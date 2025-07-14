import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { ThreatDetectionService } from '../services/ThreatDetectionService';
import { SecurityContext } from '../types/security.types';
import { logger } from '../utils/logger';
import correlationId from 'correlation-id';

// Initialize threat detection service
let threatDetectionService: ThreatDetectionService;

/**
 * Initialize security middleware with threat detection service
 */
export function initializeSecurityMiddleware(service: ThreatDetectionService): void {
  threatDetectionService = service;
}

/**
 * Helmet security headers middleware
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

/**
 * Rate limiting middleware
 */
export const rateLimitMiddleware = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000') / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/status';
  },
  keyGenerator: (req: Request) => {
    // Use IP + User ID if authenticated, otherwise just IP
    const securityContext: SecurityContext = (req as any).securityContext;
    return securityContext?.userId ? 
      `${req.ip}_${securityContext.userId}` : 
      req.ip || 'unknown';
  },
  onLimitReached: (req: Request) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      correlationId: correlationId.getId(),
    });
  },
});

/**
 * Strict rate limiting for authentication endpoints
 */
export const authRateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip || 'unknown',
  onLimitReached: (req: Request) => {
    logger.warn('Authentication rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      correlationId: correlationId.getId(),
    });
  },
});

/**
 * MongoDB injection protection
 */
export const mongoSanitizeMiddleware = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn('Potential NoSQL injection attempt detected', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      key,
      path: req.path,
      correlationId: correlationId.getId(),
    });
  },
});

/**
 * HTTP Parameter Pollution protection
 */
export const hppMiddleware = hpp({
  whitelist: ['tags', 'categories', 'sort'], // Allow arrays for these parameters
});

/**
 * IP Whitelist middleware
 */
export function ipWhitelistMiddleware(whitelist: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIP = req.ip || req.connection.remoteAddress || '';
    
    if (whitelist.length > 0 && !whitelist.includes(clientIP)) {
      logger.warn('IP not in whitelist', {
        ip: clientIP,
        userAgent: req.get('User-Agent'),
        path: req.path,
        correlationId: correlationId.getId(),
      });
      
      res.status(403).json({
        error: 'Access denied: IP not authorized',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    next();
  };
}

/**
 * IP Blacklist middleware
 */
export function ipBlacklistMiddleware(blacklist: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIP = req.ip || req.connection.remoteAddress || '';
    
    if (blacklist.includes(clientIP)) {
      logger.warn('Blocked IP attempt', {
        ip: clientIP,
        userAgent: req.get('User-Agent'),
        path: req.path,
        correlationId: correlationId.getId(),
      });
      
      res.status(403).json({
        error: 'Access denied: IP blocked',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    next();
  };
}

/**
 * Request size limit middleware
 */
export function requestSizeLimitMiddleware(maxSize: number = 10 * 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.get('content-length') || '0');
    
    if (contentLength > maxSize) {
      logger.warn('Request size exceeded limit', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength,
        maxSize,
        path: req.path,
        correlationId: correlationId.getId(),
      });
      
      res.status(413).json({
        error: 'Request entity too large',
        maxSize,
        actualSize: contentLength,
      });
      return;
    }
    
    next();
  };
}

/**
 * Threat detection middleware
 */
export function threatDetectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!threatDetectionService) {
    return next();
  }

  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  const requestPath = req.path;
  const requestMethod = req.method;

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /\b(union|select|insert|delete|drop|create|alter)\b/i, // SQL injection
    /[<>\"']/g, // XSS patterns
    /\.\.\//g, // Path traversal
    /%[0-9a-f]{2}/gi, // URL encoding (potential bypass attempts)
  ];

  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  let threatScore = 0;
  const detectedThreats: string[] = [];

  // Check for suspicious patterns
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData)) {
      threatScore += 10;
      detectedThreats.push(pattern.toString());
    }
  }

  // Check User-Agent
  if (userAgent.length < 10 || userAgent.includes('bot') || userAgent.includes('crawler')) {
    threatScore += 5;
    detectedThreats.push('suspicious_user_agent');
  }

  // Check for rapid requests from same IP
  const requestKey = `requests:${clientIP}`;
  // This would normally use Redis to track requests per IP

  // Create security context
  const securityContext: SecurityContext = {
    ip: clientIP,
    userAgent,
    correlationId: correlationId.getId(),
    riskScore: threatScore,
    threats: detectedThreats,
    permissions: [],
    mfaVerified: false,
  };

  // Attach security context to request
  (req as any).securityContext = securityContext;

  // Log if threat detected
  if (threatScore > 0) {
    logger.warn('Potential threat detected', {
      ip: clientIP,
      userAgent,
      path: requestPath,
      method: requestMethod,
      threatScore,
      threats: detectedThreats,
      correlationId: securityContext.correlationId,
    });
  }

  // Block high-risk requests
  if (threatScore >= 20) {
    logger.error('High-risk request blocked', {
      ip: clientIP,
      userAgent,
      path: requestPath,
      method: requestMethod,
      threatScore,
      threats: detectedThreats,
      correlationId: securityContext.correlationId,
    });

    res.status(403).json({
      error: 'Request blocked due to security concerns',
      timestamp: new Date().toISOString(),
      correlationId: securityContext.correlationId,
    });
    return;
  }

  next();
}

