import amqp from 'amqplib';
import { config } from './index';
import { logger } from '../utils/logger';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;

export const QUEUES = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_COMPLETED: 'order.completed',
  ORDER_FAILED: 'order.failed',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  DELIVERY_ASSIGNED: 'reskflow.assigned',
  DELIVERY_UPDATED: 'reskflow.updated',
  CART_CHECKOUT: 'cart.checkout',
};

export async function connectRabbitMQ() {
  try {
    connection = await amqp.connect(config.rabbitmq.url);
    channel = await connection.createChannel();

    // Create queues
    for (const queue of Object.values(QUEUES)) {
      await channel.assertQueue(queue, { durable: true });
    }

    // Handle connection events
    connection.on('error', (error) => {
      logger.error('RabbitMQ connection error:', error);
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      setTimeout(connectRabbitMQ, 5000);
    });

    logger.info('RabbitMQ connected and queues created');
    return true;
  } catch (error) {
    logger.error('RabbitMQ connection failed:', error);
    setTimeout(connectRabbitMQ, 5000);
    throw error;
  }
}

export function getChannel(): amqp.Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  return channel;
}

export async function publishMessage(queue: string, message: any) {
  try {
    const channel = getChannel();
    const messageBuffer = Buffer.from(JSON.stringify(message));
    
    return channel.sendToQueue(queue, messageBuffer, {
      persistent: true,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error(`Failed to publish message to ${queue}:`, error);
    throw error;
  }
}

export async function consumeMessage(
  queue: string,
  handler: (message: any) => Promise<void>
) {
  try {
    const channel = getChannel();
    
    await channel.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString());
        await handler(content);
        channel.ack(msg);
      } catch (error) {
        logger.error(`Error processing message from ${queue}:`, error);
        channel.nack(msg, false, false);
      }
    });
  } catch (error) {
    logger.error(`Failed to consume messages from ${queue}:`, error);
    throw error;
  }
}

export async function disconnectRabbitMQ() {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('RabbitMQ disconnected');
  } catch (error) {
    logger.error('Error disconnecting RabbitMQ:', error);
    throw error;
  }
}