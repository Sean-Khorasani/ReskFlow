/**
 * Driver Shift Scheduling Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get shift schedule
router.get('/schedule',
  authMiddleware,
  authorize('DRIVER'),
  query('startDate').isISO8601(),
  query('endDate').isISO8601(),
  query('status').optional().isIn(['scheduled', 'active', 'completed', 'cancelled']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.shift.url}/shifts/schedule`,
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

// Get available shifts
router.get('/available',
  authMiddleware,
  authorize('DRIVER'),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('zone').optional().isString(),
  query('shiftType').optional().isIn(['regular', 'peak', 'overnight', 'weekend']),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.shift.url}/shifts/available`,
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

// Book shift
router.post('/book',
  authMiddleware,
  authorize('DRIVER'),
  body('shiftId').isUUID(),
  body('vehicleId').optional().isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/book`,
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

// Start shift
router.post('/:shiftId/start',
  authMiddleware,
  authorize('DRIVER'),
  param('shiftId').isUUID(),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('vehicleId').isUUID(),
  body('vehicleInspection').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/${req.params.shiftId}/start`,
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

// End shift
router.post('/:shiftId/end',
  authMiddleware,
  authorize('DRIVER'),
  param('shiftId').isUUID(),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('mileage').optional().isFloat({ min: 0 }),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/${req.params.shiftId}/end`,
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

// Take break
router.post('/:shiftId/break',
  authMiddleware,
  authorize('DRIVER'),
  param('shiftId').isUUID(),
  body('breakType').isIn(['rest', 'meal', 'personal']),
  body('duration').optional().isInt({ min: 5, max: 60 }), // minutes
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/${req.params.shiftId}/break`,
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

// End break
router.post('/:shiftId/resume',
  authMiddleware,
  authorize('DRIVER'),
  param('shiftId').isUUID(),
  body('location').optional().isObject(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/${req.params.shiftId}/resume`,
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

// Cancel shift
router.post('/:shiftId/cancel',
  authMiddleware,
  authorize('DRIVER'),
  param('shiftId').isUUID(),
  body('reason').notEmpty(),
  body('findReplacement').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/${req.params.shiftId}/cancel`,
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

// Swap shift
router.post('/:shiftId/swap',
  authMiddleware,
  authorize('DRIVER'),
  param('shiftId').isUUID(),
  body('targetDriverId').optional().isUUID(),
  body('targetShiftId').optional().isUUID(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/${req.params.shiftId}/swap`,
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

// Get shift preferences
router.get('/preferences',
  authMiddleware,
  authorize('DRIVER'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.shift.url}/shifts/preferences/${req.user!.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update shift preferences
router.put('/preferences',
  authMiddleware,
  authorize('DRIVER'),
  body('preferredDays').optional().isArray(),
  body('preferredTimes').optional().isArray(),
  body('preferredZones').optional().isArray(),
  body('maxHoursPerWeek').optional().isInt({ min: 1, max: 60 }),
  body('maxShiftsPerWeek').optional().isInt({ min: 1, max: 7 }),
  body('minShiftDuration').optional().isInt({ min: 1, max: 12 }),
  body('availableForEmergency').optional().isBoolean(),
  body('blackoutDates').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.shift.url}/shifts/preferences/${req.user!.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get shift history
router.get('/history',
  authMiddleware,
  authorize('DRIVER'),
  paginationValidation,
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('includeStats').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.shift.url}/shifts/history`,
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

// Get shift statistics
router.get('/statistics',
  authMiddleware,
  authorize('DRIVER'),
  query('period').isIn(['week', 'month', 'quarter', 'year']),
  query('compareWithPrevious').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.shift.url}/shifts/statistics`,
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

// Request time off
router.post('/time-off',
  authMiddleware,
  authorize('DRIVER'),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('type').isIn(['vacation', 'sick', 'personal', 'emergency']),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.shift.url}/shifts/time-off`,
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

// Get time off requests
router.get('/time-off',
  authMiddleware,
  authorize('DRIVER'),
  query('status').optional().isIn(['pending', 'approved', 'denied', 'cancelled']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.shift.url}/shifts/time-off`,
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

export const shiftRoutes = router;