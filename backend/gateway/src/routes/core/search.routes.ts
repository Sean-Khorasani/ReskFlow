/**
 * Search Routes
 */

import { Router } from 'express';
import { query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { optionalAuthMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Global search
router.get('/',
  optionalAuthMiddleware,
  query('q').notEmpty().trim(),
  query('type').optional().isIn(['all', 'merchants', 'items', 'cuisines']),
  query('latitude').optional().isFloat({ min: -90, max: 90 }),
  query('longitude').optional().isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 50 }),
  query('filters').optional().isObject(),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search`,
        query: {
          ...req.query,
          userId: req.user?.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Search suggestions
router.get('/suggestions',
  query('q').notEmpty().trim(),
  query('type').optional().isIn(['merchants', 'items', 'cuisines']),
  query('limit').optional().isInt({ min: 1, max: 20 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search/suggestions`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Trending searches
router.get('/trending',
  query('latitude').optional().isFloat({ min: -90, max: 90 }),
  query('longitude').optional().isFloat({ min: -180, max: 180 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search/trending`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Search history (authenticated users)
router.get('/history',
  optionalAuthMiddleware,
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      if (!req.user) {
        res.json({ searches: [] });
        return;
      }
      
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search/history/${req.user.id}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Clear search history
router.delete('/history',
  optionalAuthMiddleware,
  async (req, res, next) => {
    try {
      if (!req.user) {
        res.json({ success: true });
        return;
      }
      
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.search.url}/search/history/${req.user.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Popular searches by category
router.get('/popular/:category',
  query('latitude').optional().isFloat({ min: -90, max: 90 }),
  query('longitude').optional().isFloat({ min: -180, max: 180 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search/popular/${req.params.category}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Nearby search
router.get('/nearby',
  query('latitude').isFloat({ min: -90, max: 90 }),
  query('longitude').isFloat({ min: -180, max: 180 }),
  query('type').optional().isIn(['merchants', 'cuisines', 'popular']),
  query('radius').optional().isFloat({ min: 0.1, max: 10 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search/nearby`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Advanced filters
router.get('/filters',
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.search.url}/search/filters`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const searchRoutes = router;