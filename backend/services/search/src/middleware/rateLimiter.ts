import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

// Default rate limit configuration
const defaultConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Allow 1000 requests per windowMs for search
  message: {
    error: 'Too many search requests from this IP',
    retryAfter: 15 * 60, // seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
};

// Rate limiter with Redis store
export const rateLimitMiddleware = rateLimit({
  ...defaultConfig,
  store: {
    async incr(key: string): Promise<{ totalHits: number; resetTime?: Date }> {
      try {
        if (!redisClient.connected) {
          // Fallback to memory-based limiting if Redis is not available
          return { totalHits: 1 };
        }

        const multi = redisClient.client.multi();
        multi.incr(`rate_limit:${key}`);
        multi.expire(`rate_limit:${key}`, Math.ceil(defaultConfig.windowMs / 1000));
        multi.ttl(`rate_limit:${key}`);
        
        const results = await multi.exec();
        
        if (!results) {
          return { totalHits: 1 };
        }

        const hits = results[0][1] as number;
        const ttl = results[2][1] as number;
        const resetTime = ttl > 0 ? new Date(Date.now() + ttl * 1000) : undefined;

        return {
          totalHits: hits,
          resetTime,
        };
      } catch (error) {
        logger.error('Rate limiter Redis error', { error: error.message, key });
        return { totalHits: 1 };
      }
    },

    async decrement(key: string): Promise<void> {
      try {
        if (redisClient.connected) {
          await redisClient.decr(`rate_limit:${key}`);
        }
      } catch (error) {
        logger.error('Rate limiter Redis decrement error', { error: error.message, key });
      }
    },

    async resetKey(key: string): Promise<void> {
      try {
        if (redisClient.connected) {
          await redisClient.del(`rate_limit:${key}`);
        }
      } catch (error) {
        logger.error('Rate limiter Redis reset error', { error: error.message, key });
      }
    },
  },
  keyGenerator: (req: Request): string => {
    // Use IP + User ID if authenticated, otherwise just IP
    const user = req.user;
    const service = req.service;
    
    if (service) {
      return `service:${service.name}`;
    }
    
    if (user) {
      return `user:${user.id}:${req.ip}`;
    }
    
    return `ip:${req.ip}`;
  },
  skip: (req: Request): boolean => {
    // Skip rate limiting for health checks and authenticated services
    return req.path === '/health' || !!req.service;
  },
  onLimitReached: (req: Request, res: Response): void => {
    const user = req.user;
    const service = req.service;
    
    logger.warn('Search rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      userId: user?.id,
      serviceName: service?.name,
      timestamp: new Date().toISOString(),
    });
  },
});

// Stricter rate limiting for autocomplete (higher frequency)
export const autocompleteRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Allow 60 autocomplete requests per minute
  message: {
    error: 'Too many autocomplete requests',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = req.user;
    const service = req.service;
    
    if (service) {
      return `autocomplete:service:${service.name}`;
    }
    
    if (user) {
      return `autocomplete:user:${user.id}`;
    }
    
    return `autocomplete:ip:${req.ip}`;
  },
  skip: (req: Request): boolean => {
    return !!req.service; // Skip for services
  },
  onLimitReached: (req: Request, res: Response): void => {
    logger.warn('Autocomplete rate limit exceeded', {
      ip: req.ip,
      query: req.query.q,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
  },
});

// Rate limiting for indexing operations (administrative)
export const indexingRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Allow 10 indexing operations per 5 minutes
  message: {
    error: 'Too many indexing requests',
    retryAfter: 5 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = req.user;
    const service = req.service;
    
    if (service) {
      return `indexing:service:${service.name}`;
    }
    
    if (user) {
      return `indexing:user:${user.id}`;
    }
    
    return `indexing:ip:${req.ip}`;
  },
  onLimitReached: (req: Request, res: Response): void => {
    logger.warn('Indexing rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      serviceName: req.service?.name,
      timestamp: new Date().toISOString(),
    });
  },
});

// Custom rate limiter for specific endpoints
export function createCustomRateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  skipCondition?: (req: Request) => boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      error: `Too many requests for ${options.keyPrefix}`,
      retryAfter: Math.ceil(options.windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request): string => {
      const user = req.user;
      const service = req.service;
      
      if (service) {
        return `${options.keyPrefix}:service:${service.name}`;
      }
      
      if (user) {
        return `${options.keyPrefix}:user:${user.id}`;
      }
      
      return `${options.keyPrefix}:ip:${req.ip}`;
    },
    skip: options.skipCondition || (() => false),
    onLimitReached: (req: Request, res: Response): void => {
      logger.warn(`Custom rate limit exceeded for ${options.keyPrefix}`, {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        serviceName: req.service?.name,
        timestamp: new Date().toISOString(),
      });
    },
  });
}

// Rate limit status check utility
export async function getRateLimitStatus(key: string): Promise<{
  remaining: number;
  resetTime: Date | null;
  totalHits: number;
} | null> {
  try {
    if (!redisClient.connected) {
      return null;
    }

    const [hits, ttl] = await Promise.all([
      redisClient.get(`rate_limit:${key}`),
      redisClient.ttl(`rate_limit:${key}`),
    ]);

    const totalHits = parseInt(hits || '0', 10);
    const remaining = Math.max(0, defaultConfig.max - totalHits);
    const resetTime = ttl > 0 ? new Date(Date.now() + ttl * 1000) : null;

    return {
      remaining,
      resetTime,
      totalHits,
    };
  } catch (error) {
    logger.error('Failed to get rate limit status', { error: error.message, key });
    return null;
  }
}