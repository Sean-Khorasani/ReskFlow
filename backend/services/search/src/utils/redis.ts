import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

class RedisClient {
  public client: RedisClientType;
  public connected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 10000,
        lazyConnect: true,
      },
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis connection refused');
          return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          logger.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          logger.error('Redis max attempts exceeded');
          return new Error('Max attempts exceeded');
        }
        return Math.min(options.attempt * 100, 3000);
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('Redis client connecting...');
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
      this.connected = true;
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error:', error);
      this.connected = false;
    });

    this.client.on('end', () => {
      logger.info('Redis client connection ended');
      this.connected = false;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    try {
      if (!this.connected) {
        await this.client.connect();
        logger.info('Redis connected successfully');
      }
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        await this.client.quit();
        this.connected = false;
        logger.info('Redis disconnected successfully');
      }
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      logger.error('Redis ping failed:', error);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string): Promise<string | null> {
    try {
      return await this.client.set(key, value);
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return null;
    }
  }

  async setex(key: string, seconds: number, value: string): Promise<string | null> {
    try {
      return await this.client.setEx(key, seconds, value);
    } catch (error) {
      logger.error(`Redis SETEX error for key ${key}:`, error);
      return null;
    }
  }

  async del(...keys: string[]): Promise<number> {
    try {
      return await this.client.del(keys);
    } catch (error) {
      logger.error(`Redis DEL error for keys ${keys.join(', ')}:`, error);
      return 0;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      return [];
    }
  }

  async exists(...keys: string[]): Promise<number> {
    try {
      return await this.client.exists(keys);
    } catch (error) {
      logger.error(`Redis EXISTS error for keys ${keys.join(', ')}:`, error);
      return 0;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error(`Redis TTL error for key ${key}:`, error);
      return -1;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Redis INCR error for key ${key}:`, error);
      return 0;
    }
  }

  async decr(key: string): Promise<number> {
    try {
      return await this.client.decr(key);
    } catch (error) {
      logger.error(`Redis DECR error for key ${key}:`, error);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      logger.error(`Redis LRANGE error for key ${key}:`, error);
      return [];
    }
  }

  async lpush(key: string, ...elements: string[]): Promise<number> {
    try {
      return await this.client.lPush(key, elements);
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      return 0;
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    try {
      return await this.client.lTrim(key, start, stop);
    } catch (error) {
      logger.error(`Redis LTRIM error for key ${key}:`, error);
      return 'ERROR';
    }
  }

  async lrem(key: string, count: number, element: string): Promise<number> {
    try {
      return await this.client.lRem(key, count, element);
    } catch (error) {
      logger.error(`Redis LREM error for key ${key}:`, error);
      return 0;
    }
  }

  async zrevrange(key: string, start: number, stop: number, withScores?: 'WITHSCORES'): Promise<string[]> {
    try {
      if (withScores === 'WITHSCORES') {
        return await this.client.zRevRangeWithScores(key, start, stop) as any;
      }
      return await this.client.zRevRange(key, start, stop);
    } catch (error) {
      logger.error(`Redis ZREVRANGE error for key ${key}:`, error);
      return [];
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      return await this.client.zAdd(key, { score, value: member });
    } catch (error) {
      logger.error(`Redis ZADD error for key ${key}:`, error);
      return 0;
    }
  }

  async zincrby(key: string, increment: number, member: string): Promise<number> {
    try {
      return await this.client.zIncrBy(key, increment, member);
    } catch (error) {
      logger.error(`Redis ZINCRBY error for key ${key}:`, error);
      return 0;
    }
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      return undefined;
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.client.hSet(key, field, value);
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      return 0;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      return {};
    }
  }

  async multi(): Promise<any> {
    return this.client.multi();
  }

  // Health check method
  async healthCheck(): Promise<{ status: string; latency?: number }> {
    try {
      const start = Date.now();
      await this.ping();
      const latency = Date.now() - start;

      return {
        status: 'healthy',
        latency
      };
    } catch (error) {
      return {
        status: 'unhealthy'
      };
    }
  }

  // Graceful shutdown
  async gracefulShutdown(): Promise<void> {
    logger.info('Starting Redis graceful shutdown...');
    try {
      await this.disconnect();
      logger.info('Redis graceful shutdown completed');
    } catch (error) {
      logger.error('Error during Redis graceful shutdown:', error);
    }
  }
}

// Export singleton instance
export const redisClient = new RedisClient();

// Type exports for convenience
export type { RedisClientType };