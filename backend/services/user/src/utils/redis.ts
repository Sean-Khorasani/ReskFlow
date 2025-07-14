import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError(err) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  }
});

redis.on('connect', () => {
  logger.info('Successfully connected to Redis');
});

redis.on('error', (error) => {
  logger.error('Redis connection error:', error);
});

redis.on('close', () => {
  logger.info('Redis connection closed');
});

// Cache keys
export const cacheKeys = {
  userById: (id: string) => `user:${id}`,
  userByEmail: (email: string) => `user:email:${email}`,
  userSessions: (userId: string) => `user:${userId}:sessions`,
  refreshToken: (token: string) => `refresh:${token}`,
  twoFactorTemp: (userId: string) => `2fa:temp:${userId}`,
  loginAttempts: (email: string) => `login:attempts:${email}`,
  passwordReset: (token: string) => `password:reset:${token}`,
  emailVerification: (token: string) => `email:verify:${token}`
};

// Cache TTL (in seconds)
export const cacheTTL = {
  user: 3600, // 1 hour
  session: 86400, // 24 hours
  refreshToken: 2592000, // 30 days
  twoFactorTemp: 300, // 5 minutes
  loginAttempts: 900, // 15 minutes
  passwordReset: 3600, // 1 hour
  emailVerification: 86400 // 24 hours
};