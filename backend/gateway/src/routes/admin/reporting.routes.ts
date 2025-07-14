/**
 * Admin Reporting Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get available reports
router.get('/templates',
  authMiddleware,
  authorize('ADMIN'),
  query('category').optional().isIn(['financial', 'operational', 'customer', 'merchant', 'driver', 'compliance']),
  query('frequency').optional().isIn(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.reporting.url}/reports/templates`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Generate report
router.post('/generate',
  authMiddleware,
  authorize('ADMIN'),
  body('templateId').optional().isUUID(),
  body('type').isIn(['financial', 'operational', 'customer', 'merchant', 'driver', 'compliance', 'custom']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['pdf', 'excel', 'csv', 'json']),
  body('filters').optional().isObject(),
  body('metrics').optional().isArray(),
  body('groupBy').optional().isArray(),
  body('includeCharts').optional().isBoolean(),
  body('includeRawData').optional().isBoolean(),
  body('schedule').optional().isObject(),
  body('schedule.frequency').optional().isIn(['once', 'daily', 'weekly', 'monthly']),
  body('schedule.time').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('schedule.dayOfWeek').optional().isInt({ min: 0, max: 6 }),
  body('schedule.dayOfMonth').optional().isInt({ min: 1, max: 31 }),
  body('recipients').optional().isArray(),
  body('recipients.*.email').optional().isEmail(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/generate`,
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

// Get report status
router.get('/:reportId/status',
  authMiddleware,
  authorize('ADMIN'),
  param('reportId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.reporting.url}/reports/${req.params.reportId}/status`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Download report
router.get('/:reportId/download',
  authMiddleware,
  authorize('ADMIN'),
  param('reportId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.reporting.url}/reports/${req.params.reportId}/download`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get scheduled reports
router.get('/scheduled',
  authMiddleware,
  authorize('ADMIN'),
  paginationValidation,
  query('isActive').optional().isBoolean(),
  query('frequency').optional().isIn(['daily', 'weekly', 'monthly']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.reporting.url}/reports/scheduled`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update scheduled report
router.put('/scheduled/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  body('isActive').optional().isBoolean(),
  body('schedule').optional().isObject(),
  body('filters').optional().isObject(),
  body('recipients').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.reporting.url}/reports/scheduled/${req.params.id}`,
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

// Delete scheduled report
router.delete('/scheduled/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.reporting.url}/reports/scheduled/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get report history
router.get('/history',
  authMiddleware,
  authorize('ADMIN'),
  paginationValidation,
  query('type').optional().isString(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('generatedBy').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.reporting.url}/reports/history`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Financial reports
router.post('/financial/revenue',
  authMiddleware,
  authorize('ADMIN'),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('breakdown').optional().isIn(['daily', 'weekly', 'monthly', 'merchant', 'category', 'payment_method']),
  body('includeRefunds').optional().isBoolean(),
  body('includeFees').optional().isBoolean(),
  body('merchantIds').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/financial/revenue`,
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

// Operational reports
router.post('/operational/performance',
  authMiddleware,
  authorize('ADMIN'),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('metrics').isArray(),
  body('metrics.*').isIn(['orders', 'deliveries', 'avg_reskflow_time', 'customer_satisfaction', 'driver_utilization']),
  body('groupBy').optional().isIn(['hour', 'day', 'week', 'month', 'location', 'merchant']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/operational/performance`,
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

// Customer analytics report
router.post('/customer/analytics',
  authMiddleware,
  authorize('ADMIN'),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('segments').optional().isArray(),
  body('metrics').optional().isArray(),
  body('includeChurn').optional().isBoolean(),
  body('includeLTV').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/customer/analytics`,
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

// Compliance report
router.post('/compliance',
  authMiddleware,
  authorize('ADMIN'),
  body('type').isIn(['tax', 'regulatory', 'data_privacy', 'audit']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('jurisdiction').optional().isString(),
  body('includeDetails').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/compliance`,
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

// Custom SQL report
router.post('/custom/sql',
  authMiddleware,
  authorize('ADMIN'),
  body('query').notEmpty(),
  body('parameters').optional().isObject(),
  body('timeout').optional().isInt({ min: 1000, max: 300000 }),
  body('format').isIn(['json', 'csv', 'excel']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/custom/sql`,
        body: {
          ...req.body,
          executedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Dashboard configuration
router.get('/dashboards',
  authMiddleware,
  authorize('ADMIN'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.reporting.url}/reports/dashboards`,
        query: {
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

// Create dashboard
router.post('/dashboards',
  authMiddleware,
  authorize('ADMIN'),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('widgets').isArray(),
  body('widgets.*.type').isIn(['chart', 'metric', 'table', 'map']),
  body('widgets.*.config').isObject(),
  body('refreshInterval').optional().isInt({ min: 60, max: 3600 }),
  body('isPublic').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/dashboards`,
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

// Export data
router.post('/export',
  authMiddleware,
  authorize('ADMIN'),
  body('entity').isIn(['users', 'orders', 'merchants', 'drivers', 'transactions']),
  body('filters').optional().isObject(),
  body('fields').optional().isArray(),
  body('format').isIn(['csv', 'json', 'excel']),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.reporting.url}/reports/export`,
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

export const reportingRoutes = router;