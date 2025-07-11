import amqp, { Channel, Connection } from 'amqplib';
import { config } from '../config';
import { logger } from './logger';

export interface UserEvent {
  type: 'USER_CREATED' | 'USER_UPDATED' | 'USER_DELETED' | 'USER_VERIFIED' | 'PASSWORD_CHANGED' | 'LOGIN' | 'LOGOUT';
  userId: string;
  data: any;
  timestamp: Date;
}

export class MessageQueue {
  private static instance: MessageQueue;
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly exchange = 'user-events';

  private constructor() {}

  static getInstance(): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue();
    }
    return MessageQueue.instance;
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(config.rabbitMq.url);
      this.channel = await this.connection.createChannel();
      
      // Declare exchange
      await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
      
      logger.info('Connected to RabbitMQ');
      
      // Handle connection events
      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
        this.reconnect();
      });
      
      this.connection.on('close', () => {
        logger.info('RabbitMQ connection closed');
        this.reconnect();
      });
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ:', error);
      setTimeout(() => this.reconnect(), 5000);
    }
  }

  private async reconnect(): Promise<void> {
    this.connection = null;
    this.channel = null;
    await this.connect();
  }

  async publishEvent(event: UserEvent): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }

    try {
      const routingKey = `user.${event.type.toLowerCase()}`;
      const message = Buffer.from(JSON.stringify({
        ...event,
        timestamp: new Date()
      }));

      this.channel!.publish(this.exchange, routingKey, message, {
        persistent: true,
        contentType: 'application/json'
      });

      logger.debug(`Published event: ${event.type} for user: ${event.userId}`);
    } catch (error) {
      logger.error('Failed to publish event:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection:', error);
    }
  }
}

// Initialize connection
MessageQueue.getInstance().connect();