import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';

interface DeliveryNotification {
  type: 'contactless_confirmed' | 'reskflow_approaching' | 'delivered' | 'safe_drop';
  orderId: string;
  customerId: string;
  data: any;
}

export class NotificationService {
  constructor(private notificationQueue: Bull.Queue) {}

  async sendContactlessConfirmation(params: {
    orderId: string;
    customerId: string;
    settings: any;
  }): Promise<void> {
    await this.notificationQueue.add('send-notification', {
      type: 'contactless_confirmed',
      orderId: params.orderId,
      customerId: params.customerId,
      data: {
        settings: params.settings,
        message: 'Contactless reskflow has been enabled for your order',
      },
    });
  }

  async sendDeliveryApproaching(params: {
    orderId: string;
    customerId: string;
    estimatedArrival: Date;
    driverLocation?: { latitude: number; longitude: number };
  }): Promise<void> {
    await this.notificationQueue.add('send-notification', {
      type: 'reskflow_approaching',
      orderId: params.orderId,
      customerId: params.customerId,
      data: {
        estimatedArrival: params.estimatedArrival,
        driverLocation: params.driverLocation,
        message: `Your reskflow is approaching! ETA: ${dayjs(params.estimatedArrival).format('h:mm A')}`,
      },
    });
  }

  async sendDeliveryNotification(params: {
    orderId: string;
    customerId: string;
    photoUrl?: string;
    dropLocation: string;
  }): Promise<void> {
    await this.notificationQueue.add('send-notification', {
      type: 'delivered',
      orderId: params.orderId,
      customerId: params.customerId,
      data: {
        photoUrl: params.photoUrl,
        dropLocation: params.dropLocation,
        message: `Your order has been delivered to: ${params.dropLocation}`,
      },
    });
  }

  async sendSafeDropNotification(params: {
    orderId: string;
    customerId: string;
    reason: string;
    safeLocation: string;
    photoUrl?: string;
  }): Promise<void> {
    await this.notificationQueue.add('send-notification', {
      type: 'safe_drop',
      orderId: params.orderId,
      customerId: params.customerId,
      data: {
        reason: params.reason,
        safeLocation: params.safeLocation,
        photoUrl: params.photoUrl,
        message: `Your order was safely delivered to: ${params.safeLocation}. Reason: ${params.reason}`,
      },
    });
  }

  async processNotification(notification: DeliveryNotification): Promise<void> {
    try {
      // Get customer preferences
      const customer = await prisma.customer.findUnique({
        where: { id: notification.customerId },
        include: {
          notificationPreferences: true,
        },
      });

      if (!customer) {
        logger.error(`Customer not found: ${notification.customerId}`);
        return;
      }

      // Check if customer has enabled this type of notification
      const preferences = customer.notificationPreferences;
      
      if (!this.shouldSendNotification(notification.type, preferences)) {
        logger.info(`Notification skipped due to preferences: ${notification.type}`);
        return;
      }

      // Send via appropriate channels
      const channels = this.getNotificationChannels(preferences);

      for (const channel of channels) {
        await this.sendViaChannel(channel, notification, customer);
      }

      // Log notification
      await prisma.notificationLog.create({
        data: {
          customer_id: notification.customerId,
          order_id: notification.orderId,
          type: notification.type,
          channels: channels,
          data: notification.data,
          sent_at: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error processing notification:', error);
      throw error;
    }
  }

  private shouldSendNotification(type: string, preferences: any): boolean {
    if (!preferences) return true; // Default to sending if no preferences

    switch (type) {
      case 'contactless_confirmed':
        return preferences.order_updates !== false;
      case 'reskflow_approaching':
        return preferences.reskflow_updates !== false;
      case 'delivered':
        return preferences.reskflow_confirmation !== false;
      case 'safe_drop':
        return preferences.reskflow_confirmation !== false;
      default:
        return true;
    }
  }

  private getNotificationChannels(preferences: any): string[] {
    const channels: string[] = [];

    if (!preferences) {
      return ['push', 'email']; // Default channels
    }

    if (preferences.push_enabled !== false) channels.push('push');
    if (preferences.email_enabled !== false) channels.push('email');
    if (preferences.sms_enabled === true) channels.push('sms');

    return channels;
  }

  private async sendViaChannel(
    channel: string,
    notification: DeliveryNotification,
    customer: any
  ): Promise<void> {
    switch (channel) {
      case 'push':
        await this.sendPushNotification(notification, customer);
        break;
      case 'email':
        await this.sendEmailNotification(notification, customer);
        break;
      case 'sms':
        await this.sendSMSNotification(notification, customer);
        break;
    }
  }

  private async sendPushNotification(
    notification: DeliveryNotification,
    customer: any
  ): Promise<void> {
    // Integration with push notification service (FCM, APNS, etc.)
    logger.info(`Sending push notification to ${customer.id}: ${notification.data.message}`);
    
    // This would integrate with your push notification service
    // For now, we'll just log it
  }

  private async sendEmailNotification(
    notification: DeliveryNotification,
    customer: any
  ): Promise<void> {
    // Integration with email service
    logger.info(`Sending email to ${customer.email}: ${notification.data.message}`);
    
    // This would integrate with your email service
    // For now, we'll just log it
  }

  private async sendSMSNotification(
    notification: DeliveryNotification,
    customer: any
  ): Promise<void> {
    // Integration with SMS service (Twilio, etc.)
    logger.info(`Sending SMS to ${customer.phone}: ${notification.data.message}`);
    
    // This would integrate with your SMS service
    // For now, we'll just log it
  }
}