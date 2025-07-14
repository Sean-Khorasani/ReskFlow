import { Router } from 'express';
import { StatisticsController } from '../controllers/statistics.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { query } from 'express-validator';

const router = Router();
const statisticsController = new StatisticsController();

// Get order statistics
router.get(
  '/orders',
  authenticate,
  authorize('ADMIN', 'MERCHANT'),
  [
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('merchantId').optional().isUUID().withMessage('Invalid merchant ID'),
  ],
  validate,
  statisticsController.getOrderStatistics
);

// Get revenue statistics
router.get(
  '/revenue',
  authenticate,
  authorize('ADMIN', 'MERCHANT'),
  [
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('merchantId').optional().isUUID().withMessage('Invalid merchant ID'),
    query('groupBy').optional().isIn(['day', 'week', 'month']).withMessage('Invalid groupBy value'),
  ],
  validate,
  statisticsController.getRevenueStatistics
);

// Get popular items
router.get(
  '/popular-items',
  authenticate,
  authorize('ADMIN', 'MERCHANT'),
  [
    query('merchantId').optional().isUUID().withMessage('Invalid merchant ID'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  ],
  validate,
  statisticsController.getPopularItems
);

export default router;