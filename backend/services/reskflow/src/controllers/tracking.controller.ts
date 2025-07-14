import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { TrackingService } from '../services/tracking.service';
import { DeliveryService } from '../services/reskflow.service';
import { DriverService } from '../services/driver.service';
import { NotificationService } from '@reskflow/shared';
import {
  TrackingEventType,
  DeliveryStatus,
  LocationUpdate,
  ApiResponse,
} from '../types/reskflow.types';
import {
  DeliveryNotFoundError,
  DriverNotFoundError,
  ValidationError,
  AuthorizationError,
  TrackingError,
} from '../utils/errors';
import { trackingLogger, loggerHelpers } from '../utils/logger';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { rateLimit } from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';

export class TrackingController {
  private io: SocketIOServer | null = null;

  constructor(
    private trackingService: TrackingService,
    private reskflowService: DeliveryService,
    private driverService: DriverService,
    private notificationService: NotificationService
  ) {}

  /**
   * Set Socket.IO instance for real-time updates
   */
  setSocketIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Rate limiting configurations
   */
  static locationUpdateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // Limit each driver to 200 location updates per minute
    message: 'Too many location updates',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
  });

  static generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Limit each IP to 300 requests per windowMs
    message: 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Validation rules
   */
  static logEventValidation = [
    param('reskflowId').isUUID().withMessage('Valid reskflow ID is required'),
    body('eventType').isIn(Object.values(TrackingEventType)).withMessage('Valid event type is required'),
    body('status').optional().isIn(Object.values(DeliveryStatus)).withMessage('Invalid status'),
    body('location').optional().isObject().withMessage('Location must be an object'),
    body('location.lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('location.lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('notes').optional().isLength({ max: 1000 }).withMessage('Notes too long'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object'),
  ];

  static updateLocationValidation = [
    param('reskflowId').isUUID().withMessage('Valid reskflow ID is required'),
    body('location').isObject().withMessage('Location is required'),
    body('location.lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('location.lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    body('heading').optional().isFloat({ min: 0, max: 360 }).withMessage('Heading must be between 0-360'),
    body('speed').optional().isFloat({ min: 0 }).withMessage('Speed must be non-negative'),
    body('accuracy').optional().isFloat({ min: 0 }).withMessage('Accuracy must be non-negative'),
    body('status').optional().isIn(Object.values(DeliveryStatus)).withMessage('Invalid status'),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes too long'),
  ];

  static getHistoryValidation = [
    param('reskflowId').isUUID().withMessage('Valid reskflow ID is required'),
    query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1-1000'),
  ];

  static bulkTrackingValidation = [
    body('reskflowIds').isArray({ min: 1, max: 50 }).withMessage('Delivery IDs array required (max 50)'),
    body('reskflowIds.*').isUUID().withMessage('All reskflow IDs must be valid UUIDs'),
  ];

  /**
   * Log a tracking event
   */
  logTrackingEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      const eventData = {
        reskflowId,
        eventType: req.body.eventType as TrackingEventType,
        status: req.body.status as DeliveryStatus,
        location: req.body.location ? {
          lat: parseFloat(req.body.location.lat),
          lng: parseFloat(req.body.location.lng),
        } : undefined,
        notes: req.body.notes,
        metadata: req.body.metadata,
        createdBy: userId,
      };

      const trackingEvent = await this.trackingService.logTrackingEvent(eventData);

      // Emit real-time update to connected clients
      if (this.io) {
        const eventMessage = {
          type: 'TRACKING_EVENT',
          data: trackingEvent,
          timestamp: new Date(),
          reskflowId,
        };

        // Emit to reskflow-specific room
        this.io.to(`reskflow:${reskflowId}`).emit('trackingEvent', eventMessage);

        // Emit to customer
        this.io.to(`user:${reskflow.customerId}`).emit('trackingEvent', eventMessage);

        // Emit to driver if assigned
        if (reskflow.driverId) {
          this.io.to(`user:${reskflow.driverId}`).emit('trackingEvent', eventMessage);
        }
      }

      // Log business event
      loggerHelpers.logBusinessEvent('tracking_event_logged_api', {
        reskflowId,
        eventType: eventData.eventType,
        userId,
        userRole,
      });

      const response: ApiResponse = {
        success: true,
        data: trackingEvent,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update location for a reskflow
   */
  updateLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate this is a driver updating their assigned reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      
      if (userRole !== 'admin' && reskflow.driverId !== userId) {
        throw new AuthorizationError('Can only update location for assigned deliveries');
      }

      // Get driver details
      const driver = userRole === 'admin' 
        ? await this.driverService.getDriverById(reskflow.driverId!)
        : await this.driverService.getDriverByUserId(userId);

      const locationUpdate: LocationUpdate = {
        reskflowId,
        driverId: driver.id,
        location: {
          lat: parseFloat(req.body.location.lat),
          lng: parseFloat(req.body.location.lng),
        },
        heading: req.body.heading ? parseFloat(req.body.heading) : undefined,
        speed: req.body.speed ? parseFloat(req.body.speed) : undefined,
        accuracy: req.body.accuracy ? parseFloat(req.body.accuracy) : undefined,
        timestamp: new Date(),
        status: req.body.status as DeliveryStatus,
        notes: req.body.notes,
      };

      await this.trackingService.updateLocation(locationUpdate);

      // Emit real-time location update
      if (this.io) {
        const locationMessage = this.trackingService.createLocationUpdateMessage(locationUpdate);

        // Emit to reskflow-specific room
        this.io.to(`reskflow:${reskflowId}`).emit('locationUpdate', locationMessage);

        // Emit to customer
        this.io.to(`user:${reskflow.customerId}`).emit('locationUpdate', locationMessage);

        // Emit to driver
        this.io.to(`user:${driver.userId}`).emit('locationUpdate', locationMessage);
      }

      // Log tracking event
      loggerHelpers.logTrackingEvent('location_update_api', driver.id, locationUpdate.location, {
        reskflowId,
        heading: locationUpdate.heading,
        speed: locationUpdate.speed,
        accuracy: locationUpdate.accuracy,
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
   * Get tracking information for a reskflow
   */
  getTrackingInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      const trackingInfo = await this.trackingService.getTrackingInfo(reskflowId);

      const response: ApiResponse = {
        success: true,
        data: trackingInfo,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get location history for a reskflow
   */
  getLocationHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      const locationHistory = await this.trackingService.getLocationHistory(reskflowId, limit);

      const response: ApiResponse = {
        success: true,
        data: locationHistory,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get bulk tracking data for multiple deliveries
   */
  getBulkTrackingData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowIds: string[] = req.body.reskflowIds;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Only admins and dispatchers can get bulk tracking data
      if (!['admin', 'dispatcher'].includes(userRole)) {
        throw new AuthorizationError('Insufficient permissions for bulk tracking data');
      }

      const bulkTrackingData = await this.trackingService.getBulkTrackingData(reskflowIds);

      const response: ApiResponse = {
        success: true,
        data: bulkTrackingData,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get real-time tracking data (WebSocket alternative)
   */
  getRealtimeTracking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      // Set up Server-Sent Events (SSE) for real-time tracking
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      // Send initial tracking data
      const trackingInfo = await this.trackingService.getTrackingInfo(reskflowId);
      res.write(`data: ${JSON.stringify({ type: 'initial', data: trackingInfo })}\n\n`);

      // Set up interval to send updates
      const updateInterval = setInterval(async () => {
        try {
          const updatedTrackingInfo = await this.trackingService.getTrackingInfo(reskflowId);
          res.write(`data: ${JSON.stringify({ type: 'update', data: updatedTrackingInfo })}\n\n`);
        } catch (error) {
          trackingLogger.error('Error sending SSE update', {
            reskflowId,
            userId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }, 5000); // Update every 5 seconds

      // Handle client disconnect
      req.on('close', () => {
        clearInterval(updateInterval);
        trackingLogger.debug('SSE connection closed', { reskflowId, userId });
      });

      // Keep connection alive
      const keepAliveInterval = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 30000); // Send keepalive every 30 seconds

      req.on('close', () => {
        clearInterval(keepAliveInterval);
      });

    } catch (error) {
      next(error);
    }
  };

  /**
   * Subscribe to tracking updates via WebSocket
   */
  subscribeToTracking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      // Generate subscription token (in a real app, this would be stored securely)
      const subscriptionToken = Buffer.from(`${userId}:${reskflowId}:${Date.now()}`).toString('base64');

      const response: ApiResponse = {
        success: true,
        data: {
          subscriptionToken,
          reskflowId,
          websocketUrl: `/tracking/subscribe/${subscriptionToken}`,
          instructions: 'Use this token to connect to WebSocket for real-time updates',
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
   * Get reskflow timeline events
   */
  getDeliveryTimeline = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      const trackingInfo = await this.trackingService.getTrackingInfo(reskflowId);

      // Return only the timeline events
      const response: ApiResponse = {
        success: true,
        data: {
          reskflowId,
          events: trackingInfo.events,
          lastUpdate: trackingInfo.lastUpdate,
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
   * Get current location of reskflow
   */
  getCurrentLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.reskflowId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Validate access to this reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateTrackingAccess(userId, userRole, reskflow);

      const trackingInfo = await this.trackingService.getTrackingInfo(reskflowId);

      const response: ApiResponse = {
        success: true,
        data: {
          reskflowId,
          currentLocation: trackingInfo.currentLocation,
          lastUpdate: trackingInfo.lastUpdate,
          status: trackingInfo.currentStatus,
          estimatedArrival: trackingInfo.estimatedArrival,
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
   * Private helper methods
   */
  private async validateTrackingAccess(userId: string, userRole: string, reskflow: any): Promise<void> {
    switch (userRole) {
      case 'admin':
      case 'dispatcher':
        // Can track any reskflow
        break;
      case 'customer':
        // Can only track their own deliveries
        if (reskflow.customerId !== userId) {
          throw new AuthorizationError('Cannot track reskflow for another customer');
        }
        break;
      case 'driver':
        // Can only track assigned deliveries
        if (reskflow.driverId !== userId) {
          throw new AuthorizationError('Cannot track unassigned reskflow');
        }
        break;
      case 'merchant':
        // Can track deliveries for their merchant
        // This would require checking if userId is associated with reskflow.merchantId
        break;
      default:
        throw new AuthorizationError('Invalid user role for tracking access');
    }
  }
}