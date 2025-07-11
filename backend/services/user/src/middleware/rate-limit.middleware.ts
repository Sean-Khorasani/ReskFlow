import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { redis } from '../utils/redis';

// Custom store using Redis
class RedisStore {
  private keyPrefix = 'rate-limit:';

  async increment(key: string): Promise<{ totalHits: number; resetTime?: Date }> {
    const redisKey = this.keyPrefix + key;
    const multi = redis.multi();
    
    multi.incr(redisKey);
    multi.expire(redisKey, Math.ceil(config.rateLimit.windowMs / 1000));
    
    const results = await multi.exec();
    const totalHits = results?.[0]?.[1] as number || 1;
    
    const ttl = await redis.ttl(redisKey);
    const resetTime = ttl > 0 ? new Date(Date.now() + ttl * 1000) : undefined;
    
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await redis.decr(this.keyPrefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await redis.del(this.keyPrefix + key);
  }
}

// General rate limiter
export const rateLimiter = rateLimit({
  ...config.rateLimit,
  store: new RedisStore(),
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// Strict rate limiter for auth endpoints
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  store: new RedisStore(),
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Rate limiter for password reset
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  store: new RedisStore(),
  message: 'Too many password reset requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});