/**
 * Group Order Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Create group order
router.post('/',
  authMiddleware,
  body('name').notEmpty().trim(),
  body('merchantId').isUUID(),
  body('reskflowAddress').isObject(),
  body('reskflowTime').isISO8601(),
  body('maxParticipants').optional().isInt({ min: 2, max: 50 }),
  body('splitMethod').optional().isIn(['equal', 'byItems', 'custom']),
  body('joinDeadline').optional().isISO8601(),
  body('minimumOrderAmount').optional().isFloat({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders`,
        body: {
          ...req.body,
          createdBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get group order details
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Join group order
router.post('/:id/join',
  authMiddleware,
  param('id').isUUID(),
  body('joinCode').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/join`,
        body: {
          userId: req.user!.id,
          joinCode: req.body.joinCode
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Leave group order
router.post('/:id/leave',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/leave`,
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

// Add items to group order
router.post('/:id/items',
  authMiddleware,
  param('id').isUUID(),
  body('items').isArray(),
  body('items.*.menuItemId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.customizations').optional().isObject(),
  body('items.*.notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/items`,
        body: {
          userId: req.user!.id,
          items: req.body.items
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update participant items
router.put('/:id/items',
  authMiddleware,
  param('id').isUUID(),
  body('items').isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/items`,
        body: {
          userId: req.user!.id,
          items: req.body.items
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Remove item from group order
router.delete('/:id/items/:itemId',
  authMiddleware,
  param('id').isUUID(),
  param('itemId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/items/${req.params.itemId}`,
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

// Submit participant order
router.post('/:id/submit',
  authMiddleware,
  param('id').isUUID(),
  body('paymentMethodId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/submit`,
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

// Finalize group order (host only)
router.post('/:id/finalize',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/finalize`,
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

// Get participant summary
router.get('/:id/participants',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/participants`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get payment split details
router.get('/:id/payment-split',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/payment-split`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Send reminders
router.post('/:id/remind',
  authMiddleware,
  param('id').isUUID(),
  body('participantIds').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/remind`,
        body: {
          requestedBy: req.user!.id,
          participantIds: req.body.participantIds
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user's group orders
router.get('/user/:userId',
  authMiddleware,
  param('userId').isUUID(),
  query('status').optional().isIn(['active', 'completed', 'cancelled']),
  query('role').optional().isIn(['host', 'participant']),
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
        url: `${config.services.groupOrder.url}/group-orders/user/${req.params.userId}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Cancel group order
router.post('/:id/cancel',
  authMiddleware,
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/cancel`,
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

// Generate share link
router.post('/:id/share',
  authMiddleware,
  param('id').isUUID(),
  body('expiresIn').optional().isInt({ min: 1, max: 24 }), // hours
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.groupOrder.url}/group-orders/${req.params.id}/share`,
        body: {
          userId: req.user!.id,
          expiresIn: req.body.expiresIn
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const groupOrderRoutes = router;