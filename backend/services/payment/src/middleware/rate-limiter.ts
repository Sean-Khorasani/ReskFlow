import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/errors';

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
}

export const rateLimiter = (options: RateLimitOptions = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
    max: options.max || 100, // 100 requests
    message: options.message || 'Too many requests, please try again later',
    handler: (req, res) => {
      throw new AppError(options.message || 'Too many requests', 429);
    },
    standardHeaders: true,
    legacyHeaders: false
  });
};

// Default rate limiter
export const defaultRateLimiter = rateLimiter();

// Strict rate limiter for sensitive endpoints
export const strictRateLimiter = rateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10 // 10 requests
});