/**
 * Driver Earnings Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, dateRangeValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get earnings overview
router.get('/overview',
  authMiddleware,
  authorize('DRIVER'),
  query('period').optional().isIn(['today', 'week', 'month', 'year', 'custom']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/overview`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get detailed earnings
router.get('/details',
  authMiddleware,
  authorize('DRIVER'),
  dateRangeValidation,
  query('groupBy').optional().isIn(['day', 'week', 'month']),
  query('includeBreakdown').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/details`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get reskflow earnings
router.get('/deliveries',
  authMiddleware,
  authorize('DRIVER'),
  dateRangeValidation,
  query('status').optional().isIn(['completed', 'cancelled', 'all']),
  query('sortBy').optional().isIn(['date', 'amount', 'distance']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/deliveries`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get earnings by reskflow
router.get('/reskflow/:reskflowId',
  authMiddleware,
  authorize('DRIVER'),
  param('reskflowId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/reskflow/${req.params.reskflowId}`,
        query: {
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get tips report
router.get('/tips',
  authMiddleware,
  authorize('DRIVER'),
  dateRangeValidation,
  query('groupBy').optional().isIn(['day', 'week', 'month']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/tips`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get bonuses and incentives
router.get('/bonuses',
  authMiddleware,
  authorize('DRIVER'),
  dateRangeValidation,
  query('type').optional().isIn(['completion', 'peak_hours', 'referral', 'milestone']),
  query('status').optional().isIn(['earned', 'pending', 'paid']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/bonuses`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get active incentives
router.get('/incentives/active',
  authMiddleware,
  authorize('DRIVER'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/incentives/active`,
        query: {
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get payout history
router.get('/payouts',
  authMiddleware,
  authorize('DRIVER'),
  dateRangeValidation,
  query('status').optional().isIn(['pending', 'processing', 'completed', 'failed']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/payouts`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Request payout
router.post('/payouts/request',
  authMiddleware,
  authorize('DRIVER'),
  body('amount').optional().isFloat({ min: 1 }),
  body('payoutMethodId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.earnings.url}/earnings/payouts/request`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get payout methods
router.get('/payout-methods',
  authMiddleware,
  authorize('DRIVER'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/payout-methods`,
        query: {
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add payout method
router.post('/payout-methods',
  authMiddleware,
  authorize('DRIVER'),
  body('type').isIn(['bank_account', 'debit_card', 'paypal']),
  body('details').isObject(),
  body('isDefault').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.earnings.url}/earnings/payout-methods`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get earnings goals
router.get('/goals',
  authMiddleware,
  authorize('DRIVER'),
  query('period').optional().isIn(['daily', 'weekly', 'monthly']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/goals`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Set earnings goal
router.post('/goals',
  authMiddleware,
  authorize('DRIVER'),
  body('period').isIn(['daily', 'weekly', 'monthly']),
  body('targetAmount').isFloat({ min: 0 }),
  body('startDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.earnings.url}/earnings/goals`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get earnings analytics
router.get('/analytics',
  authMiddleware,
  authorize('DRIVER'),
  dateRangeValidation,
  query('metrics').optional().isArray(),
  query('compareWith').optional().isIn(['previous_period', 'last_year']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/analytics`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get tax documents
router.get('/tax-documents',
  authMiddleware,
  authorize('DRIVER'),
  query('year').isInt({ min: 2020 }),
  query('type').optional().isIn(['1099', 'summary', 'detailed']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.earnings.url}/earnings/tax-documents`,
        query: {
          ...req.query,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Download earnings report
router.post('/report',
  authMiddleware,
  authorize('DRIVER'),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['pdf', 'csv', 'excel']),
  body('includeDetails').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.earnings.url}/earnings/report`,
        body: {
          ...req.body,
          driverId: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const earningsRoutes = router;