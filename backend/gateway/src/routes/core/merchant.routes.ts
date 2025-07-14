/**
 * Merchant Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get merchant list (public)
router.get('/',
  paginationValidation,
  query('category').optional().isString(),
  query('cuisine').optional().isString(),
  query('search').optional().isString(),
  query('latitude').optional().isFloat({ min: -90, max: 90 }),
  query('longitude').optional().isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 50 }),
  query('isOpen').optional().isBoolean(),
  query('rating').optional().isFloat({ min: 0, max: 5 }),
  query('priceRange').optional().isIn(['$', '$$', '$$$', '$$$$']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.merchant.url}/merchants`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant details (public)
router.get('/:id',
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.merchant.url}/merchants/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant menu (public)
router.get('/:id/menu',
  param('id').isUUID(),
  query('category').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/menu`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create merchant (admin only)
router.post('/',
  authMiddleware,
  authorize('ADMIN'),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('category').notEmpty(),
  body('cuisine').optional().isArray(),
  body('address').isObject(),
  body('address.street').notEmpty(),
  body('address.city').notEmpty(),
  body('address.state').notEmpty(),
  body('address.postalCode').notEmpty(),
  body('address.latitude').isFloat({ min: -90, max: 90 }),
  body('address.longitude').isFloat({ min: -180, max: 180 }),
  body('phone').isMobilePhone(),
  body('email').isEmail(),
  body('hours').isArray(),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('reskflowFee').optional().isFloat({ min: 0 }),
  body('reskflowRadius').optional().isFloat({ min: 0.1, max: 50 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.merchant.url}/merchants`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update merchant
router.put('/:id',
  authMiddleware,
  checkPermission('merchant', 'update'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('description').optional().trim(),
  body('category').optional(),
  body('cuisine').optional().isArray(),
  body('phone').optional().isMobilePhone(),
  body('hours').optional().isArray(),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('reskflowFee').optional().isFloat({ min: 0 }),
  body('reskflowRadius').optional().isFloat({ min: 0.1, max: 50 }),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.merchant.url}/merchants/${req.params.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Upload merchant logo
router.post('/:id/logo',
  authMiddleware,
  checkPermission('merchant', 'update'),
  param('id').isUUID(),
  body('logo').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/logo`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add menu item
router.post('/:id/menu/items',
  authMiddleware,
  checkPermission('menu', 'create'),
  param('id').isUUID(),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('price').isFloat({ min: 0 }),
  body('category').notEmpty(),
  body('images').optional().isArray(),
  body('ingredients').optional().isArray(),
  body('allergens').optional().isArray(),
  body('nutritionInfo').optional().isObject(),
  body('preparationTime').optional().isInt({ min: 1 }),
  body('isAvailable').optional().isBoolean(),
  body('isVegetarian').optional().isBoolean(),
  body('isVegan').optional().isBoolean(),
  body('isGlutenFree').optional().isBoolean(),
  body('spiceLevel').optional().isIn([0, 1, 2, 3, 4]),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/menu/items`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update menu item
router.put('/:id/menu/items/:itemId',
  authMiddleware,
  checkPermission('menu', 'update'),
  param('id').isUUID(),
  param('itemId').isUUID(),
  body('name').optional().trim(),
  body('description').optional().trim(),
  body('price').optional().isFloat({ min: 0 }),
  body('category').optional(),
  body('isAvailable').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/menu/items/${req.params.itemId}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Delete menu item
router.delete('/:id/menu/items/:itemId',
  authMiddleware,
  checkPermission('menu', 'delete'),
  param('id').isUUID(),
  param('itemId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/menu/items/${req.params.itemId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant orders
router.get('/:id/orders',
  authMiddleware,
  checkPermission('order', 'read'),
  param('id').isUUID(),
  paginationValidation,
  query('status').optional().isIn(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']),
  query('date').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/orders`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant statistics
router.get('/:id/statistics',
  authMiddleware,
  checkPermission('analytics', 'read'),
  param('id').isUUID(),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/statistics`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant reviews
router.get('/:id/reviews',
  param('id').isUUID(),
  paginationValidation,
  query('rating').optional().isInt({ min: 1, max: 5 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/reviews`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Toggle merchant availability
router.put('/:id/availability',
  authMiddleware,
  checkPermission('merchant', 'update'),
  param('id').isUUID(),
  body('isOpen').isBoolean(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.merchant.url}/merchants/${req.params.id}/availability`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get merchant payouts
router.get('/:id/payouts',
  authMiddleware,
  checkPermission('payment', 'read'),
  param('id').isUUID(),
  paginationValidation,
  query('status').optional().isIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.payment.url}/merchants/${req.params.id}/payouts`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const merchantRoutes = router;