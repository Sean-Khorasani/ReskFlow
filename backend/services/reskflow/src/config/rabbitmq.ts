import amqp from 'amqplib';
import { config } from './index';
import { logger } from '../utils/logger';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;

export const QUEUES = {
  // Delivery specific queues
  DELIVERY_CREATED: 'reskflow.created',
  DELIVERY_ASSIGNED: 'reskflow.assigned',
  DELIVERY_PICKED_UP: 'reskflow.picked_up',
  DELIVERY_IN_TRANSIT: 'reskflow.in_transit',
  DELIVERY_DELIVERED: 'reskflow.delivered',
  DELIVERY_CANCELLED: 'reskflow.cancelled',
  DELIVERY_FAILED: 'reskflow.failed',
  
  // Driver queues
  DRIVER_AVAILABLE: 'driver.available',
  DRIVER_UNAVAILABLE: 'driver.unavailable',
  DRIVER_LOCATION_UPDATE: 'driver.location_update',
  
  // Order related queues (listening)
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_CANCELLED: 'order.cancelled',
  
  // Route optimization
  ROUTE_OPTIMIZATION_REQUEST: 'route.optimization.request',
  ROUTE_OPTIMIZATION_RESPONSE: 'route.optimization.response',
  
  // Notifications
  NOTIFICATION_SEND: 'notification.send',
  
  // Dead letter queue for failed messages
  DELIVERY_DLQ: 'reskflow.dlq',
};

export const EXCHANGES = {
  DELIVERY: 'reskflow.exchange',
  DRIVER: 'driver.exchange',
  ORDER: 'order.exchange',
  NOTIFICATION: 'notification.exchange',
};

export async function connectRabbitMQ() {
  try {
    connection = await amqp.connect(config.rabbitmq.url);
    channel = await connection.createChannel();

    // Create exchanges
    for (const exchange of Object.values(EXCHANGES)) {
      await channel.assertExchange(exchange, 'topic', { durable: true });
    }

    // Create queues with dead letter configuration
    for (const queue of Object.values(QUEUES)) {
      const queueOptions: amqp.Options.AssertQueue = {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGES.DELIVERY,
          'x-dead-letter-routing-key': QUEUES.DELIVERY_DLQ,
          'x-message-ttl': 1800000, // 30 minutes
        },
      };

      // Dead letter queue doesn't need DLX
      if (queue === QUEUES.DELIVERY_DLQ) {
        delete queueOptions.arguments;
      }

      await channel.assertQueue(queue, queueOptions);
    }

    // Bind queues to exchanges with routing keys
    await bindQueues();

    // Handle connection events
    connection.on('error', (error) => {
      logger.error('RabbitMQ connection error:', error);
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      setTimeout(connectRabbitMQ, 5000);
    });

    // Set prefetch count for fair dispatch
    await channel.prefetch(1);

    logger.info('RabbitMQ connected and configured successfully');
    return true;
  } catch (error) {
    logger.error('RabbitMQ connection failed:', error);
    setTimeout(connectRabbitMQ, 5000);
    throw error;
  }
}

async function bindQueues() {
  if (!channel) throw new Error('RabbitMQ channel not initialized');

  // Delivery events
  await channel.bindQueue(QUEUES.DELIVERY_CREATED, EXCHANGES.DELIVERY, 'reskflow.created');
  await channel.bindQueue(QUEUES.DELIVERY_ASSIGNED, EXCHANGES.DELIVERY, 'reskflow.assigned');
  await channel.bindQueue(QUEUES.DELIVERY_PICKED_UP, EXCHANGES.DELIVERY, 'reskflow.picked_up');
  await channel.bindQueue(QUEUES.DELIVERY_IN_TRANSIT, EXCHANGES.DELIVERY, 'reskflow.in_transit');
  await channel.bindQueue(QUEUES.DELIVERY_DELIVERED, EXCHANGES.DELIVERY, 'reskflow.delivered');
  await channel.bindQueue(QUEUES.DELIVERY_CANCELLED, EXCHANGES.DELIVERY, 'reskflow.cancelled');
  await channel.bindQueue(QUEUES.DELIVERY_FAILED, EXCHANGES.DELIVERY, 'reskflow.failed');
  await channel.bindQueue(QUEUES.DELIVERY_DLQ, EXCHANGES.DELIVERY, QUEUES.DELIVERY_DLQ);

  // Driver events
  await channel.bindQueue(QUEUES.DRIVER_AVAILABLE, EXCHANGES.DRIVER, 'driver.available');
  await channel.bindQueue(QUEUES.DRIVER_UNAVAILABLE, EXCHANGES.DRIVER, 'driver.unavailable');
  await channel.bindQueue(QUEUES.DRIVER_LOCATION_UPDATE, EXCHANGES.DRIVER, 'driver.location.*');

  // Order events (external)
  await channel.bindQueue(QUEUES.ORDER_CREATED, EXCHANGES.ORDER, 'order.created');
  await channel.bindQueue(QUEUES.ORDER_CONFIRMED, EXCHANGES.ORDER, 'order.confirmed');
  await channel.bindQueue(QUEUES.ORDER_CANCELLED, EXCHANGES.ORDER, 'order.cancelled');

  // Route optimization
  await channel.bindQueue(QUEUES.ROUTE_OPTIMIZATION_REQUEST, EXCHANGES.DELIVERY, 'route.optimization.request');
  await channel.bindQueue(QUEUES.ROUTE_OPTIMIZATION_RESPONSE, EXCHANGES.DELIVERY, 'route.optimization.response');

  // Notifications
  await channel.bindQueue(QUEUES.NOTIFICATION_SEND, EXCHANGES.NOTIFICATION, 'notification.*');
}

