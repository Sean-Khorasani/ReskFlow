/**
 * Analytics Routes
 */

import { Router } from 'express';
import { body, query } from 'express-validator';
import { validationMiddleware, dateRangeValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Track event
router.post('/events',
  authMiddleware,
  body('event').notEmpty(),
  body('properties').optional().isObject(),
  body('timestamp').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.analytics.url}/analytics/events`,
        body: {
          ...req.body,
          userId: req.user!.id,
          timestamp: req.body.timestamp || new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get dashboard metrics
router.get('/dashboard/:type',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  query('metrics').optional().isArray(),
  query('groupBy').optional().isIn(['hour', 'day', 'week', 'month']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/dashboard/${req.params.type}`,
        query: {
          ...req.query,
          userId: req.user!.id,
          role: req.user!.role
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get metrics
router.get('/metrics',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  query('metrics').isArray(),
  query('dimensions').optional().isArray(),
  query('filters').optional().isObject(),
  query('groupBy').optional().isIn(['hour', 'day', 'week', 'month']),
  query('orderBy').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/metrics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get funnel analysis
router.get('/funnel',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  query('steps').isArray(),
  query('segment').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/funnel`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get cohort analysis
router.get('/cohort',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  query('cohortBy').isIn(['signup_date', 'first_order_date']),
  query('metric').isIn(['retention', 'revenue', 'orders']),
  query('period').isIn(['day', 'week', 'month']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/cohort`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user analytics
router.get('/users/:userId',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      // Check permission to view user analytics
      if (req.user!.role !== 'ADMIN' && req.params.userId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/users/${req.params.userId}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Export analytics data
router.post('/export',
  authMiddleware,
  checkPermission('analytics', 'read'),
  body('type').isIn(['metrics', 'events', 'users', 'orders']),
  body('format').isIn(['csv', 'json', 'excel']),
  body('filters').optional().isObject(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('email').optional().isEmail(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.analytics.url}/analytics/export`,
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

// Get real-time analytics
router.get('/realtime',
  authMiddleware,
  checkPermission('analytics', 'read'),
  query('metrics').isArray(),
  query('interval').optional().isInt({ min: 1, max: 60 }), // seconds
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/realtime`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get heatmap data
router.get('/heatmap',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  query('type').isIn(['orders', 'deliveries', 'revenue']),
  query('bounds').isObject(),
  query('bounds.north').isFloat({ min: -90, max: 90 }),
  query('bounds.south').isFloat({ min: -90, max: 90 }),
  query('bounds.east').isFloat({ min: -180, max: 180 }),
  query('bounds.west').isFloat({ min: -180, max: 180 }),
  query('resolution').optional().isInt({ min: 1, max: 10 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/heatmap`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get conversion tracking
router.get('/conversions',
  authMiddleware,
  checkPermission('analytics', 'read'),
  dateRangeValidation,
  query('conversionType').optional().isIn(['signup', 'first_order', 'repeat_order', 'subscription']),
  query('source').optional().isString(),
  query('campaign').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/conversions`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get A/B test results
router.get('/experiments/:experimentId',
  authMiddleware,
  checkPermission('analytics', 'read'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.analytics.url}/analytics/experiments/${req.params.experimentId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const analyticsRoutes = router;