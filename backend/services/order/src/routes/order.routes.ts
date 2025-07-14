import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authenticate, authorize, authorizeOrderAccess } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { orderCreationLimiter } from '../middleware/rate-limit.middleware';
import {
  createOrderValidator,
  updateOrderValidator,
  cancelOrderValidator,
  rateOrderValidator,
  orderIdValidator,
  paginationValidator,
} from '../validators/order.validators';

const router = Router();
const orderController = new OrderController();

// Create order (rate limited)
router.post(
  '/',
  authenticate,
  authorize('CUSTOMER'),
  orderCreationLimiter,
  createOrderValidator,
  validate,
  orderController.createOrder
);

// Get order by ID
router.get(
  '/:orderId',
  authenticate,
  orderIdValidator,
  validate,
  authorizeOrderAccess(),
  orderController.getOrder
);

// Get user orders
router.get(
  '/',
  authenticate,
  paginationValidator,
  validate,
  orderController.getUserOrders
);

// Get merchant orders
router.get(
  '/merchant/:merchantId',
  authenticate,
  authorize('MERCHANT', 'ADMIN'),
  paginationValidator,
  validate,
  orderController.getMerchantOrders
);

// Update order (merchant only)
router.put(
  '/:orderId',
  authenticate,
  authorize('MERCHANT', 'ADMIN'),
  orderIdValidator,
  updateOrderValidator,
  validate,
  orderController.updateOrder
);

// Update order status
router.put(
  '/:orderId/status',
  authenticate,
  authorize('MERCHANT', 'ADMIN', 'DRIVER'),
  orderIdValidator,
  validate,
  orderController.updateOrderStatus
);

// Cancel order
router.post(
  '/:orderId/cancel',
  authenticate,
  orderIdValidator,
  cancelOrderValidator,
  validate,
  authorizeOrderAccess(),
  orderController.cancelOrder
);

// Rate order
router.post(
  '/:orderId/rate',
  authenticate,
  authorize('CUSTOMER'),
  orderIdValidator,
  rateOrderValidator,
  validate,
  authorizeOrderAccess(),
  orderController.rateOrder
);

// Get order tracking
router.get(
  '/:orderId/tracking',
  authenticate,
  orderIdValidator,
  validate,
  authorizeOrderAccess(),
  orderController.getOrderTracking
);

// Request invoice
router.post(
  '/:orderId/invoice',
  authenticate,
  orderIdValidator,
  validate,
  authorizeOrderAccess(),
  orderController.requestInvoice
);

// Reorder
router.post(
  '/:orderId/reorder',
  authenticate,
  authorize('CUSTOMER'),
  orderIdValidator,
  validate,
  authorizeOrderAccess(),
  orderController.reorder
);

export default router;