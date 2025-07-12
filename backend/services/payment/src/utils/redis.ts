import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (error) => {
  logger.error('Redis error:', error);
});

// Helper functions
export const setWithExpiry = async (
  key: string,
  value: any,
  ttl: number
): Promise<void> => {
  await redis.setex(key, ttl, JSON.stringify(value));
};

export const get = async <T>(key: string): Promise<T | null> => {
  const value = await redis.get(key);
  return value ? JSON.parse(value) : null;
};

export const del = async (key: string): Promise<void> => {
  await redis.del(key);
};

export const exists = async (key: string): Promise<boolean> => {
  const result = await redis.exists(key);
  return result === 1;
};