import { Request, Response, NextFunction } from 'express';
import { logger, loggerHelpers } from '../utils/logger';
import { config } from '../config';

// Extended request interface for logging
interface LoggedRequest extends Request {
  startTime?: number;
  requestId?: string;
}

// Generate unique request ID
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Request logging middleware
export function requestLogger(
  req: LoggedRequest,
  res: Response,
  next: NextFunction
): void {
  // Generate unique request ID
  req.requestId = generateRequestId();
  req.startTime = Date.now();

  // Skip logging for health checks and static assets
  if (shouldSkipLogging(req)) {
    return next();
  }

  // Log incoming request
  logIncomingRequest(req);

  // Store original res.end to log response
  const originalEnd = res.end;
  
  res.end = function(chunk?: any, encoding?: any) {
    // Log response
    logResponse(req, res);
    
    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };

  next();
}

// Check if request should be skipped from logging
function shouldSkipLogging(req: Request): boolean {
  const skipPaths = [
    '/health',
    '/metrics',
    '/favicon.ico',
  ];

  const skipExtensions = [
    '.css',
    '.js',
    '.map',
    '.ico',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
  ];

  // Skip health checks and static assets
  if (skipPaths.some(path => req.path.startsWith(path))) {
    return true;
  }

  // Skip static file requests
  if (skipExtensions.some(ext => req.path.endsWith(ext))) {
    return true;
  }

  return false;
}

// Log incoming request
function logIncomingRequest(req: LoggedRequest): void {
  const logData = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: getClientIp(req),
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    userId: req.user?.userId,
    role: req.user?.role,
    referer: req.get('Referer'),
    timestamp: new Date().toISOString(),
  };

  // Log request body for non-GET requests (be careful with sensitive data)
  if (req.method !== 'GET' && req.body && config.env === 'development') {
    logData.body = sanitizeLogData(req.body);
  }

  logger.info('Incoming request', logData);
}

// Log response
function logResponse(req: LoggedRequest, res: Response): void {
  const duration = req.startTime ? Date.now() - req.startTime : 0;
  const statusCode = res.statusCode;

  const logData = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    statusCode,
    duration,
    contentLength: res.get('Content-Length'),
    userId: req.user?.userId,
    timestamp: new Date().toISOString(),
  };

  // Determine log level based on status code
  if (statusCode >= 400) {
    if (statusCode >= 500) {
      logger.error('Response error', logData);
    } else {
      logger.warn('Response client error', logData);
    }
  } else {
    logger.info('Response success', logData);
  }

  // Log performance metrics for slow requests
  if (duration > 1000) {
    loggerHelpers.logPerformance('slow_request', duration, {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode,
    });
  }
}

// Get real client IP address
function getClientIp(req: Request): string {
  return (
    req.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    req.get('X-Real-IP') ||
    req.get('X-Client-IP') ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

// Sanitize sensitive data from logs
function sanitizeLogData(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = [
    'password',
    'token',
    'authorization',
    'secret',
    'key',
    'pin',
    'otp',
    'ssn',
    'creditCard',
    'cvv',
    'cardNumber',
  ];

  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  // Recursively sanitize nested objects
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  }

  return sanitized;
}

// Security event logging middleware
export function securityLogger(
  req: LoggedRequest,
  res: Response,
  next: NextFunction
): void {
  // Log suspicious activities
  const suspiciousPatterns = [
    /\.\./,           // Path traversal
    /<script/i,       // XSS attempts
    /union.*select/i, // SQL injection
    /javascript:/i,   // JavaScript protocol
    /vbscript:/i,     // VBScript protocol
  ];

  const requestData = JSON.stringify({
    path: req.path,
    query: req.query,
    body: req.body,
  });

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData)) {
      loggerHelpers.logSecurityEvent('suspicious_request', req.user?.userId, getClientIp(req), {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        pattern: pattern.toString(),
      });
      break;
    }
  }

  // Log failed authentication attempts
  if (req.path.includes('/auth') && res.statusCode === 401) {
    loggerHelpers.logSecurityEvent('auth_failure', req.user?.userId, getClientIp(req), {
      requestId: req.requestId,
      path: req.path,
      userAgent: req.get('User-Agent'),
    });
  }

  next();
}

