/**
 * Order Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation, dateRangeValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Create order
router.post('/',
  authMiddleware,
  body('merchantId').isUUID(),
  body('items').isArray({ min: 1 }),
  body('items.*.menuItemId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.customizations').optional().isArray(),
  body('reskflowAddress').isObject(),
  body('reskflowAddress.street').notEmpty(),
  body('reskflowAddress.city').notEmpty(),
  body('reskflowAddress.state').notEmpty(),
  body('reskflowAddress.postalCode').notEmpty(),
  body('reskflowAddress.latitude').isFloat({ min: -90, max: 90 }),
  body('reskflowAddress.longitude').isFloat({ min: -180, max: 180 }),
  body('paymentMethodId').optional().isUUID(),
  body('scheduledFor').optional().isISO8601(),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.order.url}/orders`,
        body: {
          ...req.body,
          customerId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get order by ID
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.order.url}/orders/${req.params.id}`,
        headers: req.headers
      });
      
      // Check if user has permission to view this order
      if (req.user!.role !== 'ADMIN' && 
          result.customerId !== req.user!.id &&
          result.merchantId !== req.user!.id &&
          result.driverId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user orders
router.get('/',
  authMiddleware,
  paginationValidation,
  dateRangeValidation,
  query('status').optional().isIn(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.order.url}/orders`,
        query: {
          ...req.query,
          customerId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update order (merchant)
router.put('/:id',
  authMiddleware,
  checkPermission('order', 'update'),
  param('id').isUUID(),
  body('status').optional().isIn(['CONFIRMED', 'PREPARING', 'READY', 'CANCELLED']),
  body('estimatedPrepTime').optional().isInt({ min: 1 }),
  body('cancellationReason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.order.url}/orders/${req.params.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Cancel order
router.post('/:id/cancel',
  authMiddleware,
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.order.url}/orders/${req.params.id}/cancel`,
        body: {
          ...req.body,
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

// Rate order
router.post('/:id/rate',
  authMiddleware,
  param('id').isUUID(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().isString(),
  body('type').isIn(['FOOD', 'DELIVERY', 'OVERALL']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.order.url}/orders/${req.params.id}/rate`,
        body: {
          ...req.body,
          userId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get order tracking
router.get('/:id/tracking',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.order.url}/orders/${req.params.id}/tracking`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant orders
router.get('/merchant/:merchantId',
  authMiddleware,
  checkPermission('order', 'read'),
  param('merchantId').isUUID(),
  paginationValidation,
  dateRangeValidation,
  query('status').optional().isIn(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.order.url}/orders/merchant/${req.params.merchantId}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get order statistics
router.get('/statistics',
  authMiddleware,
  dateRangeValidation,
  query('merchantId').optional().isUUID(),
  query('customerId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.order.url}/orders/statistics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Request invoice
router.post('/:id/invoice',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.order.url}/orders/${req.params.id}/invoice`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Reorder
router.post('/:id/reorder',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.order.url}/orders/${req.params.id}/reorder`,
        body: {
          customerId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const orderRoutes = router;