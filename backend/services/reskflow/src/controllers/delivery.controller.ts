import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { DeliveryService } from '../services/reskflow.service';
import { TrackingService } from '../services/tracking.service';
import { RouteService } from '../services/route.service';
import { NotificationService } from '@reskflow/shared';
import {
  CreateDeliveryInput,
  UpdateDeliveryInput,
  DeliveryFilters,
  DeliveryStatus,
  DeliveryPriority,
  ApiResponse,
} from '../types/reskflow.types';
import {
  DeliveryNotFoundError,
  ValidationError,
  AuthorizationError,
  BusinessLogicError,
} from '../utils/errors';
import { reskflowLogger, loggerHelpers } from '../utils/logger';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { rateLimit } from 'express-rate-limit';

export class DeliveryController {
  constructor(
    private reskflowService: DeliveryService,
    private trackingService: TrackingService,
    private routeService: RouteService,
    private notificationService: NotificationService
  ) {}

  /**
   * Rate limiting configurations
   */
  static createDeliveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 reskflow creation requests per windowMs
    message: 'Too many reskflow creation requests',
    standardHeaders: true,
    legacyHeaders: false,
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
  static createDeliveryValidation = [
    body('orderId').isUUID().withMessage('Valid order ID is required'),
    body('customerId').isUUID().withMessage('Valid customer ID is required'),
    body('merchantId').isUUID().withMessage('Valid merchant ID is required'),
    body('pickupAddress').isObject().withMessage('Pickup address is required'),
    body('pickupAddress.street').notEmpty().withMessage('Pickup street is required'),
    body('pickupAddress.city').notEmpty().withMessage('Pickup city is required'),
    body('pickupAddress.country').notEmpty().withMessage('Pickup country is required'),
    body('reskflowAddress').isObject().withMessage('Delivery address is required'),
    body('reskflowAddress.street').notEmpty().withMessage('Delivery street is required'),
    body('reskflowAddress.city').notEmpty().withMessage('Delivery city is required'),
    body('reskflowAddress.country').notEmpty().withMessage('Delivery country is required'),
    body('customerPhone').isMobilePhone().withMessage('Valid customer phone is required'),
    body('reskflowFee').isNumeric().withMessage('Valid reskflow fee is required'),
    body('estimatedPickupTime').isISO8601().withMessage('Valid estimated pickup time is required'),
    body('estimatedDeliveryTime').isISO8601().withMessage('Valid estimated reskflow time is required'),
    body('priority').optional().isIn(Object.values(DeliveryPriority)).withMessage('Invalid priority'),
    body('specialInstructions').optional().isLength({ max: 500 }).withMessage('Special instructions too long'),
  ];

  static updateDeliveryValidation = [
    param('id').isUUID().withMessage('Valid reskflow ID is required'),
    body('status').optional().isIn(Object.values(DeliveryStatus)).withMessage('Invalid status'),
    body('actualPickupTime').optional().isISO8601().withMessage('Invalid pickup time'),
    body('actualDeliveryTime').optional().isISO8601().withMessage('Invalid reskflow time'),
    body('reskflowRating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1-5'),
    body('reskflowNotes').optional().isLength({ max: 1000 }).withMessage('Notes too long'),
    body('cancelReason').optional().isLength({ max: 500 }).withMessage('Cancel reason too long'),
    body('failureReason').optional().isLength({ max: 500 }).withMessage('Failure reason too long'),
  ];

