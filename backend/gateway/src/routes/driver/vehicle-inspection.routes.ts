/**
 * Vehicle Inspection Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Create vehicle inspection
router.post('/',
  authMiddleware,
  authorize('DRIVER'),
  body('vehicleId').isUUID(),
  body('type').isIn(['pre_shift', 'post_shift', 'weekly', 'monthly', 'incident']),
  body('mileage').isInt({ min: 0 }),
  body('checklist').isObject(),
  body('checklist.exterior').isObject(),
  body('checklist.interior').isObject(),
  body('checklist.mechanical').isObject(),
  body('checklist.safety').isObject(),
  body('checklist.documents').isObject(),
  body('issues').optional().isArray(),
  body('issues.*.category').optional().isString(),
  body('issues.*.severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('issues.*.description').optional().isString(),
  body('issues.*.photos').optional().isArray(),
  body('photos').optional().isArray(),
  body('signature').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.vehicleInspection.url}/inspections`,
        body: {
          ...req.body,
          driverId: req.user!.id,
          inspectedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get inspection by ID
router.get('/:id',
  authMiddleware,
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get inspection history
router.get('/history',
  authMiddleware,
  authorize('DRIVER'),
  paginationValidation,
  query('vehicleId').optional().isUUID(),
  query('type').optional().isIn(['pre_shift', 'post_shift', 'weekly', 'monthly', 'incident']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('hasIssues').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/history`,
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

// Get pending inspections
router.get('/pending',
  authMiddleware,
  authorize('DRIVER'),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/pending`,
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

// Get inspection checklist template
router.get('/checklist/:vehicleType',
  authMiddleware,
  param('vehicleType').isIn(['car', 'van', 'truck', 'motorcycle', 'bicycle', 'scooter']),
  query('inspectionType').optional().isIn(['pre_shift', 'post_shift', 'weekly', 'monthly']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/checklist/${req.params.vehicleType}`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Report vehicle issue
router.post('/issues',
  authMiddleware,
  authorize('DRIVER'),
  body('vehicleId').isUUID(),
  body('category').isIn(['mechanical', 'electrical', 'body', 'interior', 'safety', 'other']),
  body('severity').isIn(['low', 'medium', 'high', 'critical']),
  body('description').notEmpty(),
  body('location').optional().isObject(),
  body('location.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('location.longitude').optional().isFloat({ min: -180, max: 180 }),
  body('photos').optional().isArray(),
  body('requiresImmediateAction').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.vehicleInspection.url}/inspections/issues`,
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

// Update issue status
router.put('/issues/:issueId',
  authMiddleware,
  param('issueId').isUUID(),
  body('status').optional().isIn(['reported', 'acknowledged', 'in_progress', 'resolved', 'deferred']),
  body('resolution').optional().isString(),
  body('resolvedBy').optional().isUUID(),
  body('resolvedAt').optional().isISO8601(),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.vehicleInspection.url}/inspections/issues/${req.params.issueId}`,
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

// Get vehicle issues
router.get('/issues',
  authMiddleware,
  query('vehicleId').optional().isUUID(),
  query('status').optional().isIn(['reported', 'acknowledged', 'in_progress', 'resolved', 'deferred']),
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('category').optional().isString(),
  paginationValidation,
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/issues`,
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

// Get maintenance schedule
router.get('/maintenance/:vehicleId',
  authMiddleware,
  param('vehicleId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/maintenance/${req.params.vehicleId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Record maintenance
router.post('/maintenance',
  authMiddleware,
  body('vehicleId').isUUID(),
  body('type').isIn(['oil_change', 'tire_rotation', 'brake_service', 'filter_replacement', 'other']),
  body('description').notEmpty(),
  body('mileage').isInt({ min: 0 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('serviceProvider').optional().isString(),
  body('nextServiceDue').optional().isObject(),
  body('nextServiceDue.mileage').optional().isInt({ min: 0 }),
  body('nextServiceDue.date').optional().isISO8601(),
  body('documents').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.vehicleInspection.url}/inspections/maintenance`,
        body: {
          ...req.body,
          recordedBy: req.user!.id,
          serviceDate: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get inspection statistics
router.get('/statistics',
  authMiddleware,
  query('vehicleId').optional().isUUID(),
  query('period').optional().isIn(['week', 'month', 'quarter', 'year']),
  query('groupBy').optional().isIn(['vehicle', 'type', 'driver']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/statistics`,
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

// Generate inspection report
router.post('/report',
  authMiddleware,
  body('vehicleId').optional().isUUID(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['pdf', 'excel', 'csv']),
  body('includePhotos').optional().isBoolean(),
  body('includeIssues').optional().isBoolean(),
  body('includeMaintenance').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.vehicleInspection.url}/inspections/report`,
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

// Upload inspection photos
router.post('/:inspectionId/photos',
  authMiddleware,
  param('inspectionId').isUUID(),
  body('photos').isArray(),
  body('photos.*.url').notEmpty(),
  body('photos.*.type').isIn(['exterior', 'interior', 'damage', 'document', 'other']),
  body('photos.*.description').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.vehicleInspection.url}/inspections/${req.params.inspectionId}/photos`,
        body: {
          ...req.body,
          uploadedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get compliance status
router.get('/compliance/:vehicleId',
  authMiddleware,
  param('vehicleId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.vehicleInspection.url}/inspections/compliance/${req.params.vehicleId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const vehicleInspectionRoutes = router;