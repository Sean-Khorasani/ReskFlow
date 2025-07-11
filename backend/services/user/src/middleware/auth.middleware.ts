import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { AppError } from './error.middleware';
import { redis, cacheKeys } from '../utils/redis';
import { UserRole } from '@prisma/client';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'No token provided');
    }

    const token = authHeader.substring(7);
    
    // Check if token is blacklisted
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      throw new AppError(401, 'Token has been revoked');
    }

    const payload = verifyAccessToken(token);
    
    // Check if user still exists and is active
    const userCache = await redis.get(cacheKeys.userById(payload.userId));
    if (userCache) {
      const user = JSON.parse(userCache);
      if (!user.isActive) {
        throw new AppError(401, 'User account is deactivated');
      }
    }

    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(new AppError(401, 'Invalid token'));
    }
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Unauthorized'));
      return;
    }

    if (!roles.includes(req.user.role as UserRole)) {
      next(new AppError(403, 'Insufficient permissions'));
      return;
    }

    next();
  };
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (!isBlacklisted) {
      try {
        const payload = verifyAccessToken(token);
        req.user = payload;
      } catch {
        // Invalid token, but continue as unauthenticated
      }
    }

    next();
  } catch (error) {
    next();
  }
};