import { prisma, logger, redis } from '@reskflow/shared';
import { S3Service } from '@reskflow/shared';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import { Readable } from 'stream';
import {
  Menu,
  MenuItem,
  MenuCategory,
  MenuItemStatus,
  OperatingHours,
  ModifierGroup,
  Modifier,
} from '@prisma/client';

interface CreateMenuInput {
  name: string;
  description?: string;
  availableFrom?: Date;
  availableTo?: Date;
  availableDays?: number[];
}

interface CreateMenuItemInput {
  merchantId: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  compareAtPrice?: number;
  images?: Express.Multer.File[];
  sku?: string;
  trackInventory?: boolean;
  quantity?: number;
  preparationTime?: number;
  nutritionInfo?: any;
  allergens?: string[];
  isVegetarian?: boolean;
  isVegan?: boolean;
  isGlutenFree?: boolean;
  isSpicy?: boolean;
  modifierGroups?: CreateModifierGroupInput[];
}

interface CreateModifierGroupInput {
  name: string;
  description?: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: {
    name: string;
    price: number;
    isDefault?: boolean;
    maxQuantity?: number;
  }[];
}

interface BulkImportResult {
  totalItems: number;
  successCount: number;
  failedCount: number;
  errors: { row: number; error: string }[];
}

export class MenuManagementService {
  private s3Service: S3Service;

  constructor() {
    this.s3Service = new S3Service();
  }