  static getDeliveriesValidation = [
    query('status').optional().isIn(Object.values(DeliveryStatus)).withMessage('Invalid status'),
    query('customerId').optional().isUUID().withMessage('Invalid customer ID'),
    query('driverId').optional().isUUID().withMessage('Invalid driver ID'),
    query('merchantId').optional().isUUID().withMessage('Invalid merchant ID'),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('priority').optional().isIn(Object.values(DeliveryPriority)).withMessage('Invalid priority'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
    query('sortBy').optional().isIn(['createdAt', 'updatedAt', 'status', 'priority']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
  ];

  static assignDeliveryValidation = [
    param('id').isUUID().withMessage('Valid reskflow ID is required'),
    body('driverId').isUUID().withMessage('Valid driver ID is required'),
  ];

  static cancelDeliveryValidation = [
    param('id').isUUID().withMessage('Valid reskflow ID is required'),
    body('reason').notEmpty().withMessage('Cancellation reason is required'),
  ];

  /**
   * Create a new reskflow
   */
  createDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const userId = req.user?.id;
      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      const reskflowData: CreateDeliveryInput = {
        orderId: req.body.orderId,
        customerId: req.body.customerId,
        merchantId: req.body.merchantId,
        pickupAddress: req.body.pickupAddress,
        reskflowAddress: req.body.reskflowAddress,
        customerPhone: req.body.customerPhone,
        customerName: req.body.customerName,
        merchantPhone: req.body.merchantPhone,
        merchantName: req.body.merchantName,
        specialInstructions: req.body.specialInstructions,
        reskflowFee: parseFloat(req.body.reskflowFee),
        estimatedPickupTime: new Date(req.body.estimatedPickupTime),
        estimatedDeliveryTime: new Date(req.body.estimatedDeliveryTime),
        priority: req.body.priority || DeliveryPriority.NORMAL,
      };

      // Authorization: Check if user can create reskflow for this customer/merchant
      await this.validateDeliveryAccess(userId, req.user?.role, reskflowData);

      const reskflow = await this.reskflowService.createDelivery(reskflowData);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_created_api', {
        reskflowId: reskflow.id,
        userId,
        orderId: reskflow.orderId,
        priority: reskflow.priority,
      });

      const response: ApiResponse = {
        success: true,
        data: reskflow,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get reskflow by ID
   */
  getDeliveryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);

      // Authorization: Check if user can access this reskflow
      await this.validateDeliveryViewAccess(userId, userRole, reskflow);

      const response: ApiResponse = {
        success: true,
        data: reskflow,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get deliveries with filters and pagination
   */
  getDeliveries = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      const filters: DeliveryFilters = {
        status: req.query.status as DeliveryStatus,
        customerId: req.query.customerId as string,
        driverId: req.query.driverId as string,
        merchantId: req.query.merchantId as string,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        priority: req.query.priority as DeliveryPriority,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
        sortBy: req.query.sortBy as string || 'createdAt',
        sortOrder: req.query.sortOrder as 'asc' | 'desc' || 'desc',
      };

      // Apply role-based filtering
      await this.applyRoleBasedFilters(filters, userId, userRole);

      const deliveries = await this.reskflowService.getDeliveries(filters);

      const response: ApiResponse = {
        success: true,
        data: deliveries,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update reskflow
   */
  updateDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get current reskflow to check permissions
      const currentDelivery = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateDeliveryUpdateAccess(userId, userRole, currentDelivery);

      const updateData: UpdateDeliveryInput = {};

      // Only allow certain fields based on user role
      if (req.body.status && this.canUpdateStatus(userRole, req.body.status)) {
        updateData.status = req.body.status;
      }

      if (req.body.actualPickupTime) {
        updateData.actualPickupTime = new Date(req.body.actualPickupTime);
      }

      if (req.body.actualDeliveryTime) {
        updateData.actualDeliveryTime = new Date(req.body.actualDeliveryTime);
      }

      if (req.body.reskflowProof) {
        updateData.reskflowProof = req.body.reskflowProof;
      }

      if (req.body.customerSignature) {
        updateData.customerSignature = req.body.customerSignature;
      }

      if (req.body.reskflowRating && (userRole === 'customer' || userRole === 'admin')) {
        updateData.reskflowRating = req.body.reskflowRating;
      }

      if (req.body.reskflowNotes) {
        updateData.reskflowNotes = req.body.reskflowNotes;
      }

      if (req.body.cancelReason) {
        updateData.cancelReason = req.body.cancelReason;
      }

      if (req.body.failureReason && (userRole === 'driver' || userRole === 'admin')) {
        updateData.failureReason = req.body.failureReason;
      }

      const updatedDelivery = await this.reskflowService.updateDelivery(reskflowId, updateData);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_updated_api', {
        reskflowId,
        userId,
        userRole,
        updates: updateData,
      });

