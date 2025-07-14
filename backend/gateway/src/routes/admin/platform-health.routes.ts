/**
 * Platform Health Monitoring Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get overall platform health
router.get('/status',
  authMiddleware,
  authorize('ADMIN'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/status`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get service health
router.get('/services',
  authMiddleware,
  authorize('ADMIN'),
  query('service').optional().isString(),
  query('status').optional().isIn(['healthy', 'degraded', 'down', 'unknown']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/services`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get service details
router.get('/services/:serviceName',
  authMiddleware,
  authorize('ADMIN'),
  param('serviceName').notEmpty(),
  query('includeMetrics').optional().isBoolean(),
  query('includeDependencies').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/services/${req.params.serviceName}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get system metrics
router.get('/metrics',
  authMiddleware,
  authorize('ADMIN'),
  query('category').optional().isIn(['cpu', 'memory', 'disk', 'network', 'database', 'cache', 'queue']),
  query('timeRange').optional().isIn(['1h', '3h', '6h', '12h', '24h', '7d', '30d']),
  query('interval').optional().isIn(['1m', '5m', '15m', '1h', '1d']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/metrics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get alerts
router.get('/alerts',
  authMiddleware,
  authorize('ADMIN'),
  query('status').optional().isIn(['active', 'acknowledged', 'resolved']),
  query('severity').optional().isIn(['info', 'warning', 'error', 'critical']),
  query('service').optional().isString(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/alerts`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Acknowledge alert
router.post('/alerts/:alertId/acknowledge',
  authMiddleware,
  authorize('ADMIN'),
  param('alertId').isUUID(),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.platformHealth.url}/health/alerts/${req.params.alertId}/acknowledge`,
        body: {
          ...req.body,
          acknowledgedBy: req.user!.id,
          acknowledgedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get error logs
router.get('/errors',
  authMiddleware,
  authorize('ADMIN'),
  query('service').optional().isString(),
  query('level').optional().isIn(['error', 'fatal']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/errors`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get performance metrics
router.get('/performance',
  authMiddleware,
  authorize('ADMIN'),
  query('endpoint').optional().isString(),
  query('timeRange').optional().isIn(['1h', '3h', '6h', '12h', '24h', '7d']),
  query('percentiles').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/performance`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get database health
router.get('/database',
  authMiddleware,
  authorize('ADMIN'),
  query('instance').optional().isString(),
  query('includeQueries').optional().isBoolean(),
  query('includeConnections').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/database`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get cache health
router.get('/cache',
  authMiddleware,
  authorize('ADMIN'),
  query('instance').optional().isString(),
  query('includeStats').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/cache`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get queue health
router.get('/queues',
  authMiddleware,
  authorize('ADMIN'),
  query('queue').optional().isString(),
  query('includeStats').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/queues`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Run health check
router.post('/check',
  authMiddleware,
  authorize('ADMIN'),
  body('services').optional().isArray(),
  body('checkType').optional().isIn(['basic', 'detailed', 'full']),
  body('timeout').optional().isInt({ min: 1000, max: 60000 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.platformHealth.url}/health/check`,
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

// Configure monitoring
router.put('/monitoring/config',
  authMiddleware,
  authorize('ADMIN'),
  body('alertThresholds').optional().isObject(),
  body('checkIntervals').optional().isObject(),
  body('retentionPeriods').optional().isObject(),
  body('notifications').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.platformHealth.url}/health/monitoring/config`,
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

// Get incident history
router.get('/incidents',
  authMiddleware,
  authorize('ADMIN'),
  query('status').optional().isIn(['ongoing', 'resolved', 'postmortem']),
  query('severity').optional().isIn(['minor', 'major', 'critical']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.platformHealth.url}/health/incidents`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create incident
router.post('/incidents',
  authMiddleware,
  authorize('ADMIN'),
  body('title').notEmpty().trim(),
  body('description').notEmpty(),
  body('severity').isIn(['minor', 'major', 'critical']),
  body('affectedServices').isArray(),
  body('impact').notEmpty(),
  body('status').optional().isIn(['investigating', 'identified', 'monitoring', 'resolved']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.platformHealth.url}/health/incidents`,
        body: {
          ...req.body,
          reportedBy: req.user!.id,
          startedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update incident
router.put('/incidents/:incidentId',
  authMiddleware,
  authorize('ADMIN'),
  param('incidentId').isUUID(),
  body('status').optional().isIn(['investigating', 'identified', 'monitoring', 'resolved']),
  body('updates').optional().isArray(),
  body('resolution').optional().isString(),
  body('postmortem').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.platformHealth.url}/health/incidents/${req.params.incidentId}`,
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

// Get health report
router.post('/report',
  authMiddleware,
  authorize('ADMIN'),
  body('type').isIn(['daily', 'weekly', 'monthly', 'custom']),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('includeMetrics').optional().isArray(),
  body('format').optional().isIn(['json', 'pdf', 'html']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.platformHealth.url}/health/report`,
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

export const platformHealthRoutes = router;