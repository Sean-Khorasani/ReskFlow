import rateLimit from 'express-rate-limit';
import { TooManyRequestsError } from '../utils/errors';

export const createRateLimiter = (
  windowMs: number = 15 * 60 * 1000, // 15 minutes
  max: number = 100
) => {
  return rateLimit({
    windowMs,
    max,
    message: 'Too many requests from this IP, please try again later',
    handler: (req, res, next) => {
      next(new TooManyRequestsError());
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Specific rate limiters
export const orderCreationLimiter = createRateLimiter(15 * 60 * 1000, 10); // 10 orders per 15 minutes
export const generalLimiter = createRateLimiter(15 * 60 * 1000, 100); // 100 requests per 15 minutes