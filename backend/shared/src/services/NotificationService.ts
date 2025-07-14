import { config, logger } from '../config';
import { prisma } from '../database';
import * as SendGrid from '@sendgrid/mail';
import twilio from 'twilio';
import { redis } from '../redis';
import * as admin from 'firebase-admin';

interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  type: 'email' | 'sms' | 'push' | 'all';
}

export class NotificationService {
  private twilioClient: twilio.Twilio;
  private sendGridClient: typeof SendGrid;
  private fcm?: admin.messaging.Messaging;

  constructor() {
    // Initialize SendGrid
    this.sendGridClient = SendGrid;
    this.sendGridClient.setApiKey(config.sendgrid.apiKey);

    // Initialize Twilio
    this.twilioClient = twilio(
      config.twilio.accountSid,
      config.twilio.authToken
    );

    // Initialize Firebase Admin for push notifications
    if (config.firebase.serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(config.firebase.serviceAccount),
      });
      this.fcm = admin.messaging();
    }
  }

  async sendNotification(payload: NotificationPayload): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const promises: Promise<any>[] = [];

      if (payload.type === 'email' || payload.type === 'all') {
        promises.push(this.sendEmail(user.email, payload.title, payload.body));
      }

      if (payload.type === 'sms' || payload.type === 'all') {
        if (user.phone) {
          promises.push(this.sendSMS(user.phone, payload.body));
        }
      }

      if (payload.type === 'push' || payload.type === 'all') {
        const fcmToken = await this.getUserFCMToken(user.id);
        if (fcmToken) {
          promises.push(this.sendPushNotification(fcmToken, payload));
        }
      }

      await Promise.all(promises);

      // Log notification
      await this.logNotification(payload);

      logger.info(`Notification sent to user ${payload.userId}`);
    } catch (error) {
      logger.error('Failed to send notification', error);
      throw error;
    }
  }

  // Order-specific notifications
  async sendOrderAcceptedNotification(
    customerId: string,
    orderNumber: string,
    estimatedMinutes: number
  ): Promise<void> {
    await this.sendNotification({
      userId: customerId,
      title: 'Order Accepted! 🎉',
      body: `Your order #${orderNumber} has been accepted and will be ready in approximately ${estimatedMinutes} minutes.`,
      data: { type: 'order_accepted', orderNumber },
      type: 'all',
    });
  }

  async sendOrderRejectedNotification(
    customerId: string,
    orderNumber: string,
    reason: string
  ): Promise<void> {
    await this.sendNotification({
      userId: customerId,
      title: 'Order Cancelled',
      body: `Your order #${orderNumber} has been cancelled. Reason: ${reason}. You will receive a full refund.`,
      data: { type: 'order_rejected', orderNumber, reason },
      type: 'all',
    });
  }

  async sendOrderReadyNotification(
    customerId: string,
    orderNumber: string
  ): Promise<void> {
    await this.sendNotification({
      userId: customerId,
      title: 'Order Ready! 🍕',
      body: `Your order #${orderNumber} is ready for pickup/reskflow.`,
      data: { type: 'order_ready', orderNumber },
      type: 'all',
    });
  }

  async sendDriverNotification(
    driverId: string,
    title: string,
    body: string
  ): Promise<void> {
    await this.sendNotification({
      userId: driverId,
      title,
      body,
      type: 'push',
    });
  }

  async sendMerchantNotification(
    merchantId: string,
    title: string,
    body: string
  ): Promise<void> {
    // Get merchant owner
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { ownerId: true },
    });

    if (merchant) {
      await this.sendNotification({
        userId: merchant.ownerId,
        title,
        body,
        type: 'all',
      });
    }
  }

  // Bulk notifications
  async sendBulkNotifications(
    userIds: string[],
    title: string,
    body: string
  ): Promise<void> {
    const batchSize = 100;
    
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(userId =>
          this.sendNotification({
            userId,
            title,
            body,
            type: 'push',
          }).catch(error => {
            logger.error(`Failed to send notification to user ${userId}`, error);
          })
        )
      );
    }
  }

  private async sendEmail(
    to: string,
    subject: string,
    text: string
  ): Promise<void> {
    try {
      const msg = {
        to,
        from: config.sendgrid.fromEmail,
        subject,
        text,
        html: `<p>${text}</p>`,
      };

      await this.sendGridClient.send(msg);
    } catch (error) {
      logger.error('Failed to send email', error);
      throw error;
    }
  }

  private async sendSMS(to: string, body: string): Promise<void> {
    try {
      await this.twilioClient.messages.create({
        body,
        to,
        from: config.twilio.fromNumber,
      });
    } catch (error) {
      logger.error('Failed to send SMS', error);
      throw error;
    }
  }

  private async sendPushNotification(
    fcmToken: string,
    payload: NotificationPayload
  ): Promise<void> {
    if (!this.fcm) {
      logger.warn('FCM not initialized');
      return;
    }

    try {
      const message: admin.messaging.Message = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        token: fcmToken,
        android: {
          notification: {
            icon: 'notification_icon',
            color: '#ff6347',
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      };

      await this.fcm.send(message);
    } catch (error) {
      logger.error('Failed to send push notification', error);
      throw error;
    }
  }

  private async getUserFCMToken(userId: string): Promise<string | null> {
    const key = `fcm:token:${userId}`;
    return redis.get(key);
  }

  async setUserFCMToken(userId: string, token: string): Promise<void> {
    const key = `fcm:token:${userId}`;
    await redis.set(key, token, 'EX', 30 * 24 * 60 * 60); // 30 days
  }

  private async logNotification(payload: NotificationPayload): Promise<void> {
    // Store notification history
    const key = `notifications:${payload.userId}`;
    const notification = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    await redis.lpush(key, JSON.stringify(notification));
    await redis.ltrim(key, 0, 99); // Keep last 100 notifications
    await redis.expire(key, 30 * 24 * 60 * 60); // 30 days
  }

  async getNotificationHistory(
    userId: string,
    limit: number = 20
  ): Promise<any[]> {
    const key = `notifications:${userId}`;
    const history = await redis.lrange(key, 0, limit - 1);
    return history.map(h => JSON.parse(h));
  }
}