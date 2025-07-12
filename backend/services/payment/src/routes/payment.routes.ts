import { Router } from 'express';
import { PaymentController } from '../controllers';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import {
  createPaymentValidator,
  processPaymentValidator,
  refundPaymentValidator
} from '../validators/payment.validators';

const router = Router();
const paymentController = new PaymentController();

// Create a new payment
router.post(
  '/',
  authenticate,
  createPaymentValidator,
  validateRequest,
  paymentController.createPayment
);

// Process a payment
router.post(
  '/:paymentId/process',
  authenticate,
  processPaymentValidator,
  validateRequest,
  paymentController.processPayment
);

// Refund a payment
router.post(
  '/:paymentId/refund',
  authenticate,
  refundPaymentValidator,
  validateRequest,
  paymentController.refundPayment
);

// Get payment by ID
router.get(
  '/:paymentId',
  authenticate,
  paymentController.getPayment
);

// Get payment by order ID
router.get(
  '/order/:orderId',
  authenticate,
  paymentController.getPaymentByOrderId
);

// Get user's payments
router.get(
  '/user/:userId',
  authenticate,
  paymentController.getUserPayments
);

// Update payment status (admin only)
router.patch(
  '/:paymentId/status',
  authenticate,
  paymentController.updatePaymentStatus
);

export default router;