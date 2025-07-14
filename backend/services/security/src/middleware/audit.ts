import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/AuditService';
import { AuditLog, SecurityContext } from '../types/security.types';
import { logAuditEvent } from '../utils/logger';
import correlationId from 'correlation-id';

// Initialize audit service
let auditService: AuditService;

/**
 * Initialize audit middleware with audit service
 */
export function initializeAuditMiddleware(service: AuditService): void {
  auditService = service;
}

/**
 * Main audit middleware
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Capture response data
  let responseData: any;
  let responseSize = 0;

  // Override res.send to capture response
  res.send = function(data: any) {
    responseData = data;
    responseSize = Buffer.byteLength(data || '', 'utf8');
    return originalSend.call(this, data);
  };

  // Override res.json to capture JSON response
  res.json = function(data: any) {
    responseData = data;
    responseSize = Buffer.byteLength(JSON.stringify(data || {}), 'utf8');
    return originalJson.call(this, data);
  };

  // Capture request completion
  res.on('finish', async () => {
    try {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Get security context if available
      const securityContext: SecurityContext = (req as any).securityContext || {
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        correlationId: correlationId.getId(),
        permissions: [],
        mfaVerified: false,
        riskScore: 0,
      };

      // Determine if the request was successful
      const success = res.statusCode < 400;

      // Extract error information for failed requests
      let error: string | undefined;
      if (!success && responseData) {
        if (typeof responseData === 'string') {
          try {
            const parsed = JSON.parse(responseData);
            error = parsed.error || parsed.message;
          } catch {
            error = responseData.substring(0, 500); // Limit error message length
          }
        } else if (typeof responseData === 'object') {
          error = responseData.error || responseData.message;
        }
      }

      // Create audit log entry
      const auditData: Partial<AuditLog> = {
        userId: securityContext.userId,
        sessionId: securityContext.sessionId,
        action: determineAction(req.method, req.path, req.body),
        resource: determineResource(req.path),
        method: req.method,
        endpoint: req.path,
        userAgent: securityContext.userAgent,
        ip: securityContext.ip,
        success,
        error,
        duration,
        correlationId: securityContext.correlationId,
        metadata: {
          query: req.query,
          statusCode: res.statusCode,
          responseSize,
          requestSize: getRequestSize(req),
          apiVersion: (req as any).apiVersion,
          riskScore: securityContext.riskScore,
          mfaVerified: securityContext.mfaVerified,
          permissions: securityContext.permissions,
          headers: sanitizeHeaders(req.headers),
        },
      };

      // Log to audit service if available
      if (auditService) {
        await auditService.logAuditEvent(auditData);
      } else {
        // Fallback to file logging
        logAuditEvent(
          auditData.action || 'unknown',
          auditData.resource || 'unknown',
          auditData.userId,
          auditData.ip,
          auditData.success,
          auditData.metadata
        );
      }

      // Log sensitive operations with higher priority
      if (isSensitiveOperation(req.method, req.path)) {
        logAuditEvent(
          `sensitive_${auditData.action}`,
          auditData.resource || 'unknown',
          auditData.userId,
          auditData.ip,
          auditData.success,
          {
            ...auditData.metadata,
            sensitive: true,
            requestBody: sanitizeRequestBody(req.body),
          }
        );
      }

      // Log failed authentication attempts
      if (!success && req.path.includes('auth')) {
        logAuditEvent(
          'failed_authentication',
          'authentication',
          auditData.userId,
          auditData.ip,
          false,
          {
            endpoint: req.path,
            statusCode: res.statusCode,
            userAgent: securityContext.userAgent,
            method: req.method,
          }
        );
      }

    } catch (error) {
      // Audit logging should not break the application
      console.error('Audit middleware error:', error.message);
    }
  });

  next();
}

/**
 * High-priority audit middleware for critical operations
 */
export function criticalAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Log the start of critical operation
  const securityContext: SecurityContext = (req as any).securityContext || {
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    correlationId: correlationId.getId(),
    permissions: [],
    mfaVerified: false,
    riskScore: 0,
  };

  logAuditEvent(
    'critical_operation_start',
    determineResource(req.path),
    securityContext.userId,
    securityContext.ip,
    true,
    {
      method: req.method,
      endpoint: req.path,
      timestamp: new Date().toISOString(),
      requestBody: sanitizeRequestBody(req.body),
    }
  );

  // Capture completion
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const success = res.statusCode < 400;

    logAuditEvent(
      'critical_operation_complete',
      determineResource(req.path),
      securityContext.userId,
      securityContext.ip,
      success,
      {
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode,
        duration,
        timestamp: new Date().toISOString(),
      }
    );
  });

  next();
}

