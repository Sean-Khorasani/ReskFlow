/**
 * Multi-Location Management Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get all locations
router.get('/',
  authMiddleware,
  checkPermission('locations', 'read'),
  paginationValidation,
  query('merchantId').isUUID(),
  query('status').optional().isIn(['active', 'inactive', 'pending', 'suspended']),
  query('city').optional().isString(),
  query('state').optional().isString(),
  query('search').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get location details
router.get('/:id',
  authMiddleware,
  checkPermission('locations', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create new location
router.post('/',
  authMiddleware,
  checkPermission('locations', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('address').isObject(),
  body('address.street').notEmpty(),
  body('address.city').notEmpty(),
  body('address.state').notEmpty(),
  body('address.postalCode').notEmpty(),
  body('address.country').notEmpty(),
  body('address.latitude').isFloat({ min: -90, max: 90 }),
  body('address.longitude').isFloat({ min: -180, max: 180 }),
  body('phone').isMobilePhone(),
  body('email').isEmail(),
  body('hours').isArray(),
  body('manager').isObject(),
  body('manager.name').notEmpty(),
  body('manager.email').isEmail(),
  body('manager.phone').isMobilePhone(),
  body('features').optional().isObject(),
  body('features.hasDelivery').optional().isBoolean(),
  body('features.hasPickup').optional().isBoolean(),
  body('features.hasDineIn').optional().isBoolean(),
  body('features.hasDriveThru').optional().isBoolean(),
  body('reskflowRadius').optional().isFloat({ min: 0.1, max: 50 }),
  body('minOrderAmount').optional().isFloat({ min: 0 }),
  body('preparationTime').optional().isInt({ min: 1 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.multiLocation.url}/locations`,
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

// Update location
router.put('/:id',
  authMiddleware,
  checkPermission('locations', 'update'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('address').optional().isObject(),
  body('phone').optional().isMobilePhone(),
  body('email').optional().isEmail(),
  body('hours').optional().isArray(),
  body('manager').optional().isObject(),
  body('features').optional().isObject(),
  body('status').optional().isIn(['active', 'inactive', 'suspended']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}`,
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

// Update location status
router.put('/:id/status',
  authMiddleware,
  checkPermission('locations', 'update'),
  param('id').isUUID(),
  body('status').isIn(['active', 'inactive', 'suspended']),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/status`,
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

// Get location performance
router.get('/:id/performance',
  authMiddleware,
  checkPermission('locations', 'read'),
  param('id').isUUID(),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('metrics').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/performance`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Compare locations
router.get('/compare',
  authMiddleware,
  checkPermission('locations', 'read'),
  query('locationIds').isArray(),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('metrics').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations/compare`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Manage location staff
router.get('/:id/staff',
  authMiddleware,
  checkPermission('locations', 'read'),
  param('id').isUUID(),
  paginationValidation,
  query('role').optional().isString(),
  query('status').optional().isIn(['active', 'inactive']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/staff`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add staff to location
router.post('/:id/staff',
  authMiddleware,
  checkPermission('locations', 'update'),
  param('id').isUUID(),
  body('userId').isUUID(),
  body('role').notEmpty(),
  body('permissions').optional().isArray(),
  body('startDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/staff`,
        body: {
          ...req.body,
          addedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Transfer staff between locations
router.post('/staff/transfer',
  authMiddleware,
  checkPermission('locations', 'update'),
  body('staffId').isUUID(),
  body('fromLocationId').isUUID(),
  body('toLocationId').isUUID(),
  body('effectiveDate').isISO8601(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.multiLocation.url}/locations/staff/transfer`,
        body: {
          ...req.body,
          transferredBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Sync menu across locations
router.post('/menu/sync',
  authMiddleware,
  checkPermission('locations', 'update'),
  body('sourceLocationId').isUUID(),
  body('targetLocationIds').isArray(),
  body('syncOptions').isObject(),
  body('syncOptions.items').optional().isBoolean(),
  body('syncOptions.prices').optional().isBoolean(),
  body('syncOptions.availability').optional().isBoolean(),
  body('syncOptions.categories').optional().isBoolean(),
  body('syncOptions.modifiers').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.multiLocation.url}/locations/menu/sync`,
        body: {
          ...req.body,
          syncedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get location inventory
router.get('/:id/inventory',
  authMiddleware,
  checkPermission('locations', 'read'),
  param('id').isUUID(),
  paginationValidation,
  query('category').optional().isString(),
  query('lowStock').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/inventory`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Transfer inventory between locations
router.post('/inventory/transfer',
  authMiddleware,
  checkPermission('locations', 'update'),
  body('fromLocationId').isUUID(),
  body('toLocationId').isUUID(),
  body('items').isArray(),
  body('items.*.inventoryId').isUUID(),
  body('items.*.quantity').isFloat({ min: 0 }),
  body('transferDate').optional().isISO8601(),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.multiLocation.url}/locations/inventory/transfer`,
        body: {
          ...req.body,
          transferredBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get location settings
router.get('/:id/settings',
  authMiddleware,
  checkPermission('locations', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/settings`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update location settings
router.put('/:id/settings',
  authMiddleware,
  checkPermission('locations', 'update'),
  param('id').isUUID(),
  body('orderSettings').optional().isObject(),
  body('reskflowSettings').optional().isObject(),
  body('paymentSettings').optional().isObject(),
  body('notificationSettings').optional().isObject(),
  body('taxSettings').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.multiLocation.url}/locations/${req.params.id}/settings`,
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

// Generate location report
router.post('/report',
  authMiddleware,
  checkPermission('locations', 'read'),
  body('locationIds').optional().isArray(),
  body('type').isIn(['performance', 'comparison', 'inventory', 'staff', 'financial']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['pdf', 'excel', 'csv']),
  body('metrics').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.multiLocation.url}/locations/report`,
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

export const multiLocationRoutes = router;