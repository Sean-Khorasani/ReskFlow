import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { logger } from '../utils/logger';

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  merchantId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (roles.length && !roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
}

export function authorizeOrderAccess() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new UnauthorizedError());
      }

      const { orderId } = req.params;
      const userId = req.user.userId;
      const userRole = req.user.role;

      // Admins can access all orders
      if (userRole === 'ADMIN') {
        return next();
      }

      // Import here to avoid circular dependency
      const { OrderService } = await import('../services/order.service');
      const orderService = new OrderService();
      const order = await orderService.getOrderById(orderId);

      if (!order) {
        return next(new ForbiddenError('Order not found'));
      }

      // Customers can only access their own orders
      if (userRole === 'CUSTOMER' && order.userId !== userId) {
        return next(new ForbiddenError('Access denied'));
      }

      // Merchants can only access orders from their restaurant
      if (userRole === 'MERCHANT' && order.merchantId !== req.user.merchantId) {
        return next(new ForbiddenError('Access denied'));
      }

      // Drivers can only access assigned deliveries
      if (userRole === 'DRIVER') {
        // Check if driver is assigned to this order's reskflow
        // This would require checking with reskflow service
        logger.warn('Driver order access check not fully implemented');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function extractToken(req: Request): string | null {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7);
  }
  return null;
}