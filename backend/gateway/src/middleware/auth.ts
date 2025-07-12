/**
 * Authentication Middleware
 * Validates JWT tokens and attaches user context to requests
 */

import { Request, Response, NextFunction } from 'express';
import { securityService } from '../../../src/services/security/security.service';
import { userService } from '../../../src/services/user/user.service';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    sessionId?: string;
  };
  token?: string;
}

/**
 * Main authentication middleware
 */
export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    req.token = token;

    // Verify token
    const payload = await securityService.verifyToken(token);

    // Get user details
    const user = await userService.getUserById(payload.userId);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: payload.sessionId
    };

    // Log access
    await securityService.logSecurityEvent({
      type: 'access',
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        path: req.path,
        method: req.method
      },
      timestamp: new Date()
    });

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Optional authentication middleware
 * Allows requests to proceed without authentication but attaches user if token is valid
 */
export const optionalAuthMiddleware = async (
  req: AuthRequest,
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
    req.token = token;

    // Try to verify token
    const payload = await securityService.verifyToken(token);
    const user = await userService.getUserById(payload.userId);

    if (user && user.isActive) {
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        sessionId: payload.sessionId
      };
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Role-based authorization middleware
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      // Log permission denied
      securityService.logSecurityEvent({
        type: 'permission_denied',
        userId: req.user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          path: req.path,
          method: req.method,
          requiredRoles: allowedRoles,
          userRole: req.user.role
        },
        timestamp: new Date()
      });

      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Permission-based authorization middleware
 */
export const checkPermission = (resource: string, action: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user has permission
    const hasPermission = securityService.hasPermission(
      req.user.role as any,
      resource,
      action,
      req.params.userId === req.user.id ? 'own' : 'all'
    );

    if (!hasPermission) {
      // Log permission denied
      securityService.logSecurityEvent({
        type: 'permission_denied',
        userId: req.user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          path: req.path,
          method: req.method,
          resource,
          action,
          userRole: req.user.role
        },
        timestamp: new Date()
      });

      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * API key authentication middleware for service-to-service communication
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  // Validate API key
  const validApiKey = process.env[`API_KEY_${req.headers['x-service-name']}`];
  
  if (apiKey !== validApiKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
};

/**
 * Refresh token middleware
 */
export const refreshTokenMiddleware = async (
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> => {
  try {
    const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
    
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token required' });
      return;
    }

    // Verify and refresh tokens
    const tokens = await userService.refreshToken(refreshToken);
    
    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

/**
 * Session validation middleware
 */
export const validateSession = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user || !req.user.sessionId) {
    next();
    return;
  }

  try {
    const session = await securityService.getSession(req.user.sessionId);
    
    if (!session || session.userId !== req.user.id) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }

    // Check if session is expired
    if (new Date() > new Date(session.expiresAt)) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    next();
  } catch (error) {
    logger.error('Session validation error:', error);
    res.status(401).json({ error: 'Session validation failed' });
  }
};

/**
 * Two-factor authentication check middleware
 */
export const require2FA = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    // Check if user has 2FA enabled
    const user = await userService.getUserById(req.user.id);
    
    if (user && user.twoFactorEnabled && !req.headers['x-2fa-token']) {
      res.status(403).json({ 
        error: 'Two-factor authentication required',
        require2FA: true 
      });
      return;
    }

    // Verify 2FA token if provided
    if (req.headers['x-2fa-token']) {
      const isValid = await userService.verify2FAToken(
        req.user.id,
        req.headers['x-2fa-token'] as string
      );
      
      if (!isValid) {
        res.status(403).json({ error: 'Invalid 2FA token' });
        return;
      }
    }

    next();
  } catch (error) {
    logger.error('2FA check error:', error);
    res.status(500).json({ error: '2FA validation failed' });
  }
};