import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { param } from 'express-validator';

const router = Router();
const invoiceController = new InvoiceController();

// Get invoice by ID
router.get(
  '/:invoiceId',
  authenticate,
  [param('invoiceId').isUUID().withMessage('Invalid invoice ID')],
  validate,
  invoiceController.getInvoice
);

// Get invoice by order ID
router.get(
  '/order/:orderId',
  authenticate,
  [param('orderId').isUUID().withMessage('Invalid order ID')],
  validate,
  invoiceController.getInvoiceByOrder
);

// Download invoice PDF
router.get(
  '/:invoiceId/download',
  authenticate,
  [param('invoiceId').isUUID().withMessage('Invalid invoice ID')],
  validate,
  invoiceController.downloadInvoice
);

export default router;