export function getChannel(): amqp.Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  return channel;
}

export async function publishMessage(
  exchange: string, 
  routingKey: string, 
  message: any,
  options: amqp.Options.Publish = {}
) {
  try {
    const channel = getChannel();
    const messageBuffer = Buffer.from(JSON.stringify(message));
    
    const publishOptions: amqp.Options.Publish = {
      persistent: true,
      timestamp: Date.now(),
      messageId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...options,
    };

    const published = channel.publish(exchange, routingKey, messageBuffer, publishOptions);
    
    if (!published) {
      logger.warn(`Message not published to ${exchange}:${routingKey} - channel full`);
    }
    
    return published;
  } catch (error) {
    logger.error(`Failed to publish message to ${exchange}:${routingKey}:`, error);
    throw error;
  }
}

export async function publishToQueue(queue: string, message: any) {
  try {
    const channel = getChannel();
    const messageBuffer = Buffer.from(JSON.stringify(message));
    
    return channel.sendToQueue(queue, messageBuffer, {
      persistent: true,
      timestamp: Date.now(),
      messageId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
  } catch (error) {
    logger.error(`Failed to publish message to queue ${queue}:`, error);
    throw error;
  }
}

export async function consumeMessage(
  queue: string,
  handler: (message: any, originalMessage?: amqp.ConsumeMessage) => Promise<void>,
  options: amqp.Options.Consume = {}
) {
  try {
    const channel = getChannel();
    
    const consumeOptions: amqp.Options.Consume = {
      noAck: false,
      ...options,
    };
    
    await channel.consume(queue, async (msg) => {
      if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString());
        await handler(content, msg);
        channel.ack(msg);
      } catch (error) {
        logger.error(`Error processing message from ${queue}:`, error);
        
        // Check if this is a retry
        const retryCount = msg.properties.headers?.['x-retry-count'] || 0;
        const maxRetries = 3;
        
        if (retryCount < maxRetries) {
          // Retry by republishing with incremented retry count
          await publishToQueue(queue, {
            ...JSON.parse(msg.content.toString()),
            _retryCount: retryCount + 1,
          });
          channel.ack(msg);
        } else {
          // Max retries reached, send to DLQ
          logger.error(`Max retries reached for message in ${queue}, sending to DLQ`);
          channel.nack(msg, false, false);
        }
      }
    }, consumeOptions);
  } catch (error) {
    logger.error(`Failed to consume messages from ${queue}:`, error);
    throw error;
  }
}

export async function publishDeliveryEvent(event: string, data: any) {
  return publishMessage(EXCHANGES.DELIVERY, `reskflow.${event}`, {
    event,
    data,
    timestamp: new Date().toISOString(),
    service: 'reskflow-service',
  });
}

export async function publishDriverEvent(event: string, data: any) {
  return publishMessage(EXCHANGES.DRIVER, `driver.${event}`, {
    event,
    data,
    timestamp: new Date().toISOString(),
    service: 'reskflow-service',
  });
}

export async function publishNotification(type: string, data: any) {
  return publishMessage(EXCHANGES.NOTIFICATION, `notification.${type}`, {
    type,
    data,
    timestamp: new Date().toISOString(),
    service: 'reskflow-service',
  });
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

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectRabbitMQ();
});

process.on('SIGTERM', async () => {
  await disconnectRabbitMQ();
});