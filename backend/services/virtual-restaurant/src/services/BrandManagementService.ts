import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import AWS from 'aws-sdk';

interface Brand {
  id: string;
  name: string;
  description: string;
  values: string[];
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
    text?: string;
    background?: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  logo?: string;
  favicon?: string;
  createdAt: Date;
}

interface BrandAssets {
  logo: {
    full: string;
    icon: string;
    wordmark: string;
  };
  colors: {
    palette: string[];
    guidelines: string;
  };
  typography: {
    specimens: string[];
    guidelines: string;
  };
  templates: {
    menuHeader: string;
    menuItem: string;
    promotion: string;
    socialMedia: {
      instagram: string;
      facebook: string;
      twitter: string;
    };
  };
}

interface CreateBrandParams {
  name: string;
  description: string;
  values: string[];
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  logo?: Express.Multer.File;
  ownerId: string;
}

export class BrandManagementService {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.bucketName = process.env.S3_BUCKET_NAME || 'reskflow-brand-assets';
  }

  async createBrand(params: CreateBrandParams): Promise<Brand> {
    let logoUrl: string | undefined;

    // Upload logo if provided
    if (params.logo) {
      logoUrl = await this.uploadBrandAsset(
        params.logo.buffer,
        `logos/${uuidv4()}-${params.logo.originalname}`
      );
    }

    // Create brand record
    const brand = await prisma.brand.create({
      data: {
        id: uuidv4(),
        name: params.name,
        description: params.description,
        values: params.values,
        colors: params.colors,
        fonts: params.fonts,
        logo_url: logoUrl,
        owner_id: params.ownerId,
        created_at: new Date(),
      },
    });

    // Generate initial brand assets
    await this.generateInitialAssets(brand.id);

    return this.mapToBrand(brand);
  }

  async updateBrand(
    brandId: string,
    updates: Partial<Brand>,
    userId: string
  ): Promise<Brand> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
    });

    if (!brand || brand.owner_id !== userId) {
      throw new Error('Brand not found or unauthorized');
    }

    const updated = await prisma.brand.update({
      where: { id: brandId },
      data: {
        name: updates.name,
        description: updates.description,
        values: updates.values,
        colors: updates.colors,
        fonts: updates.fonts,
        updated_at: new Date(),
      },
    });

    // Regenerate assets if visual elements changed
    if (updates.colors || updates.fonts) {
      await this.regenerateAssets(brandId);
    }

    return this.mapToBrand(updated);
  }

  async getBrandAssets(brandId: string): Promise<BrandAssets> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      include: {
        assets: true,
      },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    // Get or generate assets
    const assets = await this.getOrGenerateAssets(brand);

    return {
      logo: {
        full: assets.logo_full || brand.logo_url || '',
        icon: assets.logo_icon || '',
        wordmark: assets.logo_wordmark || '',
      },
      colors: {
        palette: this.generateColorPalette(brand.colors),
        guidelines: assets.color_guidelines || '',
      },
      typography: {
        specimens: [assets.typography_specimen || ''],
        guidelines: assets.typography_guidelines || '',
      },
      templates: {
        menuHeader: assets.template_menu_header || '',
        menuItem: assets.template_menu_item || '',
        promotion: assets.template_promotion || '',
        socialMedia: {
          instagram: assets.template_social_instagram || '',
          facebook: assets.template_social_facebook || '',
          twitter: assets.template_social_twitter || '',
        },
      },
    };
  }

  async generateBrandAssets(
    brandId: string,
    assetTypes: string[]
  ): Promise<{ [key: string]: string }> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    const generatedAssets: { [key: string]: string } = {};

    for (const assetType of assetTypes) {
      switch (assetType) {
        case 'logo_variations':
          generatedAssets.logoVariations = await this.generateLogoVariations(brand);
          break;
        case 'color_palette':
          generatedAssets.colorPalette = await this.generateExtendedColorPalette(brand);
          break;
        case 'menu_template':
          generatedAssets.menuTemplate = await this.generateMenuTemplate(brand);
          break;
        case 'social_templates':
          generatedAssets.socialTemplates = await this.generateSocialTemplates(brand);
          break;
        case 'brand_guidelines':
          generatedAssets.brandGuidelines = await this.generateBrandGuidelines(brand);
          break;
      }
    }

    // Store generated assets
    await this.storeGeneratedAssets(brandId, generatedAssets);

    return generatedAssets;
  }

  async cloneBrand(
    sourceBrandId: string,
    targetRestaurantId: string,
    newName: string
  ): Promise<Brand> {
    const source = await prisma.brand.findUnique({
      where: { id: sourceBrandId },
    });

    if (!source) {
      throw new Error('Source brand not found');
    }

    // Create new brand with cloned attributes
    const cloned = await prisma.brand.create({
      data: {
        id: uuidv4(),
        name: newName,
        description: source.description,
        values: source.values,
        colors: source.colors,
        fonts: source.fonts,
        owner_id: source.owner_id,
        virtual_restaurant_id: targetRestaurantId,
        created_at: new Date(),
      },
    });

    // Clone assets
    if (source.logo_url) {
      // Copy logo to new location
      const newLogoUrl = await this.copyAsset(source.logo_url, `logos/${cloned.id}`);
      await prisma.brand.update({
        where: { id: cloned.id },
        data: { logo_url: newLogoUrl },
      });
    }

    return this.mapToBrand(cloned);
  }

  async createBrandVariation(
    baseBrandId: string,
    variation: {
      name: string;
      colorScheme: 'light' | 'dark' | 'custom';
      customColors?: any;
    }
  ): Promise<Brand> {
    const baseBrand = await prisma.brand.findUnique({
      where: { id: baseBrandId },
    });

    if (!baseBrand) {
      throw new Error('Base brand not found');
    }

    // Generate color variation
    let colors = baseBrand.colors;
    if (variation.colorScheme === 'dark') {
      colors = this.generateDarkTheme(baseBrand.colors);
    } else if (variation.colorScheme === 'custom' && variation.customColors) {
      colors = { ...baseBrand.colors, ...variation.customColors };
    }

    // Create variation
    const brandVariation = await prisma.brand.create({
      data: {
        id: uuidv4(),
        name: variation.name,
        description: `${baseBrand.description} - ${variation.colorScheme} variant`,
        values: baseBrand.values,
        colors,
        fonts: baseBrand.fonts,
        parent_brand_id: baseBrandId,
        owner_id: baseBrand.owner_id,
        created_at: new Date(),
      },
    });

    return this.mapToBrand(brandVariation);
  }

  async applyBrandToMenu(brandId: string, menuId: string): Promise<void> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }

    // Get menu items
    const menuItems = await prisma.menuItem.findMany({
      where: { menu_id: menuId },
    });

    // Generate branded menu assets
    for (const item of menuItems) {
      const brandedImage = await this.generateBrandedItemImage(
        item,
        brand
      );

      await prisma.menuItem.update({
        where: { id: item.id },
        data: {
          branded_image_url: brandedImage,
          brand_colors: brand.colors,
        },
      });
    }

    // Update menu with brand
    await prisma.menu.update({
      where: { id: menuId },
      data: {
        brand_id: brandId,
        brand_applied_at: new Date(),
      },
    });
  }

  private async generateInitialAssets(brandId: string): Promise<void> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
    });

    if (!brand) return;

    // Generate color palette
    const colorPalette = this.generateColorPalette(brand.colors);
    
    // Generate typography specimen
    const typographySpecimen = await this.generateTypographySpecimen(brand);

    // Store initial assets
    await prisma.brandAsset.create({
      data: {
        brand_id: brandId,
        color_palette: colorPalette,
        typography_specimen: typographySpecimen,
        generated_at: new Date(),
      },
    });
  }

  private async generateLogoVariations(brand: any): Promise<string> {
    if (!brand.logo_url) {
      return '';
    }

    // Download original logo
    const logoBuffer = await this.downloadAsset(brand.logo_url);

    // Generate variations
    const variations = await Promise.all([
      // Icon version (square crop)
      sharp(logoBuffer)
        .resize(512, 512, { fit: 'contain', background: 'transparent' })
        .toBuffer(),
      
      // Wordmark version (horizontal crop)
      sharp(logoBuffer)
        .resize(1200, 300, { fit: 'contain', background: 'transparent' })
        .toBuffer(),
      
      // Monochrome version
      sharp(logoBuffer)
        .grayscale()
        .toBuffer(),
    ]);

    // Upload variations
    const urls = await Promise.all([
      this.uploadBrandAsset(variations[0], `logos/${brand.id}/icon.png`),
      this.uploadBrandAsset(variations[1], `logos/${brand.id}/wordmark.png`),
      this.uploadBrandAsset(variations[2], `logos/${brand.id}/mono.png`),
    ]);

    return urls.join(',');
  }

  private generateColorPalette(colors: any): string[] {
    const palette: string[] = [colors.primary, colors.secondary];
    
    if (colors.accent) palette.push(colors.accent);
    
    // Generate tints and shades
    const primary = colors.primary;
    palette.push(
      this.adjustColor(primary, 0.2), // Lighter
      this.adjustColor(primary, -0.2), // Darker
    );

    return palette;
  }

  private generateExtendedColorPalette(brand: any): Promise<string> {
    // Generate comprehensive color system
    const extendedPalette = {
      primary: this.generateColorScale(brand.colors.primary),
      secondary: this.generateColorScale(brand.colors.secondary),
      neutral: this.generateNeutralScale(),
      semantic: {
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
      },
    };

    return Promise.resolve(JSON.stringify(extendedPalette));
  }

  private async generateMenuTemplate(brand: any): Promise<string> {
    // Generate HTML/CSS template for menu
    const template = `
      <style>
        .menu-header {
          background-color: ${brand.colors.primary};
          color: ${brand.colors.text || '#FFFFFF'};
          font-family: ${brand.fonts.heading}, sans-serif;
          padding: 2rem;
        }
        .menu-item {
          font-family: ${brand.fonts.body}, sans-serif;
          border-left: 4px solid ${brand.colors.secondary};
        }
      </style>
      <div class="menu-template">
        <!-- Menu template structure -->
      </div>
    `;

    const url = await this.uploadBrandAsset(
      Buffer.from(template),
      `templates/${brand.id}/menu.html`
    );

    return url;
  }

  private async generateSocialTemplates(brand: any): Promise<string> {
    // Generate social media post templates
    const templates = {
      instagram: await this.generateInstagramTemplate(brand),
      facebook: await this.generateFacebookTemplate(brand),
      twitter: await this.generateTwitterTemplate(brand),
    };

    return JSON.stringify(templates);
  }

  private async generateBrandGuidelines(brand: any): Promise<string> {
    // Generate comprehensive brand guidelines document
    const guidelines = {
      mission: brand.description,
      values: brand.values,
      voice: this.generateBrandVoice(brand.values),
      visualIdentity: {
        colors: brand.colors,
        typography: brand.fonts,
        spacing: this.generateSpacingSystem(),
        imagery: this.generateImageryGuidelines(brand),
      },
      usage: {
        dos: this.generateUsageDos(brand),
        donts: this.generateUsageDonts(brand),
      },
    };

    const url = await this.uploadBrandAsset(
      Buffer.from(JSON.stringify(guidelines, null, 2)),
      `guidelines/${brand.id}/brand-guidelines.json`
    );

    return url;
  }

  private async generateBrandedItemImage(item: any, brand: any): Promise<string> {
    // Create branded image for menu item
    const width = 800;
    const height = 600;
    
    // Create base image with brand colors
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="${brand.colors.background || '#FFFFFF'}"/>
        <rect x="0" y="0" width="${width}" height="80" fill="${brand.colors.primary}"/>
        <text x="40" y="50" font-family="${brand.fonts.heading}" font-size="32" fill="white">
          ${item.name}
        </text>
        <text x="40" y="150" font-family="${brand.fonts.body}" font-size="18" fill="${brand.colors.text || '#333333'}">
          ${item.description || ''}
        </text>
        <text x="40" y="550" font-family="${brand.fonts.heading}" font-size="36" fill="${brand.colors.primary}">
          $${item.price}
        </text>
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();

    const url = await this.uploadBrandAsset(
      buffer,
      `menu-items/${brand.id}/${item.id}.png`
    );

    return url;
  }

  private async uploadBrandAsset(buffer: Buffer, key: string): Promise<string> {
    const params = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: this.getContentType(key),
    };

    await this.s3.upload(params).promise();
    return `https://${this.bucketName}.s3.amazonaws.com/${key}`;
  }

  private async downloadAsset(url: string): Promise<Buffer> {
    // Download asset from S3 or external URL
    // Implementation depends on storage strategy
    return Buffer.from('');
  }

  private async copyAsset(sourceUrl: string, destKey: string): Promise<string> {
    // Copy S3 object to new location
    const sourceKey = sourceUrl.split('.com/')[1];
    
    await this.s3.copyObject({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${sourceKey}`,
      Key: destKey,
    }).promise();

    return `https://${this.bucketName}.s3.amazonaws.com/${destKey}`;
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: { [key: string]: string } = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      html: 'text/html',
      css: 'text/css',
      json: 'application/json',
    };
    return types[ext || ''] || 'application/octet-stream';
  }

  private adjustColor(hex: string, amount: number): string {
    // Adjust color brightness
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount * 255));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount * 255));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount * 255));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  private generateColorScale(baseColor: string): string[] {
    const scale: string[] = [];
    for (let i = -4; i <= 4; i++) {
      scale.push(this.adjustColor(baseColor, i * 0.1));
    }
    return scale;
  }

  private generateNeutralScale(): string[] {
    return [
      '#FFFFFF',
      '#F9FAFB',
      '#F3F4F6',
      '#E5E7EB',
      '#D1D5DB',
      '#9CA3AF',
      '#6B7280',
      '#4B5563',
      '#374151',
      '#1F2937',
      '#111827',
    ];
  }

  private generateDarkTheme(lightColors: any): any {
    return {
      primary: this.adjustColor(lightColors.primary, -0.3),
      secondary: this.adjustColor(lightColors.secondary, -0.3),
      accent: lightColors.accent ? this.adjustColor(lightColors.accent, -0.3) : undefined,
      text: '#FFFFFF',
      background: '#1A1A1A',
    };
  }

  private generateBrandVoice(values: string[]): any {
    const voiceMap: { [key: string]: string } = {
      quality: 'Professional and refined',
      innovation: 'Forward-thinking and modern',
      convenience: 'Clear and efficient',
      authentic: 'Genuine and approachable',
      sustainable: 'Conscious and responsible',
    };

    return values.map(v => voiceMap[v] || 'Friendly and approachable');
  }

  private generateSpacingSystem(): any {
    return {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
      '2xl': '3rem',
    };
  }

  private generateImageryGuidelines(brand: any): any {
    return {
      style: 'Modern and clean',
      filters: `Use ${brand.colors.primary} overlay at 20% opacity`,
      composition: 'Center-focused with ample negative space',
      mood: brand.values.includes('premium') ? 'Elegant and sophisticated' : 'Warm and inviting',
    };
  }

  private generateUsageDos(brand: any): string[] {
    return [
      `Use ${brand.fonts.heading} for all headlines`,
      `Maintain minimum spacing of 1rem around logo`,
      `Use primary color for CTAs and important elements`,
      'Ensure sufficient contrast for accessibility',
    ];
  }

  private generateUsageDonts(brand: any): string[] {
    return [
      'Don\'t alter logo proportions',
      'Don\'t use low-contrast color combinations',
      'Don\'t mix brand fonts with others',
      'Don\'t use more than 3 colors in one composition',
    ];
  }

  private async generateInstagramTemplate(brand: any): Promise<string> {
    // Instagram post template (1080x1080)
    return 'instagram-template-url';
  }

  private async generateFacebookTemplate(brand: any): Promise<string> {
    // Facebook post template (1200x630)
    return 'facebook-template-url';
  }

  private async generateTwitterTemplate(brand: any): Promise<string> {
    // Twitter post template (1200x675)
    return 'twitter-template-url';
  }

  private async getOrGenerateAssets(brand: any): Promise<any> {
    let assets = await prisma.brandAsset.findFirst({
      where: { brand_id: brand.id },
    });

    if (!assets) {
      await this.generateInitialAssets(brand.id);
      assets = await prisma.brandAsset.findFirst({
        where: { brand_id: brand.id },
      });
    }

    return assets || {};
  }

  private async regenerateAssets(brandId: string): Promise<void> {
    await this.generateInitialAssets(brandId);
  }

  private async storeGeneratedAssets(
    brandId: string,
    assets: { [key: string]: string }
  ): Promise<void> {
    await prisma.brandAsset.upsert({
      where: { brand_id: brandId },
      update: {
        ...assets,
        updated_at: new Date(),
      },
      create: {
        brand_id: brandId,
        ...assets,
        generated_at: new Date(),
      },
    });
  }

  private async generateTypographySpecimen(brand: any): Promise<string> {
    // Generate typography specimen showing font usage
    const specimen = `
      <div style="font-family: ${brand.fonts.heading}">
        <h1>Heading Font: ${brand.fonts.heading}</h1>
        <h2>The quick brown fox jumps over the lazy dog</h2>
      </div>
      <div style="font-family: ${brand.fonts.body}">
        <p>Body Font: ${brand.fonts.body}</p>
        <p>The quick brown fox jumps over the lazy dog</p>
      </div>
    `;
    
    return specimen;
  }

  private mapToBrand(dbBrand: any): Brand {
    return {
      id: dbBrand.id,
      name: dbBrand.name,
      description: dbBrand.description,
      values: dbBrand.values,
      colors: dbBrand.colors,
      fonts: dbBrand.fonts,
      logo: dbBrand.logo_url,
      favicon: dbBrand.favicon_url,
      createdAt: dbBrand.created_at,
    };
  }
}