import { Application, Router } from 'express';
import { TrackingController } from '../controllers/tracking.controller';
import { authenticateToken, authorizeRoles } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { logger } from '../utils/logger';

/**
 * Set up tracking-related routes
 */
export function setupTrackingRoutes(
  app: Application, 
  trackingController: TrackingController, 
  apiPrefix: string
): void {
  const router = Router();

  // Apply general rate limiting to all tracking routes
  router.use(TrackingController.generalLimiter);

  /**
   * POST /tracking/:reskflowId/events
   * Log a tracking event for a reskflow
   * 
   * Access: drivers (for assigned deliveries), admins, dispatchers
   */
  router.post('/:reskflowId/events',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    TrackingController.logEventValidation,
    validateRequest,
    trackingController.logTrackingEvent
  );

  /**
   * POST /tracking/:reskflowId/location
   * Update location for a reskflow
   * 
   * Access: drivers (for assigned deliveries), admins
   * Rate limit: 200 updates per minute
   */
  router.post('/:reskflowId/location',
    TrackingController.locationUpdateLimiter,
    authenticateToken,
    authorizeRoles(['driver', 'admin']),
    TrackingController.updateLocationValidation,
    validateRequest,
    trackingController.updateLocation
  );

  /**
   * GET /tracking/:reskflowId
   * Get tracking information for a reskflow
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.get('/:reskflowId',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    trackingController.getTrackingInfo
  );

  /**
   * GET /tracking/:reskflowId/location/current
   * Get current location of reskflow
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.get('/:reskflowId/location/current',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    trackingController.getCurrentLocation
  );

  /**
   * GET /tracking/:reskflowId/location/history
   * Get location history for a reskflow
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.get('/:reskflowId/location/history',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    TrackingController.getHistoryValidation,
    validateRequest,
    trackingController.getLocationHistory
  );

  /**
   * GET /tracking/:reskflowId/timeline
   * Get reskflow timeline events
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.get('/:reskflowId/timeline',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    trackingController.getDeliveryTimeline
  );

  /**
   * GET /tracking/:reskflowId/realtime
   * Get real-time tracking data via Server-Sent Events (SSE)
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.get('/:reskflowId/realtime',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    trackingController.getRealtimeTracking
  );

  /**
   * POST /tracking/:reskflowId/subscribe
   * Subscribe to tracking updates via WebSocket
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.post('/:reskflowId/subscribe',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    trackingController.subscribeToTracking
  );

  /**
   * POST /tracking/bulk
   * Get bulk tracking data for multiple deliveries
   * 
   * Access: admins, dispatchers only
   */
  router.post('/bulk',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    TrackingController.bulkTrackingValidation,
    validateRequest,
    trackingController.getBulkTrackingData
  );

  /**
   * GET /tracking/public/:trackingNumber
   * Public tracking endpoint (no authentication required)
   * 
   * Access: public (anyone with tracking number)
   */
  router.get('/public/:trackingNumber',
    // No authentication required for public tracking
    (req, res, next) => {
      // TODO: Implement public tracking with limited information
      // This would show basic status without sensitive details
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Public tracking endpoint coming soon',
      });
    }
  );

  /**
   * POST /tracking/notifications/preferences
   * Update tracking notification preferences
   * 
   * Access: customers, drivers
   */
  router.post('/notifications/preferences',
    authenticateToken,
    authorizeRoles(['customer', 'driver']),
    [
      // Validation for notification preferences
      // TODO: Add proper validation
    ],
    // TODO: Implement notification preferences
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Notification preferences endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/analytics/summary
   * Get tracking analytics summary
   * 
   * Access: admins, dispatchers only
   */
  router.get('/analytics/summary',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement tracking analytics
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Tracking analytics endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/geofence/events
   * Get geofence events
   * 
   * Access: admins, dispatchers only
   */
  router.get('/geofence/events',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement geofence events endpoint
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Geofence events endpoint coming soon',
      });
    }
  );

  /**
   * POST /tracking/geofence/create
   * Create a geofence
   * 
   * Access: admins, dispatchers only
   */
  router.post('/geofence/create',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    [
      // Validation for geofence creation
      // TODO: Add proper validation
    ],
    // TODO: Implement geofence creation
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Geofence creation endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/heatmap
   * Get reskflow heatmap data
   * 
   * Access: admins, dispatchers only
   */
  router.get('/heatmap',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement heatmap data
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Heatmap data endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/routes/optimization
   * Get route optimization data
   * 
   * Access: admins, dispatchers only
   */
  router.get('/routes/optimization',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement route optimization data
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Route optimization data endpoint coming soon',
      });
    }
  );

  /**
   * POST /tracking/alerts/create
   * Create tracking alerts
   * 
   * Access: customers (for their deliveries), admins, dispatchers
   */
  router.post('/alerts/create',
    authenticateToken,
    authorizeRoles(['customer', 'admin', 'dispatcher']),
    [
      // Validation for alert creation
      // TODO: Add proper validation
    ],
    // TODO: Implement alert creation
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Alert creation endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/alerts/:userId
   * Get user's tracking alerts
   * 
   * Access: the user themselves, admins, dispatchers
   */
  router.get('/alerts/:userId',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Validate user access
      if (req.user?.role !== 'admin' && req.user?.role !== 'dispatcher' && req.user?.id !== req.params.userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot access another user\'s alerts',
        });
      }
      next();
    },
    // TODO: Implement user alerts
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'User alerts endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/reskflow/:reskflowId/eta
   * Get estimated time of arrival for reskflow
   * 
   * Access: customers (own deliveries), drivers (assigned), merchants (their deliveries), admins, dispatchers
   */
  router.get('/reskflow/:reskflowId/eta',
    authenticateToken,
    authorizeRoles(['customer', 'driver', 'merchant', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Redirect to main tracking endpoint and extract ETA
      req.params.reskflowId = req.params.reskflowId;
      next();
    },
    trackingController.getCurrentLocation
  );

  /**
   * POST /tracking/reskflow/:reskflowId/share
   * Share reskflow tracking with others
   * 
   * Access: customers (own deliveries), admins
   */
  router.post('/reskflow/:reskflowId/share',
    authenticateToken,
    authorizeRoles(['customer', 'admin']),
    [
      // Validation for sharing
      // TODO: Add proper validation
    ],
    // TODO: Implement tracking sharing
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Tracking sharing endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/driver/:driverId/current
   * Get current location of specific driver
   * 
   * Access: the driver themselves, admins, dispatchers
   */
  router.get('/driver/:driverId/current',
    authenticateToken,
    authorizeRoles(['driver', 'admin', 'dispatcher']),
    (req, res, next) => {
      // Validate driver access
      if (req.user?.role === 'driver' && req.user?.id !== req.params.driverId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot access another driver\'s location',
        });
      }
      next();
    },
    // TODO: Implement driver location tracking
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Driver location tracking endpoint coming soon',
      });
    }
  );

  /**
   * GET /tracking/metrics/performance
   * Get tracking performance metrics
   * 
   * Access: admins, dispatchers only
   */
  router.get('/metrics/performance',
    authenticateToken,
    authorizeRoles(['admin', 'dispatcher']),
    // TODO: Implement performance metrics
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Performance metrics endpoint coming soon',
      });
    }
  );

  /**
   * POST /tracking/test/simulate
   * Simulate tracking data for testing
   * 
   * Access: admins only (development/testing environment)
   */
  router.post('/test/simulate',
    authenticateToken,
    authorizeRoles(['admin']),
    (req, res, next) => {
      // Only allow in development/testing environment
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Simulation not allowed in production',
        });
      }
      next();
    },
    // TODO: Implement tracking simulation
    (req, res) => {
      res.status(501).json({
        error: 'Not Implemented',
        message: 'Tracking simulation endpoint coming soon',
      });
    }
  );

  // Error handling for invalid tracking routes
  router.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Tracking endpoint ${req.method} ${req.originalUrl} not found`,
      availableEndpoints: [
        'POST /:reskflowId/events',
        'POST /:reskflowId/location',
        'GET /:reskflowId',
        'GET /:reskflowId/location/current',
        'GET /:reskflowId/location/history',
        'GET /:reskflowId/timeline',
        'GET /:reskflowId/realtime',
        'POST /:reskflowId/subscribe',
        'POST /bulk',
        'GET /public/:trackingNumber',
      ],
    });
  });

  // Mount the router
  app.use(`${apiPrefix}/tracking`, router);

  logger.info('Tracking routes setup completed', {
    prefix: `${apiPrefix}/tracking`,
    routesCount: router.stack.length,
  });
}