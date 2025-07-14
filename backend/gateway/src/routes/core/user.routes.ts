/**
 * User Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authMiddleware, authorize } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get current user profile
router.get('/me',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.user.url}/users/${req.user!.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update current user profile
router.put('/me',
  authMiddleware,
  body('firstName').optional().trim(),
  body('lastName').optional().trim(),
  body('phone').optional().isMobilePhone(),
  body('dateOfBirth').optional().isISO8601(),
  body('preferredLanguage').optional().isIn(['en', 'es', 'fr', 'de']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.user.url}/users/${req.user!.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user by ID (admin only)
router.get('/:id',
  authMiddleware,
  authorize('ADMIN'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.user.url}/users/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Search users (admin only)
router.get('/',
  authMiddleware,
  authorize('ADMIN'),
  query('query').optional().isString(),
  query('role').optional().isIn(['CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN']),
  query('isActive').optional().isBoolean(),
  query('emailVerified').optional().isBoolean(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.user.url}/users`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Change password
router.put('/me/password',
  authMiddleware,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.user.url}/users/${req.user!.id}/password`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Delete account
router.delete('/me',
  authMiddleware,
  body('password').notEmpty(),
  body('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.user.url}/users/${req.user!.id}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update notification preferences
router.put('/me/notifications',
  authMiddleware,
  body('email').optional().isBoolean(),
  body('sms').optional().isBoolean(),
  body('push').optional().isBoolean(),
  body('orderUpdates').optional().isBoolean(),
  body('promotions').optional().isBoolean(),
  body('newsletter').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.user.url}/users/${req.user!.id}/notifications`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Upload avatar
router.post('/me/avatar',
  authMiddleware,
  body('avatar').notEmpty().custom((value) => {
    // Check if it's a valid base64 image
    const base64Regex = /^data:image\/(png|jpg|jpeg|gif|webp);base64,/;
    return base64Regex.test(value);
  }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.user.url}/users/${req.user!.id}/avatar`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user addresses
router.get('/me/addresses',
  authMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.user.url}/users/${req.user!.id}/addresses`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Add address
router.post('/me/addresses',
  authMiddleware,
  body('label').notEmpty().trim(),
  body('street').notEmpty().trim(),
  body('city').notEmpty().trim(),
  body('state').notEmpty().trim(),
  body('country').notEmpty().trim(),
  body('postalCode').notEmpty().trim(),
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('isDefault').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.user.url}/users/${req.user!.id}/addresses`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update address
router.put('/me/addresses/:addressId',
  authMiddleware,
  param('addressId').isUUID(),
  body('label').optional().trim(),
  body('street').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('country').optional().trim(),
  body('postalCode').optional().trim(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
  body('isDefault').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.user.url}/users/${req.user!.id}/addresses/${req.params.addressId}`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Delete address
router.delete('/me/addresses/:addressId',
  authMiddleware,
  param('addressId').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'DELETE',
        url: `${config.services.user.url}/users/${req.user!.id}/addresses/${req.params.addressId}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get user statistics (admin only)
router.get('/statistics',
  authMiddleware,
  authorize('ADMIN'),
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.user.url}/users/statistics`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const userRoutes = router;