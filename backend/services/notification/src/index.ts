import express from 'express';
import { config, logger, connectDatabase, prisma } from '@reskflow/shared';
import { SMSService } from './services/SMSService';
import { EmailService } from './services/EmailService';
import { PushNotificationService } from './services/PushNotificationService';
import { TemplateService } from './services/TemplateService';
import { NotificationQueue } from './queues/NotificationQueue';
import { NotificationScheduler } from './services/NotificationScheduler';
import i18n from 'i18n';
import path from 'path';

const app = express();
app.use(express.json());

let smsService: SMSService;
let emailService: EmailService;
let pushService: PushNotificationService;
let templateService: TemplateService;
let notificationQueue: NotificationQueue;
let scheduler: NotificationScheduler;

async function startService() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Notification service: Database connected');

    // Configure i18n
    i18n.configure({
      locales: ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar'],
      directory: path.join(__dirname, 'locales'),
      defaultLocale: 'en',
      objectNotation: true,
    });

    // Initialize services
    smsService = new SMSService();
    emailService = new EmailService();
    pushService = new PushNotificationService();
    templateService = new TemplateService();
    notificationQueue = new NotificationQueue();
    scheduler = new NotificationScheduler();

    // Start queue processing
    await notificationQueue.start();

    // API endpoints
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'notification' });
    });

    // Send notification
    app.post('/send', async (req, res) => {
      try {
        const { userId, type, channel, data, priority = 'normal' } = req.body;
        
        const notification = await prisma.notification.create({
          data: {
            userId,
            title: data.title,
            body: data.body,
            type,
            data: data.metadata || {},
          },
        });

        await notificationQueue.addNotification({
          notificationId: notification.id,
          userId,
          type,
          channel: channel || ['push', 'email'],
          data,
          priority,
        });

        res.json({ 
          success: true, 
          notificationId: notification.id 
        });
      } catch (error) {
        logger.error('Failed to send notification', error);
        res.status(500).json({ error: 'Failed to send notification' });
      }
    });

    // Bulk send
    app.post('/send-bulk', async (req, res) => {
      try {
        const { userIds, type, channel, data, priority = 'normal' } = req.body;
        
        const notifications = await Promise.all(
          userIds.map((userId: string) =>
            prisma.notification.create({
              data: {
                userId,
                title: data.title,
                body: data.body,
                type,
                data: data.metadata || {},
              },
            })
          )
        );

        await notificationQueue.addBulkNotifications(
          notifications.map((n, i) => ({
            notificationId: n.id,
            userId: userIds[i],
            type,
            channel: channel || ['push', 'email'],
            data,
            priority,
          }))
        );

        res.json({ 
          success: true, 
          count: notifications.length 
        });
      } catch (error) {
        logger.error('Failed to send bulk notifications', error);
        res.status(500).json({ error: 'Failed to send bulk notifications' });
      }
    });

    // Schedule notification
    app.post('/schedule', async (req, res) => {
      try {
        const { userId, type, channel, data, scheduledFor } = req.body;
        
        const scheduled = await scheduler.scheduleNotification({
          userId,
          type,
          channel,
          data,
          scheduledFor: new Date(scheduledFor),
        });

        res.json({ 
          success: true, 
          scheduledId: scheduled.id 
        });
      } catch (error) {
        logger.error('Failed to schedule notification', error);
        res.status(500).json({ error: 'Failed to schedule notification' });
      }
    });

    // Get notification templates
    app.get('/templates', async (req, res) => {
      try {
        const { type, locale = 'en' } = req.query;
        
        const templates = await templateService.getTemplates(
          type as string,
          locale as string
        );

        res.json(templates);
      } catch (error) {
        logger.error('Failed to get templates', error);
        res.status(500).json({ error: 'Failed to get templates' });
      }
    });

    // Update user preferences
    app.put('/preferences/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const preferences = req.body;
        
        await prisma.userPreferences.upsert({
          where: { userId },
          update: preferences,
          create: {
            userId,
            ...preferences,
          },
        });

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to update preferences', error);
        res.status(500).json({ error: 'Failed to update preferences' });
      }
    });

    // Get notification history
    app.get('/history/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        const notifications = await prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: parseInt(limit as string),
          skip: parseInt(offset as string),
        });

        res.json(notifications);
      } catch (error) {
        logger.error('Failed to get notification history', error);
        res.status(500).json({ error: 'Failed to get notification history' });
      }
    });

    // Mark as read
    app.put('/read/:notificationId', async (req, res) => {
      try {
        const { notificationId } = req.params;
        
        await prisma.notification.update({
          where: { id: notificationId },
          data: { 
            read: true,
            readAt: new Date(),
          },
        });

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to mark as read', error);
        res.status(500).json({ error: 'Failed to mark as read' });
      }
    });

    // Test endpoints
    app.post('/test/sms', async (req, res) => {
      try {
        const { to, message } = req.body;
        const result = await smsService.sendSMS(to, message);
        res.json(result);
      } catch (error) {
        logger.error('SMS test failed', error);
        res.status(500).json({ error: 'SMS test failed' });
      }
    });

    app.post('/test/email', async (req, res) => {
      try {
        const { to, subject, html } = req.body;
        const result = await emailService.sendEmail({
          to,
          subject,
          html,
        });
        res.json(result);
      } catch (error) {
        logger.error('Email test failed', error);
        res.status(500).json({ error: 'Email test failed' });
      }
    });

    // Start server
    const PORT = 3007;
    app.listen(PORT, () => {
      logger.info(`📧 Notification service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start notification service', error);
    process.exit(1);
  }
}

// Event listeners for automated notifications
async function setupEventListeners() {
  // Delivery created
  notificationQueue.on('delivery.created', async (data: any) => {
    const { delivery } = data;
    
    // Notify sender
    await notificationQueue.addNotification({
      userId: delivery.senderId,
      type: 'DELIVERY_CREATED',
      channel: ['push', 'email'],
      data: {
        title: 'Delivery Created',
        body: `Your delivery ${delivery.trackingNumber} has been created`,
        metadata: { deliveryId: delivery.id },
      },
      priority: 'high',
    });

    // Notify recipient if exists
    if (delivery.recipientId) {
      await notificationQueue.addNotification({
        userId: delivery.recipientId,
        type: 'DELIVERY_INCOMING',
        channel: ['push', 'email', 'sms'],
        data: {
          title: 'Package Coming Your Way',
          body: `A package is being sent to you. Track: ${delivery.trackingNumber}`,
          metadata: { deliveryId: delivery.id },
        },
        priority: 'high',
      });
    }
  });

  // Delivery status update
  notificationQueue.on('delivery.status.updated', async (data: any) => {
    const { delivery, oldStatus, newStatus } = data;
    
    const statusMessages: any = {
      ASSIGNED: {
        title: 'Driver Assigned',
        body: 'A driver has been assigned to your delivery',
      },
      PICKED_UP: {
        title: 'Package Picked Up',
        body: 'Your package has been picked up',
      },
      IN_TRANSIT: {
        title: 'On The Way',
        body: 'Your package is on the way',
      },
      DELIVERED: {
        title: 'Delivered!',
        body: 'Your package has been delivered successfully',
      },
    };

    const message = statusMessages[newStatus];
    if (message) {
      // Notify sender
      await notificationQueue.addNotification({
        userId: delivery.senderId,
        type: 'DELIVERY_STATUS_UPDATE',
        channel: ['push', 'email'],
        data: {
          ...message,
          metadata: { 
            deliveryId: delivery.id,
            oldStatus,
            newStatus,
          },
        },
        priority: newStatus === 'DELIVERED' ? 'high' : 'normal',
      });

      // Notify recipient
      if (delivery.recipientId && ['IN_TRANSIT', 'DELIVERED'].includes(newStatus)) {
        await notificationQueue.addNotification({
          userId: delivery.recipientId,
          type: 'DELIVERY_STATUS_UPDATE',
          channel: ['push', 'sms'],
          data: {
            ...message,
            metadata: { 
              deliveryId: delivery.id,
              oldStatus,
              newStatus,
            },
          },
          priority: 'high',
        });
      }
    }
  });

  // Payment events
  notificationQueue.on('payment.completed', async (data: any) => {
    const { payment, userId } = data;
    
    await notificationQueue.addNotification({
      userId,
      type: 'PAYMENT_COMPLETED',
      channel: ['push', 'email'],
      data: {
        title: 'Payment Successful',
        body: `Payment of ${payment.currency} ${payment.amount} completed`,
        metadata: { paymentId: payment.id },
      },
      priority: 'high',
    });
  });

  // Driver notifications
  notificationQueue.on('driver.new.delivery', async (data: any) => {
    const { driverId, delivery } = data;
    
    await notificationQueue.addNotification({
      userId: driverId,
      type: 'NEW_DELIVERY_AVAILABLE',
      channel: ['push'],
      data: {
        title: 'New Delivery Available',
        body: `New delivery request in your area. Distance: ${delivery.distance}km`,
        metadata: { 
          deliveryId: delivery.id,
          earnings: delivery.driverEarnings,
        },
      },
      priority: 'high',
    });
  });
}

startService();
setupEventListeners();