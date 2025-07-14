/**
 * Notification Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get user notifications
router.get('/',
  authMiddleware,
  paginationValidation,
  query('unreadOnly').optional().isBoolean(),
  query('type').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.notification.url}/notifications`,
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

// Get notification by ID
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.notification.url}/notifications/${req.params.id}`,
        headers: req.headers
      });
      
      // Check ownership
      if (result.userId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Mark notification as read
router.put('/:id/read',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.notification.url}/notifications/${req.params.id}/read`,
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

// Mark all notifications as read
router.put('/read-all',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.notification.url}/notifications/read-all`,
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

// Delete notification
router.delete('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.notification.url}/notifications/${req.params.id}`,
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

// Get notification preferences
router.get('/preferences',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.notification.url}/notifications/preferences/${req.user!.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update notification preferences
router.put('/preferences',
  authMiddleware,
  body('email').optional().isObject(),
  body('email.orderUpdates').optional().isBoolean(),
  body('email.promotions').optional().isBoolean(),
  body('email.newsletter').optional().isBoolean(),
  body('sms').optional().isObject(),
  body('sms.orderUpdates').optional().isBoolean(),
  body('sms.reskflowAlerts').optional().isBoolean(),
  body('push').optional().isObject(),
  body('push.orderUpdates').optional().isBoolean(),
  body('push.reskflowAlerts').optional().isBoolean(),
  body('push.promotions').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.notification.url}/notifications/preferences/${req.user!.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Register device for push notifications
router.post('/devices',
  authMiddleware,
  body('token').notEmpty(),
  body('platform').isIn(['ios', 'android', 'web']),
  body('deviceId').notEmpty(),
  body('deviceInfo').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.notification.url}/notifications/devices`,
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

// Unregister device
router.delete('/devices/:deviceId',
  authMiddleware,
  param('deviceId').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.notification.url}/notifications/devices/${req.params.deviceId}`,
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

// Send notification (admin only)
router.post('/send',
  authMiddleware,
  authorize('ADMIN'),
  body('userId').optional().isUUID(),
  body('userIds').optional().isArray(),
  body('segment').optional().isString(),
  body('type').notEmpty(),
  body('title').notEmpty(),
  body('message').notEmpty(),
  body('data').optional().isObject(),
  body('channels').optional().isArray(),
  body('scheduledFor').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.notification.url}/notifications/send`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get notification statistics (admin only)
router.get('/statistics',
  authMiddleware,
  authorize('ADMIN'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('type').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.notification.url}/notifications/statistics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Test notification
router.post('/test',
  authMiddleware,
  body('channel').isIn(['email', 'sms', 'push']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.notification.url}/notifications/test`,
        body: {
          userId: req.user!.id,
          channel: req.body.channel
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const notificationRoutes = router;