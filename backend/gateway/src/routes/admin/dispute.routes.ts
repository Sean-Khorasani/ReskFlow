/**
 * Dispute Resolution Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get disputes
router.get('/',
  authMiddleware,
  checkPermission('disputes', 'read'),
  paginationValidation,
  query('status').optional().isIn(['open', 'investigating', 'pending_response', 'resolved', 'closed', 'escalated']),
  query('type').optional().isIn(['order', 'payment', 'reskflow', 'quality', 'driver', 'merchant', 'refund']),
  query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  query('assignedTo').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dispute.url}/disputes`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get dispute details
router.get('/:id',
  authMiddleware,
  checkPermission('disputes', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dispute.url}/disputes/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create dispute
router.post('/',
  authMiddleware,
  body('type').isIn(['order', 'payment', 'reskflow', 'quality', 'driver', 'merchant', 'refund']),
  body('orderId').optional().isUUID(),
  body('subject').notEmpty().trim(),
  body('description').notEmpty().trim(),
  body('claimAmount').optional().isFloat({ min: 0 }),
  body('evidence').optional().isArray(),
  body('evidence.*.type').optional().isIn(['image', 'document', 'text', 'video']),
  body('evidence.*.url').optional().isString(),
  body('evidence.*.description').optional().isString(),
  body('desiredResolution').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes`,
        body: {
          ...req.body,
          filedBy: req.user!.id,
          filedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update dispute status
router.put('/:id/status',
  authMiddleware,
  checkPermission('disputes', 'update'),
  param('id').isUUID(),
  body('status').isIn(['investigating', 'pending_response', 'resolved', 'closed', 'escalated']),
  body('reason').optional().isString(),
  body('internalNotes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.dispute.url}/disputes/${req.params.id}/status`,
        body: {
          ...req.body,
          updatedBy: req.user!.id,
          updatedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Assign dispute
router.post('/:id/assign',
  authMiddleware,
  checkPermission('disputes', 'update'),
  param('id').isUUID(),
  body('assignTo').isUUID(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/${req.params.id}/assign`,
        body: {
          ...req.body,
          assignedBy: req.user!.id,
          assignedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add response to dispute
router.post('/:id/responses',
  authMiddleware,
  param('id').isUUID(),
  body('message').notEmpty().trim(),
  body('attachments').optional().isArray(),
  body('isInternal').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/${req.params.id}/responses`,
        body: {
          ...req.body,
          respondedBy: req.user!.id,
          respondedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Escalate dispute
router.post('/:id/escalate',
  authMiddleware,
  checkPermission('disputes', 'update'),
  param('id').isUUID(),
  body('escalationLevel').isIn(['supervisor', 'manager', 'legal', 'executive']),
  body('reason').notEmpty(),
  body('urgency').optional().isIn(['normal', 'high', 'critical']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/${req.params.id}/escalate`,
        body: {
          ...req.body,
          escalatedBy: req.user!.id,
          escalatedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Resolve dispute
router.post('/:id/resolve',
  authMiddleware,
  checkPermission('disputes', 'update'),
  param('id').isUUID(),
  body('resolution').notEmpty(),
  body('resolutionType').isIn(['refund_full', 'refund_partial', 'credit', 'replacement', 'apology', 'no_action', 'other']),
  body('compensationAmount').optional().isFloat({ min: 0 }),
  body('creditAmount').optional().isFloat({ min: 0 }),
  body('actions').optional().isArray(),
  body('actions.*.type').optional().isIn(['refund', 'credit', 'ban_user', 'warn_merchant', 'retrain_driver']),
  body('actions.*.details').optional().isObject(),
  body('preventiveMeasures').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/${req.params.id}/resolve`,
        body: {
          ...req.body,
          resolvedBy: req.user!.id,
          resolvedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get dispute history
router.get('/:id/history',
  authMiddleware,
  checkPermission('disputes', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dispute.url}/disputes/${req.params.id}/history`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get dispute statistics
router.get('/statistics',
  authMiddleware,
  authorize('ADMIN'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('groupBy').optional().isIn(['type', 'status', 'resolution', 'agent', 'day', 'week', 'month']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dispute.url}/disputes/statistics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get SLA metrics
router.get('/sla-metrics',
  authMiddleware,
  authorize('ADMIN'),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('agentId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dispute.url}/disputes/sla-metrics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get dispute templates
router.get('/templates',
  authMiddleware,
  checkPermission('disputes', 'read'),
  query('type').optional().isString(),
  query('resolutionType').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dispute.url}/disputes/templates`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create dispute template
router.post('/templates',
  authMiddleware,
  authorize('ADMIN'),
  body('name').notEmpty().trim(),
  body('type').isIn(['order', 'payment', 'reskflow', 'quality', 'driver', 'merchant', 'refund']),
  body('resolutionType').isString(),
  body('template').notEmpty(),
  body('variables').optional().isArray(),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/templates`,
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

// Bulk update disputes
router.post('/bulk-update',
  authMiddleware,
  authorize('ADMIN'),
  body('disputeIds').isArray(),
  body('action').isIn(['assign', 'close', 'escalate', 'change_priority']),
  body('data').isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/bulk-update`,
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

// Search disputes
router.post('/search',
  authMiddleware,
  checkPermission('disputes', 'read'),
  body('query').optional().isString(),
  body('filters').optional().isObject(),
  body('dateRange').optional().isObject(),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/search`,
        body: {
          ...req.body,
          searchedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Export disputes
router.post('/export',
  authMiddleware,
  authorize('ADMIN'),
  body('filters').optional().isObject(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['csv', 'excel', 'pdf']),
  body('fields').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dispute.url}/disputes/export`,
        body: {
          ...req.body,
          exportedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const disputeRoutes = router;