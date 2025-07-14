/**
 * Favorites Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Add to favorites
router.post('/',
  authMiddleware,
  body('type').isIn(['merchant', 'item', 'order']),
  body('targetId').isUUID(),
  body('notes').optional().isString(),
  body('tags').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.favorites.url}/favorites`,
        body: {
          ...req.body,
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

// Get favorites
router.get('/',
  authMiddleware,
  paginationValidation,
  query('type').optional().isIn(['merchant', 'item', 'order']),
  query('tags').optional().isArray(),
  query('sortBy').optional().isIn(['addedAt', 'name', 'frequency']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites`,
        query: {
          ...req.query,
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

// Remove from favorites
router.delete('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.favorites.url}/favorites/${req.params.id}`,
        body: {
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

// Check if favorited
router.get('/check',
  authMiddleware,
  query('type').isIn(['merchant', 'item', 'order']),
  query('targetId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/check`,
        query: {
          ...req.query,
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

// Get favorite merchants
router.get('/merchants',
  authMiddleware,
  paginationValidation,
  query('latitude').optional().isFloat({ min: -90, max: 90 }),
  query('longitude').optional().isFloat({ min: -180, max: 180 }),
  query('isOpen').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/merchants`,
        query: {
          ...req.query,
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

// Get favorite items
router.get('/items',
  authMiddleware,
  paginationValidation,
  query('merchantId').optional().isUUID(),
  query('isAvailable').optional().isBoolean(),
  query('category').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/items`,
        query: {
          ...req.query,
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

// Get favorite orders (reorder)
router.get('/orders',
  authMiddleware,
  paginationValidation,
  query('merchantId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/orders`,
        query: {
          ...req.query,
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

// Update favorite
router.put('/:id',
  authMiddleware,
  param('id').isUUID(),
  body('notes').optional().isString(),
  body('tags').optional().isArray(),
  body('customName').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.favorites.url}/favorites/${req.params.id}`,
        body: {
          ...req.body,
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

// Create favorite list
router.post('/lists',
  authMiddleware,
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('isPublic').optional().isBoolean(),
  body('items').optional().isArray(),
  body('items.*.type').optional().isIn(['merchant', 'item']),
  body('items.*.targetId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.favorites.url}/favorites/lists`,
        body: {
          ...req.body,
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

// Get favorite lists
router.get('/lists',
  authMiddleware,
  paginationValidation,
  query('includeShared').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/lists`,
        query: {
          ...req.query,
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

// Add to favorite list
router.post('/lists/:listId/items',
  authMiddleware,
  param('listId').isUUID(),
  body('type').isIn(['merchant', 'item']),
  body('targetId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.favorites.url}/favorites/lists/${req.params.listId}/items`,
        body: {
          ...req.body,
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

// Share favorite list
router.post('/lists/:listId/share',
  authMiddleware,
  param('listId').isUUID(),
  body('userIds').optional().isArray(),
  body('emails').optional().isArray(),
  body('message').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.favorites.url}/favorites/lists/${req.params.listId}/share`,
        body: {
          ...req.body,
          sharedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get suggested favorites
router.get('/suggestions',
  authMiddleware,
  query('type').optional().isIn(['merchant', 'item']),
  query('basedOn').optional().isIn(['history', 'similar', 'trending']),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/suggestions`,
        query: {
          ...req.query,
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

// Import favorites from another platform
router.post('/import',
  authMiddleware,
  body('platform').isIn(['ubereats', 'doordash', 'grubhub', 'postmates']),
  body('data').isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.favorites.url}/favorites/import`,
        body: {
          ...req.body,
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

// Export favorites
router.get('/export',
  authMiddleware,
  query('format').optional().isIn(['json', 'csv']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.favorites.url}/favorites/export`,
        query: {
          ...req.query,
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

export const favoritesRoutes = router;