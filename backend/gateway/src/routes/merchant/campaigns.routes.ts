/**
 * Promotional Campaigns Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get campaigns
router.get('/',
  authMiddleware,
  checkPermission('campaigns', 'read'),
  paginationValidation,
  query('merchantId').isUUID(),
  query('status').optional().isIn(['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled']),
  query('type').optional().isIn(['discount', 'bogo', 'freebie', 'bundle', 'loyalty', 'flash_sale']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.campaigns.url}/campaigns`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get campaign details
router.get('/:id',
  authMiddleware,
  checkPermission('campaigns', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create campaign
router.post('/',
  authMiddleware,
  checkPermission('campaigns', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('type').isIn(['discount', 'bogo', 'freebie', 'bundle', 'loyalty', 'flash_sale']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('rules').isObject(),
  body('rules.discountType').optional().isIn(['percentage', 'fixed', 'tiered']),
  body('rules.discountValue').optional().isFloat({ min: 0 }),
  body('rules.minOrderAmount').optional().isFloat({ min: 0 }),
  body('rules.maxDiscountAmount').optional().isFloat({ min: 0 }),
  body('rules.applicableItems').optional().isArray(),
  body('rules.excludedItems').optional().isArray(),
  body('target').isObject(),
  body('target.audience').isIn(['all', 'new_customers', 'returning_customers', 'vip', 'segment']),
  body('target.segment').optional().isObject(),
  body('limits').optional().isObject(),
  body('limits.totalUses').optional().isInt({ min: 1 }),
  body('limits.usesPerCustomer').optional().isInt({ min: 1 }),
  body('limits.dailyLimit').optional().isInt({ min: 1 }),
  body('promoCode').optional().matches(/^[A-Z0-9]+$/),
  body('autoApply').optional().isBoolean(),
  body('stackable').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns`,
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

// Update campaign
router.put('/:id',
  authMiddleware,
  checkPermission('campaigns', 'update'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('description').optional().trim(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('rules').optional().isObject(),
  body('target').optional().isObject(),
  body('limits').optional().isObject(),
  body('status').optional().isIn(['draft', 'scheduled', 'active', 'paused']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}`,
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

// Activate campaign
router.post('/:id/activate',
  authMiddleware,
  checkPermission('campaigns', 'update'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/activate`,
        body: {
          activatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Pause campaign
router.post('/:id/pause',
  authMiddleware,
  checkPermission('campaigns', 'update'),
  param('id').isUUID(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/pause`,
        body: {
          pausedBy: req.user!.id,
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

// Cancel campaign
router.post('/:id/cancel',
  authMiddleware,
  checkPermission('campaigns', 'delete'),
  param('id').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/cancel`,
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

// Clone campaign
router.post('/:id/clone',
  authMiddleware,
  checkPermission('campaigns', 'create'),
  param('id').isUUID(),
  body('name').notEmpty().trim(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/clone`,
        body: {
          ...req.body,
          clonedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Validate promo code
router.post('/validate',
  body('promoCode').notEmpty(),
  body('merchantId').isUUID(),
  body('customerId').optional().isUUID(),
  body('orderAmount').isFloat({ min: 0 }),
  body('items').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/validate`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Apply campaign
router.post('/apply',
  body('campaignId').optional().isUUID(),
  body('promoCode').optional().notEmpty(),
  body('merchantId').isUUID(),
  body('customerId').isUUID(),
  body('orderAmount').isFloat({ min: 0 }),
  body('items').isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/apply`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get campaign analytics
router.get('/:id/analytics',
  authMiddleware,
  checkPermission('campaigns', 'read'),
  param('id').isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('metrics').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/analytics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get campaign usage
router.get('/:id/usage',
  authMiddleware,
  checkPermission('campaigns', 'read'),
  param('id').isUUID(),
  paginationValidation,
  query('customerId').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/usage`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get eligible campaigns for customer
router.get('/eligible',
  query('merchantId').isUUID(),
  query('customerId').optional().isUUID(),
  query('orderAmount').optional().isFloat({ min: 0 }),
  query('items').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.campaigns.url}/campaigns/eligible`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create A/B test
router.post('/:id/ab-test',
  authMiddleware,
  checkPermission('campaigns', 'create'),
  param('id').isUUID(),
  body('variants').isArray(),
  body('variants.*.name').notEmpty(),
  body('variants.*.weight').isFloat({ min: 0, max: 1 }),
  body('variants.*.rules').isObject(),
  body('testDuration').optional().isInt({ min: 1 }),
  body('successMetric').isIn(['conversion_rate', 'revenue', 'usage_count']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.campaigns.url}/campaigns/${req.params.id}/ab-test`,
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

// Get campaign templates
router.get('/templates',
  authMiddleware,
  query('type').optional().isIn(['discount', 'bogo', 'freebie', 'bundle', 'loyalty', 'flash_sale']),
  query('category').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.campaigns.url}/campaigns/templates`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const campaignsRoutes = router;