/**
 * Split Payment Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Create split payment request
router.post('/',
  authMiddleware,
  body('orderId').isUUID(),
  body('totalAmount').isFloat({ min: 0 }),
  body('splits').isArray(),
  body('splits.*.userId').optional().isUUID(),
  body('splits.*.email').optional().isEmail(),
  body('splits.*.phone').optional().isMobilePhone(),
  body('splits.*.amount').optional().isFloat({ min: 0 }),
  body('splits.*.percentage').optional().isFloat({ min: 0, max: 100 }),
  body('splits.*.items').optional().isArray(),
  body('splitMethod').isIn(['equal', 'percentage', 'amount', 'items']),
  body('deadline').optional().isISO8601(),
  body('allowPartialPayment').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments`,
        body: {
          ...req.body,
          initiatorId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get split payment details
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Accept split payment request
router.post('/:id/accept',
  authMiddleware,
  param('id').isUUID(),
  body('paymentMethodId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/accept`,
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

// Decline split payment request
router.post('/:id/decline',
  authMiddleware,
  param('id').isUUID(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/decline`,
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

// Pay split share
router.post('/:id/pay',
  authMiddleware,
  param('id').isUUID(),
  body('paymentMethodId').isUUID(),
  body('amount').optional().isFloat({ min: 0 }),
  body('tip').optional().isFloat({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/pay`,
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

// Update split amounts
router.put('/:id/splits',
  authMiddleware,
  param('id').isUUID(),
  body('splits').isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/splits`,
        body: {
          splits: req.body.splits,
          updatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Send payment reminders
router.post('/:id/remind',
  authMiddleware,
  param('id').isUUID(),
  body('participantIds').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/remind`,
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

// Get payment status
router.get('/:id/status',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/status`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Cancel split payment
router.post('/:id/cancel',
  authMiddleware,
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/cancel`,
        body: {
          cancelledBy: req.user!.id,
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

// Get user's split payments
router.get('/user/:userId',
  authMiddleware,
  param('userId').isUUID(),
  query('role').optional().isIn(['initiator', 'participant']),
  query('status').optional().isIn(['pending', 'partial', 'completed', 'cancelled']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
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
        url: `${config.services.splitPayment.url}/split-payments/user/${req.params.userId}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Calculate split suggestions
router.post('/calculate',
  authMiddleware,
  body('totalAmount').isFloat({ min: 0 }),
  body('participants').isArray(),
  body('participants.*.userId').optional().isUUID(),
  body('participants.*.items').optional().isArray(),
  body('method').isIn(['equal', 'byItems', 'proportional']),
  body('includeTip').optional().isBoolean(),
  body('tipPercentage').optional().isFloat({ min: 0, max: 100 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/calculate`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Settle split payment
router.post('/:id/settle',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/settle`,
        body: {
          settledBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get split payment summary
router.get('/:id/summary',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/summary`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Request payment adjustment
router.post('/:id/adjust',
  authMiddleware,
  param('id').isUUID(),
  body('participantId').isUUID(),
  body('newAmount').isFloat({ min: 0 }),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/adjust`,
        body: {
          ...req.body,
          requestedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Generate payment link
router.post('/:id/payment-link',
  authMiddleware,
  param('id').isUUID(),
  body('participantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.splitPayment.url}/split-payments/${req.params.id}/payment-link`,
        body: {
          participantId: req.body.participantId,
          requestedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const splitPaymentRoutes = router;