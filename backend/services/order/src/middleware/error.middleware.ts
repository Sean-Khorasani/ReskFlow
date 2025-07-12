import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { config } from '../config';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  let error = err;

  // Log error
  logger.error({
    error: {
      message: err.message,
      stack: err.stack,
      statusCode: (err as any).statusCode,
    },
    request: {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      body: req.body,
      headers: {
        'user-agent': req.get('user-agent'),
        'content-type': req.get('content-type'),
      },
    },
  });

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      error = new AppError('Duplicate entry found', 409);
    } else if (prismaError.code === 'P2025') {
      error = new AppError('Record not found', 404);
    } else {
      error = new AppError('Database error', 500);
    }
  }

  // Handle MongoDB errors
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    const mongoError = err as any;
    if (mongoError.code === 11000) {
      error = new AppError('Duplicate entry found', 409);
    } else {
      error = new AppError('Database error', 500);
    }
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    error = new AppError(err.message, 400);
  }

  // Default to 500 server error
  if (!(error instanceof AppError)) {
    error = new AppError(
      config.env === 'production' ? 'Internal server error' : err.message,
      500
    );
  }

  const appError = error as AppError;

  res.status(appError.statusCode).json({
    error: {
      message: appError.message,
      statusCode: appError.statusCode,
      ...(config.env === 'development' && {
        stack: err.stack,
        originalError: err.message,
      }),
    },
  });
}