/**
 * Dynamic Pricing Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get pricing rules
router.get('/rules',
  authMiddleware,
  authorize('ADMIN'),
  paginationValidation,
  query('type').optional().isIn(['surge', 'time_based', 'demand_based', 'distance_based', 'weather_based', 'event_based']),
  query('status').optional().isIn(['active', 'inactive', 'scheduled', 'expired']),
  query('zone').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/rules`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get pricing rule details
router.get('/rules/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/rules/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create pricing rule
router.post('/rules',
  authMiddleware,
  authorize('ADMIN'),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('type').isIn(['surge', 'time_based', 'demand_based', 'distance_based', 'weather_based', 'event_based']),
  body('conditions').isObject(),
  body('conditions.triggers').isArray(),
  body('conditions.triggers.*.type').isIn(['time', 'demand', 'supply', 'weather', 'event', 'zone']),
  body('conditions.triggers.*.operator').isIn(['gt', 'gte', 'lt', 'lte', 'eq', 'between', 'in']),
  body('conditions.triggers.*.value').notEmpty(),
  body('adjustments').isObject(),
  body('adjustments.type').isIn(['multiplier', 'fixed', 'percentage', 'tiered']),
  body('adjustments.value').isFloat({ min: 0 }),
  body('adjustments.minMultiplier').optional().isFloat({ min: 1 }),
  body('adjustments.maxMultiplier').optional().isFloat({ min: 1 }),
  body('adjustments.tiers').optional().isArray(),
  body('applicableTo').isObject(),
  body('applicableTo.services').optional().isArray(),
  body('applicableTo.zones').optional().isArray(),
  body('applicableTo.merchants').optional().isArray(),
  body('schedule').optional().isObject(),
  body('schedule.startDate').optional().isISO8601(),
  body('schedule.endDate').optional().isISO8601(),
  body('schedule.daysOfWeek').optional().isArray(),
  body('schedule.timeSlots').optional().isArray(),
  body('priority').optional().isInt({ min: 1, max: 100 }),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dynamicPricing.url}/pricing/rules`,
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

// Update pricing rule
router.put('/rules/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('description').optional().trim(),
  body('conditions').optional().isObject(),
  body('adjustments').optional().isObject(),
  body('applicableTo').optional().isObject(),
  body('schedule').optional().isObject(),
  body('priority').optional().isInt({ min: 1, max: 100 }),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.dynamicPricing.url}/pricing/rules/${req.params.id}`,
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

// Delete pricing rule
router.delete('/rules/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.dynamicPricing.url}/pricing/rules/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Calculate price
router.post('/calculate',
  body('basePrice').isFloat({ min: 0 }),
  body('service').isIn(['reskflow', 'service_fee', 'small_order_fee']),
  body('context').isObject(),
  body('context.location').optional().isObject(),
  body('context.location.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('context.location.longitude').optional().isFloat({ min: -180, max: 180 }),
  body('context.distance').optional().isFloat({ min: 0 }),
  body('context.orderValue').optional().isFloat({ min: 0 }),
  body('context.merchantId').optional().isUUID(),
  body('context.customerId').optional().isUUID(),
  body('context.datetime').optional().isISO8601(),
  body('applyRules').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dynamicPricing.url}/pricing/calculate`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get active pricing
router.get('/active',
  query('zone').optional().isString(),
  query('service').optional().isIn(['reskflow', 'service_fee', 'small_order_fee']),
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/active`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get pricing zones
router.get('/zones',
  authMiddleware,
  authorize('ADMIN'),
  query('city').optional().isString(),
  query('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/zones`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create pricing zone
router.post('/zones',
  authMiddleware,
  authorize('ADMIN'),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('boundaries').isObject(),
  body('boundaries.type').isIn(['polygon', 'circle']),
  body('boundaries.coordinates').isArray(),
  body('basePricing').isObject(),
  body('basePricing.reskflowFee').isFloat({ min: 0 }),
  body('basePricing.serviceFee').isFloat({ min: 0 }),
  body('basePricing.smallOrderFee').optional().isFloat({ min: 0 }),
  body('basePricing.smallOrderThreshold').optional().isFloat({ min: 0 }),
  body('demandThresholds').optional().isObject(),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dynamicPricing.url}/pricing/zones`,
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

// Get pricing analytics
router.get('/analytics',
  authMiddleware,
  authorize('ADMIN'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('metrics').optional().isArray(),
  query('groupBy').optional().isIn(['hour', 'day', 'week', 'zone', 'rule']),
  query('zone').optional().isString(),
  query('ruleId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/analytics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Simulate pricing
router.post('/simulate',
  authMiddleware,
  authorize('ADMIN'),
  body('ruleId').optional().isUUID(),
  body('ruleConfig').optional().isObject(),
  body('scenarios').isArray(),
  body('scenarios.*.name').notEmpty(),
  body('scenarios.*.context').isObject(),
  body('dateRange').optional().isObject(),
  body('dateRange.startDate').optional().isISO8601(),
  body('dateRange.endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dynamicPricing.url}/pricing/simulate`,
        body: {
          ...req.body,
          simulatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get surge pricing status
router.get('/surge',
  query('zone').optional().isString(),
  query('includeNearby').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/surge`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Override pricing
router.post('/override',
  authMiddleware,
  authorize('ADMIN'),
  body('type').isIn(['zone', 'merchant', 'global']),
  body('targetId').optional().isUUID(),
  body('adjustments').isObject(),
  body('reason').notEmpty(),
  body('duration').optional().isObject(),
  body('duration.startTime').optional().isISO8601(),
  body('duration.endTime').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dynamicPricing.url}/pricing/override`,
        body: {
          ...req.body,
          overriddenBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get pricing history
router.get('/history',
  authMiddleware,
  authorize('ADMIN'),
  query('entityType').isIn(['order', 'zone', 'merchant']),
  query('entityId').isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dynamicPricing.url}/pricing/history`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Configure pricing alerts
router.put('/alerts/config',
  authMiddleware,
  authorize('ADMIN'),
  body('surgeThreshold').optional().isFloat({ min: 1 }),
  body('revenueImpactThreshold').optional().isFloat({ min: 0 }),
  body('notificationChannels').optional().isArray(),
  body('alertRecipients').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.dynamicPricing.url}/pricing/alerts/config`,
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

export const dynamicPricingRoutes = router;