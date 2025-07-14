/**
 * Fraud Detection Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get fraud alerts
router.get('/alerts',
  authMiddleware,
  authorize('ADMIN'),
  paginationValidation,
  query('status').optional().isIn(['pending', 'investigating', 'confirmed', 'false_positive', 'resolved']),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('type').optional().isIn(['payment', 'account', 'reskflow', 'promo_abuse', 'identity']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/alerts`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get fraud alert details
router.get('/alerts/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/alerts/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update alert status
router.put('/alerts/:id/status',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  body('status').isIn(['investigating', 'confirmed', 'false_positive', 'resolved']),
  body('notes').optional().isString(),
  body('action').optional().isIn(['block_user', 'block_payment', 'flag_account', 'require_verification', 'none']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.fraudDetection.url}/fraud/alerts/${req.params.id}/status`,
        body: {
          ...req.body,
          reviewedBy: req.user!.id,
          reviewedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Check transaction for fraud
router.post('/check-transaction',
  authMiddleware,
  body('transactionId').isUUID(),
  body('type').isIn(['payment', 'refund', 'payout']),
  body('amount').isFloat({ min: 0 }),
  body('userId').isUUID(),
  body('paymentMethod').isObject(),
  body('deviceInfo').optional().isObject(),
  body('locationInfo').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/check-transaction`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Check user activity
router.post('/check-user',
  authMiddleware,
  body('userId').isUUID(),
  body('activityType').isIn(['login', 'order', 'account_change', 'high_value_transaction']),
  body('metadata').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/check-user`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get fraud rules
router.get('/rules',
  authMiddleware,
  authorize('ADMIN'),
  paginationValidation,
  query('type').optional().isString(),
  query('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/rules`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create fraud rule
router.post('/rules',
  authMiddleware,
  authorize('ADMIN'),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('type').isIn(['payment', 'behavior', 'velocity', 'pattern', 'ml_based']),
  body('conditions').isArray(),
  body('conditions.*.field').notEmpty(),
  body('conditions.*.operator').isIn(['equals', 'greater_than', 'less_than', 'contains', 'matches', 'in']),
  body('conditions.*.value').notEmpty(),
  body('actions').isArray(),
  body('actions.*.type').isIn(['block', 'flag', 'review', 'notify', 'challenge']),
  body('severity').isIn(['low', 'medium', 'high', 'critical']),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/rules`,
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

// Update fraud rule
router.put('/rules/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('description').optional().trim(),
  body('conditions').optional().isArray(),
  body('actions').optional().isArray(),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.fraudDetection.url}/fraud/rules/${req.params.id}`,
        body: {
          ...req.body,
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

// Get blacklists
router.get('/blacklists',
  authMiddleware,
  authorize('ADMIN'),
  query('type').optional().isIn(['email', 'phone', 'ip', 'device', 'payment_method']),
  query('search').optional().isString(),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/blacklists`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add to blacklist
router.post('/blacklists',
  authMiddleware,
  authorize('ADMIN'),
  body('type').isIn(['email', 'phone', 'ip', 'device', 'payment_method']),
  body('value').notEmpty(),
  body('reason').notEmpty(),
  body('expiresAt').optional().isISO8601(),
  body('relatedAlertId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/blacklists`,
        body: {
          ...req.body,
          addedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Remove from blacklist
router.delete('/blacklists/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.fraudDetection.url}/fraud/blacklists/${req.params.id}`,
        body: {
          reason: req.body.reason,
          removedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get fraud statistics
router.get('/statistics',
  authMiddleware,
  authorize('ADMIN'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('groupBy').optional().isIn(['day', 'week', 'month', 'type', 'severity']),
  query('type').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/statistics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get ML model performance
router.get('/ml/performance',
  authMiddleware,
  authorize('ADMIN'),
  query('modelId').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/ml/performance`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Train ML model
router.post('/ml/train',
  authMiddleware,
  authorize('ADMIN'),
  body('modelType').isIn(['transaction', 'user_behavior', 'account_takeover', 'promo_abuse']),
  body('trainingData').optional().isObject(),
  body('parameters').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/ml/train`,
        body: {
          ...req.body,
          initiatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get risk score
router.post('/risk-score',
  authMiddleware,
  body('entityType').isIn(['user', 'transaction', 'merchant', 'driver']),
  body('entityId').isUUID(),
  body('context').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/risk-score`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Review queue
router.get('/review-queue',
  authMiddleware,
  authorize('ADMIN'),
  paginationValidation,
  query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  query('type').optional().isString(),
  query('assignedTo').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.fraudDetection.url}/fraud/review-queue`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Assign review
router.post('/review-queue/:id/assign',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  body('assignTo').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/review-queue/${req.params.id}/assign`,
        body: {
          assignTo: req.body.assignTo || req.user!.id,
          assignedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Generate fraud report
router.post('/report',
  authMiddleware,
  authorize('ADMIN'),
  body('type').isIn(['summary', 'detailed', 'trends', 'rules_performance']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['pdf', 'excel', 'json']),
  body('includeCharts').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.fraudDetection.url}/fraud/report`,
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

export const fraudDetectionRoutes = router;