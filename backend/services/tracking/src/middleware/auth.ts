import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: string;
    permissions: string[];
  };
  service?: {
    name: string;
    version: string;
  };
}

export function authenticateRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    const serviceHeader = req.headers['x-service-token'];

    // Check for service-to-service authentication
    if (serviceHeader) {
      const isValidService = validateServiceToken(serviceHeader as string);
      if (isValidService) {
        req.service = {
          name: 'internal-service',
          version: '1.0.0',
        };
        return next();
      }
    }

    // Check for user authentication
    if (!authHeader) {
      logger.warn('No authorization header provided', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      
      res.status(401).json({
        error: 'Authentication required',
        message: 'Authorization header is missing',
      });
      return;
    }

    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      logger.warn('No token provided in authorization header', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      
      res.status(401).json({
        error: 'Authentication required',
        message: 'Token is missing',
      });
      return;
    }

    // Validate JWT token (simplified validation)
    const user = validateJWTToken(token);
    
    if (!user) {
      logger.warn('Invalid or expired token', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        tokenPrefix: token.substring(0, 10),
      });
      
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired token',
      });
      return;
    }

    req.user = user;
    next();

  } catch (error) {
    logger.error('Authentication error', {
      error: error.message,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    res.status(500).json({
      error: 'Authentication error',
      message: 'Internal authentication error',
    });
  }
}

export function requireRole(requiredRole: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated',
      });
      return;
    }

    if (req.user.role !== requiredRole && req.user.role !== 'admin') {
      logger.warn('Insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRole,
        path: req.path,
        method: req.method,
      });

      res.status(403).json({
        error: 'Access denied',
        message: `Required role: ${requiredRole}`,
      });
      return;
    }

    next();
  };
}

export function requirePermission(requiredPermission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated',
      });
      return;
    }

    if (!req.user.permissions.includes(requiredPermission) && req.user.role !== 'admin') {
      logger.warn('Insufficient permissions', {
        userId: req.user.id,
        userPermissions: req.user.permissions,
        requiredPermission,
        path: req.path,
        method: req.method,
      });

      res.status(403).json({
        error: 'Access denied',
        message: `Required permission: ${requiredPermission}`,
      });
      return;
    }

    next();
  };
}

export function requireAnyRole(requiredRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated',
      });
      return;
    }

    if (!requiredRoles.includes(req.user.role) && req.user.role !== 'admin') {
      logger.warn('Insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles,
        path: req.path,
        method: req.method,
      });

      res.status(403).json({
        error: 'Access denied',
        message: `Required roles: ${requiredRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

export function allowServiceOrUser(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Allow if either service token or user token is valid
  if (req.service || req.user) {
    return next();
  }

  res.status(401).json({
    error: 'Authentication required',
    message: 'Service or user authentication required',
  });
}

function validateServiceToken(token: string): boolean {
  try {
    // In a real implementation, this would validate against a list of known service tokens
    // or decrypt/verify a JWT token specifically for services
    const validServiceTokens = [
      process.env.DELIVERY_SERVICE_TOKEN,
      process.env.ORDER_SERVICE_TOKEN,
      process.env.PAYMENT_SERVICE_TOKEN,
      process.env.USER_SERVICE_TOKEN,
      process.env.NOTIFICATION_SERVICE_TOKEN,
    ].filter(Boolean);

    return validServiceTokens.includes(token);
  } catch (error) {
    logger.error('Service token validation error', { error: error.message });
    return false;
  }
}

function validateJWTToken(token: string): { id: string; role: string; permissions: string[] } | null {
  try {
    // In a real implementation, this would use a JWT library to verify the token
    // For now, we'll do a simplified validation
    
    // Mock validation - in production, use jsonwebtoken library
    if (token.length < 10) {
      return null;
    }

    // Extract user info from token (this would be done by JWT verification)
    // For demo purposes, we'll create a mock user based on token
    const mockUsers: Record<string, { id: string; role: string; permissions: string[] }> = {
      'driver_token': {
        id: 'driver_123',
        role: 'driver',
        permissions: ['tracking:read', 'tracking:write', 'location:update'],
      },
      'customer_token': {
        id: 'customer_456',
        role: 'customer',
        permissions: ['tracking:read'],
      },
      'admin_token': {
        id: 'admin_789',
        role: 'admin',
        permissions: ['*'],
      },
      'merchant_token': {
        id: 'merchant_101',
        role: 'merchant',
        permissions: ['tracking:read', 'geofence:manage'],
      },
    };

    // In production, decode the actual JWT token
    const user = mockUsers[token] || {
      id: 'user_' + Math.random().toString(36).substr(2, 9),
      role: 'user',
      permissions: ['tracking:read'],
    };

    return user;
  } catch (error) {
    logger.error('JWT token validation error', { error: error.message });
    return null;
  }
}

export function extractUserContext(req: AuthenticatedRequest): {
  userId?: string;
  role?: string;
  permissions?: string[];
  isService?: boolean;
} {
  if (req.service) {
    return {
      isService: true,
    };
  }

  if (req.user) {
    return {
      userId: req.user.id,
      role: req.user.role,
      permissions: req.user.permissions,
      isService: false,
    };
  }

  return {};
}

export function logRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const context = extractUserContext(req);
  
  logger.info('API request', {
    method: req.method,
    path: req.path,
    query: req.query,
    userContext: context,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
  });

  next();
}