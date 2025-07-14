import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { authLogger } from '../utils/logger';
import { redis } from '../config/redis';

interface JwtPayload {
  userId: string;
  email: string;
  role: 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'ADMIN';
  merchantId?: string;
  driverId?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// Extract token from request headers
function extractToken(req: Request): string | null {
  // Check Authorization header
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7);
  }

  // Check query parameter (for WebSocket connections)
  if (req.query.token && typeof req.query.token === 'string') {
    return req.query.token;
  }

  // Check cookies
  if (req.cookies?.token) {
    return req.cookies.token;
  }

  return null;
}

// Main authentication middleware
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedError('No authentication token provided');
    }

    // Check if token is blacklisted
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    
    // Additional validation
    if (!decoded.userId || !decoded.email || !decoded.role) {
      throw new UnauthorizedError('Invalid token payload');
    }

    // Store user info in request
    req.user = decoded;

    // Log authentication
    authLogger.info('User authenticated', {
      userId: decoded.userId,
      role: decoded.role,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      authLogger.warn('Invalid JWT token', {
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
      next(new UnauthorizedError('Invalid authentication token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      authLogger.warn('Expired JWT token', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
      next(new UnauthorizedError('Authentication token has expired'));
    } else {
      next(error);
    }
  }
}

// Optional authentication (user may or may not be authenticated)
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }

    // Check if token is blacklisted
    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      return next();
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;

    authLogger.debug('Optional authentication successful', {
      userId: decoded.userId,
      role: decoded.role,
    });
  } catch (error) {
    // Silently fail for optional auth
    authLogger.debug('Optional authentication failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  next();
}

// Role-based authorization
export function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (allowedRoles.length === 0) {
      return next(); // No role restriction
    }

    if (!allowedRoles.includes(req.user.role)) {
      authLogger.warn('Authorization failed', {
        userId: req.user.userId,
        userRole: req.user.role,
        allowedRoles,
        ip: req.ip,
      });
      return next(new ForbiddenError('Insufficient permissions'));
    }

    authLogger.debug('Authorization successful', {
      userId: req.user.userId,
      role: req.user.role,
      allowedRoles,
    });

    next();
  };
}

// Check if user can access reskflow
export function authorizeDeliveryAccess() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new UnauthorizedError('Authentication required'));
      }

      const { reskflowId } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      // Admins can access all deliveries
      if (userRole === 'ADMIN') {
        return next();
      }

      // Import reskflow service to check ownership
      const { DeliveryService } = await import('../services/reskflow.service');
      const reskflowService = new DeliveryService();
      
      try {
        const reskflow = await reskflowService.getDeliveryById(reskflowId);

        // Customers can only access their own orders' deliveries
        if (userRole === 'CUSTOMER' && reskflow.customerId !== userId) {
          return next(new ForbiddenError('Access denied to reskflow'));
        }

        // Drivers can only access deliveries assigned to them
        if (userRole === 'DRIVER') {
          const driverId = req.user.driverId;
          if (!driverId || reskflow.driverId !== driverId) {
            return next(new ForbiddenError('Access denied to reskflow'));
          }
        }

        // Merchants can only access deliveries for their orders
        if (userRole === 'MERCHANT') {
          const merchantId = req.user.merchantId;
          if (!merchantId || reskflow.merchantId !== merchantId) {
            return next(new ForbiddenError('Access denied to reskflow'));
          }
        }

        authLogger.info('Delivery access authorized', {
          userId,
          role: userRole,
          reskflowId,
        });

        next();
      } catch (error) {
        authLogger.error('Error checking reskflow access', {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
          reskflowId,
        });
        next(new ForbiddenError('Delivery not found or access denied'));
      }
    } catch (error) {
      next(error);
    }
  };
}

