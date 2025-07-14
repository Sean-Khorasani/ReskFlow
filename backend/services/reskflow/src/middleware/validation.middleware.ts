import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

// Validation options
const validationOptions: Joi.ValidationOptions = {
  abortEarly: false, // Return all validation errors
  allowUnknown: false, // Don't allow unknown fields
  stripUnknown: true, // Remove unknown fields
};

// Generic validation middleware
export function validate(schema: {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  headers?: Joi.ObjectSchema;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validationErrors: string[] = [];

      // Validate request body
      if (schema.body) {
        const { error, value } = schema.body.validate(req.body, validationOptions);
        if (error) {
          validationErrors.push(...formatJoiErrors(error.details));
        } else {
          req.body = value;
        }
      }

      // Validate query parameters
      if (schema.query) {
        const { error, value } = schema.query.validate(req.query, validationOptions);
        if (error) {
          validationErrors.push(...formatJoiErrors(error.details));
        } else {
          req.query = value;
        }
      }

      // Validate route parameters
      if (schema.params) {
        const { error, value } = schema.params.validate(req.params, validationOptions);
        if (error) {
          validationErrors.push(...formatJoiErrors(error.details));
        } else {
          req.params = value;
        }
      }

      // Validate headers
      if (schema.headers) {
        const { error } = schema.headers.validate(req.headers, validationOptions);
        if (error) {
          validationErrors.push(...formatJoiErrors(error.details));
        }
      }

      if (validationErrors.length > 0) {
        logger.warn('Validation failed', {
          path: req.path,
          method: req.method,
          errors: validationErrors,
          userId: req.user?.userId,
        });
        throw new ValidationError(`Validation failed: ${validationErrors.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

// Format Joi validation errors
function formatJoiErrors(details: Joi.ValidationErrorItem[]): string[] {
  return details.map(detail => {
    const path = detail.path.join('.');
    return `${path}: ${detail.message}`;
  });
}

// Common validation schemas
export const commonSchemas = {
  // UUID validation
  uuid: Joi.string().uuid().required(),
  optionalUuid: Joi.string().uuid().optional(),

  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  // Coordinates
  coordinates: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }),

  // Address
  address: Joi.object({
    street: Joi.string().trim().min(1).max(255).required(),
    city: Joi.string().trim().min(1).max(100).required(),
    state: Joi.string().trim().min(1).max(100).optional(),
    zipCode: Joi.string().trim().min(1).max(20).optional(),
    country: Joi.string().trim().min(1).max(100).required(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }).optional(),
  }),

  // Phone number
  phoneNumber: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,}$/).required(),

  // Date range
  dateRange: Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
  }),
};

// Delivery-specific validation schemas
export const reskflowSchemas = {
  // Create reskflow
  createDelivery: {
    body: Joi.object({
      orderId: commonSchemas.uuid,
      customerId: commonSchemas.uuid,
      merchantId: commonSchemas.uuid,
      pickupAddress: commonSchemas.address,
      reskflowAddress: commonSchemas.address,
      customerPhone: commonSchemas.phoneNumber,
      specialInstructions: Joi.string().trim().max(500).optional(),
      reskflowFee: Joi.number().min(0).precision(2).required(),
      estimatedPickupTime: Joi.date().iso().min('now').required(),
      estimatedDeliveryTime: Joi.date().iso().min(Joi.ref('estimatedPickupTime')).required(),
      priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH', 'URGENT').default('NORMAL'),
    }),
  },

  // Update reskflow
  updateDelivery: {
    params: Joi.object({
      reskflowId: commonSchemas.uuid,
    }),
    body: Joi.object({
      status: Joi.string().valid(
        'PENDING',
        'ASSIGNED',
        'PICKED_UP',
        'IN_TRANSIT',
        'DELIVERED',
        'CANCELLED',
        'FAILED'
      ).optional(),
      actualPickupTime: Joi.date().iso().optional(),
      actualDeliveryTime: Joi.date().iso().optional(),
      reskflowProof: Joi.string().uri().optional(),
      notes: Joi.string().trim().max(1000).optional(),
    }).min(1),
  },

  // Assign reskflow
  assignDelivery: {
    params: Joi.object({
      reskflowId: commonSchemas.uuid,
    }),
    body: Joi.object({
      driverId: commonSchemas.uuid,
    }),
  },

  // Get deliveries with filters
  getDeliveries: {
    query: commonSchemas.pagination.keys({
      status: Joi.string().valid(
        'PENDING',
        'ASSIGNED',
        'PICKED_UP',
        'IN_TRANSIT',
        'DELIVERED',
        'CANCELLED',
        'FAILED'
      ).optional(),
      customerId: commonSchemas.optionalUuid,
      driverId: commonSchemas.optionalUuid,
      merchantId: commonSchemas.optionalUuid,
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
      priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH', 'URGENT').optional(),
    }),
  },

  // Get reskflow by ID
  getDeliveryById: {
    params: Joi.object({
      reskflowId: commonSchemas.uuid,
    }),
  },
};

// Driver-specific validation schemas
export const driverSchemas = {
  // Create driver
  createDriver: {
    body: Joi.object({
      userId: commonSchemas.uuid,
      licenseNumber: Joi.string().trim().min(1).max(50).required(),
      vehicleType: Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK').required(),
      vehicleModel: Joi.string().trim().min(1).max(100).required(),
      vehiclePlate: Joi.string().trim().min(1).max(20).required(),
      phone: commonSchemas.phoneNumber,
      emergencyContact: Joi.object({
        name: Joi.string().trim().min(1).max(100).required(),
        phone: commonSchemas.phoneNumber,
        relationship: Joi.string().trim().min(1).max(50).required(),
      }).required(),
    }),
  },

  // Update driver
  updateDriver: {
    params: Joi.object({
      driverId: commonSchemas.uuid,
    }),
    body: Joi.object({
      status: Joi.string().valid('ACTIVE', 'INACTIVE', 'SUSPENDED').optional(),
      vehicleType: Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK').optional(),
      vehicleModel: Joi.string().trim().min(1).max(100).optional(),
      vehiclePlate: Joi.string().trim().min(1).max(20).optional(),
      phone: commonSchemas.phoneNumber.optional(),
      emergencyContact: Joi.object({
        name: Joi.string().trim().min(1).max(100).required(),
        phone: commonSchemas.phoneNumber,
        relationship: Joi.string().trim().min(1).max(50).required(),
      }).optional(),
    }).min(1),
  },

  // Update driver location
  updateDriverLocation: {
    params: Joi.object({
      driverId: commonSchemas.uuid,
    }),
    body: Joi.object({
      location: commonSchemas.coordinates,
      heading: Joi.number().min(0).max(360).optional(),
      speed: Joi.number().min(0).optional(),
      accuracy: Joi.number().min(0).optional(),
    }),
  },

  // Update driver availability
  updateDriverAvailability: {
    params: Joi.object({
      driverId: commonSchemas.uuid,
    }),
    body: Joi.object({
      available: Joi.boolean().required(),
      location: commonSchemas.coordinates.optional(),
    }),
  },

  // Get nearby drivers
  getNearbyDrivers: {
    query: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
      radius: Joi.number().min(0.1).max(50).default(10),
      vehicleType: Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK').optional(),
      limit: Joi.number().integer().min(1).max(100).default(20),
    }),
  },
};

// Tracking-specific validation schemas
export const trackingSchemas = {
  // Update tracking
  updateTracking: {
    params: Joi.object({
      reskflowId: commonSchemas.uuid,
    }),
    body: Joi.object({
      location: commonSchemas.coordinates,
      timestamp: Joi.date().iso().default('now'),
      status: Joi.string().valid(
        'ASSIGNED',
        'PICKED_UP',
        'IN_TRANSIT',
        'DELIVERED',
        'FAILED'
      ).optional(),
      notes: Joi.string().trim().max(500).optional(),
    }),
  },

  // Get tracking history
  getTrackingHistory: {
    params: Joi.object({
      reskflowId: commonSchemas.uuid,
    }),
    query: Joi.object({
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
      limit: Joi.number().integer().min(1).max(1000).default(100),
    }),
  },
};

// Route-specific validation schemas
export const routeSchemas = {
  // Calculate route
  calculateRoute: {
    body: Joi.object({
      origin: commonSchemas.coordinates,
      destination: commonSchemas.coordinates,
      waypoints: Joi.array().items(commonSchemas.coordinates).optional(),
      optimizeWaypoints: Joi.boolean().default(false),
      vehicleType: Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK').default('CAR'),
    }),
  },

  // Optimize reskflow route
  optimizeRoute: {
    body: Joi.object({
      depot: commonSchemas.coordinates,
      reskflowPoints: Joi.array().items(commonSchemas.coordinates).min(1).required(),
      vehicleType: Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK').default('CAR'),
    }),
  },
};

// Analytics validation schemas
export const analyticsSchemas = {
  // Get reskflow analytics
  getDeliveryAnalytics: {
    query: commonSchemas.dateRange.keys({
      groupBy: Joi.string().valid('day', 'week', 'month').default('day'),
      merchantId: commonSchemas.optionalUuid,
      driverId: commonSchemas.optionalUuid,
    }),
  },

  // Get driver performance
  getDriverPerformance: {
    params: Joi.object({
      driverId: commonSchemas.uuid,
    }),
    query: commonSchemas.dateRange.keys({
      metric: Joi.string().valid(
        'reskflow_time',
        'customer_rating',
        'completion_rate',
        'distance_traveled'
      ).optional(),
    }),
  },
};

// File upload validation
export const fileUploadSchemas = {
  // Upload reskflow proof
  uploadDeliveryProof: {
    params: Joi.object({
      reskflowId: commonSchemas.uuid,
    }),
  },
};

// WebSocket validation schemas
export const websocketSchemas = {
  // Join room
  joinRoom: Joi.object({
    room: Joi.string().valid('reskflow', 'driver', 'customer').required(),
    id: commonSchemas.uuid.required(),
  }),

  // Location update
  locationUpdate: Joi.object({
    reskflowId: commonSchemas.uuid.required(),
    location: commonSchemas.coordinates.required(),
    timestamp: Joi.date().iso().default('now'),
  }),
};

// Custom validation functions
export const customValidators = {
  // Validate coordinates are within service area
  validateServiceArea: (lat: number, lng: number, serviceAreas: any[]) => {
    // Implementation would check if coordinates are within defined service areas
    return true; // Placeholder
  },

  // Validate reskflow time is within business hours
  validateBusinessHours: (reskflowTime: Date) => {
    const hour = reskflowTime.getHours();
    return hour >= 6 && hour <= 23; // 6 AM to 11 PM
  },

  // Validate driver capacity
  validateDriverCapacity: async (driverId: string, maxCapacity: number = 5) => {
    // Implementation would check current active deliveries for driver
    return true; // Placeholder
  },
};

// Validation error handler
export function handleValidationError(error: Joi.ValidationError): ValidationError {
  const messages = error.details.map(detail => detail.message);
  return new ValidationError(`Validation failed: ${messages.join(', ')}`);
}

// Sanitization middleware
export function sanitizeInput(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        // Basic XSS protection
        req.body[field] = req.body[field]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '');
      }
    });
    next();
  };
}

// Rate limiting validation
export function validateRateLimit(maxRequests: number, windowMs: number) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    for (const [k, v] of requests.entries()) {
      if (v.resetTime < windowStart) {
        requests.delete(k);
      }
    }

    const current = requests.get(key) || { count: 0, resetTime: now + windowMs };
    
    if (current.resetTime < now) {
      current.count = 1;
      current.resetTime = now + windowMs;
    } else {
      current.count++;
    }

    requests.set(key, current);

    if (current.count > maxRequests) {
      const error = new ValidationError(`Rate limit exceeded. Try again later.`);
      return next(error);
    }

    next();
  };
}