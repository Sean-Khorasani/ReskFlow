/**
 * Driver Emergency Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Trigger emergency alert
router.post('/alert',
  authMiddleware,
  authorize('DRIVER'),
  body('type').isIn(['accident', 'medical', 'security', 'vehicle_breakdown', 'natural_disaster', 'other']),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('location.accuracy').optional().isFloat({ min: 0 }),
  body('description').optional().isString(),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('reskflowId').optional().isUUID(),
  body('vehicleId').optional().isUUID(),
  body('requiresAmbulance').optional().isBoolean(),
  body('requiresPolice').optional().isBoolean(),
  body('requiresTowing').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.emergency.url}/emergency/alert`,
        body: {
          ...req.body,
          driverId: req.user!.id,
          timestamp: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update emergency status
router.put('/alert/:alertId',
  authMiddleware,
  param('alertId').isUUID(),
  body('status').optional().isIn(['active', 'responding', 'resolved', 'cancelled']),
  body('currentLocation').optional().isObject(),
  body('additionalInfo').optional().isString(),
  body('photos').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.emergency.url}/emergency/alert/${req.params.alertId}`,
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

// Cancel emergency alert
router.post('/alert/:alertId/cancel',
  authMiddleware,
  authorize('DRIVER'),
  param('alertId').isUUID(),
  body('reason').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.emergency.url}/emergency/alert/${req.params.alertId}/cancel`,
        body: {
          reason: req.body.reason,
          cancelledBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get active emergencies
router.get('/active',
  authMiddleware,
  query('radius').optional().isFloat({ min: 0.1, max: 100 }),
  query('latitude').optional().isFloat({ min: -90, max: 90 }),
  query('longitude').optional().isFloat({ min: -180, max: 180 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/active`,
        query: {
          ...req.query,
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

// Get emergency contacts
router.get('/contacts',
  authMiddleware,
  authorize('DRIVER'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/contacts`,
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

// Update emergency contacts
router.put('/contacts',
  authMiddleware,
  authorize('DRIVER'),
  body('contacts').isArray(),
  body('contacts.*.name').notEmpty(),
  body('contacts.*.phone').isMobilePhone(),
  body('contacts.*.relationship').notEmpty(),
  body('contacts.*.isPrimary').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.emergency.url}/emergency/contacts`,
        body: {
          contacts: req.body.contacts,
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

// Send check-in
router.post('/check-in',
  authMiddleware,
  authorize('DRIVER'),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('status').isIn(['safe', 'need_assistance', 'delayed']),
  body('message').optional().isString(),
  body('estimatedDelay').optional().isInt({ min: 1 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.emergency.url}/emergency/check-in`,
        body: {
          ...req.body,
          driverId: req.user!.id,
          timestamp: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get nearby safe zones
router.get('/safe-zones',
  authMiddleware,
  query('latitude').isFloat({ min: -90, max: 90 }),
  query('longitude').isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 50 }),
  query('type').optional().isIn(['police_station', 'hospital', 'fire_station', 'rest_area', 'gas_station']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/safe-zones`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Report incident
router.post('/incident',
  authMiddleware,
  authorize('DRIVER'),
  body('type').isIn(['accident', 'theft', 'assault', 'harassment', 'property_damage', 'other']),
  body('location').isObject(),
  body('occurredAt').isISO8601(),
  body('description').notEmpty(),
  body('involvedParties').optional().isArray(),
  body('witnesses').optional().isArray(),
  body('policeReportNumber').optional().isString(),
  body('insuranceClaimNumber').optional().isString(),
  body('photos').optional().isArray(),
  body('documents').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.emergency.url}/emergency/incident`,
        body: {
          ...req.body,
          reportedBy: req.user!.id,
          reportedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get incident reports
router.get('/incidents',
  authMiddleware,
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('type').optional().isString(),
  query('status').optional().isIn(['reported', 'investigating', 'resolved', 'closed']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/incidents`,
        query: {
          ...req.query,
          driverId: req.user!.role === 'DRIVER' ? req.user!.id : undefined
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get emergency procedures
router.get('/procedures/:type',
  authMiddleware,
  param('type').isIn(['accident', 'medical', 'security', 'vehicle_breakdown', 'natural_disaster']),
  query('language').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/procedures/${req.params.type}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Activate panic mode
router.post('/panic',
  authMiddleware,
  authorize('DRIVER'),
  body('location').isObject(),
  body('location.latitude').isFloat({ min: -90, max: 90 }),
  body('location.longitude').isFloat({ min: -180, max: 180 }),
  body('silentMode').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.emergency.url}/emergency/panic`,
        body: {
          ...req.body,
          driverId: req.user!.id,
          activatedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get emergency statistics
router.get('/statistics',
  authMiddleware,
  query('period').optional().isIn(['week', 'month', 'quarter', 'year']),
  query('groupBy').optional().isIn(['type', 'severity', 'location', 'time']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/statistics`,
        query: {
          ...req.query,
          driverId: req.user!.role === 'DRIVER' ? req.user!.id : undefined
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Request emergency assistance
router.post('/assistance',
  authMiddleware,
  authorize('DRIVER'),
  body('type').isIn(['towing', 'jump_start', 'flat_tire', 'fuel_reskflow', 'lockout']),
  body('location').isObject(),
  body('vehicleInfo').isObject(),
  body('description').optional().isString(),
  body('estimatedWaitTime').optional().isInt({ min: 1 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.emergency.url}/emergency/assistance`,
        body: {
          ...req.body,
          driverId: req.user!.id,
          requestedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get emergency kit checklist
router.get('/kit-checklist',
  authMiddleware,
  query('vehicleType').optional().isIn(['car', 'van', 'truck', 'motorcycle', 'bicycle']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.emergency.url}/emergency/kit-checklist`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const emergencyRoutes = router;