      const response: ApiResponse = {
        success: true,
        data: updatedDelivery,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Assign reskflow to driver
   */
  assignDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowId = req.params.id;
      const driverId = req.body.driverId;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Only admins and dispatchers can assign deliveries
      if (!['admin', 'dispatcher'].includes(userRole)) {
        throw new AuthorizationError('Insufficient permissions to assign deliveries');
      }

      const assignedDelivery = await this.reskflowService.assignDelivery(reskflowId, driverId);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_assigned_api', {
        reskflowId,
        driverId,
        assignedBy: userId,
      });

      const response: ApiResponse = {
        success: true,
        data: assignedDelivery,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Unassign reskflow from driver
   */
  unassignDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.id;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Only admins and dispatchers can unassign deliveries
      if (!['admin', 'dispatcher'].includes(userRole)) {
        throw new AuthorizationError('Insufficient permissions to unassign deliveries');
      }

      const unassignedDelivery = await this.reskflowService.unassignDelivery(reskflowId);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_unassigned_api', {
        reskflowId,
        unassignedBy: userId,
      });

      const response: ApiResponse = {
        success: true,
        data: unassignedDelivery,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Cancel reskflow
   */
  cancelDelivery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const reskflowId = req.params.id;
      const reason = req.body.reason;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Get current reskflow to check permissions
      const currentDelivery = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateDeliveryCancellationAccess(userId, userRole, currentDelivery);

      const cancelledDelivery = await this.reskflowService.cancelDelivery(reskflowId, reason, userId);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_cancelled_api', {
        reskflowId,
        reason,
        cancelledBy: userId,
        userRole,
      });

      const response: ApiResponse = {
        success: true,
        data: cancelledDelivery,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get reskflow analytics
   */
  getDeliveryAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      // Only admins and dispatchers can view analytics
      if (!['admin', 'dispatcher'].includes(userRole)) {
        throw new AuthorizationError('Insufficient permissions to view analytics');
      }

      const filters = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        merchantId: req.query.merchantId as string,
        driverId: req.query.driverId as string,
      };

      const analytics = await this.reskflowService.getDeliveryAnalytics(filters);

      const response: ApiResponse = {
        success: true,
        data: analytics,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Calculate reskflow route
   */
  calculateRoute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reskflowId = req.params.id;
      const userId = req.user?.id;

      if (!userId) {
        throw new AuthorizationError('User not authenticated');
      }

      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
      await this.validateDeliveryViewAccess(userId, req.user?.role, reskflow);

      if (!reskflow.pickupAddress.coordinates || !reskflow.reskflowAddress.coordinates) {
        throw new BusinessLogicError('Delivery addresses missing coordinates');
      }

      const route = await this.routeService.calculateRoute({
        origin: reskflow.pickupAddress.coordinates,
        destination: reskflow.reskflowAddress.coordinates,
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
  private async validateDeliveryAccess(
    userId: string,
    userRole: string,
    reskflowData: CreateDeliveryInput
  ): Promise<void> {
    switch (userRole) {
      case 'admin':
      case 'dispatcher':
        // Can create deliveries for anyone
        break;
      case 'merchant':
        // Can only create deliveries for their own merchant
        // This would require checking if userId is associated with merchantId
        break;
      case 'customer':
        // Can only create deliveries for themselves
        if (reskflowData.customerId !== userId) {
          throw new AuthorizationError('Cannot create reskflow for another customer');
        }
        break;
      default:
        throw new AuthorizationError('Invalid user role');
    }
  }

  private async validateDeliveryViewAccess(userId: string, userRole: string, reskflow: any): Promise<void> {
    switch (userRole) {
      case 'admin':
      case 'dispatcher':
        // Can view any reskflow
        break;
      case 'merchant':
        // Can only view deliveries for their merchant
        // This would require checking if userId is associated with reskflow.merchantId
        break;
      case 'customer':
        // Can only view their own deliveries
        if (reskflow.customerId !== userId) {
          throw new AuthorizationError('Cannot access reskflow for another customer');
        }
        break;
      case 'driver':
        // Can only view assigned deliveries
        if (reskflow.driverId !== userId) {
          throw new AuthorizationError('Cannot access unassigned reskflow');
        }
        break;
      default:
        throw new AuthorizationError('Invalid user role');
    }
  }

  private async validateDeliveryUpdateAccess(userId: string, userRole: string, reskflow: any): Promise<void> {
    switch (userRole) {
      case 'admin':
        // Can update any reskflow
        break;
      case 'dispatcher':
        // Can update most reskflow fields
        break;
      case 'driver':
        // Can only update assigned deliveries and limited fields
        if (reskflow.driverId !== userId) {
          throw new AuthorizationError('Cannot update unassigned reskflow');
        }
        break;
      case 'customer':
        // Can only update their own deliveries and very limited fields
        if (reskflow.customerId !== userId) {
          throw new AuthorizationError('Cannot update reskflow for another customer');
        }
        break;
      default:
        throw new AuthorizationError('Invalid user role');
    }
  }

  private async validateDeliveryCancellationAccess(
    userId: string,
    userRole: string,
    reskflow: any
  ): Promise<void> {
    switch (userRole) {
      case 'admin':
      case 'dispatcher':
        // Can cancel any reskflow
        break;
      case 'customer':
        // Can only cancel their own deliveries if not picked up
        if (reskflow.customerId !== userId) {
          throw new AuthorizationError('Cannot cancel reskflow for another customer');
        }
        if (reskflow.status !== DeliveryStatus.PENDING && reskflow.status !== DeliveryStatus.ASSIGNED) {
          throw new BusinessLogicError('Cannot cancel reskflow that has been picked up');
        }
        break;
      case 'driver':
        // Can cancel assigned deliveries before pickup
        if (reskflow.driverId !== userId) {
          throw new AuthorizationError('Cannot cancel unassigned reskflow');
        }
        if (reskflow.status === DeliveryStatus.PICKED_UP || reskflow.status === DeliveryStatus.IN_TRANSIT) {
          throw new BusinessLogicError('Cannot cancel reskflow that has been picked up');
        }
        break;
      default:
        throw new AuthorizationError('Invalid user role');
    }
  }

  private async applyRoleBasedFilters(filters: DeliveryFilters, userId: string, userRole: string): Promise<void> {
    switch (userRole) {
      case 'admin':
      case 'dispatcher':
        // No additional filters needed
        break;
      case 'customer':
        // Only show their own deliveries
        filters.customerId = userId;
        break;
      case 'driver':
        // Only show assigned deliveries
        filters.driverId = userId;
        break;
      case 'merchant':
        // Only show deliveries for their merchant
        // This would require determining the merchant ID from user ID
        break;
    }
  }

  private canUpdateStatus(userRole: string, status: DeliveryStatus): boolean {
    const rolePermissions: Record<string, DeliveryStatus[]> = {
      admin: Object.values(DeliveryStatus),
      dispatcher: Object.values(DeliveryStatus),
      driver: [
        DeliveryStatus.PICKED_UP,
        DeliveryStatus.IN_TRANSIT,
        DeliveryStatus.DELIVERED,
        DeliveryStatus.FAILED,
      ],
      customer: [],
      merchant: [DeliveryStatus.CANCELLED],
    };

    return rolePermissions[userRole]?.includes(status) || false;
  }
}