  async getMenus(merchantId: string): Promise<Menu[]> {
    return prisma.menu.findMany({
      where: { merchantId },
      include: {
        categories: {
          include: {
            items: {
              where: { status: MenuItemStatus.AVAILABLE },
              include: {
                modifierGroups: {
                  include: { modifiers: true },
                },
              },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createMenu(merchantId: string, input: CreateMenuInput): Promise<Menu> {
    try {
      const menuCount = await prisma.menu.count({ where: { merchantId } });

      const menu = await prisma.menu.create({
        data: {
          merchantId,
          name: input.name,
          description: input.description,
          availableFrom: input.availableFrom,
          availableTo: input.availableTo,
          availableDays: input.availableDays || [],
          sortOrder: menuCount,
        },
        include: { categories: true },
      });

      // Invalidate cache
      await redis.del(`merchant:${merchantId}:menus`);

      logger.info(`Menu created: ${menu.id} for merchant ${merchantId}`);
      return menu;
    } catch (error) {
      logger.error('Failed to create menu', error);
      throw error;
    }
  }

  async createMenuItem(input: CreateMenuItemInput): Promise<MenuItem> {
    try {
      // Upload images if provided
      const imageUrls: string[] = [];
      if (input.images && input.images.length > 0) {
        for (const image of input.images) {
          const key = `merchants/${input.merchantId}/menu-items/${Date.now()}-${image.originalname}`;
          const url = await this.s3Service.uploadFile(image.buffer, key, image.mimetype);
          imageUrls.push(url);
        }
      }

      // Create menu item with modifiers
      const menuItem = await prisma.$transaction(async (tx) => {
        const item = await tx.menuItem.create({
          data: {
            merchantId: input.merchantId,
            categoryId: input.categoryId,
            name: input.name,
            description: input.description,
            price: input.price,
            compareAtPrice: input.compareAtPrice,
            images: imageUrls,
            sku: input.sku,
            trackInventory: input.trackInventory || false,
            quantity: input.quantity || 0,
            preparationTime: input.preparationTime,
            nutritionInfo: input.nutritionInfo,
            allergens: input.allergens || [],
            isVegetarian: input.isVegetarian || false,
            isVegan: input.isVegan || false,
            isGlutenFree: input.isGlutenFree || false,
            isSpicy: input.isSpicy || false,
            status: MenuItemStatus.AVAILABLE,
          },
        });

        // Create modifier groups if provided
        if (input.modifierGroups && input.modifierGroups.length > 0) {
          for (let i = 0; i < input.modifierGroups.length; i++) {
            const groupInput = input.modifierGroups[i];
            const group = await tx.modifierGroup.create({
              data: {
                menuItemId: item.id,
                name: groupInput.name,
                description: groupInput.description,
                isRequired: groupInput.isRequired,
                minSelections: groupInput.minSelections,
                maxSelections: groupInput.maxSelections,
                sortOrder: i,
                modifiers: {
                  create: groupInput.modifiers.map((mod, j) => ({
                    name: mod.name,
                    price: mod.price,
                    isDefault: mod.isDefault || false,
                    maxQuantity: mod.maxQuantity || 1,
                    sortOrder: j,
                  })),
                },
              },
            });
          }
        }

        return item;
      });

      // Update search index
      await this.updateSearchIndex(menuItem);

      // Invalidate cache
      await redis.del(`merchant:${input.merchantId}:menu-items`);

      logger.info(`Menu item created: ${menuItem.id} for merchant ${input.merchantId}`);
      return menuItem;
    } catch (error) {
      logger.error('Failed to create menu item', error);
      throw error;
    }
  }

  async bulkImportItems(
    merchantId: string,
    file: Express.Multer.File
  ): Promise<BulkImportResult> {
    const result: BulkImportResult = {
      totalItems: 0,
      successCount: 0,
      failedCount: 0,
      errors: [],
    };

    try {
      const items = await this.parseImportFile(file);
      result.totalItems = items.length;

      // Get or create default category
      let defaultCategory = await prisma.menuCategory.findFirst({
        where: {
          menu: { merchantId },
          name: 'Imported Items',
        },
      });

      if (!defaultCategory) {
        const defaultMenu = await prisma.menu.findFirst({
          where: { merchantId },
        });

        if (!defaultMenu) {
          throw new Error('No menu found for merchant');
        }

        defaultCategory = await prisma.menuCategory.create({
          data: {
            menuId: defaultMenu.id,
            name: 'Imported Items',
            sortOrder: 999,
          },
        });
      }

      // Process items in batches
      const batchSize = 50;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (item, index) => {
            try {
              await this.createMenuItem({
                merchantId,
                categoryId: item.categoryId || defaultCategory.id,
                name: item.name,
                description: item.description,
                price: parseFloat(item.price),
                sku: item.sku,
                trackInventory: item.trackInventory === 'true',
                quantity: parseInt(item.quantity || '0'),
                allergens: item.allergens ? item.allergens.split(',') : [],
                isVegetarian: item.isVegetarian === 'true',
                isVegan: item.isVegan === 'true',
                isGlutenFree: item.isGlutenFree === 'true',
                isSpicy: item.isSpicy === 'true',
              });
              result.successCount++;
            } catch (error: any) {
              result.failedCount++;
              result.errors.push({
                row: i + index + 1,
                error: error.message,
              });
            }
          })
        );
      }

      logger.info(`Bulk import completed for merchant ${merchantId}: ${result.successCount}/${result.totalItems} successful`);
      return result;
    } catch (error) {
      logger.error('Bulk import failed', error);
      throw error;
    }
  }

  async getOperatingHours(merchantId: string): Promise<OperatingHours[]> {
    return prisma.operatingHours.findMany({
      where: { merchantId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async updateOperatingHours(
    merchantId: string,
    hours: Array<{
      dayOfWeek: number;
      openTime: string;
      closeTime: string;
      isOpen: boolean;
    }>
  ): Promise<OperatingHours[]> {
    try {
      // Delete existing hours
      await prisma.operatingHours.deleteMany({
        where: { merchantId },
      });

      // Create new hours
      const operatingHours = await prisma.operatingHours.createMany({
        data: hours.map((h) => ({
          merchantId,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isOpen: h.isOpen,
        })),
      });

      // Update merchant open status based on current day/time
      await this.updateMerchantOpenStatus(merchantId);

      logger.info(`Operating hours updated for merchant ${merchantId}`);
      return prisma.operatingHours.findMany({
        where: { merchantId },
        orderBy: { dayOfWeek: 'asc' },
      });
    } catch (error) {
      logger.error('Failed to update operating hours', error);
      throw error;
    }
  }

  private async parseImportFile(file: Express.Multer.File): Promise<any[]> {
    const extension = file.originalname.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      return this.parseCSV(file.buffer);
    } else if (extension === 'xlsx' || extension === 'xls') {
      return this.parseExcel(file.buffer);
    } else {
      throw new Error('Unsupported file format. Please use CSV or Excel.');
    }
  }

  private parseCSV(buffer: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  private parseExcel(buffer: Buffer): any[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
  }

  private async updateSearchIndex(menuItem: MenuItem): Promise<void> {
    // TODO: Integrate with search service (Elasticsearch/Algolia)
    const searchData = {
      id: menuItem.id,
      merchantId: menuItem.merchantId,
      name: menuItem.name,
      description: menuItem.description,
      price: menuItem.price,
      tags: [
        ...(menuItem.isVegetarian ? ['vegetarian'] : []),
        ...(menuItem.isVegan ? ['vegan'] : []),
        ...(menuItem.isGlutenFree ? ['gluten-free'] : []),
        ...(menuItem.isSpicy ? ['spicy'] : []),
      ],
      allergens: menuItem.allergens,
    };

    await redis.set(
      `search:menu-item:${menuItem.id}`,
      JSON.stringify(searchData),
      'EX',
      86400 // 24 hours
    );
  }

  private async updateMerchantOpenStatus(merchantId: string): Promise<void> {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0-6 (Sun-Sat)
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const todayHours = await prisma.operatingHours.findUnique({
      where: {
        merchantId_dayOfWeek: {
          merchantId,
          dayOfWeek,
        },
      },
    });

    if (todayHours && todayHours.isOpen) {
      const isOpen = currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime;
      
      await prisma.merchant.update({
        where: { id: merchantId },
        data: { isOpen },
      });
    } else {
      await prisma.merchant.update({
        where: { id: merchantId },
        data: { isOpen: false },
      });
    }
  }
}