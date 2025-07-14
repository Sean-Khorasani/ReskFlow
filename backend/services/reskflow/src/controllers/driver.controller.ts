import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { DriverService } from '../services/driver.service';
import { TrackingService } from '../services/tracking.service';
import { RouteService } from '../services/route.service';
import { NotificationService } from '@reskflow/shared';
import {
  CreateDriverInput,
  UpdateDriverInput,
  DriverStatus,
  VehicleType,
  Coordinates,
  ApiResponse,
} from '../types/reskflow.types';
import {
  DriverNotFoundError,
  ValidationError,
  AuthorizationError,
  BusinessLogicError,
} from '../utils/errors';
import { driverLogger, loggerHelpers } from '../utils/logger';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { rateLimit } from 'express-rate-limit';

export class DriverController {
  constructor(
    private driverService: DriverService,
    private trackingService: TrackingService,
    private routeService: RouteService,
    private notificationService: NotificationService
  ) {}

  /**
   * Rate limiting configurations
   */
  static locationUpdateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Limit each driver to 100 location updates per minute
    message: 'Too many location updates',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip, // Rate limit per user
  });

  static generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per windowMs
    message: 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Validation rules
   */
  static createDriverValidation = [
    body('userId').isUUID().withMessage('Valid user ID is required'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').isMobilePhone().withMessage('Valid phone number is required'),
    body('dateOfBirth').isISO8601().withMessage('Valid date of birth is required'),
    body('licenseNumber').notEmpty().withMessage('License number is required'),
    body('licenseExpiry').isISO8601().withMessage('Valid license expiry date is required'),
    body('vehicleType').isIn(Object.values(VehicleType)).withMessage('Valid vehicle type is required'),
    body('vehicleModel').notEmpty().withMessage('Vehicle model is required'),
    body('vehiclePlate').notEmpty().withMessage('Vehicle plate is required'),
    body('vehicleColor').optional().notEmpty().withMessage('Vehicle color cannot be empty'),
    body('emergencyContact').isObject().withMessage('Emergency contact is required'),
    body('emergencyContact.name').notEmpty().withMessage('Emergency contact name is required'),
    body('emergencyContact.phone').isMobilePhone().withMessage('Valid emergency contact phone is required'),
    body('emergencyContact.relationship').notEmpty().withMessage('Emergency contact relationship is required'),
  ];

  static updateDriverValidation = [
    param('id').isUUID().withMessage('Valid driver ID is required'),
    body('status').optional().isIn(Object.values(DriverStatus)).withMessage('Invalid status'),
    body('vehicleType').optional().isIn(Object.values(VehicleType)).withMessage('Invalid vehicle type'),
    body('vehicleModel').optional().notEmpty().withMessage('Vehicle model cannot be empty'),
    body('vehiclePlate').optional().notEmpty().withMessage('Vehicle plate cannot be empty'),
    body('vehicleColor').optional().notEmpty().withMessage('Vehicle color cannot be empty'),
    body('phone').optional().isMobilePhone().withMessage('Invalid phone number'),
    body('emergencyContact').optional().isObject().withMessage('Invalid emergency contact'),
    body('suspensionReason').optional().isLength({ max: 500 }).withMessage('Suspension reason too long'),
  ];

  static updateLocationValidation = [
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    body('heading').optional().isFloat({ min: 0, max: 360 }).withMessage('Heading must be between 0-360'),
    body('speed').optional().isFloat({ min: 0 }).withMessage('Speed must be non-negative'),
    body('accuracy').optional().isFloat({ min: 0 }).withMessage('Accuracy must be non-negative'),
  ];

  static updateAvailabilityValidation = [
    body('available').isBoolean().withMessage('Available must be a boolean'),
    body('location').optional().isObject().withMessage('Location must be an object'),
    body('location.lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('location.lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  ];

  static searchNearbyValidation = [
    query('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    query('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    query('radius').optional().isFloat({ min: 0.1, max: 100 }).withMessage('Radius must be between 0.1-100 km'),
    query('vehicleType').optional().isIn(Object.values(VehicleType)).withMessage('Invalid vehicle type'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  ];

  /**
   * Create a new driver profile
   */
  createDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Only admins can create driver profiles for other users
      if (req.body.userId !== userId && userRole !== 'admin') {
        throw new AuthorizationError('Cannot create driver profile for another user');
      }

      const driverData: CreateDriverInput = {
        userId: req.body.userId,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone,
        dateOfBirth: new Date(req.body.dateOfBirth),
        licenseNumber: req.body.licenseNumber,
        licenseExpiry: new Date(req.body.licenseExpiry),
        vehicleType: req.body.vehicleType,
        vehicleModel: req.body.vehicleModel,
        vehiclePlate: req.body.vehiclePlate,
        vehicleColor: req.body.vehicleColor,
        emergencyContact: req.body.emergencyContact,
      };

      const driver = await this.driverService.createDriver(driverData);

      // Log business event
      loggerHelpers.logBusinessEvent('driver_created_api', {
        driverId: driver.id,
        userId,
        createdBy: userId,
        vehicleType: driver.vehicleType,
      });

      const response: ApiResponse = {
        success: true,
        data: driver,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get driver by ID
   */
  getDriverById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      const driver = await this.driverService.getDriverById(driverId);

      // Authorization: Check if user can access this driver
      await this.validateDriverViewAccess(userId, userRole, driver);

      const response: ApiResponse = {
        success: true,
        data: driver,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get current user's driver profile
   */
  getMyDriverProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      const driver = await this.driverService.getDriverByUserId(userId);

      const response: ApiResponse = {
        success: true,
        data: driver,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update driver profile
   */
  updateDriver = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const driverId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get current driver to check permissions
      const currentDriver = await this.driverService.getDriverById(driverId);
      await this.validateDriverUpdateAccess(userId, userRole, currentDriver);

      const updateData: UpdateDriverInput = {};

      // Only allow certain fields based on user role
      if (req.body.status && userRole === 'admin') {
        updateData.status = req.body.status;
        updateData.suspensionReason = req.body.suspensionReason;
      }

      if (req.body.vehicleType) {
        updateData.vehicleType = req.body.vehicleType;
      }

      if (req.body.vehicleModel) {
        updateData.vehicleModel = req.body.vehicleModel;
      }

      if (req.body.vehiclePlate) {
        updateData.vehiclePlate = req.body.vehiclePlate;
      }

      if (req.body.vehicleColor) {
        updateData.vehicleColor = req.body.vehicleColor;
      }

      if (req.body.phone) {
        updateData.phone = req.body.phone;
      }

      if (req.body.emergencyContact) {
        updateData.emergencyContact = req.body.emergencyContact;
      }

      const updatedDriver = await this.driverService.updateDriver(driverId, updateData);

      // Log business event
      loggerHelpers.logBusinessEvent('driver_updated_api', {
        driverId,
        updatedBy: userId,
        userRole,
        updates: updateData,
      });

      const response: ApiResponse = {
        success: true,
        data: updatedDriver,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update driver location
   */
  updateLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const userId = req.user?.id;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get driver profile
      const driver = await this.driverService.getDriverByUserId(userId);

      const locationData = {
        location: {
          lat: parseFloat(req.body.lat),
          lng: parseFloat(req.body.lng),
        },
        heading: req.body.heading ? parseFloat(req.body.heading) : undefined,
        speed: req.body.speed ? parseFloat(req.body.speed) : undefined,
        accuracy: req.body.accuracy ? parseFloat(req.body.accuracy) : undefined,
      };

      await this.driverService.updateDriverLocation(driver.id, locationData);

      // Log tracking event
      loggerHelpers.logTrackingEvent('driver_location_update_api', driver.id, locationData.location, {
        heading: locationData.heading,
        speed: locationData.speed,
        accuracy: locationData.accuracy,
      });

      const response: ApiResponse = {
        success: true,
        data: { message: 'Location updated successfully' },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update driver availability
   */
  updateAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const userId = req.user?.id;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get driver profile
      const driver = await this.driverService.getDriverByUserId(userId);

      const availabilityData = {
        available: req.body.available,
        location: req.body.location ? {
          lat: parseFloat(req.body.location.lat),
          lng: parseFloat(req.body.location.lng),
        } : undefined,
      };

      const updatedDriver = await this.driverService.updateDriverAvailability(driver.id, availabilityData);

      // Log business event
      loggerHelpers.logBusinessEvent('driver_availability_updated_api', {
        driverId: driver.id,
        userId,
        available: availabilityData.available,
        location: availabilityData.location,
      });

      const response: ApiResponse = {
        success: true,
        data: updatedDriver,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Search for nearby drivers
   */
  searchNearbyDrivers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Only admins and dispatchers can search for drivers
      if (!['admin', 'dispatcher'].includes(userRole)) {
        throw new AuthorizationError('Insufficient permissions to search drivers');
      }

      const searchParams = {
        lat: parseFloat(req.query.lat as string),
        lng: parseFloat(req.query.lng as string),
        radius: req.query.radius ? parseFloat(req.query.radius as string) : undefined,
        vehicleType: req.query.vehicleType as VehicleType,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      };

      const nearbyDrivers = await this.driverService.getNearbyDrivers(searchParams);

      const response: ApiResponse = {
        success: true,
        data: nearbyDrivers,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Check if driver can take more deliveries
   */
  checkCapacity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get driver to check permissions
      const driver = await this.driverService.getDriverById(driverId);
      await this.validateDriverViewAccess(userId, userRole, driver);

      const canTakeDelivery = await this.driverService.canTakeDelivery(driverId);

      const response: ApiResponse = {
        success: true,
        data: { canTakeDelivery },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get driver performance metrics
   */
  getPerformance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get driver to check permissions
      const driver = await this.driverService.getDriverById(driverId);
      await this.validateDriverViewAccess(userId, userRole, driver);

      const period = req.query.startDate && req.query.endDate ? {
        startDate: new Date(req.query.startDate as string),
        endDate: new Date(req.query.endDate as string),
      } : undefined;

      const performance = await this.driverService.getDriverPerformance(driverId, period);

      const response: ApiResponse = {
        success: true,
        data: performance,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get driver's current location
   */
  getCurrentLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get driver to check permissions
      const driver = await this.driverService.getDriverById(driverId);
      await this.validateDriverViewAccess(userId, userRole, driver);

      const response: ApiResponse = {
        success: true,
        data: {
          location: driver.currentLocation,
          lastUpdate: driver.lastLocationUpdate,
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get route to pickup/reskflow location
   */
  getRouteToDestination = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      const { lat, lng } = req.body;

      if (!lat || !lng) {
        throw new ValidationError('Destination coordinates are required');
      }

      // Get driver profile and current location
      const driver = await this.driverService.getDriverByUserId(userId);

      if (!driver.currentLocation) {
        throw new BusinessLogicError('Driver location not available');
      }

      const route = await this.routeService.calculateRoute({
        origin: driver.currentLocation,
        destination: { lat: parseFloat(lat), lng: parseFloat(lng) },
        vehicleType: driver.vehicleType,
      });

      const response: ApiResponse = {
        success: true,
        data: route,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Private helper methods
   */
  private async validateDriverViewAccess(userId: string, userRole: string, driver: any): Promise<void> {
    switch (userRole) {
      case 'admin':
      case 'dispatcher':
        // Can view any driver
        break;
      case 'driver':
        // Can only view their own profile
        if (driver.userId !== userId) {
          throw new AuthorizationError('Cannot access another driver\'s profile');
        }
        break;
      default:
        throw new AuthorizationError('Insufficient permissions to view driver profile');
    }
  }

  private async validateDriverUpdateAccess(userId: string, userRole: string, driver: any): Promise<void> {
    switch (userRole) {
      case 'admin':
        // Can update any driver
        break;
      case 'driver':
        // Can only update their own profile and limited fields
        if (driver.userId !== userId) {
          throw new AuthorizationError('Cannot update another driver\'s profile');
        }
        break;
      default:
        throw new AuthorizationError('Insufficient permissions to update driver profile');
    }
  }
}