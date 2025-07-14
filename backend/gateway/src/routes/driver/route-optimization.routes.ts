/**
 * Route Optimization Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get optimized route
router.post('/optimize',
  authMiddleware,
  authorize('DRIVER'),
  body('deliveries').isArray(),
  body('deliveries.*.id').isUUID(),
  body('deliveries.*.pickupLocation').isObject(),
  body('deliveries.*.pickupLocation.latitude').isFloat({ min: -90, max: 90 }),
  body('deliveries.*.pickupLocation.longitude').isFloat({ min: -180, max: 180 }),
  body('deliveries.*.reskflowLocation').isObject(),
  body('deliveries.*.reskflowLocation.latitude').isFloat({ min: -90, max: 90 }),
  body('deliveries.*.reskflowLocation.longitude').isFloat({ min: -180, max: 180 }),
  body('deliveries.*.priority').optional().isInt({ min: 1, max: 5 }),
  body('deliveries.*.timeWindow').optional().isObject(),
  body('startLocation').optional().isObject(),
  body('startLocation.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('startLocation.longitude').optional().isFloat({ min: -180, max: 180 }),
  body('preferences').optional().isObject(),
  body('preferences.avoidTolls').optional().isBoolean(),
  body('preferences.avoidHighways').optional().isBoolean(),
  body('preferences.vehicleType').optional().isIn(['car', 'bike', 'scooter', 'walk']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/optimize`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get current route
router.get('/current',
  authMiddleware,
  authorize('DRIVER'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.routeOptimization.url}/routes/current`,
        query: {
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update route preferences
router.put('/preferences',
  authMiddleware,
  authorize('DRIVER'),
  body('avoidTolls').optional().isBoolean(),
  body('avoidHighways').optional().isBoolean(),
  body('avoidFerries').optional().isBoolean(),
  body('vehicleType').optional().isIn(['car', 'bike', 'scooter', 'walk']),
  body('maxDeliveries').optional().isInt({ min: 1, max: 20 }),
  body('maxDistance').optional().isFloat({ min: 1, max: 100 }),
  body('preferredAreas').optional().isArray(),
  body('avoidedAreas').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.routeOptimization.url}/routes/preferences`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get route suggestions
router.get('/suggestions',
  authMiddleware,
  authorize('DRIVER'),
  query('latitude').isFloat({ min: -90, max: 90 }),
  query('longitude').isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 50 }),
  query('maxDeliveries').optional().isInt({ min: 1, max: 10 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.routeOptimization.url}/routes/suggestions`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Recalculate route
router.post('/recalculate',
  authMiddleware,
  authorize('DRIVER'),
  body('currentLocation').isObject(),
  body('currentLocation.latitude').isFloat({ min: -90, max: 90 }),
  body('currentLocation.longitude').isFloat({ min: -180, max: 180 }),
  body('reason').optional().isIn(['traffic', 'road_closure', 'new_reskflow', 'cancelled_reskflow']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/recalculate`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get traffic conditions
router.get('/traffic',
  authMiddleware,
  authorize('DRIVER'),
  query('routeId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.routeOptimization.url}/routes/traffic`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Report route issue
router.post('/report-issue',
  authMiddleware,
  authorize('DRIVER'),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('issueType').isIn(['road_closure', 'heavy_traffic', 'accident', 'construction', 'other']),
  body('description').notEmpty(),
  body('severity').optional().isIn(['low', 'medium', 'high']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/report-issue`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get route history
router.get('/history',
  authMiddleware,
  authorize('DRIVER'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.routeOptimization.url}/routes/history`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Save route
router.post('/save',
  authMiddleware,
  authorize('DRIVER'),
  body('name').notEmpty().trim(),
  body('route').isObject(),
  body('tags').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/save`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get saved routes
router.get('/saved',
  authMiddleware,
  authorize('DRIVER'),
  query('tags').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.routeOptimization.url}/routes/saved`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get route analytics
router.get('/analytics',
  authMiddleware,
  authorize('DRIVER'),
  query('routeId').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.routeOptimization.url}/routes/analytics`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get alternative routes
router.post('/alternatives',
  authMiddleware,
  authorize('DRIVER'),
  body('start').isObject(),
  body('start.latitude').isFloat({ min: -90, max: 90 }),
  body('start.longitude').isFloat({ min: -180, max: 180 }),
  body('end').isObject(),
  body('end.latitude').isFloat({ min: -90, max: 90 }),
  body('end.longitude').isFloat({ min: -180, max: 180 }),
  body('waypoints').optional().isArray(),
  body('maxAlternatives').optional().isInt({ min: 1, max: 5 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/alternatives`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get fuel-efficient route
router.post('/fuel-efficient',
  authMiddleware,
  authorize('DRIVER'),
  body('deliveries').isArray(),
  body('vehicleType').isIn(['car', 'hybrid', 'electric', 'motorcycle']),
  body('fuelType').optional().isIn(['gasoline', 'diesel', 'electric']),
  body('currentFuelLevel').optional().isFloat({ min: 0, max: 100 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/fuel-efficient`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Share route
router.post('/:routeId/share',
  authMiddleware,
  authorize('DRIVER'),
  param('routeId').isUUID(),
  body('recipientIds').optional().isArray(),
  body('expiresIn').optional().isInt({ min: 1, max: 24 }), // hours
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.routeOptimization.url}/routes/${req.params.routeId}/share`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const routeOptimizationRoutes = router;