/**
 * Data access audit middleware
 */
export function dataAccessAuditMiddleware(dataType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    const securityContext: SecurityContext = (req as any).securityContext || {
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      correlationId: correlationId.getId(),
      permissions: [],
      mfaVerified: false,
      riskScore: 0,
    };

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const success = res.statusCode < 400;

      logAuditEvent(
        `data_access_${req.method.toLowerCase()}`,
        dataType,
        securityContext.userId,
        securityContext.ip,
        success,
        {
          method: req.method,
          endpoint: req.path,
          statusCode: res.statusCode,
          duration,
          dataType,
          recordId: req.params.id,
          query: sanitizeQueryParams(req.query),
        }
      );
    });

    next();
  };
}

/**
 * Administrative action audit middleware
 */
export function adminAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  const securityContext: SecurityContext = (req as any).securityContext || {
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    correlationId: correlationId.getId(),
    permissions: [],
    mfaVerified: false,
    riskScore: 0,
  };

  // Log admin action attempt
  logAuditEvent(
    'admin_action_attempt',
    determineResource(req.path),
    securityContext.userId,
    securityContext.ip,
    true,
    {
      method: req.method,
      endpoint: req.path,
      requestBody: sanitizeRequestBody(req.body),
      adminLevel: true,
    }
  );

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const success = res.statusCode < 400;

    logAuditEvent(
      'admin_action_result',
      determineResource(req.path),
      securityContext.userId,
      securityContext.ip,
      success,
      {
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode,
        duration,
        adminLevel: true,
      }
    );
  });

  next();
}

/**
 * Compliance audit middleware for GDPR operations
 */
export function complianceAuditMiddleware(operation: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const securityContext: SecurityContext = (req as any).securityContext || {
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      correlationId: correlationId.getId(),
      permissions: [],
      mfaVerified: false,
      riskScore: 0,
    };

    res.on('finish', () => {
      const success = res.statusCode < 400;

      logAuditEvent(
        `compliance_${operation}`,
        'compliance',
        securityContext.userId,
        securityContext.ip,
        success,
        {
          method: req.method,
          endpoint: req.path,
          statusCode: res.statusCode,
          operation,
          gdprCompliance: true,
          subjectUserId: req.params.userId || req.body?.userId,
        }
      );
    });

    next();
  };
}

/**
 * Authentication audit middleware
 */
export function authAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  const securityContext: SecurityContext = (req as any).securityContext || {
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    correlationId: correlationId.getId(),
    permissions: [],
    mfaVerified: false,
    riskScore: 0,
  };

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const success = res.statusCode < 400;
    const action = determineAuthAction(req.path);

    logAuditEvent(
      action,
      'authentication',
      req.body?.userId || req.body?.email,
      securityContext.ip,
      success,
      {
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: securityContext.userAgent,
        authMethod: req.body?.authMethod || 'password',
        mfaUsed: req.body?.mfaToken ? true : false,
      }
    );
  });

  next();
}

/**
 * File operation audit middleware
 */
export function fileAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const securityContext: SecurityContext = (req as any).securityContext || {
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    correlationId: correlationId.getId(),
    permissions: [],
    mfaVerified: false,
    riskScore: 0,
  };

  res.on('finish', () => {
    const success = res.statusCode < 400;

    logAuditEvent(
      `file_${req.method.toLowerCase()}`,
      'file_system',
      securityContext.userId,
      securityContext.ip,
      success,
      {
        method: req.method,
        endpoint: req.path,
        statusCode: res.statusCode,
        fileName: req.params.filename || req.body?.filename,
        fileSize: req.get('Content-Length'),
        contentType: req.get('Content-Type'),
      }
    );
  });

  next();
}

/**
 * Real-time audit logging for immediate alerts
 */
export function realTimeAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const securityContext: SecurityContext = (req as any).securityContext || {
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    correlationId: correlationId.getId(),
    permissions: [],
    mfaVerified: false,
    riskScore: 0,
  };

  // Log immediately for real-time monitoring
  logAuditEvent(
    'real_time_request',
    determineResource(req.path),
    securityContext.userId,
    securityContext.ip,
    true,
    {
      method: req.method,
      endpoint: req.path,
      timestamp: new Date().toISOString(),
      realTime: true,
    }
  );

  next();
}

