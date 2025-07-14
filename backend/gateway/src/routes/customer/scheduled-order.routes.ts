/**
 * Scheduled Order Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Create scheduled order
router.post('/',
  authMiddleware,
  body('orderId').optional().isUUID(),
  body('merchantId').isUUID(),
  body('items').isArray(),
  body('items.*.menuItemId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('reskflowAddress').isObject(),
  body('scheduleType').isIn(['once', 'recurring']),
  body('scheduledTime').optional().isISO8601(),
  body('recurrence').optional().isObject(),
  body('recurrence.frequency').optional().isIn(['daily', 'weekly', 'biweekly', 'monthly']),
  body('recurrence.daysOfWeek').optional().isArray(),
  body('recurrence.dayOfMonth').optional().isInt({ min: 1, max: 31 }),
  body('recurrence.endDate').optional().isISO8601(),
  body('recurrence.maxOccurrences').optional().isInt({ min: 1 }),
  body('paymentMethodId').isUUID(),
  body('instructions').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.scheduledOrder.url}/scheduled-orders`,
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

// Get scheduled order
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}`,
        headers: req.headers
      });
      
      // Check ownership
      if (result.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update scheduled order
router.put('/:id',
  authMiddleware,
  param('id').isUUID(),
  body('items').optional().isArray(),
  body('reskflowAddress').optional().isObject(),
  body('scheduledTime').optional().isISO8601(),
  body('recurrence').optional().isObject(),
  body('instructions').optional().isString(),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}`,
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

// Pause scheduled order
router.post('/:id/pause',
  authMiddleware,
  param('id').isUUID(),
  body('untilDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/pause`,
        body: {
          userId: req.user!.id,
          untilDate: req.body.untilDate
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Resume scheduled order
router.post('/:id/resume',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/resume`,
        body: {
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

// Cancel scheduled order
router.delete('/:id',
  authMiddleware,
  param('id').isUUID(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}`,
        body: {
          userId: req.user!.id,
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

// Skip next occurrence
router.post('/:id/skip-next',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/skip-next`,
        body: {
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

// Get user's scheduled orders
router.get('/user/:userId',
  authMiddleware,
  param('userId').isUUID(),
  paginationValidation,
  query('isActive').optional().isBoolean(),
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      // Check permission
      if (req.user!.id !== req.params.userId && req.user!.role !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/user/${req.params.userId}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get upcoming scheduled orders
router.get('/upcoming',
  authMiddleware,
  query('days').optional().isInt({ min: 1, max: 30 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/upcoming`,
        query: {
          ...req.query,
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

// Get scheduled order history
router.get('/:id/history',
  authMiddleware,
  param('id').isUUID(),
  paginationValidation,
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/history`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Modify single occurrence
router.post('/:id/occurrences/:date',
  authMiddleware,
  param('id').isUUID(),
  param('date').isISO8601(),
  body('items').optional().isArray(),
  body('reskflowAddress').optional().isObject(),
  body('instructions').optional().isString(),
  body('skip').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/occurrences/${req.params.date}`,
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

// Get order templates
router.get('/templates',
  authMiddleware,
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/templates`,
        query: {
          ...req.query,
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

// Save as template
router.post('/:id/save-template',
  authMiddleware,
  param('id').isUUID(),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/save-template`,
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

// Preview next occurrences
router.get('/:id/preview',
  authMiddleware,
  param('id').isUUID(),
  query('count').optional().isInt({ min: 1, max: 10 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/preview`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update payment method
router.put('/:id/payment-method',
  authMiddleware,
  param('id').isUUID(),
  body('paymentMethodId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.scheduledOrder.url}/scheduled-orders/${req.params.id}/payment-method`,
        body: {
          userId: req.user!.id,
          paymentMethodId: req.body.paymentMethodId
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const scheduledOrderRoutes = router;