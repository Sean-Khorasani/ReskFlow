import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let error = err;

  // Handle MongoDB errors
  if (err.name === 'CastError') {
    const message = 'Invalid ID format';
    error = new AppError(message, 400);
  }

  if (err.name === 'ValidationError') {
    const message = 'Validation error';
    error = new AppError(message, 422);
  }

  if (err.name === 'MongoError' && (err as any).code === 11000) {
    const message = 'Duplicate field value';
    error = new AppError(message, 409);
  }

  // Log error
  logger.error({
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Send error response
  const appError = error as AppError;
  res.status(appError.statusCode || 500).json({
    success: false,
    error: {
      message: appError.message || 'Internal server error',
      ...(appError.errors && { errors: appError.errors }),
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    }
  });
};