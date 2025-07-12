import { PrismaClient } from '@prisma/client';
import Bull from 'bull';
import { EmailService } from './email.service';
import { SMSService } from './sms.service';
import { PushService } from './push.service';
import { TemplateService } from './template.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  NotificationChannel,
  NotificationRequest,
  NotificationResult,
  NotificationType,
  NotificationPreferences
} from '../types/notification.types';

export class NotificationService {
  private prisma: PrismaClient;
  private emailService: EmailService;
  private smsService: SMSService;
  private pushService: PushService;
  private templateService: TemplateService;
  private notificationQueue: Bull.Queue;
  
  constructor() {
    this.prisma = new PrismaClient();
    this.emailService = new EmailService();
    this.smsService = new SMSService();
    this.pushService = new PushService();
    this.templateService = new TemplateService();
    
    this.notificationQueue = new Bull('notifications', {
      redis: config.redis
    });
    
    this.setupQueueProcessors();
  }
  
  private setupQueueProcessors() {
    this.notificationQueue.process(async (job) => {
      const { request } = job.data;
      await this.processNotification(request);
    });
  }
  
  async send(request: NotificationRequest): Promise<NotificationResult[]> {
    // Queue the notification for processing
    await this.notificationQueue.add({ request }, {
      priority: request.priority === 'high' ? 1 : 2,
      delay: request.scheduledAt ? request.scheduledAt.getTime() - Date.now() : 0
    });
    
    logger.info('Notification queued', { 
      userId: request.userId, 
      type: request.type 
    });
    
    return [];
  }
  
  private async processNotification(
    request: NotificationRequest
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    
    // Get user details and preferences
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId },
      include: { 
        profile: true,
        notificationPreferences: true
      }
    });
    
    if (!user) {
      logger.error('User not found for notification', { userId: request.userId });
      return results;
    }
    
    // Filter channels based on user preferences
    const enabledChannels = this.filterEnabledChannels(
      request.channels,
      user.notificationPreferences as any,
      request.type
    );
    
    // Process each channel
    for (const channel of enabledChannels) {
      const result = await this.sendToChannel(channel, user, request);
      results.push(result);
      
      // Store notification record
      await this.storeNotification(user.id, request, result);
    }
    
    return results;
  }
  
  private filterEnabledChannels(
    requestedChannels: NotificationChannel[],
    preferences: NotificationPreferences | null,
    type: NotificationType
  ): NotificationChannel[] {
    if (!preferences) return requestedChannels;
    
    return requestedChannels.filter(channel => {
      const channelPrefs = preferences[channel];
      return channelPrefs?.enabled && channelPrefs.types.includes(type);
    });
  }
  
  private async sendToChannel(
    channel: NotificationChannel,
    user: any,
    request: NotificationRequest
  ): Promise<NotificationResult> {
    // Get template for the channel
    const template = await this.templateService.getTemplate(
      request.type,
      channel
    );
    
    if (!template) {
      return {
        id: `${channel}-${Date.now()}`,
        channel,
        success: false,
        error: 'Template not found'
      };
    }
    
    // Render template with data
    const rendered = this.templateService.render(template, request.data);
    
    switch (channel) {
      case NotificationChannel.EMAIL:
        return await this.emailService.send(
          user.email,
          rendered.subject || '',
          rendered.content
        );
        
      case NotificationChannel.SMS:
        if (!user.profile?.phoneNumber) {
          return {
            id: `sms-${Date.now()}`,
            channel: NotificationChannel.SMS,
            success: false,
            error: 'Phone number not available'
          };
        }
        return await this.smsService.send(
          user.profile.phoneNumber,
          rendered.content
        );
        
      case NotificationChannel.PUSH:
        const tokens = await this.prisma.pushToken.findMany({
          where: { userId: user.id, active: true }
        });
        
        if (tokens.length === 0) {
          return {
            id: `push-${Date.now()}`,
            channel: NotificationChannel.PUSH,
            success: false,
            error: 'No push tokens available'
          };
        }
        
        // Send to first active token
        return await this.pushService.sendFCM(
          tokens[0].token,
          rendered.subject || 'ReskFlow',
          rendered.content,
          request.data
        );
        
      case NotificationChannel.IN_APP:
        // Store in-app notification
        await this.prisma.notification.create({
          data: {
            userId: user.id,
            title: rendered.subject || '',
            body: rendered.content,
            type: request.type,
            read: false,
            data: request.data
          }
        });
        
        return {
          id: `inapp-${Date.now()}`,
          channel: NotificationChannel.IN_APP,
          success: true,
          sentAt: new Date()
        };
        
      default:
        return {
          id: `unknown-${Date.now()}`,
          channel,
          success: false,
          error: 'Unknown channel'
        };
    }
  }
  
  private async storeNotification(
    userId: string,
    request: NotificationRequest,
    result: NotificationResult
  ) {
    await this.prisma.notificationLog.create({
      data: {
        userId,
        type: request.type,
        channel: result.channel,
        success: result.success,
        error: result.error,
        sentAt: result.sentAt || new Date(),
        data: request.data
      }
    });
  }
  
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.update({
      where: { 
        id: notificationId,
        userId
      },
      data: { read: true }
    });
  }
  
  async getInAppNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20
  ) {
    const skip = (page - 1) * limit;
    
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      this.prisma.notification.count({
        where: { userId }
      })
    ]);
    
    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }
}