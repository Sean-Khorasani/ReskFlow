import { prisma, logger, redis } from '@reskflow/shared';
import { S3Service } from '@reskflow/shared';
import slugify from 'slugify';
import * as crypto from 'crypto';
import { Merchant, MerchantStatus, MerchantType } from '@prisma/client';

interface RegisterMerchantInput {
  ownerId: string;
  name: string;
  type: MerchantType;
  businessName: string;
  email: string;
  phone: string;
  description?: string;
  cuisineTypes?: string[];
  dietaryOptions?: string[];
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}

interface DocumentUpload {
  type: string;
  url: string;
  uploadedAt: Date;
  verified: boolean;
}

export class MerchantOnboardingService {
  private s3Service: S3Service;

  constructor() {
    this.s3Service = new S3Service();
  }

  async registerMerchant(input: RegisterMerchantInput): Promise<Merchant> {
    try {
      // Generate unique slug
      const baseSlug = slugify(input.name, { lower: true, strict: true });
      const slug = await this.generateUniqueSlug(baseSlug);

      // Create merchant with primary location
      const merchant = await prisma.merchant.create({
        data: {
          ownerId: input.ownerId,
          name: input.name,
          slug,
          type: input.type,
          status: MerchantStatus.PENDING_VERIFICATION,
          businessName: input.businessName,
          email: input.email,
          phone: input.phone,
          description: input.description,
          cuisineTypes: input.cuisineTypes || [],
          dietaryOptions: input.dietaryOptions || [],
          locations: {
            create: {
              isPrimary: true,
              name: 'Primary Location',
              street: input.street,
              city: input.city,
              state: input.state,
              country: input.country,
              postalCode: input.postalCode,
              latitude: input.latitude,
              longitude: input.longitude,
              phone: input.phone,
              email: input.email,
            },
          },
          // Create default operating hours (9 AM - 9 PM)
          operatingHours: {
            create: Array.from({ length: 7 }, (_, day) => ({
              dayOfWeek: day,
              openTime: '09:00',
              closeTime: '21:00',
              isOpen: true,
            })),
          },
        },
        include: {
          locations: true,
          operatingHours: true,
        },
      });

      // Create onboarding checklist in Redis
      await this.createOnboardingChecklist(merchant.id);

      // Send notification to admin for verification
      await this.notifyAdminForVerification(merchant);

      logger.info(`Merchant registered: ${merchant.id} - ${merchant.name}`);
      return merchant;
    } catch (error) {
      logger.error('Failed to register merchant', error);
      throw error;
    }
  }

  async verifyMerchant(
    merchantId: string,
    approved: boolean,
    reason?: string
  ): Promise<{ success: boolean; merchant?: Merchant }> {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
      });

      if (!merchant) {
        throw new Error('Merchant not found');
      }

      if (merchant.status !== MerchantStatus.PENDING_VERIFICATION) {
        throw new Error('Merchant is not pending verification');
      }

      const updatedMerchant = await prisma.merchant.update({
        where: { id: merchantId },
        data: {
          status: approved ? MerchantStatus.ACTIVE : MerchantStatus.REJECTED,
          verifiedAt: approved ? new Date() : null,
        },
      });

      // Send notification to merchant
      await this.notifyMerchantVerificationResult(updatedMerchant, approved, reason);

      // If approved, initialize merchant services
      if (approved) {
        await this.initializeMerchantServices(merchantId);
      }

      logger.info(`Merchant ${merchantId} verification: ${approved ? 'approved' : 'rejected'}`);
      return { success: true, merchant: updatedMerchant };
    } catch (error) {
      logger.error('Failed to verify merchant', error);
      throw error;
    }
  }

  async uploadDocuments(
    merchantId: string,
    files: Express.Multer.File[],
    documentTypes: string[]
  ): Promise<DocumentUpload[]> {
    try {
      const documents: DocumentUpload[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const documentType = documentTypes[i];

        // Upload to S3
        const key = `merchants/${merchantId}/documents/${documentType}-${Date.now()}-${file.originalname}`;
        const url = await this.s3Service.uploadFile(file.buffer, key, file.mimetype);

        documents.push({
          type: documentType,
          url,
          uploadedAt: new Date(),
          verified: false,
        });

        // Store document info in database
        await prisma.$executeRaw`
          UPDATE "Merchant" 
          SET "documents" = COALESCE("documents", '[]'::jsonb) || ${JSON.stringify([{
            type: documentType,
            url,
            uploadedAt: new Date(),
            verified: false,
          }])}::jsonb
          WHERE id = ${merchantId}
        `;
      }

      // Update onboarding checklist
      await this.updateOnboardingChecklist(merchantId, 'documents', true);

      logger.info(`Documents uploaded for merchant ${merchantId}`);
      return documents;
    } catch (error) {
      logger.error('Failed to upload documents', error);
      throw error;
    }
  }

  private async generateUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await prisma.merchant.findUnique({
        where: { slug },
      });

      if (!existing) {
        return slug;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  private async createOnboardingChecklist(merchantId: string): Promise<void> {
    const checklist = {
      basicInfo: true,
      documents: false,
      bankAccount: false,
      menu: false,
      photos: false,
      training: false,
    };

    await redis.set(
      `onboarding:${merchantId}`,
      JSON.stringify(checklist),
      'EX',
      30 * 24 * 60 * 60 // 30 days
    );
  }

  private async updateOnboardingChecklist(
    merchantId: string,
    step: string,
    completed: boolean
  ): Promise<void> {
    const key = `onboarding:${merchantId}`;
    const checklistStr = await redis.get(key);
    
    if (checklistStr) {
      const checklist = JSON.parse(checklistStr);
      checklist[step] = completed;
      
      await redis.set(key, JSON.stringify(checklist), 'EX', 30 * 24 * 60 * 60);

      // Check if onboarding is complete
      const isComplete = Object.values(checklist).every((value) => value === true);
      if (isComplete) {
        await this.completeOnboarding(merchantId);
      }
    }
  }

  private async completeOnboarding(merchantId: string): Promise<void> {
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { 
        status: MerchantStatus.ACTIVE,
        isOpen: true,
      },
    });

    logger.info(`Merchant ${merchantId} onboarding completed`);
  }

  private async notifyAdminForVerification(merchant: Merchant): Promise<void> {
    // TODO: Implement notification service integration
    logger.info(`Admin notification sent for merchant ${merchant.id}`);
  }

  private async notifyMerchantVerificationResult(
    merchant: Merchant,
    approved: boolean,
    reason?: string
  ): Promise<void> {
    // TODO: Implement notification service integration
    logger.info(`Merchant ${merchant.id} notified of verification result`);
  }

  private async initializeMerchantServices(merchantId: string): Promise<void> {
    // Generate API keys
    const apiKey = crypto.randomBytes(32).toString('hex');
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    // Store in Redis
    await redis.set(`merchant:${merchantId}:apiKey`, apiKey);
    await redis.set(`merchant:${merchantId}:webhookSecret`, webhookSecret);

    // Create default menu categories
    await prisma.menu.create({
      data: {
        merchantId,
        name: 'Main Menu',
        description: 'Default menu',
        isActive: true,
        categories: {
          create: [
            { name: 'Popular Items', sortOrder: 0 },
            { name: 'Main Courses', sortOrder: 1 },
            { name: 'Beverages', sortOrder: 2 },
          ],
        },
      },
    });

    logger.info(`Merchant services initialized for ${merchantId}`);
  }
}