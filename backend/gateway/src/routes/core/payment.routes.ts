/**
 * Payment Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation, dateRangeValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Process payment
router.post('/process',
  authMiddleware,
  body('orderId').isUUID(),
  body('amount').isFloat({ min: 0.01 }),
  body('currency').isIn(['USD', 'EUR', 'GBP']),
  body('paymentMethodId').optional().isUUID(),
  body('paymentMethodType').isIn(['card', 'wallet', 'crypto', 'bank_transfer']),
  body('savePaymentMethod').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.payment.url}/payments/process`,
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

// Get payment methods
router.get('/methods',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/payments/methods/${req.user!.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add payment method
router.post('/methods',
  authMiddleware,
  body('type').isIn(['card', 'bank', 'wallet', 'crypto']),
  body('details').isObject(),
  body('isDefault').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.payment.url}/payments/methods`,
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

// Delete payment method
router.delete('/methods/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.payment.url}/payments/methods/${req.params.id}`,
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

// Set default payment method
router.put('/methods/:id/default',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.payment.url}/payments/methods/${req.params.id}/default`,
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

// Get payment history
router.get('/history',
  authMiddleware,
  paginationValidation,
  dateRangeValidation,
  query('status').optional().isIn(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/payments/history/${req.user!.id}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get payment by ID
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/payments/${req.params.id}`,
        headers: req.headers
      });
      
      // Check permission
      if (req.user!.role !== 'ADMIN' && result.customerId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Request refund
router.post('/:id/refund',
  authMiddleware,
  param('id').isUUID(),
  body('amount').optional().isFloat({ min: 0.01 }),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.payment.url}/payments/${req.params.id}/refund`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get wallet balance
router.get('/wallet/balance',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/wallet/${req.user!.id}/balance`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add funds to wallet
router.post('/wallet/add-funds',
  authMiddleware,
  body('amount').isFloat({ min: 1 }),
  body('paymentMethodId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.payment.url}/wallet/${req.user!.id}/add-funds`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get wallet transactions
router.get('/wallet/transactions',
  authMiddleware,
  paginationValidation,
  dateRangeValidation,
  query('type').optional().isIn(['CREDIT', 'DEBIT']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/wallet/${req.user!.id}/transactions`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Withdraw from wallet
router.post('/wallet/withdraw',
  authMiddleware,
  body('amount').isFloat({ min: 10 }),
  body('bankAccountId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.payment.url}/wallet/${req.user!.id}/withdraw`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get payment statistics (admin/merchant)
router.get('/statistics',
  authMiddleware,
  checkPermission('payment', 'read'),
  dateRangeValidation,
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/payments/statistics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Stripe webhook
router.post('/webhook/stripe',
  // No auth for webhooks
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.payment.url}/payments/webhook/stripe`,
        body: req.body,
        headers: {
          'stripe-signature': req.headers['stripe-signature']
        }
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const paymentRoutes = router;