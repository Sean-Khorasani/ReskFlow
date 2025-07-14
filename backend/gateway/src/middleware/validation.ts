/**
 * Validation Middleware
 * Validates request data and sanitizes inputs
 */

import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { securityService } from '../../../src/services/security/security.service';
import { logger } from '../utils/logger';

/**
 * Main validation middleware that checks validation results
 */
export const validationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));

    logger.warn('Validation failed:', {
      path: req.path,
      method: req.method,
      errors: formattedErrors
    });

    res.status(400).json({
      error: 'Validation failed',
      errors: formattedErrors
    });
    return;
  }

  next();
};

/**
 * Security validation middleware
 * Checks for malicious patterns in request data
 */
export const securityValidation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Validate all input data
    const dataToValidate = {
      body: req.body,
      query: req.query,
      params: req.params
    };

    const validation = securityService.validateInput(dataToValidate);
    
    if (!validation.valid) {
      // Log security event
      securityService.logSecurityEvent({
        type: 'suspicious_activity',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          path: req.path,
          method: req.method,
          threats: validation.threats
        },
        timestamp: new Date()
      });

      res.status(400).json({
        error: 'Invalid input detected',
        threats: validation.threats
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Security validation error:', error);
    res.status(500).json({ error: 'Security validation failed' });
  }
};

/**
 * Sanitize request data
 */
export const sanitizeRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Sanitize body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query params
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }

    // Sanitize params
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    logger.error('Sanitization error:', error);
    res.status(500).json({ error: 'Request sanitization failed' });
  }
};

/**
 * File upload validation middleware
 */
export const fileValidation = (options: {
  maxSize?: number;
  allowedTypes?: string[];
  required?: boolean;
}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { maxSize = 10 * 1024 * 1024, allowedTypes = [], required = false } = options;

    // Check if file is required
    if (required && !req.file && (!req.files || Object.keys(req.files).length === 0)) {
      res.status(400).json({ error: 'File is required' });
      return;
    }

    // Validate single file
    if (req.file) {
      if (!validateFile(req.file, maxSize, allowedTypes)) {
        res.status(400).json({ error: 'Invalid file' });
        return;
      }
    }

    // Validate multiple files
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      
      for (const file of files) {
        if (!validateFile(file as Express.Multer.File, maxSize, allowedTypes)) {
          res.status(400).json({ error: 'Invalid file' });
          return;
        }
      }
    }

    next();
  };
};

/**
 * JSON schema validation middleware
 */
interface ValidationSchema {
  validate(data: any, options?: any): { error?: { details: Array<{ path: string[]; message: string }> } };
}

export const schemaValidation = (schema: ValidationSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      res.status(400).json({
        error: 'Validation failed',
        errors
      });
      return;
    }

    next();
  };
};

/**
 * Pagination validation middleware
 */
export const paginationValidation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  // Validate page
  if (page < 1) {
    res.status(400).json({ error: 'Page must be greater than 0' });
    return;
  }

  // Validate limit
  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: 'Limit must be between 1 and 100' });
    return;
  }

  // Add pagination to request
  (req as any).pagination = {
    page,
    limit,
    offset: (page - 1) * limit
  };

  next();
};

/**
 * Date range validation middleware
 */
export const dateRangeValidation = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  if (startDate && !isValidDate(startDate)) {
    res.status(400).json({ error: 'Invalid start date' });
    return;
  }

  if (endDate && !isValidDate(endDate)) {
    res.status(400).json({ error: 'Invalid end date' });
    return;
  }

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      res.status(400).json({ error: 'Start date must be before end date' });
      return;
    }

    // Check if range is too large (e.g., more than 1 year)
    const yearInMs = 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > yearInMs) {
      res.status(400).json({ error: 'Date range cannot exceed 1 year' });
      return;
    }
  }

  next();
};

/**
 * Content type validation middleware
 */
export const contentTypeValidation = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.headers['content-type'];
    
    if (!contentType) {
      res.status(400).json({ error: 'Content-Type header is required' });
      return;
    }

    const baseContentType = contentType.split(';')[0].trim();
    
    if (!allowedTypes.includes(baseContentType)) {
      res.status(415).json({ 
        error: 'Unsupported Media Type',
        allowedTypes 
      });
      return;
    }

    next();
  };
};

/**
 * Custom validation rules
 */
export const customValidations = {
  isPhoneNumber: (value: string): boolean => {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(value);
  },

  isPostalCode: (value: string, country: string = 'US'): boolean => {
    const postalCodeRegex: Record<string, RegExp> = {
      US: /^\d{5}(-\d{4})?$/,
      CA: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
      UK: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
      AU: /^\d{4}$/
    };

    const regex = postalCodeRegex[country];
    return regex ? regex.test(value) : true;
  },

  isCoordinate: (value: any): boolean => {
    if (typeof value !== 'object') return false;
    const { lat, lng } = value;
    return (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180
    );
  },

  isURL: (value: string): boolean => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },

  isBase64: (value: string): boolean => {
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    return base64Regex.test(value);
  }
};

/**
 * Helper functions
 */
function sanitizeObject(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      
      if (typeof value === 'string') {
        // Basic XSS prevention
        sanitized[key] = value
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .trim();
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'object' ? sanitizeObject(item) : item
        );
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  
  return sanitized;
}

function validateFile(file: Express.Multer.File, maxSize: number, allowedTypes: string[]): boolean {
  // Check file size
  if (file.size > maxSize) {
    return false;
  }

  // Check file type
  if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
    return false;
  }

  // Check for malicious file names
  const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.ps1'];
  const fileName = file.originalname.toLowerCase();
  
  for (const ext of dangerousExtensions) {
    if (fileName.endsWith(ext)) {
      return false;
    }
  }

  return true;
}

function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Create validation chain for common fields
 */
export const commonValidations = {
  email: () => ({
    in: ['body'],
    isEmail: true,
    normalizeEmail: true,
    errorMessage: 'Invalid email address'
  }),

  password: () => ({
    in: ['body'],
    isLength: { min: 8 },
    matches: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    errorMessage: 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character'
  }),

  uuid: (field: string) => ({
    in: ['params', 'body', 'query'],
    isUUID: true,
    errorMessage: `Invalid ${field} ID`
  }),

  pagination: () => ({
    page: {
      in: ['query'],
      optional: true,
      isInt: { min: 1 },
      toInt: true,
      errorMessage: 'Page must be a positive integer'
    },
    limit: {
      in: ['query'],
      optional: true,
      isInt: { min: 1, max: 100 },
      toInt: true,
      errorMessage: 'Limit must be between 1 and 100'
    }
  })
};