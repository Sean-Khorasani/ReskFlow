import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

// Default rate limit configuration
const defaultConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP',
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

        const multi = redisClient as any;
        const results = await Promise.all([
          multi.incr(`rate_limit:${key}`),
          multi.expire(`rate_limit:${key}`, Math.ceil(defaultConfig.windowMs / 1000)),
          multi.ttl(`rate_limit:${key}`),
        ]);

        const hits = results[0];
        const ttl = results[2];
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
          await (redisClient as any).decr(`rate_limit:${key}`);
        }
      } catch (error) {
        logger.error('Rate limiter Redis decrement error', { error: error.message, key });
      }
    },

    async resetKey(key: string): Promise<void> {
      try {
        if (redisClient.connected) {
          await (redisClient as any).del(`rate_limit:${key}`);
        }
      } catch (error) {
        logger.error('Rate limiter Redis reset error', { error: error.message, key });
      }
    },
  },
  keyGenerator: (req: Request): string => {
    // Use IP + User ID if authenticated, otherwise just IP
    const user = (req as any).user;
    const service = (req as any).service;
    
    if (service) {
      return `service:${service.name}`;
    }
    
    if (user) {
      return `user:${user.id}:${req.ip}`;
    }
    
    return `ip:${req.ip}`;
  },
  skip: (req: Request): boolean => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  onLimitReached: (req: Request, res: Response): void => {
    const user = (req as any).user;
    const service = (req as any).service;
    
    logger.warn('Rate limit exceeded', {
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

// Stricter rate limiting for location updates
export const locationUpdateRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Allow 60 location updates per minute (1 per second)
  message: {
    error: 'Too many location updates',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = (req as any).user;
    const sessionId = req.body?.sessionId;
    
    if (sessionId) {
      return `location:${sessionId}`;
    }
    
    if (user) {
      return `location:user:${user.id}`;
    }
    
    return `location:ip:${req.ip}`;
  },
  onLimitReached: (req: Request, res: Response): void => {
    logger.warn('Location update rate limit exceeded', {
      ip: req.ip,
      sessionId: req.body?.sessionId,
      userId: (req as any).user?.id,
      timestamp: new Date().toISOString(),
    });
  },
});

// Rate limiting for route optimization (more expensive operations)
export const routeOptimizationRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Allow 10 route optimizations per 5 minutes
  message: {
    error: 'Too many route optimization requests',
    retryAfter: 5 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = (req as any).user;
    const driverId = req.body?.driverId;
    
    if (driverId) {
      return `route_opt:driver:${driverId}`;
    }
    
    if (user) {
      return `route_opt:user:${user.id}`;
    }
    
    return `route_opt:ip:${req.ip}`;
  },
  onLimitReached: (req: Request, res: Response): void => {
    logger.warn('Route optimization rate limit exceeded', {
      ip: req.ip,
      driverId: req.body?.driverId,
      userId: (req as any).user?.id,
      timestamp: new Date().toISOString(),
    });
  },
});

// Emergency rate limiting (very generous but still prevents abuse)
export const emergencyRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Allow 5 emergency triggers per 10 minutes
  message: {
    error: 'Too many emergency requests',
    retryAfter: 10 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = (req as any).user;
    const sessionId = req.params?.sessionId;
    
    if (sessionId) {
      return `emergency:session:${sessionId}`;
    }
    
    if (user) {
      return `emergency:user:${user.id}`;
    }
    
    return `emergency:ip:${req.ip}`;
  },
  onLimitReached: (req: Request, res: Response): void => {
    logger.error('Emergency rate limit exceeded - potential abuse', {
      ip: req.ip,
      sessionId: req.params?.sessionId,
      userId: (req as any).user?.id,
      timestamp: new Date().toISOString(),
    });
  },
});

// Administrative operations rate limiting
export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Allow 200 admin operations per 15 minutes
  message: {
    error: 'Too many administrative requests',
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = (req as any).user;
    return user ? `admin:${user.id}` : `admin:ip:${req.ip}`;
  },
  skip: (req: Request): boolean => {
    const user = (req as any).user;
    // Skip for super admin role
    return user?.role === 'super_admin';
  },
  onLimitReached: (req: Request, res: Response): void => {
    logger.warn('Admin rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userId: (req as any).user?.id,
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
      const user = (req as any).user;
      const service = (req as any).service;
      
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
        userId: (req as any).user?.id,
        serviceName: (req as any).service?.name,
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
      (redisClient as any).get(`rate_limit:${key}`),
      (redisClient as any).ttl(`rate_limit:${key}`),
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