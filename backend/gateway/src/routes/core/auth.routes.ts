/**
 * Authentication Routes
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { validationMiddleware } from '../../middleware/validation';
import { authRateLimiter, passwordResetRateLimiter } from '../../middleware/rate-limiter';
import { optionalAuthMiddleware } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Sign up
router.post('/signup',
  authRateLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  body('firstName').notEmpty().trim(),
  body('lastName').notEmpty().trim(),
  body('phone').optional().isMobilePhone(),
  body('role').isIn(['CUSTOMER', 'DRIVER', 'MERCHANT']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/signup`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Login
router.post('/login',
  authRateLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/login`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Refresh token
router.post('/refresh',
  body('refreshToken').notEmpty(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/refresh`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Logout
router.post('/logout',
  optionalAuthMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/logout`,
        body: { userId: req.user?.id },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Request password reset
router.post('/password/reset',
  passwordResetRateLimiter,
  body('email').isEmail().normalizeEmail(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/password/reset`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Reset password with token
router.post('/password/reset/confirm',
  body('email').isEmail().normalizeEmail(),
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/password/reset/confirm`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Verify email
router.post('/verify/email',
  body('userId').isUUID(),
  body('otp').isLength({ min: 6, max: 6 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/verify/email`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Verify phone
router.post('/verify/phone',
  body('userId').isUUID(),
  body('otp').isLength({ min: 6, max: 6 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/verify/phone`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Resend verification
router.post('/verify/resend',
  authRateLimiter,
  body('userId').isUUID(),
  body('type').isIn(['email', 'phone']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.auth.url}/auth/verify/resend`,
        body: req.body,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const authRoutes = router;