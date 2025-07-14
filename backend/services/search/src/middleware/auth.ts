import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        email?: string;
      };
      service?: {
        name: string;
        version: string;
      };
    }
  }
}

// Simple authentication middleware for development
// In production, this would integrate with a proper authentication service
export const authenticateUser = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      // Allow anonymous search for public endpoints
      next();
      return;
    }

    // Extract token from Bearer header
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : authHeader;

    // For development, accept any token that looks like a valid format
    if (token && token.length > 10) {
      // Mock user data - in production, decode and validate JWT
      req.user = {
        id: `user_${token.slice(-8)}`,
        role: token.includes('admin') ? 'admin' : 'user',
        email: `user_${token.slice(-8)}@example.com`
      };

      logger.debug('User authenticated', {
        userId: req.user.id,
        role: req.user.role,
        endpoint: req.path
      });
    }

    next();

  } catch (error) {
    logger.error('Authentication error', {
      error: error.message,
      authHeader: req.headers.authorization?.substring(0, 20) + '...'
    });

    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Invalid or expired token',
      timestamp: new Date().toISOString()
    });
  }
};

// Service-to-service authentication
export const authenticateService = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const serviceKey = req.headers['x-service-key'] as string;
    const serviceName = req.headers['x-service-name'] as string;
    const serviceVersion = req.headers['x-service-version'] as string;

    if (serviceKey && serviceName) {
      // In production, validate service key against a registry
      // For development, accept any service with proper headers
      req.service = {
        name: serviceName,
        version: serviceVersion || '1.0.0'
      };

      logger.debug('Service authenticated', {
        serviceName: req.service.name,
        serviceVersion: req.service.version,
        endpoint: req.path
      });
    }

    next();

  } catch (error) {
    logger.error('Service authentication error', {
      error: error.message,
      serviceName: req.headers['x-service-name']
    });

    res.status(401).json({
      success: false,
      error: 'Service authentication failed',
      message: 'Invalid service credentials',
      timestamp: new Date().toISOString()
    });
  }
};

// Admin role check middleware
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'This endpoint requires authentication',
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    logger.warn('Admin access denied', {
      userId: req.user.id,
      role: req.user.role,
      endpoint: req.path,
      ip: req.ip
    });

    res.status(403).json({
      success: false,
      error: 'Access denied',
      message: 'Admin privileges required',
      timestamp: new Date().toISOString()
    });
    return;
  }

  next();
};

// Service access check middleware
export const requireService = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.service && !req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'This endpoint requires service or user authentication',
      timestamp: new Date().toISOString()
    });
    return;
  }

  next();
};

// Request logging middleware
export const logRequest = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Log request
  logger.info('Request started', {
    method: req.method,
    path: req.path,
    query: req.query,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user?.id,
    serviceName: req.service?.name
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id,
      serviceName: req.service?.name
    });
  });

  next();
};

// CORS headers middleware
export const setCorsHeaders = (req: Request, res: Response, next: NextFunction): void => {
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'];
  const origin = req.get('Origin');

  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Service-Key, X-Service-Name, X-Service-Version');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
};

// Security headers middleware
export const setSecurityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Only set HSTS in production with HTTPS
  if (process.env.NODE_ENV === 'production' && req.secure) {
    res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
};