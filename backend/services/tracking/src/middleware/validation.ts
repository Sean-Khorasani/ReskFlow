import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../utils/logger';

// Validation schemas
const schemas = {
  createTrackingSession: Joi.object({
    orderId: Joi.string().required(),
    driverId: Joi.string().required(),
    customerId: Joi.string().required(),
    merchantId: Joi.string().required(),
    sessionType: Joi.string().valid('DELIVERY', 'PICKUP', 'ROUND_TRIP', 'MULTI_STOP').required(),
    status: Joi.string().valid('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED').optional(),
    startLocation: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().optional(),
      heading: Joi.number().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).optional(),
    endLocation: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().optional(),
      heading: Joi.number().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).optional(),
    plannedRoute: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().required(),
      type: Joi.string().valid('PICKUP', 'DELIVERY', 'WAYPOINT', 'BREAK', 'FUEL_STOP').required(),
      estimatedArrival: Joi.date().optional(),
      completed: Joi.boolean().default(false),
      metadata: Joi.object().optional(),
    })).optional(),
    estimatedArrival: Joi.date().optional(),
    metadata: Joi.object().optional(),
  }),

  updateTrackingSession: Joi.object({
    status: Joi.string().valid('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED').optional(),
    currentLocation: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().optional(),
      heading: Joi.number().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).optional(),
    endLocation: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().optional(),
      heading: Joi.number().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).optional(),
    estimatedArrival: Joi.date().optional(),
    actualArrival: Joi.date().optional(),
    metadata: Joi.object().optional(),
  }),

  updateLocation: Joi.object({
    sessionId: Joi.string().required(),
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().min(0).optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().min(0).optional(),
      heading: Joi.number().min(0).max(360).optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).required(),
    batteryLevel: Joi.number().min(0).max(100).optional(),
    networkType: Joi.string().valid('wifi', 'cellular', '2g', '3g', '4g', '5g', 'unknown').optional(),
  }),

  completeTracking: Joi.object({
    endLocation: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().optional(),
      heading: Joi.number().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).optional(),
  }),

  cancelTracking: Joi.object({
    reason: Joi.string().optional(),
  }),

  triggerEmergency: Joi.object({
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      accuracy: Joi.number().optional(),
      altitude: Joi.number().optional(),
      speed: Joi.number().optional(),
      heading: Joi.number().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().optional(),
    }).required(),
    description: Joi.string().optional(),
  }),

  createGeofenceZone: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).optional(),
    zoneType: Joi.string().valid(
      'CIRCULAR', 
      'POLYGON', 
      'RECTANGLE', 
      'MERCHANT_LOCATION', 
      'DELIVERY_AREA', 
      'RESTRICTED_ZONE', 
      'PARKING_AREA'
    ).required(),
    coordinates: Joi.alternatives().try(
      // For circular zones
      Joi.object({
        latitude: Joi.number().min(-90).max(90).required(),
        longitude: Joi.number().min(-180).max(180).required(),
      }),
      // For polygon zones
      Joi.object({
        points: Joi.array().items(Joi.object({
          latitude: Joi.number().min(-90).max(90).required(),
          longitude: Joi.number().min(-180).max(180).required(),
        })).min(3).required(),
      }),
      // For rectangle zones
      Joi.object({
        north: Joi.number().min(-90).max(90).required(),
        south: Joi.number().min(-90).max(90).required(),
        east: Joi.number().min(-180).max(180).required(),
        west: Joi.number().min(-180).max(180).required(),
      })
    ).required(),
    radius: Joi.number().min(1).max(50000).when('zoneType', {
      is: 'CIRCULAR',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    isActive: Joi.boolean().default(true),
    triggerEvents: Joi.array().items(
      Joi.string().valid('ENTERED', 'EXITED', 'DWELLING')
    ).min(1).required(),
    merchantId: Joi.string().optional(),
    areaId: Joi.string().optional(),
    metadata: Joi.object().optional(),
  }),

  updateGeofenceZone: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    description: Joi.string().max(500).optional(),
    isActive: Joi.boolean().optional(),
    triggerEvents: Joi.array().items(
      Joi.string().valid('ENTERED', 'EXITED', 'DWELLING')
    ).min(1).optional(),
    metadata: Joi.object().optional(),
  }),

  optimizeRoute: Joi.object({
    driverId: Joi.string().required(),
    waypoints: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
      address: Joi.string().required(),
      type: Joi.string().valid('PICKUP', 'DELIVERY', 'WAYPOINT', 'BREAK', 'FUEL_STOP').required(),
      estimatedArrival: Joi.date().optional(),
      actualArrival: Joi.date().optional(),
      completed: Joi.boolean().default(false),
      metadata: Joi.object().optional(),
    })).min(2).required(),
    optimizationType: Joi.string().valid(
      'SHORTEST_DISTANCE',
      'FASTEST_TIME', 
      'FUEL_EFFICIENT',
      'TRAFFIC_AWARE',
      'MULTI_OBJECTIVE'
    ).required(),
    plannedStartTime: Joi.date().required(),
    constraints: Joi.object({
      maxDistance: Joi.number().min(0).optional(),
      maxTime: Joi.number().min(0).optional(),
      vehicleType: Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK', 'VAN', 'SCOOTER').optional(),
      trafficRestrictions: Joi.array().items(Joi.object({
        zoneId: Joi.string().required(),
        vehicleTypes: Joi.array().items(
          Joi.string().valid('CAR', 'MOTORCYCLE', 'BICYCLE', 'TRUCK', 'VAN', 'SCOOTER')
        ).required(),
        timeRanges: Joi.array().items(Joi.object({
          startTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
          endTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
          days: Joi.array().items(
            Joi.string().valid('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')
          ).required(),
        })).required(),
      })).optional(),
      timeWindows: Joi.array().items(Joi.object({
        waypointId: Joi.string().required(),
        startTime: Joi.date().required(),
        endTime: Joi.date().required(),
        priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').required(),
      })).optional(),
    }).optional(),
    preferences: Joi.object({
      avoidTolls: Joi.boolean().optional(),
      avoidHighways: Joi.boolean().optional(),
      preferFastest: Joi.boolean().optional(),
      considerTraffic: Joi.boolean().optional(),
      prioritizeDeliveries: Joi.boolean().optional(),
    }).optional(),
  }),
};

export function validateRequest(schemaName: keyof typeof schemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      logger.error('Validation schema not found', { schemaName });
      res.status(500).json({
        error: 'Internal server error',
        message: 'Validation schema not found',
      });
      return;
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      logger.warn('Request validation failed', {
        schemaName,
        errors: validationErrors,
        body: req.body,
      });

      res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
      });
      return;
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
}

export function validateQueryParams(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      logger.warn('Query parameter validation failed', {
        errors: validationErrors,
        query: req.query,
      });

      res.status(400).json({
        error: 'Query parameter validation failed',
        details: validationErrors,
      });
      return;
    }

    req.query = value;
    next();
  };
}

export function validatePathParams(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      logger.warn('Path parameter validation failed', {
        errors: validationErrors,
        params: req.params,
      });

      res.status(400).json({
        error: 'Path parameter validation failed',
        details: validationErrors,
      });
      return;
    }

    req.params = value;
    next();
  };
}