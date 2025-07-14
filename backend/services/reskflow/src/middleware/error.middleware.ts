import { Request, Response, NextFunction } from 'express';
import { AppError, isOperationalError, formatErrorResponse } from '../utils/errors';
import { logger } from '../utils/logger';
import { config } from '../config';

// Error response interface
interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    statusCode: number;
    details?: any;
    stack?: string;
    timestamp: string;
    path: string;
    method: string;
    requestId?: string;
  };
}

// Generate unique request ID for error tracking
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Main error handling middleware
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = generateRequestId();
  
  // Log error with context
  logError(err, req, requestId);

  // Handle specific error types
  if (err instanceof AppError) {
    handleAppError(err, req, res, requestId);
  } else if (err.name === 'ValidationError') {
    handleValidationError(err, req, res, requestId);
  } else if (err.name === 'CastError') {
    handleCastError(err, req, res, requestId);
  } else if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    handleDatabaseError(err, req, res, requestId);
  } else if (err.name === 'MulterError') {
    handleMulterError(err, req, res, requestId);
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    handleJsonSyntaxError(err, req, res, requestId);
  } else {
    handleGenericError(err, req, res, requestId);
  }
}

// Handle operational errors
function handleAppError(
  err: AppError,
  req: Request,
  res: Response,
  requestId: string
): void {
  const errorResponse: ErrorResponse = {
    error: {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  // Add stack trace in development
  if (config.env === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(err.statusCode).json(errorResponse);
}

// Handle validation errors
function handleValidationError(
  err: any,
  req: Request,
  res: Response,
  requestId: string
): void {
  const errors = Object.values(err.errors || {}).map((error: any) => ({
    field: error.path,
    message: error.message,
    value: error.value,
  }));

  const errorResponse: ErrorResponse = {
    error: {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: errors,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  res.status(400).json(errorResponse);
}

// Handle cast errors (invalid ID format)
function handleCastError(
  err: any,
  req: Request,
  res: Response,
  requestId: string
): void {
  const errorResponse: ErrorResponse = {
    error: {
      message: `Invalid ${err.path}: ${err.value}`,
      code: 'INVALID_ID_FORMAT',
      statusCode: 400,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  res.status(400).json(errorResponse);
}

// Handle database errors
function handleDatabaseError(
  err: any,
  req: Request,
  res: Response,
  requestId: string
): void {
  let message = 'Database error occurred';
  let code = 'DATABASE_ERROR';
  let statusCode = 500;

  // Handle duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    message = `${field} already exists`;
    code = 'DUPLICATE_FIELD';
    statusCode = 409;
  }

  const errorResponse: ErrorResponse = {
    error: {
      message,
      code,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  res.status(statusCode).json(errorResponse);
}

// Handle file upload errors
function handleMulterError(
  err: any,
  req: Request,
  res: Response,
  requestId: string
): void {
  let message = 'File upload error';
  let code = 'FILE_UPLOAD_ERROR';
  let statusCode = 400;

  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      message = 'File too large';
      code = 'FILE_TOO_LARGE';
      break;
    case 'LIMIT_FILE_COUNT':
      message = 'Too many files';
      code = 'TOO_MANY_FILES';
      break;
    case 'LIMIT_UNEXPECTED_FILE':
      message = 'Unexpected field';
      code = 'UNEXPECTED_FIELD';
      break;
  }

  const errorResponse: ErrorResponse = {
    error: {
      message,
      code,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  res.status(statusCode).json(errorResponse);
}

// Handle JSON syntax errors
function handleJsonSyntaxError(
  err: any,
  req: Request,
  res: Response,
  requestId: string
): void {
  const errorResponse: ErrorResponse = {
    error: {
      message: 'Invalid JSON syntax',
      code: 'INVALID_JSON',
      statusCode: 400,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  res.status(400).json(errorResponse);
}

// Handle generic/unknown errors
function handleGenericError(
  err: Error,
  req: Request,
  res: Response,
  requestId: string
): void {
  const errorResponse: ErrorResponse = {
    error: {
      message: config.env === 'development' ? err.message : 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  // Add stack trace in development
  if (config.env === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(500).json(errorResponse);
}

// Log error with appropriate level and context
function logError(err: Error, req: Request, requestId: string): void {
  const errorContext = {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.userId,
    timestamp: new Date().toISOString(),
  };

  if (isOperationalError(err)) {
    // Log operational errors at warn level
    logger.warn('Operational error', {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      ...errorContext,
    });
  } else {
    // Log unexpected errors at error level
    logger.error('Unexpected error', {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      ...errorContext,
    });
  }
}

// 404 handler for unmatched routes
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = generateRequestId();
  
  logger.warn('Route not found', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  const errorResponse: ErrorResponse = {
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'ROUTE_NOT_FOUND',
      statusCode: 404,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      requestId,
    },
  };

  res.status(404).json(errorResponse);
}

// Async error wrapper
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Global error handlers for uncaught exceptions and unhandled rejections
export function setupGlobalErrorHandlers(): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught Exception', {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    });

    // Give the logger time to write, then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? {
        name: reason.name,
        message: reason.message,
        stack: reason.stack,
      } : reason,
      promise: promise.toString(),
    });

    // Give the logger time to write, then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle SIGTERM and SIGINT for graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

// Health check error handler
export function healthCheckErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error('Health check failed', {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  });

  res.status(503).json({
    status: 'unhealthy',
    error: err.message,
    timestamp: new Date().toISOString(),
  });
}

// Error monitoring integration (can be extended with services like Sentry)
export function reportError(err: Error, context?: any): void {
  // Log the error
  logger.error('Error reported to monitoring', {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
    context,
  });

  // Here you can integrate with error monitoring services
  // Example: Sentry.captureException(err, { contexts: context });
}

// Error metrics collection
export function collectErrorMetrics(err: Error, req: Request): void {
  // Increment error counters by type
  const errorType = err.constructor.name;
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  
  // Here you can integrate with metrics collection services
  logger.debug('Error metrics collected', {
    errorType,
    statusCode,
    path: req.path,
    method: req.method,
  });
}