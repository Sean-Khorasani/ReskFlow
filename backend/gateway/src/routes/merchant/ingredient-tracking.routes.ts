/**
 * Ingredient Tracking Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get ingredients
router.get('/',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  paginationValidation,
  query('merchantId').isUUID(),
  query('category').optional().isString(),
  query('supplier').optional().isString(),
  query('search').optional().isString(),
  query('allergen').optional().isString(),
  query('isOrganic').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get ingredient details
router.get('/:id',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create ingredient
router.post('/',
  authMiddleware,
  checkPermission('ingredients', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('category').notEmpty(),
  body('unit').isIn(['g', 'kg', 'ml', 'l', 'piece', 'bunch', 'cup', 'tbsp', 'tsp']),
  body('suppliers').isArray(),
  body('suppliers.*.supplierId').isUUID(),
  body('suppliers.*.supplierCode').optional().isString(),
  body('suppliers.*.cost').optional().isFloat({ min: 0 }),
  body('nutritionalInfo').optional().isObject(),
  body('nutritionalInfo.calories').optional().isFloat({ min: 0 }),
  body('nutritionalInfo.protein').optional().isFloat({ min: 0 }),
  body('nutritionalInfo.carbs').optional().isFloat({ min: 0 }),
  body('nutritionalInfo.fat').optional().isFloat({ min: 0 }),
  body('nutritionalInfo.fiber').optional().isFloat({ min: 0 }),
  body('allergens').optional().isArray(),
  body('certifications').optional().isArray(),
  body('origin').optional().isString(),
  body('seasonality').optional().isObject(),
  body('shelfLife').optional().isInt({ min: 1 }),
  body('storageRequirements').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.ingredientTracking.url}/ingredients`,
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

// Update ingredient
router.put('/:id',
  authMiddleware,
  checkPermission('ingredients', 'update'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('category').optional(),
  body('suppliers').optional().isArray(),
  body('nutritionalInfo').optional().isObject(),
  body('allergens').optional().isArray(),
  body('certifications').optional().isArray(),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.ingredientTracking.url}/ingredients/${req.params.id}`,
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

// Track ingredient batch
router.post('/batches',
  authMiddleware,
  checkPermission('ingredients', 'create'),
  body('ingredientId').isUUID(),
  body('batchNumber').notEmpty(),
  body('supplierId').isUUID(),
  body('quantity').isFloat({ min: 0 }),
  body('unit').isString(),
  body('receivedDate').isISO8601(),
  body('expirationDate').optional().isISO8601(),
  body('cost').isFloat({ min: 0 }),
  body('qualityCheck').optional().isObject(),
  body('qualityCheck.passed').optional().isBoolean(),
  body('qualityCheck.notes').optional().isString(),
  body('qualityCheck.checkedBy').optional().isString(),
  body('documents').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.ingredientTracking.url}/ingredients/batches`,
        body: {
          ...req.body,
          trackedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get ingredient batches
router.get('/:ingredientId/batches',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  param('ingredientId').isUUID(),
  paginationValidation,
  query('status').optional().isIn(['active', 'expired', 'depleted']),
  query('supplierId').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients/${req.params.ingredientId}/batches`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Map ingredients to menu items
router.post('/menu-mapping',
  authMiddleware,
  checkPermission('ingredients', 'update'),
  body('menuItemId').isUUID(),
  body('ingredients').isArray(),
  body('ingredients.*.ingredientId').isUUID(),
  body('ingredients.*.quantity').isFloat({ min: 0 }),
  body('ingredients.*.unit').isString(),
  body('ingredients.*.isOptional').optional().isBoolean(),
  body('ingredients.*.canSubstitute').optional().isBoolean(),
  body('ingredients.*.substitutes').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.ingredientTracking.url}/ingredients/menu-mapping`,
        body: {
          ...req.body,
          mappedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get menu item ingredients
router.get('/menu-items/:menuItemId',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  param('menuItemId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients/menu-items/${req.params.menuItemId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Track ingredient usage
router.post('/usage',
  authMiddleware,
  checkPermission('ingredients', 'create'),
  body('orderId').isUUID(),
  body('items').isArray(),
  body('items.*.menuItemId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.customizations').optional().isObject(),
  body('timestamp').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.ingredientTracking.url}/ingredients/usage`,
        body: {
          ...req.body,
          trackedBy: req.user!.id,
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

// Get ingredient usage report
router.get('/usage/report',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  query('merchantId').isUUID(),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('ingredientId').optional().isUUID(),
  query('groupBy').optional().isIn(['day', 'week', 'month', 'ingredient', 'menuItem']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients/usage/report`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get allergen report
router.get('/allergens/report',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  query('merchantId').isUUID(),
  query('menuItemId').optional().isUUID(),
  query('includeTraces').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients/allergens/report`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Check ingredient availability
router.post('/check-availability',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  body('menuItems').isArray(),
  body('menuItems.*.menuItemId').isUUID(),
  body('menuItems.*.quantity').isInt({ min: 1 }),
  body('date').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.ingredientTracking.url}/ingredients/check-availability`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get cost analysis
router.get('/cost-analysis',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  query('merchantId').isUUID(),
  query('menuItemId').optional().isUUID(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('includeLabor').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.ingredientTracking.url}/ingredients/cost-analysis`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Set par levels
router.put('/par-levels',
  authMiddleware,
  checkPermission('ingredients', 'update'),
  body('ingredientId').isUUID(),
  body('parLevel').isFloat({ min: 0 }),
  body('reorderPoint').isFloat({ min: 0 }),
  body('maxLevel').optional().isFloat({ min: 0 }),
  body('unit').isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.ingredientTracking.url}/ingredients/par-levels`,
        body: {
          ...req.body,
          setBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Generate ingredient labels
router.post('/labels',
  authMiddleware,
  checkPermission('ingredients', 'read'),
  body('menuItemIds').isArray(),
  body('format').isIn(['pdf', 'html', 'json']),
  body('includeAllergens').optional().isBoolean(),
  body('includeNutrition').optional().isBoolean(),
  body('includeCertifications').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.ingredientTracking.url}/ingredients/labels`,
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

export const ingredientTrackingRoutes = router;