// Check if driver can access driver-specific resources
export function authorizeDriverAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const { driverId } = req.params;
    const userRole = req.user.role;
    const authenticatedDriverId = req.user.driverId;

    // Admins can access all driver resources
    if (userRole === 'ADMIN') {
      return next();
    }

    // Only drivers can access driver resources
    if (userRole !== 'DRIVER') {
      return next(new ForbiddenError('Driver access required'));
    }

    // Drivers can only access their own resources
    if (driverId && authenticatedDriverId !== driverId) {
      authLogger.warn('Driver access denied', {
        authenticatedDriverId,
        requestedDriverId: driverId,
        userId: req.user.userId,
      });
      return next(new ForbiddenError('Access denied to driver resource'));
    }

    next();
  };
}

// Check if merchant can access merchant-specific resources
export function authorizeMerchantAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const { merchantId } = req.params;
    const userRole = req.user.role;
    const authenticatedMerchantId = req.user.merchantId;

    // Admins can access all merchant resources
    if (userRole === 'ADMIN') {
      return next();
    }

    // Only merchants can access merchant resources
    if (userRole !== 'MERCHANT') {
      return next(new ForbiddenError('Merchant access required'));
    }

    // Merchants can only access their own resources
    if (merchantId && authenticatedMerchantId !== merchantId) {
      authLogger.warn('Merchant access denied', {
        authenticatedMerchantId,
        requestedMerchantId: merchantId,
        userId: req.user.userId,
      });
      return next(new ForbiddenError('Access denied to merchant resource'));
    }

    next();
  };
}

// Rate limiting per user
export function rateLimitPerUser(maxRequests: number, windowMinutes: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.userId || req.ip;
      const windowKey = `rate_limit:${userId}:${Math.floor(Date.now() / (windowMinutes * 60 * 1000))}`;
      
      const currentCount = await redis.incr(windowKey);
      
      if (currentCount === 1) {
        await redis.expire(windowKey, windowMinutes * 60);
      }
      
      if (currentCount > maxRequests) {
        authLogger.warn('Rate limit exceeded', {
          userId,
          currentCount,
          maxRequests,
          windowMinutes,
          ip: req.ip,
        });
        return next(new TooManyRequestsError(`Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMinutes} minutes.`));
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, maxRequests - currentCount).toString(),
        'X-RateLimit-Reset': new Date(Date.now() + windowMinutes * 60 * 1000).toISOString(),
      });

      next();
    } catch (error) {
      authLogger.error('Rate limiting error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.userId,
        ip: req.ip,
      });
      next(); // Continue on rate limit error
    }
  };
}

// Check if token is blacklisted
async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const blacklisted = await redis.exists(`blacklist:${token}`);
    return blacklisted;
  } catch (error) {
    authLogger.error('Error checking token blacklist', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false; // Fail open
  }
}

// Blacklist a token
export async function blacklistToken(token: string, expiresInSeconds?: number): Promise<void> {
  try {
    const key = `blacklist:${token}`;
    await redis.set(key, '1');
    
    if (expiresInSeconds) {
      await redis.expire(key, expiresInSeconds);
    }
    
    authLogger.info('Token blacklisted', { tokenHash: hashToken(token) });
  } catch (error) {
    authLogger.error('Error blacklisting token', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// Hash token for logging (security)
function hashToken(token: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex').substring(0, 8);
}

// WebSocket authentication
export function authenticateSocket(token: string): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    if (!token) {
      reject(new UnauthorizedError('No token provided'));
      return;
    }

    jwt.verify(token, config.jwt.secret, async (err, decoded) => {
      if (err) {
        authLogger.warn('WebSocket authentication failed', {
          error: err.message,
        });
        reject(new UnauthorizedError('Invalid token'));
        return;
      }

      const payload = decoded as JwtPayload;
      
      // Check if token is blacklisted
      const blacklisted = await isTokenBlacklisted(token);
      if (blacklisted) {
        reject(new UnauthorizedError('Token has been revoked'));
        return;
      }

      authLogger.info('WebSocket authentication successful', {
        userId: payload.userId,
        role: payload.role,
      });

      resolve(payload);
    });
  });
}