import { Application, Router } from 'express';
import { DriverController } from '../controllers/driver.controller';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { logger } from '../utils/logger';

/**
 * Set up driver-related routes
 */
export function setupDriverRoutes(
  app: Application, 
  driverController: DriverController, 
  apiPrefix: string
): void {
  const router = Router();

  // Apply general rate limiting to all driver routes
  router.use(DriverController.generalLimiter);

  /**
   * POST /drivers
   * Create a new driver profile
   * 
   * Access: the user themselves (for their own profile), admins
   */
  router.post('/',
    authenticateToken,
    authorizeRoles(['user', 'admin']), // 'user' can create their own driver profile
    DriverController.createDriverValidation,
    validateRequest,
    driverController.createDriver
  );

  /**
   * GET /drivers/me
   * Get current user's driver profile
   * 
   * Access: drivers only
   */
  router.get('/me',
    authenticateToken,
    authorizeRoles(['driver', 'admin']),
    driverController.getMyDriverProfile
  );

  /**
   * PUT /drivers/me
   * Update current user's driver profile
   * 
   * Access: drivers only (for their own profile)
   */
  router.put('/me',
    authenticateToken,
    authorizeRoles(['driver', 'admin']),
    (req, res, next) => {
      // Set the driver ID to current user's driver profile
      // This would require getting the driver ID from the user ID
      // For now, we'll redirect to the general update endpoint
      next();
    },
    DriverController.updateDriverValidation,
    validateRequest,
    driverController.updateDriver
  );

  /**
   * POST /drivers/me/location
   * Update current driver's location
   * 
   * Access: drivers only
   * Rate limit: 100 updates per minute
   */
  router.post('/me/location',
    DriverController.locationUpdateLimiter,
    authenticateToken,
    authorizeRoles(['driver']),
    DriverController.updateLocationValidation,
    validateRequest,
    driverController.updateLocation
  );

  /**
   * POST /drivers/me/availability
   * Update current driver's availability status
   * 
   * Access: drivers only
   */
  router.post('/me/availability',
    authenticateToken,
    authorizeRoles(['driver']),
    DriverController.updateAvailabilityValidation,
    validateRequest,
    driverController.updateAvailability
  );

  /**
   * GET /drivers/me/performance
   * Get current driver's performance metrics
   * 
   * Access: drivers only (for their own metrics)
   */
  router.get('/me/performance',
    authenticateToken,
    authorizeRoles(['driver', 'admin']),
    (req, res, next) => {
      // This would need to get the driver ID from user ID
      // For now, pass through to general performance endpoint
      next();
    },
    driverController.getPerformance
  );

  /**
   * GET /drivers/me/capacity
   * Check if current driver can take more deliveries
   * 
   * Access: drivers only
   */
  router.get('/me/capacity',
    authenticateToken,
    authorizeRoles(['driver', 'admin']),
    (req, res, next) => {
      // This would need to get the driver ID from user ID
      next();
    },
    driverController.checkCapacity
  );

  /**
   * POST /drivers/me/route
   * Get route to destination for current driver
   * 
   * Access: drivers only
   */
  router.post('/me/route',
    authenticateToken,
    authorizeRoles(['driver']),
    [
      // Validation for route calculation
      // TODO: Add proper validation
    ],
    driverController.getRouteToDestination
  );

  /**
   * GET /drivers/:id
   * Get driver by ID
   * 
   * Access: the driver themselves, admins, dispatchers
   */
  router.get('/:id',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    driverController.getDriverById
  );

  /**
   * PUT /drivers/:id
   * Update driver profile
   * 
   * Access: the driver themselves (limited fields), admins (all fields)
   */
  router.put('/:id',
    authenticateToken,
    authorizeRoles(['driver', 'admin']),
    DriverController.updateDriverValidation,
    validateRequest,
    driverController.updateDriver
  );

  /**
   * GET /drivers/:id/performance
   * Get driver performance metrics
   * 
   * Access: the driver themselves, admins, dispatchers
   */
  router.get('/:id/performance',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    driverController.getPerformance
  );

  /**
   * GET /drivers/:id/capacity
   * Check if driver can take more deliveries
   * 
   * Access: admins, dispatchers
   */
  router.get('/:id/capacity',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    driverController.checkCapacity
  );

  /**
   * GET /drivers/:id/location
   * Get driver's current location
   * 
   * Access: the driver themselves, admins, dispatchers
   */
  router.get('/:id/location',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    driverController.getCurrentLocation
  );

  /**
   * GET /drivers/search/nearby
   * Search for nearby available drivers
   * 
   * Access: admins, dispatchers only
   */
  router.get('/search/nearby',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    DriverController.searchNearbyValidation,
    validateRequest,
    driverController.searchNearbyDrivers
  );

  /**
   * GET /drivers/active/list
   * Get list of active drivers
   * 
   * Access: admins, dispatchers only
   */
  router.get('/active/list',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    (req, res, next) => {
      // Add query parameters for active drivers
      req.query.status = 'ACTIVE';
      req.query.sortBy = 'lastActiveAt';
      req.query.sortOrder = 'desc';
      next();
    },
    // TODO: Implement getDrivers method or redirect to appropriate endpoint
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Active drivers list endpoint coming soon',
      });
    }
  );

  /**
   * GET /drivers/available/list
   * Get list of available drivers
   * 
   * Access: admins, dispatchers only
   */
  router.get('/available/list',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    (req, res, next) => {
      // Add query parameters for available drivers
      req.query.status = 'ACTIVE';
      req.query.available = 'true';
      req.query.sortBy = 'lastLocationUpdate';
      req.query.sortOrder = 'desc';
      next();
    },
    // TODO: Implement getAvailableDrivers method
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Available drivers list endpoint coming soon',
      });
    }
  );

  /**
   * POST /drivers/:id/suspend
   * Suspend a driver
   * 
   * Access: admins only
   */
  router.post('/:id/suspend',
    authenticateToken,
    authorizeRoles(['admin']),
    [
      // Validation for suspension
      // TODO: Add proper validation for suspension reason
    ],
    (req, res, next) => {
      // Transform to update request
      req.body = {
        status: 'SUSPENDED',
        suspensionReason: req.body.reason,
      };
      next();
    },
    DriverController.updateDriverValidation,
    validateRequest,
    driverController.updateDriver
  );

  /**
   * POST /drivers/:id/activate
   * Activate a suspended driver
   * 
   * Access: admins only
   */
  router.post('/:id/activate',
    authenticateToken,
    authorizeRoles(['admin']),
    (req, res, next) => {
      // Transform to update request
      req.body = {
        status: 'ACTIVE',
        suspensionReason: null,
      };
      next();
    },
    DriverController.updateDriverValidation,
    validateRequest,
    driverController.updateDriver
  );

  /**
   * GET /drivers/stats/summary
   * Get driver statistics summary
   * 
   * Access: admins, dispatchers only
   */
  router.get('/stats/summary',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement driver statistics endpoint
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Driver statistics endpoint coming soon',
      });
    }
  );

  /**
   * GET /drivers/zone/:zoneId
   * Get drivers in specific zone
   * 
   * Access: admins, dispatchers only
   */
  router.get('/zone/:zoneId',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement zone-based driver search
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Zone-based driver search coming soon',
      });
    }
  );

  /**
   * POST /drivers/batch/notify
   * Send batch notifications to drivers
   * 
   * Access: admins, dispatchers only
   */
  router.post('/batch/notify',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    [
      // Validation for batch notifications
      // TODO: Add proper validation
    ],
    // TODO: Implement batch notification
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Batch notification feature coming soon',
      });
    }
  );

  /**
   * GET /drivers/metrics/realtime
   * Get real-time driver metrics
   * 
   * Access: admins, dispatchers only
   */
  router.get('/metrics/realtime',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement real-time metrics
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Real-time metrics endpoint coming soon',
      });
    }
  );

  /**
   * POST /drivers/emergency/:id
   * Handle emergency situations for drivers
   * 
   * Access: the driver themselves, admins, dispatchers
   */
  router.post('/emergency/:id',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    [
      // Validation for emergency reports
      // TODO: Add proper validation
    ],
    // TODO: Implement emergency handling
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Emergency handling feature coming soon',
      });
    }
  );

  /**
   * GET /drivers/leaderboard
   * Get driver performance leaderboard
   * 
   * Access: drivers (to see their ranking), admins, dispatchers
   */
  router.get('/leaderboard',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    // TODO: Implement leaderboard
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Driver leaderboard coming soon',
      });
    }
  );

  // Error handling for invalid driver routes
  router.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Driver endpoint ${req.method} ${req.originalUrl} not found`,
      availableEndpoints: [
        'POST /',
        'GET /me',
        'PUT /me',
        'POST /me/location',
        'POST /me/availability',
        'GET /me/performance',
        'GET /me/capacity',
        'POST /me/route',
        'GET /:id',
        'PUT /:id',
        'GET /:id/performance',
        'GET /:id/capacity',
        'GET /:id/location',
        'GET /search/nearby',
      ],
    });
  });

  // Mount the router
  app.use(`${apiPrefix}/drivers`, router);

  logger.info('Driver routes setup completed', {
    prefix: `${apiPrefix}/drivers`,
    routesCount: router.stack.length,
  });
}