/**
 * Determine action based on HTTP method and path
 */
function determineAction(method: string, path: string, body?: any): string {
  const pathSegments = path.split('/').filter(segment => segment.length > 0);
  const resource = pathSegments[pathSegments.length - 1] || 'unknown';

  switch (method.toUpperCase()) {
    case 'GET':
      return pathSegments.includes('search') ? 'search' : 'read';
    case 'POST':
      if (path.includes('auth')) return 'authenticate';
      if (path.includes('login')) return 'login';
      if (path.includes('register')) return 'register';
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    case 'OPTIONS':
      return 'options';
    case 'HEAD':
      return 'head';
    default:
      return method.toLowerCase();
  }
}

/**
 * Determine resource from path
 */
function determineResource(path: string): string {
  const pathSegments = path.split('/').filter(segment => segment.length > 0);
  
  // Remove API version prefix
  if (pathSegments[0] === 'api' && pathSegments[1]?.match(/^v\d+$/)) {
    pathSegments.splice(0, 2);
  } else if (pathSegments[0] === 'api') {
    pathSegments.splice(0, 1);
  }

  // Return the first meaningful segment as resource
  return pathSegments[0] || 'root';
}

/**
 * Check if operation is sensitive
 */
function isSensitiveOperation(method: string, path: string): boolean {
  const sensitivePatterns = [
    '/auth/',
    '/admin/',
    '/users/',
    '/payments/',
    '/orders/',
    '/keys/',
    '/security/',
    '/compliance/',
  ];

  const sensitiveMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  return sensitiveMethods.includes(method) && 
         sensitivePatterns.some(pattern => path.includes(pattern));
}

/**
 * Determine authentication action from path
 */
function determineAuthAction(path: string): string {
  if (path.includes('login')) return 'login_attempt';
  if (path.includes('logout')) return 'logout';
  if (path.includes('register')) return 'registration_attempt';
  if (path.includes('reset')) return 'password_reset_attempt';
  if (path.includes('mfa')) return 'mfa_attempt';
  if (path.includes('verify')) return 'verification_attempt';
  return 'auth_attempt';
}

/**
 * Get request size
 */
function getRequestSize(req: Request): number {
  const contentLength = req.get('Content-Length');
  if (contentLength) {
    return parseInt(contentLength);
  }

  // Estimate size from body
  if (req.body) {
    return Buffer.byteLength(JSON.stringify(req.body), 'utf8');
  }

  return 0;
}

/**
 * Sanitize headers for logging
 */
function sanitizeHeaders(headers: any): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-csrf-token'];

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = String(value);
    }
  }

  return sanitized;
}

/**
 * Sanitize request body for logging
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'authorization',
    'ssn', 'creditCard', 'bankAccount', 'pin', 'otp'
  ];

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Sanitize query parameters for logging
 */
function sanitizeQueryParams(query: any): any {
  const sanitized = { ...query };
  const sensitiveParams = ['token', 'key', 'secret', 'password', 'apikey'];

  for (const param of sensitiveParams) {
    if (param in sanitized) {
      sanitized[param] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Audit middleware for API rate limiting
 */
export function rateLimitAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const securityContext: SecurityContext = (req as any).securityContext || {
    ip: req.ip || req.connection.remoteAddress || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    correlationId: correlationId.getId(),
    permissions: [],
    mfaVerified: false,
    riskScore: 0,
  };

  res.on('finish', () => {
    if (res.statusCode === 429) {
      logAuditEvent(
        'rate_limit_exceeded',
        'rate_limiting',
        securityContext.userId,
        securityContext.ip,
        false,
        {
          method: req.method,
          endpoint: req.path,
          retryAfter: res.get('Retry-After'),
          userAgent: securityContext.userAgent,
        }
      );
    }
  });

  next();
}

/**
 * Export middleware for batch operations
 */
export function batchAuditMiddleware(operationType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const securityContext: SecurityContext = (req as any).securityContext || {
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      correlationId: correlationId.getId(),
      permissions: [],
      mfaVerified: false,
      riskScore: 0,
    };

    res.on('finish', () => {
      const success = res.statusCode < 400;

      logAuditEvent(
        `batch_${operationType}`,
        'batch_operation',
        securityContext.userId,
        securityContext.ip,
        success,
        {
          method: req.method,
          endpoint: req.path,
          statusCode: res.statusCode,
          batchSize: Array.isArray(req.body) ? req.body.length : 1,
          operationType,
        }
      );
    });

    next();
  };
}