import { Application, Router } from 'express';
import { DeliveryController } from '../controllers/reskflow.controller';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { logger } from '../utils/logger';

/**
 * Set up reskflow-related routes
 */
export function setupDeliveryRoutes(
  app: Application, 
  reskflowController: DeliveryController, 
  apiPrefix: string
): void {
  const router = Router();

  // Apply general rate limiting to all reskflow routes
  router.use(DeliveryController.generalLimiter);

  /**
   * POST /deliveries
   * Create a new reskflow
   * 
   * Access: customers, merchants, admins, dispatchers
   * Rate limit: 50 requests per 15 minutes
   */
  router.post('/',
    DeliveryController.createDeliveryLimiter,
    authenticateToken,
    authorizeRoles(['customer', 'merchant', 'admin', 'dispatcher']),
    DeliveryController.createDeliveryValidation,
    validateRequest,
    reskflowController.createDelivery
  );

  /**
   * GET /deliveries
   * Get deliveries with filters and pagination
   * 
   * Access: all authenticated users (with role-based filtering)
   */
  router.get('/',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * GET /deliveries/:id
   * Get reskflow by ID
   * 
   * Access: all authenticated users (with access validation)
   */
  router.get('/:id',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    reskflowController.getDeliveryById
  );

  /**
   * PUT /deliveries/:id
   * Update reskflow
   * 
   * Access: drivers (for assigned deliveries), customers (limited), admins, dispatchers
   */
  router.put('/:id',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    DeliveryController.updateDeliveryValidation,
    validateRequest,
    reskflowController.updateDelivery
  );

  /**
   * POST /deliveries/:id/assign
   * Assign reskflow to driver
   * 
   * Access: admins, dispatchers only
   */
  router.post('/:id/assign',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    DeliveryController.assignDeliveryValidation,
    validateRequest,
    reskflowController.assignDelivery
  );

  /**
   * POST /deliveries/:id/unassign
   * Unassign reskflow from driver
   * 
   * Access: admins, dispatchers only
   */
  router.post('/:id/unassign',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    reskflowController.unassignDelivery
  );

  /**
   * POST /deliveries/:id/cancel
   * Cancel reskflow
   * 
   * Access: customers (own deliveries, if not picked up), drivers (assigned, if not picked up), admins, dispatchers
   */
  router.post('/:id/cancel',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    DeliveryController.cancelDeliveryValidation,
    validateRequest,
    reskflowController.cancelDelivery
  );

  /**
   * GET /deliveries/:id/route
   * Calculate route for reskflow
   * 
   * Access: drivers (assigned), admins, dispatchers
   */
  router.get('/:id/route',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    reskflowController.calculateRoute
  );

  /**
   * GET /deliveries/analytics
   * Get reskflow analytics
   * 
   * Access: admins, dispatchers only
   */
  router.get('/analytics',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    reskflowController.getDeliveryAnalytics
  );

  // Specialized routes for different user types

  /**
   * GET /deliveries/my/active
   * Get active deliveries for current user
   * 
   * Access: all authenticated users
   */
  router.get('/my/active',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Add filters for active deliveries
      req.query.status = req.query.status || 'PENDING,ASSIGNED,PICKED_UP,IN_TRANSIT';
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * GET /deliveries/my/history
   * Get reskflow history for current user
   * 
   * Access: all authenticated users
   */
  router.get('/my/history',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Add filters for completed/cancelled deliveries
      req.query.status = req.query.status || 'DELIVERED,CANCELLED,FAILED';
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * GET /deliveries/driver/:driverId/active
   * Get active deliveries for specific driver
   * 
   * Access: the driver themselves, admins, dispatchers
   */
  router.get('/driver/:driverId/active',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Validate driver access
      if (req.user?.role === 'driver' && req.user?.id !== req.params.driverId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot access another driver\'s deliveries',
        });
      }
      
      // Set driver filter
      req.query.driverId = req.params.driverId;
      req.query.status = 'ASSIGNED,PICKED_UP,IN_TRANSIT';
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * GET /deliveries/customer/:customerId
   * Get deliveries for specific customer
   * 
   * Access: the customer themselves, admins, dispatchers
   */
  router.get('/customer/:customerId',
    authenticateToken,
    authorizeRoles(['customer', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Validate customer access
      if (req.user?.role === 'customer' && req.user?.id !== req.params.customerId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot access another customer\'s deliveries',
        });
      }
      
      // Set customer filter
      req.query.customerId = req.params.customerId;
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * GET /deliveries/merchant/:merchantId
   * Get deliveries for specific merchant
   * 
   * Access: the merchant themselves, admins, dispatchers
   */
  router.get('/merchant/:merchantId',
    authenticateToken,
    authorizeRoles(['merchant', 'admin', 'dispatcher']),
    (req, res, next) => {
      // TODO: Validate merchant access (would need to check if user is associated with merchant)
      
      // Set merchant filter
      req.query.merchantId = req.params.merchantId;
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * POST /deliveries/:id/status
   * Update reskflow status (convenience endpoint)
   * 
   * Access: drivers (for assigned deliveries), admins, dispatchers
   */
  router.post('/:id/status',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    [
      ...DeliveryController.updateDeliveryValidation,
      // Additional validation for status-only updates
    ],
    validateRequest,
    (req, res, next) => {
      // Transform request to update format
      req.body = {
        status: req.body.status,
        notes: req.body.notes,
        actualPickupTime: req.body.actualPickupTime,
        actualDeliveryTime: req.body.actualDeliveryTime,
      };
      next();
    },
    reskflowController.updateDelivery
  );

  /**
   * GET /deliveries/pending/assignment
   * Get pending deliveries waiting for driver assignment
   * 
   * Access: admins, dispatchers only
   */
  router.get('/pending/assignment',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    (req, res, next) => {
      req.query.status = 'PENDING';
      req.query.sortBy = 'createdAt';
      req.query.sortOrder = 'asc'; // Oldest first for FIFO processing
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * GET /deliveries/overdue
   * Get overdue deliveries
   * 
   * Access: admins, dispatchers only
   */
  router.get('/overdue',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    (req, res, next) => {
      // Add filter for deliveries past estimated reskflow time
      req.query.status = 'ASSIGNED,PICKED_UP,IN_TRANSIT';
      req.query.endDate = new Date().toISOString(); // Past estimated reskflow time
      next();
    },
    DeliveryController.getDeliveriesValidation,
    validateRequest,
    reskflowController.getDeliveries
  );

  /**
   * POST /deliveries/batch/assign
   * Batch assign multiple deliveries
   * 
   * Access: admins, dispatchers only
   */
  router.post('/batch/assign',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    [
      // Validation for batch assignment
      // TODO: Add proper validation for batch operations
    ],
    // TODO: Implement batch assignment controller method
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Batch assignment feature coming soon',
      });
    }
  );

  /**
   * GET /deliveries/stats/summary
   * Get reskflow statistics summary
   * 
   * Access: admins, dispatchers only
   */
  router.get('/stats/summary',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    (req, res, next) => {
      // Redirect to analytics endpoint
      req.url = '/analytics';
      next();
    },
    reskflowController.getDeliveryAnalytics
  );

  // Error handling for invalid reskflow routes
  router.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Delivery endpoint ${req.method} ${req.originalUrl} not found`,
      availableEndpoints: [
        'GET /',
        'POST /',
        'GET /:id',
        'PUT /:id',
        'POST /:id/assign',
        'POST /:id/unassign',
        'POST /:id/cancel',
        'GET /:id/route',
        'GET /analytics',
        'GET /my/active',
        'GET /my/history',
      ],
    });
  });

  // Mount the router
  app.use(`${apiPrefix}/deliveries`, router);

  logger.info('Delivery routes setup completed', {
    prefix: `${apiPrefix}/deliveries`,
    routesCount: router.stack.length,
  });
}