// Business event logging middleware
export function businessEventLogger() {
  return (req: LoggedRequest, res: Response, next: NextFunction): void => {
    // Store original json method to intercept responses
    const originalJson = res.json;
    
    res.json = function(body: any) {
      // Log business events based on response
      logBusinessEvents(req, res, body);
      
      // Call original json method
      return originalJson.call(this, body);
    };

    next();
  };
}

// Log business events based on API responses
function logBusinessEvents(req: LoggedRequest, res: Response, responseBody: any): void {
  const { method, path } = req;
  const statusCode = res.statusCode;

  // Delivery created
  if (method === 'POST' && path.includes('/deliveries') && statusCode === 201) {
    loggerHelpers.logBusinessEvent('reskflow_created', {
      requestId: req.requestId,
      reskflowId: responseBody?.id,
      customerId: req.user?.userId,
    });
  }

  // Delivery assigned
  if (method === 'PUT' && path.includes('/assign') && statusCode === 200) {
    loggerHelpers.logBusinessEvent('reskflow_assigned', {
      requestId: req.requestId,
      reskflowId: responseBody?.id,
      driverId: responseBody?.driverId,
    });
  }

  // Delivery status updated
  if (method === 'PUT' && path.includes('/status') && statusCode === 200) {
    loggerHelpers.logBusinessEvent('reskflow_status_updated', {
      requestId: req.requestId,
      reskflowId: responseBody?.id,
      status: responseBody?.status,
      updatedBy: req.user?.userId,
    });
  }

  // Driver location updated
  if (method === 'PUT' && path.includes('/location') && statusCode === 200) {
    loggerHelpers.logBusinessEvent('driver_location_updated', {
      requestId: req.requestId,
      driverId: req.user?.driverId,
      location: responseBody?.location,
    });
  }
}

// API rate limiting logging
export function rateLimitLogger(
  req: LoggedRequest,
  res: Response,
  next: NextFunction
): void {
  // Log rate limit headers if present
  const rateLimit = {
    limit: res.get('X-RateLimit-Limit'),
    remaining: res.get('X-RateLimit-Remaining'),
    reset: res.get('X-RateLimit-Reset'),
  };

  if (rateLimit.limit) {
    logger.debug('Rate limit info', {
      requestId: req.requestId,
      userId: req.user?.userId,
      ip: getClientIp(req),
      rateLimit,
    });
  }

  // Log when rate limit is exceeded
  if (res.statusCode === 429) {
    loggerHelpers.logSecurityEvent('rate_limit_exceeded', req.user?.userId, getClientIp(req), {
      requestId: req.requestId,
      path: req.path,
      userAgent: req.get('User-Agent'),
    });
  }

  next();
}

// Error context middleware (adds request context to errors)
export function errorContextMiddleware(
  req: LoggedRequest,
  res: Response,
  next: NextFunction
): void {
  // Add request context to req object for error handling
  req.context = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: getClientIp(req),
    userAgent: req.get('User-Agent'),
    userId: req.user?.userId,
    timestamp: new Date().toISOString(),
  };

  next();
}

// API versioning logging
export function apiVersionLogger(
  req: LoggedRequest,
  res: Response,
  next: NextFunction
): void {
  const apiVersion = req.get('API-Version') || req.query.version || 'v1';
  
  logger.debug('API version', {
    requestId: req.requestId,
    version: apiVersion,
    path: req.path,
  });

  next();
}

// Custom field logger for specific use cases
export function customFieldLogger(fields: string[]) {
  return (req: LoggedRequest, res: Response, next: NextFunction): void => {
    const customData: any = {};
    
    fields.forEach(field => {
      if (req.body[field] !== undefined) {
        customData[field] = req.body[field];
      }
      if (req.query[field] !== undefined) {
        customData[field] = req.query[field];
      }
      if (req.params[field] !== undefined) {
        customData[field] = req.params[field];
      }
    });

    if (Object.keys(customData).length > 0) {
      logger.debug('Custom fields', {
        requestId: req.requestId,
        customData: sanitizeLogData(customData),
      });
    }

    next();
  };
}

// Extend Request interface for context
declare module 'express' {
  interface Request {
    context?: {
      requestId?: string;
      method: string;
      path: string;
      ip: string;
      userAgent?: string;
      userId?: string;
      timestamp: string;
    };
  }
}