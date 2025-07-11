/**
 * Delivery Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Create delivery
router.post('/',
  authMiddleware,
  checkPermission('delivery', 'create'),
  body('orderId').isUUID(),
  body('pickupAddress').isObject(),
  body('pickupAddress.street').notEmpty(),
  body('pickupAddress.city').notEmpty(),
  body('pickupAddress.latitude').isFloat({ min: -90, max: 90 }),
  body('pickupAddress.longitude').isFloat({ min: -180, max: 180 }),
  body('deliveryAddress').isObject(),
  body('deliveryAddress.street').notEmpty(),
  body('deliveryAddress.city').notEmpty(),
  body('deliveryAddress.latitude').isFloat({ min: -90, max: 90 }),
  body('deliveryAddress.longitude').isFloat({ min: -180, max: 180 }),
  body('packageDetails').isObject(),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
  body('scheduledPickupTime').optional().isISO8601(),
  body('scheduledDeliveryTime').optional().isISO8601(),
  body('requiresSignature').optional().isBoolean(),
  body('requiresIDVerification').optional().isBoolean(),
  body('insuranceAmount').optional().isFloat({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get delivery by ID
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Track delivery by tracking number
router.get('/track/:trackingNumber',
  // Public endpoint
  param('trackingNumber').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.delivery.url}/deliveries/track/${req.params.trackingNumber}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update delivery status (driver)
router.put('/:id/status',
  authMiddleware,
  authorize('DRIVER'),
  param('id').isUUID(),
  body('status').isIn(['ASSIGNED', 'IN_TRANSIT', 'PICKED_UP', 'DELIVERED', 'FAILED']),
  body('location').optional().isObject(),
  body('location.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('location.longitude').optional().isFloat({ min: -180, max: 180 }),
  body('notes').optional().isString(),
  body('photo').optional().isString(),
  body('signature').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/status`,
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

// Assign driver to delivery
router.post('/:id/assign',
  authMiddleware,
  checkPermission('delivery', 'update'),
  param('id').isUUID(),
  body('driverId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/assign`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Accept delivery assignment (driver)
router.post('/:id/accept',
  authMiddleware,
  authorize('DRIVER'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/accept`,
        body: {
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

// Reject delivery assignment (driver)
router.post('/:id/reject',
  authMiddleware,
  authorize('DRIVER'),
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/reject`,
        body: {
          driverId: req.user!.id,
          reason: req.body.reason
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Cancel delivery
router.post('/:id/cancel',
  authMiddleware,
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/cancel`,
        body: {
          reason: req.body.reason,
          cancelledBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get driver deliveries
router.get('/driver/:driverId',
  authMiddleware,
  param('driverId').isUUID(),
  paginationValidation,
  query('status').optional().isArray(),
  query('date').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      // Check permission
      if (req.user!.role !== 'ADMIN' && req.params.driverId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.delivery.url}/deliveries/driver/${req.params.driverId}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get live tracking
router.get('/:id/live',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.tracking.url}/tracking/${req.params.id}/live`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update driver location
router.post('/location',
  authMiddleware,
  authorize('DRIVER'),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('location.accuracy').optional().isFloat({ min: 0 }),
  body('location.heading').optional().isFloat({ min: 0, max: 360 }),
  body('location.speed').optional().isFloat({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.tracking.url}/tracking/location`,
        body: {
          driverId: req.user!.id,
          location: req.body.location,
          timestamp: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get delivery metrics
router.get('/metrics',
  authMiddleware,
  checkPermission('delivery', 'read'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('driverId').optional().isUUID(),
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.delivery.url}/deliveries/metrics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Optimize routes (driver)
router.post('/optimize-routes',
  authMiddleware,
  authorize('DRIVER'),
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries/optimize-routes`,
        body: {
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

// Report issue
router.post('/:id/report-issue',
  authMiddleware,
  param('id').isUUID(),
  body('type').isIn(['DAMAGED', 'LOST', 'WRONG_ADDRESS', 'CUSTOMER_UNAVAILABLE', 'OTHER']),
  body('description').notEmpty(),
  body('photos').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/report-issue`,
        body: {
          ...req.body,
          reportedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get proof of delivery
router.get('/:id/proof',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.delivery.url}/deliveries/${req.params.id}/proof`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const deliveryRoutes = router;