import { prisma, logger, redis } from '@reskflow/shared';
import { VerificationService } from './VerificationService';
import { PhotoUploadService } from './PhotoUploadService';
import { NotificationService } from './NotificationService';
import { SafeDropService } from './SafeDropService';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface ContactlessSettings {
  orderId: string;
  enabled: boolean;
  dropLocation: 'door' | 'lobby' | 'mailroom' | 'custom';
  customLocation?: string;
  instructions?: string;
  requirePhoto: boolean;
  requireSignature: boolean;
  notifyOnDelivery: boolean;
  verificationCode?: string;
  qrCode?: string;
  safeDropEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface DropoffVerification {
  reskflowId: string;
  verificationMethod: 'photo' | 'signature' | 'qr' | 'pin';
  photoUrl?: string;
  signatureData?: string;
  location: {
    latitude: number;
    longitude: number;
  };
  timestamp: Date;
  verified: boolean;
  notes?: string;
}

interface ContactlessAnalytics {
  totalContactlessDeliveries: number;
  contactlessPercentage: number;
  preferredDropLocations: Array<{
    location: string;
    count: number;
    percentage: number;
  }>;
  verificationMethods: Array<{
    method: string;
    count: number;
    percentage: number;
  }>;
  safeDropUsage: {
    total: number;
    percentage: number;
    reasons: Array<{
      reason: string;
      count: number;
    }>;
  };
  customerSatisfaction: {
    averageRating: number;
    totalRatings: number;
  };
}

export class ContactlessDeliveryService {
  constructor(
    private verificationService: VerificationService,
    private photoUploadService: PhotoUploadService,
    private notificationService: NotificationService,
    private safeDropService: SafeDropService
  ) {}

  async enableContactlessDelivery(params: {
    orderId: string;
    customerId: string;
    dropLocation: string;
    customLocation?: string;
    instructions?: string;
    requirePhoto?: boolean;
    requireSignature?: boolean;
    notifyOnDelivery?: boolean;
  }): Promise<ContactlessSettings> {
    // Verify order belongs to customer
    const order = await prisma.order.findFirst({
      where: {
        id: params.orderId,
        customer_id: params.customerId,
        status: { in: ['confirmed', 'preparing', 'ready'] },
      },
    });

    if (!order) {
      throw new Error('Order not found or not eligible for contactless reskflow');
    }

    // Generate verification code
    const verificationCode = this.generateVerificationCode();
    const qrCode = await this.verificationService.generateQRCode({
      orderId: params.orderId,
      code: verificationCode,
    });

    // Create or update contactless settings
    const settings = await prisma.contactlessDelivery.upsert({
      where: { order_id: params.orderId },
      update: {
        enabled: true,
        drop_location: params.dropLocation,
        custom_location: params.customLocation,
        instructions: params.instructions,
        require_photo: params.requirePhoto ?? true,
        require_signature: params.requireSignature ?? false,
        notify_on_reskflow: params.notifyOnDelivery ?? true,
        verification_code: verificationCode,
        qr_code: qrCode,
        updated_at: new Date(),
      },
      create: {
        id: uuidv4(),
        order_id: params.orderId,
        enabled: true,
        drop_location: params.dropLocation,
        custom_location: params.customLocation,
        instructions: params.instructions,
        require_photo: params.requirePhoto ?? true,
        require_signature: params.requireSignature ?? false,
        notify_on_reskflow: params.notifyOnDelivery ?? true,
        verification_code: verificationCode,
        qr_code: qrCode,
        safe_drop_enabled: true,
      },
    });

    // Update order with contactless flag
    await prisma.order.update({
      where: { id: params.orderId },
      data: { 
        is_contactless: true,
        reskflow_instructions: params.instructions,
      },
    });

    // Send confirmation notification
    await this.notificationService.sendContactlessConfirmation({
      orderId: params.orderId,
      customerId: params.customerId,
      settings: this.mapToContactlessSettings(settings),
    });

    return this.mapToContactlessSettings(settings);
  }

  async getContactlessSettings(orderId: string): Promise<ContactlessSettings | null> {
    const settings = await prisma.contactlessDelivery.findUnique({
      where: { order_id: orderId },
    });

    return settings ? this.mapToContactlessSettings(settings) : null;
  }

  async updateContactlessSettings(
    orderId: string,
    customerId: string,
    updates: Partial<ContactlessSettings>
  ): Promise<ContactlessSettings> {
    // Verify order belongs to customer
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        customer_id: customerId,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const settings = await prisma.contactlessDelivery.update({
      where: { order_id: orderId },
      data: {
        drop_location: updates.dropLocation,
        custom_location: updates.customLocation,
        instructions: updates.instructions,
        require_photo: updates.requirePhoto,
        require_signature: updates.requireSignature,
        notify_on_reskflow: updates.notifyOnDelivery,
        updated_at: new Date(),
      },
    });

    // Update order instructions if changed
    if (updates.instructions !== undefined) {
      await prisma.order.update({
        where: { id: orderId },
        data: { reskflow_instructions: updates.instructions },
      });
    }

    return this.mapToContactlessSettings(settings);
  }

  async verifyDropoff(params: {
    reskflowId: string;
    driverId: string;
    photoUrl?: string;
    signatureData?: string;
    location: { latitude: number; longitude: number };
    notes?: string;
  }): Promise<DropoffVerification> {
    // Get reskflow details
    const reskflow = await prisma.reskflow.findUnique({
      where: { id: params.reskflowId },
      include: {
        order: {
          include: {
            contactlessDelivery: true,
          },
        },
      },
    });

    if (!reskflow || reskflow.driver_id !== params.driverId) {
      throw new Error('Delivery not found or unauthorized');
    }

    const contactlessSettings = reskflow.order.contactlessDelivery;
    if (!contactlessSettings || !contactlessSettings.enabled) {
      throw new Error('Contactless reskflow not enabled for this order');
    }

    // Validate required verification
    if (contactlessSettings.require_photo && !params.photoUrl) {
      throw new Error('Photo required for reskflow verification');
    }

    if (contactlessSettings.require_signature && !params.signatureData) {
      throw new Error('Signature required for reskflow verification');
    }

    // Store verification
    const verification = await prisma.reskflowVerification.create({
      data: {
        id: uuidv4(),
        reskflow_id: params.reskflowId,
        verification_method: this.determineVerificationMethod(params),
        photo_url: params.photoUrl,
        signature_data: params.signatureData,
        location_lat: params.location.latitude,
        location_lng: params.location.longitude,
        notes: params.notes,
        verified: true,
        verified_at: new Date(),
      },
    });

    // Update reskflow status
    await prisma.reskflow.update({
      where: { id: params.reskflowId },
      data: {
        status: 'delivered',
        delivered_at: new Date(),
        dropoff_photo_url: params.photoUrl,
        dropoff_location_lat: params.location.latitude,
        dropoff_location_lng: params.location.longitude,
      },
    });

    // Update order status
    await prisma.order.update({
      where: { id: reskflow.order_id },
      data: {
        status: 'delivered',
        delivered_at: new Date(),
      },
    });

    // Send reskflow notification if enabled
    if (contactlessSettings.notify_on_reskflow) {
      await this.notificationService.sendDeliveryNotification({
        orderId: reskflow.order_id,
        customerId: reskflow.order.customer_id,
        photoUrl: params.photoUrl,
        dropLocation: this.getDropLocationDescription(contactlessSettings),
      });
    }

    return {
      reskflowId: params.reskflowId,
      verificationMethod: this.determineVerificationMethod(params),
      photoUrl: params.photoUrl,
      signatureData: params.signatureData,
      location: params.location,
      timestamp: new Date(),
      verified: true,
      notes: params.notes,
    };
  }

  async getContactlessAnalytics(
    merchantId: string,
    period: string = '30d'
  ): Promise<ContactlessAnalytics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all deliveries for merchant
    const deliveries = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        status: 'delivered',
        delivered_at: { gte: startDate },
      },
      include: {
        contactlessDelivery: true,
        reskflow: {
          include: {
            verification: true,
          },
        },
        reviews: true,
      },
    });

    const contactlessDeliveries = deliveries.filter(d => d.is_contactless);
    const totalDeliveries = deliveries.length;
    const totalContactless = contactlessDeliveries.length;

    // Analyze drop locations
    const locationCounts = new Map<string, number>();
    contactlessDeliveries.forEach(reskflow => {
      const location = reskflow.contactlessDelivery?.drop_location || 'unknown';
      locationCounts.set(location, (locationCounts.get(location) || 0) + 1);
    });

    const preferredDropLocations = Array.from(locationCounts.entries())
      .map(([location, count]) => ({
        location,
        count,
        percentage: (count / totalContactless) * 100,
      }))
      .sort((a, b) => b.count - a.count);

    // Analyze verification methods
    const methodCounts = new Map<string, number>();
    contactlessDeliveries.forEach(reskflow => {
      const verification = reskflow.reskflow?.verification;
      if (verification) {
        const method = verification.verification_method;
        methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
      }
    });

    const verificationMethods = Array.from(methodCounts.entries())
      .map(([method, count]) => ({
        method,
        count,
        percentage: (count / totalContactless) * 100,
      }))
      .sort((a, b) => b.count - a.count);

    // Analyze safe drop usage
    const safeDrops = await prisma.safeDrop.findMany({
      where: {
        created_at: { gte: startDate },
        order: {
          merchant_id: merchantId,
        },
      },
    });

    const reasonCounts = new Map<string, number>();
    safeDrops.forEach(drop => {
      reasonCounts.set(drop.reason, (reasonCounts.get(drop.reason) || 0) + 1);
    });

    const safeDropUsage = {
      total: safeDrops.length,
      percentage: totalContactless > 0 ? (safeDrops.length / totalContactless) * 100 : 0,
      reasons: Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };

    // Calculate customer satisfaction
    const contactlessReviews = contactlessDeliveries
      .flatMap(d => d.reviews)
      .filter(r => r.rating_type === 'reskflow');

    const averageRating = contactlessReviews.length > 0
      ? contactlessReviews.reduce((sum, r) => sum + r.rating, 0) / contactlessReviews.length
      : 0;

    return {
      totalContactlessDeliveries: totalContactless,
      contactlessPercentage: totalDeliveries > 0 
        ? (totalContactless / totalDeliveries) * 100 
        : 0,
      preferredDropLocations,
      verificationMethods,
      safeDropUsage,
      customerSatisfaction: {
        averageRating,
        totalRatings: contactlessReviews.length,
      },
    };
  }

  private generateVerificationCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private determineVerificationMethod(params: any): string {
    if (params.photoUrl && params.signatureData) {
      return 'photo_signature';
    } else if (params.photoUrl) {
      return 'photo';
    } else if (params.signatureData) {
      return 'signature';
    }
    return 'pin';
  }

  private getDropLocationDescription(settings: any): string {
    if (settings.drop_location === 'custom' && settings.custom_location) {
      return settings.custom_location;
    }
    return settings.drop_location;
  }

  private mapToContactlessSettings(dbSettings: any): ContactlessSettings {
    return {
      orderId: dbSettings.order_id,
      enabled: dbSettings.enabled,
      dropLocation: dbSettings.drop_location,
      customLocation: dbSettings.custom_location,
      instructions: dbSettings.instructions,
      requirePhoto: dbSettings.require_photo,
      requireSignature: dbSettings.require_signature,
      notifyOnDelivery: dbSettings.notify_on_reskflow,
      verificationCode: dbSettings.verification_code,
      qrCode: dbSettings.qr_code,
      safeDropEnabled: dbSettings.safe_drop_enabled,
      createdAt: dbSettings.created_at,
      updatedAt: dbSettings.updated_at,
    };
  }
}