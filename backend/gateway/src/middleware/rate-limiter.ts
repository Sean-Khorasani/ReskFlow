/**
 * Rate Limiting Middleware
 * Prevents abuse by limiting request frequency
 */

import { Request, Response, NextFunction } from 'express';
import { securityService } from '../../../src/services/security/security.service';
import { logger } from '../utils/logger';
import { AuthRequest } from './auth';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Create rate limiter middleware with custom options
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
    keyGenerator = (req) => req.ip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = keyGenerator(req);
      const result = await securityService.checkRateLimit(key, {
        windowMs,
        maxRequests,
        keyPrefix: 'rate_limit'
      });

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', result.resetAt.toISOString());

      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString());
        
        // Log rate limit exceeded
        await securityService.logSecurityEvent({
          type: 'rate_limit_exceeded',
          userId: (req as AuthRequest).user?.id,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          details: {
            path: req.path,
            method: req.method,
            limit: maxRequests,
            windowMs
          },
          timestamp: new Date()
        });

        res.status(429).json({ error: message });
        return;
      }

      // Continue to next middleware
      const originalSend = res.send;
      res.send = function(data: any) {
        // Skip counting based on response status
        if ((skipSuccessfulRequests && res.statusCode < 400) ||
            (skipFailedRequests && res.statusCode >= 400)) {
          // Decrement the counter
          securityService.checkRateLimit(key, {
            windowMs,
            maxRequests: maxRequests + 1, // Compensate for the increment
            keyPrefix: 'rate_limit'
          });
        }
        return originalSend.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Allow request on error
      next();
    }
  };
};

/**
 * Default rate limiter for general API endpoints
 */
export const rateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100
});

/**
 * Strict rate limiter for authentication endpoints
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: true
});

/**
 * Rate limiter for password reset endpoints
 */
export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3,
  message: 'Too many password reset requests, please try again later'
});

/**
 * Rate limiter for API key authenticated requests
 */
export const apiKeyRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000,
  keyGenerator: (req) => req.headers['x-api-key'] as string || req.ip
});

/**
 * Dynamic rate limiter based on user tier
 */
export const tierBasedRateLimiter = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Default limits
  const windowMs = 15 * 60 * 1000; // 15 minutes
  let maxRequests = 100;

  // Adjust limits based on user tier
  if (req.user) {
    const userTier = await getUserTier(req.user.id);
    
    switch (userTier) {
      case 'premium':
        maxRequests = 1000;
        break;
      case 'plus':
        maxRequests = 500;
        break;
      case 'basic':
      default:
        maxRequests = 100;
    }
  }

  const limiter = createRateLimiter({
    windowMs,
    maxRequests,
    keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip
  });

  limiter(req, res, next);
};

/**
 * Endpoint-specific rate limiter
 */
export const endpointRateLimiter = (limits: Record<string, RateLimitOptions>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const endpoint = `${req.method}:${req.path}`;
    
    // Find matching limit configuration
    let limitConfig: RateLimitOptions | undefined;
    
    for (const pattern in limits) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(endpoint)) {
        limitConfig = limits[pattern];
        break;
      }
    }

    if (!limitConfig) {
      // No specific limit, use default
      next();
      return;
    }

    const limiter = createRateLimiter(limitConfig);
    limiter(req, res, next);
  };
};

/**
 * Distributed rate limiter for multiple instances
 */
export const distributedRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  keyGenerator: (req) => {
    // Include instance ID for distributed limiting
    const instanceId = process.env.INSTANCE_ID || 'default';
    return `${instanceId}:${req.ip}`;
  }
});

/**
 * Helper function to get user tier
 */
async function getUserTier(userId: string): Promise<string> {
  // This would typically fetch from database
  // For now, return a default
  return 'basic';
}

/**
 * Sliding window rate limiter for more accurate limiting
 */
export class SlidingWindowRateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private requests: Map<string, number[]> = new Map();

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async checkLimit(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Get existing requests
    let timestamps = this.requests.get(key) || [];
    
    // Remove old requests outside the window
    timestamps = timestamps.filter(ts => ts > windowStart);
    
    // Check if limit exceeded
    if (timestamps.length >= this.maxRequests) {
      const oldestRequest = Math.min(...timestamps);
      const resetAt = new Date(oldestRequest + this.windowMs);
      
      return {
        allowed: false,
        remaining: 0,
        resetAt
      };
    }

    // Add current request
    timestamps.push(now);
    this.requests.set(key, timestamps);

    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance
      this.cleanup();
    }

    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetAt: new Date(now + this.windowMs)
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [key, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(ts => ts > windowStart);
      if (validTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validTimestamps);
      }
    }
  }
}

// Create a sliding window limiter instance
const slidingWindowLimiter = new SlidingWindowRateLimiter(15 * 60 * 1000, 100);

/**
 * Sliding window rate limiter middleware
 */
export const slidingWindowRateLimiterMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const key = req.ip;
  const result = await slidingWindowLimiter.checkLimit(key);

  // Set headers
  res.setHeader('X-RateLimit-Limit', '100');
  res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
  res.setHeader('X-RateLimit-Reset', result.resetAt.toISOString());

  if (!result.allowed) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  next();
};