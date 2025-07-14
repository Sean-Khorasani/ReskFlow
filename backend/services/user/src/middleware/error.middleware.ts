import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.statusCode
      }
    });
    return;
  }

  // Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      res.status(409).json({
        error: {
          message: 'A record with this value already exists',
          field: prismaError.meta?.target
        }
      });
      return;
    }
    if (prismaError.code === 'P2025') {
      res.status(404).json({
        error: {
          message: 'Record not found'
        }
      });
      return;
    }
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: {
        message: 'Validation failed',
        details: err.message
      }
    });
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({
      error: {
        message: 'Invalid token'
      }
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({
      error: {
        message: 'Token expired'
      }
    });
    return;
  }

  // Default error
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error'
    }
  });
};