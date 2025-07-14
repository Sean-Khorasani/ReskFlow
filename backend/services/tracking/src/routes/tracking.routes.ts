import { Router } from 'express';
import { TrackingController } from '../controllers/tracking.controller';
import { validateRequest } from '../middleware/validation';
import { authenticateRequest } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimiter';

const router = Router();
const trackingController = new TrackingController();

// Apply middleware
router.use(authenticateRequest);
router.use(rateLimitMiddleware);

// Health check
router.get('/health', trackingController.healthCheck.bind(trackingController));

// Tracking Session Routes
router.post('/sessions', 
  validateRequest('createTrackingSession'),
  trackingController.createTrackingSession.bind(trackingController)
);

router.get('/sessions/:sessionId', 
  trackingController.getTrackingSession.bind(trackingController)
);

router.put('/sessions/:sessionId', 
  validateRequest('updateTrackingSession'),
  trackingController.updateTrackingSession.bind(trackingController)
);

router.delete('/sessions/:sessionId', 
  trackingController.cancelTracking.bind(trackingController)
);

// Session Control Routes
router.post('/sessions/:sessionId/start', 
  trackingController.startTracking.bind(trackingController)
);

router.post('/sessions/:sessionId/pause', 
  trackingController.pauseTracking.bind(trackingController)
);

router.post('/sessions/:sessionId/resume', 
  trackingController.resumeTracking.bind(trackingController)
);

router.post('/sessions/:sessionId/complete', 
  validateRequest('completeTracking'),
  trackingController.completeTracking.bind(trackingController)
);

router.post('/sessions/:sessionId/cancel', 
  validateRequest('cancelTracking'),
  trackingController.cancelTracking.bind(trackingController)
);

// Location Routes
router.post('/location', 
  validateRequest('updateLocation'),
  trackingController.updateLocation.bind(trackingController)
);

router.get('/sessions/:sessionId/location/current', 
  trackingController.getCurrentLocation.bind(trackingController)
);

router.get('/sessions/:sessionId/location/history', 
  trackingController.getLocationHistory.bind(trackingController)
);

// Emergency Routes
router.post('/sessions/:sessionId/emergency', 
  validateRequest('triggerEmergency'),
  trackingController.triggerEmergency.bind(trackingController)
);

// Events Routes
router.get('/sessions/:sessionId/events', 
  trackingController.getTrackingEvents.bind(trackingController)
);

// Query Routes
router.get('/orders/:orderId/sessions', 
  trackingController.getSessionsByOrder.bind(trackingController)
);

router.get('/drivers/:driverId/sessions/active', 
  trackingController.getActiveSessionsByDriver.bind(trackingController)
);

// Geofence Routes
router.post('/geofences', 
  validateRequest('createGeofenceZone'),
  trackingController.createGeofenceZone.bind(trackingController)
);

router.get('/geofences/:zoneId', 
  trackingController.getGeofenceZone.bind(trackingController)
);

router.put('/geofences/:zoneId', 
  validateRequest('updateGeofenceZone'),
  trackingController.updateGeofenceZone.bind(trackingController)
);

router.delete('/geofences/:zoneId', 
  trackingController.deleteGeofenceZone.bind(trackingController)
);

// Route Optimization Routes
router.post('/route/optimize', 
  validateRequest('optimizeRoute'),
  trackingController.optimizeRoute.bind(trackingController)
);

router.get('/route/optimization/:optimizationId', 
  trackingController.getOptimizationResult.bind(trackingController)
);

export default router;