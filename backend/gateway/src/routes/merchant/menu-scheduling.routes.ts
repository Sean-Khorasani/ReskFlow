/**
 * Menu Scheduling Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get menu schedules
router.get('/',
  authMiddleware,
  checkPermission('menu', 'read'),
  paginationValidation,
  query('merchantId').isUUID(),
  query('status').optional().isIn(['active', 'scheduled', 'expired', 'draft']),
  query('type').optional().isIn(['time_based', 'seasonal', 'event', 'limited_time']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.menuScheduling.url}/menu-schedules`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get schedule details
router.get('/:id',
  authMiddleware,
  checkPermission('menu', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create menu schedule
router.post('/',
  authMiddleware,
  checkPermission('menu', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('description').optional().trim(),
  body('type').isIn(['time_based', 'seasonal', 'event', 'limited_time']),
  body('startDate').isISO8601(),
  body('endDate').optional().isISO8601(),
  body('recurrence').optional().isObject(),
  body('recurrence.frequency').optional().isIn(['daily', 'weekly', 'monthly']),
  body('recurrence.daysOfWeek').optional().isArray(),
  body('recurrence.timeSlots').optional().isArray(),
  body('recurrence.timeSlots.*.startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('recurrence.timeSlots.*.endTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('menuChanges').isObject(),
  body('menuChanges.addItems').optional().isArray(),
  body('menuChanges.removeItems').optional().isArray(),
  body('menuChanges.priceOverrides').optional().isArray(),
  body('menuChanges.availabilityOverrides').optional().isArray(),
  body('priority').optional().isInt({ min: 1, max: 10 }),
  body('autoActivate').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules`,
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

// Update menu schedule
router.put('/:id',
  authMiddleware,
  checkPermission('menu', 'update'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('description').optional().trim(),
  body('startDate').optional().isISO8601(),
  body('endDate').optional().isISO8601(),
  body('recurrence').optional().isObject(),
  body('menuChanges').optional().isObject(),
  body('priority').optional().isInt({ min: 1, max: 10 }),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}`,
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

// Delete menu schedule
router.delete('/:id',
  authMiddleware,
  checkPermission('menu', 'delete'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Activate schedule
router.post('/:id/activate',
  authMiddleware,
  checkPermission('menu', 'update'),
  param('id').isUUID(),
  body('force').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}/activate`,
        body: {
          activatedBy: req.user!.id,
          force: req.body.force
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Deactivate schedule
router.post('/:id/deactivate',
  authMiddleware,
  checkPermission('menu', 'update'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}/deactivate`,
        body: {
          deactivatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Preview schedule changes
router.post('/:id/preview',
  authMiddleware,
  checkPermission('menu', 'read'),
  param('id').isUUID(),
  body('date').optional().isISO8601(),
  body('time').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}/preview`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get active schedules
router.get('/active',
  authMiddleware,
  checkPermission('menu', 'read'),
  query('merchantId').isUUID(),
  query('date').optional().isISO8601(),
  query('time').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.menuScheduling.url}/menu-schedules/active`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get schedule conflicts
router.get('/conflicts',
  authMiddleware,
  checkPermission('menu', 'read'),
  query('merchantId').isUUID(),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('scheduleId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.menuScheduling.url}/menu-schedules/conflicts`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create time-based menu
router.post('/time-based',
  authMiddleware,
  checkPermission('menu', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('menus').isArray(),
  body('menus.*.name').notEmpty(),
  body('menus.*.startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('menus.*.endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('menus.*.daysOfWeek').isArray(),
  body('menus.*.items').isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules/time-based`,
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

// Create seasonal menu
router.post('/seasonal',
  authMiddleware,
  checkPermission('menu', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('season').isIn(['spring', 'summer', 'fall', 'winter', 'holiday', 'custom']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('items').isArray(),
  body('autoRepeat').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules/seasonal`,
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

// Get schedule history
router.get('/:id/history',
  authMiddleware,
  checkPermission('menu', 'read'),
  param('id').isUUID(),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}/history`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Clone schedule
router.post('/:id/clone',
  authMiddleware,
  checkPermission('menu', 'create'),
  param('id').isUUID(),
  body('name').notEmpty().trim(),
  body('startDate').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.menuScheduling.url}/menu-schedules/${req.params.id}/clone`,
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

export const menuSchedulingRoutes = router;