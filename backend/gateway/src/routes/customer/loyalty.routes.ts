/**
 * Loyalty Program Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get loyalty program details
router.get('/program',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.loyalty}/program`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user's loyalty status
router.get('/status/:userId',
  authMiddleware,
  param('userId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.loyalty}/users/${req.params.userId}/status`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get point transactions
router.get('/transactions/:userId',
  authMiddleware,
  param('userId').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.loyalty}/users/${req.params.userId}/transactions`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Award points
router.post('/points/award',
  authMiddleware,
  body('userId').isUUID(),
  body('points').isInt({ min: 1 }),
  body('source').isString(),
  body('description').isString(),
  body('metadata').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.loyalty}/points/award`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get available rewards
router.get('/rewards',
  authMiddleware,
  query('tier').optional().isIn(['bronze', 'silver', 'gold', 'platinum']),
  query('category').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.loyalty}/rewards`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Redeem reward
router.post('/rewards/redeem',
  authMiddleware,
  body('userId').isUUID(),
  body('rewardId').isUUID(),
  body('metadata').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.loyalty}/rewards/redeem`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get tier benefits
router.get('/tiers/:tier/benefits',
  authMiddleware,
  param('tier').isIn(['bronze', 'silver', 'gold', 'platinum']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.loyalty}/tiers/${req.params.tier}/benefits`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get redemption history
router.get('/redemptions/:userId',
  authMiddleware,
  param('userId').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.loyalty}/users/${req.params.userId}/redemptions`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const loyaltyRoutes = router;