/**
 * Content type validation middleware
 */
export function contentTypeValidationMiddleware(allowedTypes: string[] = ['application/json']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'DELETE') {
      return next();
    }

    const contentType = req.get('content-type');
    if (!contentType) {
      res.status(400).json({
        error: 'Content-Type header is required',
        allowedTypes,
      });
      return;
    }

    const isAllowed = allowedTypes.some(type => 
      contentType.toLowerCase().includes(type.toLowerCase())
    );

    if (!isAllowed) {
      logger.warn('Invalid content type', {
        ip: req.ip,
        contentType,
        allowedTypes,
        path: req.path,
        correlationId: correlationId.getId(),
      });

      res.status(415).json({
        error: 'Unsupported Media Type',
        received: contentType,
        allowedTypes,
      });
      return;
    }

    next();
  };
}

/**
 * File upload security middleware
 */
export function fileUploadSecurityMiddleware(options: {
  allowedTypes?: string[];
  maxFileSize?: number;
  maxFiles?: number;
} = {}) {
  const {
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    maxFileSize = 5 * 1024 * 1024, // 5MB
    maxFiles = 5,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const files = (req as any).files;
    
    if (!files) {
      return next();
    }

    const fileArray = Array.isArray(files) ? files : [files];

    if (fileArray.length > maxFiles) {
      res.status(400).json({
        error: 'Too many files uploaded',
        maxFiles,
        received: fileArray.length,
      });
      return;
    }

    for (const file of fileArray) {
      if (file.size > maxFileSize) {
        res.status(400).json({
          error: 'File size exceeds limit',
          maxSize: maxFileSize,
          fileName: file.name,
          fileSize: file.size,
        });
        return;
      }

      if (!allowedTypes.includes(file.mimetype)) {
        res.status(400).json({
          error: 'File type not allowed',
          allowedTypes,
          fileName: file.name,
          fileType: file.mimetype,
        });
        return;
      }
    }

    next();
  };
}

/**
 * CORS security middleware
 */
export function corsSecurityMiddleware(allowedOrigins: string[] = []) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.get('origin');
    
    if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
      logger.warn('CORS origin not allowed', {
        ip: req.ip,
        origin,
        allowedOrigins,
        path: req.path,
        correlationId: correlationId.getId(),
      });

      res.status(403).json({
        error: 'Origin not allowed by CORS policy',
        origin,
      });
      return;
    }

    // Set CORS headers
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, X-Correlation-ID');
    res.header('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  };
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Remove server header
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Add correlation ID header
  const correlationIdValue = correlationId.getId();
  res.header('X-Correlation-ID', correlationIdValue);
  
  next();
}

/**
 * Request validation middleware
 */
export function requestValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check for required headers
  const requiredHeaders = ['user-agent'];
  
  for (const header of requiredHeaders) {
    if (!req.get(header)) {
      res.status(400).json({
        error: `Missing required header: ${header}`,
        requiredHeaders,
      });
      return;
    }
  }

  // Validate HTTP method
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
  if (!allowedMethods.includes(req.method)) {
    res.status(405).json({
      error: 'Method not allowed',
      method: req.method,
      allowedMethods,
    });
    return;
  }

  next();
}