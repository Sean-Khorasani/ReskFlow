/**
 * Dietary Preferences Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get user dietary preferences
router.get('/preferences',
  authMiddleware,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/preferences/${req.user!.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update dietary preferences
router.put('/preferences',
  authMiddleware,
  body('restrictions').optional().isArray(),
  body('restrictions.*').isIn(['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'nut_free', 'shellfish_free', 'kosher', 'halal', 'low_sodium', 'low_sugar']),
  body('allergies').optional().isArray(),
  body('allergies.*.allergen').notEmpty(),
  body('allergies.*.severity').isIn(['mild', 'moderate', 'severe', 'life_threatening']),
  body('preferences').optional().isArray(),
  body('preferences.*').isString(),
  body('calorieTarget').optional().isObject(),
  body('calorieTarget.daily').optional().isInt({ min: 500, max: 5000 }),
  body('calorieTarget.perMeal').optional().isInt({ min: 100, max: 2000 }),
  body('nutritionGoals').optional().isObject(),
  body('nutritionGoals.protein').optional().isInt({ min: 0 }),
  body('nutritionGoals.carbs').optional().isInt({ min: 0 }),
  body('nutritionGoals.fat').optional().isInt({ min: 0 }),
  body('nutritionGoals.fiber').optional().isInt({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.dietary.url}/dietary/preferences/${req.user!.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Filter menu items by dietary preferences
router.post('/filter',
  authMiddleware,
  body('merchantId').isUUID(),
  body('menuItems').optional().isArray(),
  body('menuItems.*').isUUID(),
  body('useUserPreferences').optional().isBoolean(),
  body('restrictions').optional().isArray(),
  body('allergies').optional().isArray(),
  body('maxCalories').optional().isInt({ min: 0 }),
  body('nutritionFilters').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/filter`,
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

// Check item compatibility
router.post('/check-item',
  authMiddleware,
  body('menuItemId').isUUID(),
  body('customizations').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/check-item`,
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

// Get nutrition info
router.get('/nutrition/:menuItemId',
  param('menuItemId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/nutrition/${req.params.menuItemId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get meal suggestions
router.get('/suggestions',
  authMiddleware,
  query('merchantId').optional().isUUID(),
  query('mealType').optional().isIn(['breakfast', 'lunch', 'dinner', 'snack']),
  query('maxCalories').optional().isInt({ min: 0 }),
  query('priceRange').optional().isIn(['$', '$$', '$$$', '$$$$']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/suggestions`,
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

// Track nutrition
router.post('/track',
  authMiddleware,
  body('orderId').isUUID(),
  body('items').isArray(),
  body('items.*.menuItemId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.customizations').optional().isObject(),
  body('mealType').optional().isIn(['breakfast', 'lunch', 'dinner', 'snack']),
  body('consumedAt').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/track`,
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

// Get nutrition history
router.get('/history',
  authMiddleware,
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('groupBy').optional().isIn(['day', 'week', 'month']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/history/${req.user!.id}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get allergen warnings
router.post('/allergen-check',
  authMiddleware,
  body('items').isArray(),
  body('items.*.menuItemId').isUUID(),
  body('items.*.customizations').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/allergen-check`,
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

// Get dietary badges
router.get('/badges/:merchantId',
  param('merchantId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/badges/${req.params.merchantId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Save meal plan
router.post('/meal-plans',
  authMiddleware,
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('meals').isArray(),
  body('meals.*.dayOfWeek').isInt({ min: 0, max: 6 }),
  body('meals.*.mealType').isIn(['breakfast', 'lunch', 'dinner', 'snack']),
  body('meals.*.items').isArray(),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/meal-plans`,
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

// Get meal plans
router.get('/meal-plans',
  authMiddleware,
  query('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/meal-plans/${req.user!.id}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get dietary recommendations
router.get('/recommendations',
  authMiddleware,
  query('context').optional().isIn(['weight_loss', 'muscle_gain', 'maintenance', 'health']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.dietary.url}/dietary/recommendations`,
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

// Calculate meal nutrition
router.post('/calculate',
  body('items').isArray(),
  body('items.*.menuItemId').isUUID(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.customizations').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/calculate`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Generate nutrition report
router.post('/report',
  authMiddleware,
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').optional().isIn(['pdf', 'csv', 'json']),
  body('includeRecommendations').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.dietary.url}/dietary/report`,
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

export const dietaryRoutes = router;