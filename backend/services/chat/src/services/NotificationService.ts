import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';

interface ChatNotification {
  userId: string;
  roomId: string;
  type: 'new_message' | 'new_chat' | 'mention' | 'media';
  data: any;
}

export class NotificationService {
  constructor(private notificationQueue: Bull.Queue) {}

  async sendChatNotification(params: ChatNotification): Promise<void> {
    await this.notificationQueue.add('chat-notification', params);
  }

  async processNotification(notification: ChatNotification): Promise<void> {
    try {
      // Get user preferences
      const user = await prisma.user.findUnique({
        where: { id: notification.userId },
        include: {
          notificationPreferences: true,
        },
      });

      if (!user) {
        logger.error(`User not found: ${notification.userId}`);
        return;
      }

      // Check if chat notifications are enabled
      const preferences = user.notificationPreferences;
      if (!preferences?.chat_notifications) {
        return;
      }

      // Send via appropriate channels
      const channels = this.getNotificationChannels(preferences);

      for (const channel of channels) {
        await this.sendViaChannel(channel, notification, user);
      }

      // Log notification
      await prisma.notificationLog.create({
        data: {
          user_id: notification.userId,
          type: `chat_${notification.type}`,
          channels,
          data: notification.data,
          sent_at: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error processing chat notification:', error);
      throw error;
    }
  }

  private getNotificationChannels(preferences: any): string[] {
    const channels: string[] = [];

    if (preferences.push_enabled !== false) channels.push('push');
    if (preferences.email_enabled === true && preferences.email_chat_notifications) {
      channels.push('email');
    }
    if (preferences.sms_enabled === true && preferences.sms_urgent_only !== true) {
      channels.push('sms');
    }

    return channels;
  }

  private async sendViaChannel(
    channel: string,
    notification: ChatNotification,
    user: any
  ): Promise<void> {
    switch (channel) {
      case 'push':
        await this.sendPushNotification(notification, user);
        break;
      case 'email':
        await this.sendEmailNotification(notification, user);
        break;
      case 'sms':
        await this.sendSMSNotification(notification, user);
        break;
    }
  }

  private async sendPushNotification(
    notification: ChatNotification,
    user: any
  ): Promise<void> {
    const title = this.getNotificationTitle(notification);
    const body = this.getNotificationBody(notification);

    logger.info(`Sending push notification to ${user.id}: ${title}`);
    
    // This would integrate with FCM/APNS
    // For now, we'll just log it
  }

  private async sendEmailNotification(
    notification: ChatNotification,
    user: any
  ): Promise<void> {
    if (notification.type !== 'new_message') {
      return; // Only send emails for new messages
    }

    const subject = 'New message in your reskflow chat';
    const body = this.getNotificationBody(notification);

    logger.info(`Sending email to ${user.email}: ${subject}`);
    
    // This would integrate with email service
  }

  private async sendSMSNotification(
    notification: ChatNotification,
    user: any
  ): Promise<void> {
    if (notification.type !== 'new_message') {
      return; // Only send SMS for new messages
    }

    const message = this.getNotificationBody(notification);

    logger.info(`Sending SMS to ${user.phone}: ${message}`);
    
    // This would integrate with SMS service
  }

  private getNotificationTitle(notification: ChatNotification): string {
    switch (notification.type) {
      case 'new_message':
        return 'New message';
      case 'new_chat':
        return 'New chat started';
      case 'mention':
        return 'You were mentioned';
      case 'media':
        return 'Media shared';
      default:
        return 'Chat notification';
    }
  }

  private getNotificationBody(notification: ChatNotification): string {
    const data = notification.data;

    switch (notification.type) {
      case 'new_message':
        return data.message || 'You have a new message';
      case 'new_chat':
        return 'A new chat has been started for your order';
      case 'mention':
        return `${data.senderName} mentioned you in a chat`;
      case 'media':
        return `${data.senderName} shared ${data.mediaType}`;
      default:
        return 'Check your chat messages';
    }
  }
}