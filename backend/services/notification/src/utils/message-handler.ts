import amqp from 'amqplib';
import { config } from '../config';
import { logger } from './logger';
import { NotificationService } from '../services/notification.service';
import { NotificationRequest } from '../types/notification.types';

const notificationService = new NotificationService();

export async function setupMessageHandlers() {
  try {
    const connection = await amqp.connect(config.rabbitmq.url);
    const channel = await connection.createChannel();
    
    // Assert queues
    await channel.assertQueue(config.rabbitmq.queues.notifications, {
      durable: true
    });
    
    // Handle notification messages
    channel.consume(
      config.rabbitmq.queues.notifications,
      async (msg) => {
        if (!msg) return;
        
        try {
          const request: NotificationRequest = JSON.parse(msg.content.toString());
          await notificationService.send(request);
          channel.ack(msg);
        } catch (error) {
          logger.error('Error processing notification message', { error });
          // Requeue message on error
          channel.nack(msg, false, true);
        }
      }
    );
    
    logger.info('Message handlers setup complete');
  } catch (error) {
    logger.error('Failed to setup message handlers', { error });
    // Retry after delay
    setTimeout(setupMessageHandlers, 5000);
  }
}