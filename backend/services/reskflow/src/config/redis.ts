import Redis from 'ioredis';
import { logger } from '../utils/logger';

class RedisConfig {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private isConnected: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    const redisConfig = {
      host: this.parseRedisUrl(redisUrl).host,
      port: this.parseRedisUrl(redisUrl).port,
      password: this.parseRedisUrl(redisUrl).password,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(`Redis retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      commandTimeout: 5000,
      lazyConnect: true,
    };

    this.client = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);
    this.publisher = new Redis(redisConfig);

    this.setupEventHandlers();
  }

  private parseRedisUrl(url: string): { host: string; port: number; password?: string } {
    const urlObj = new URL(url);
    return {
      host: urlObj.hostname || 'localhost',
      port: parseInt(urlObj.port) || 6379,
      password: urlObj.password || undefined,
    };
  }

  private setupEventHandlers() {
    // Client events
    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error:', error);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      logger.warn('Redis client connection closed');
      this.isConnected = false;
    });

    // Subscriber events
    this.subscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
    });

    this.subscriber.on('error', (error) => {
      logger.error('Redis subscriber error:', error);
    });

    // Publisher events
    this.publisher.on('connect', () => {
      logger.info('Redis publisher connected');
    });

    this.publisher.on('error', (error) => {
      logger.error('Redis publisher error:', error);
    });
  }

  async connect() {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);
      
      // Test connection
      await this.client.ping();
      
      logger.info('All Redis connections established successfully');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await Promise.all([
        this.client.quit(),
        this.subscriber.quit(),
        this.publisher.quit(),
      ]);
      logger.info('All Redis connections closed successfully');
    } catch (error) {
      logger.error('Error closing Redis connections:', error);
      throw error;
    }
  }

  // Basic Redis operations
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.set(key, value, 'EX', ttl);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const result = await this.client.expire(key, ttl);
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  async hmset(key: string, data: Record<string, string>): Promise<void> {
    await this.client.hmset(key, data);
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  // Sorted set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return this.client.zrem(key, ...members);
  }

  async zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    if (withScores) {
      return this.client.zrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrange(key, start, stop);
  }

  async zrevrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]> {
    if (withScores) {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrevrange(key, start, stop);
  }

  // Pub/Sub operations
  async publish(channel: string, message: any): Promise<number> {
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    return this.publisher.publish(channel, messageStr);
  }

  async subscribe(channels: string | string[], handler: (channel: string, message: string) => void): Promise<void> {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    
    await this.subscriber.subscribe(...channelArray);
    
    this.subscriber.on('message', (channel, message) => {
      try {
        handler(channel, message);
      } catch (error) {
        logger.error(`Error handling message from channel ${channel}:`, error);
      }
    });
  }

  async unsubscribe(channels?: string | string[]): Promise<void> {
    if (channels) {
      const channelArray = Array.isArray(channels) ? channels : [channels];
      await this.subscriber.unsubscribe(...channelArray);
    } else {
      await this.subscriber.unsubscribe();
    }
  }

  // Pattern-based pub/sub
  async psubscribe(patterns: string | string[], handler: (pattern: string, channel: string, message: string) => void): Promise<void> {
    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    
    await this.subscriber.psubscribe(...patternArray);
    
    this.subscriber.on('pmessage', (pattern, channel, message) => {
      try {
        handler(pattern, channel, message);
      } catch (error) {
        logger.error(`Error handling pmessage from pattern ${pattern}, channel ${channel}:`, error);
      }
    });
  }

  async punsubscribe(patterns?: string | string[]): Promise<void> {
    if (patterns) {
      const patternArray = Array.isArray(patterns) ? patterns : [patterns];
      await this.subscriber.punsubscribe(...patternArray);
    } else {
      await this.subscriber.punsubscribe();
    }
  }

  // JSON operations
  async setJson(key: string, value: any, ttl?: number): Promise<void> {
    const jsonStr = JSON.stringify(value);
    await this.set(key, jsonStr, ttl);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`Failed to parse JSON for key ${key}:`, error);
      return null;
    }
  }

  // Cache with automatic fetching
  async getCached<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 3600
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetcher();
    await this.setJson(key, value, ttl);
    return value;
  }

  // Distributed lock
  async acquireLock(lockKey: string, timeout: number = 10000): Promise<string | null> {
    const lockValue = `${Date.now()}-${Math.random()}`;
    const result = await this.client.set(lockKey, lockValue, 'PX', timeout, 'NX');
    return result === 'OK' ? lockValue : null;
  }

  async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.client.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  // Health check
  async healthCheck(): Promise<{ status: string; latency?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      
      return {
        status: 'healthy',
        latency,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Pattern-based key deletion
  async deletePattern(pattern: string): Promise<number> {
    const keys = await this.client.keys(pattern);
    if (keys.length === 0) return 0;
    
    return this.client.del(...keys);
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  getPublisher(): Redis {
    return this.publisher;
  }

  isHealthy(): boolean {
    return this.isConnected;
  }
}

export const redis = new RedisConfig();

export async function connectRedis() {
  await redis.connect();
}

export async function disconnectRedis() {
  await redis.disconnect();
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectRedis();
});

process.on('SIGTERM', async () => {
  await disconnectRedis();
});