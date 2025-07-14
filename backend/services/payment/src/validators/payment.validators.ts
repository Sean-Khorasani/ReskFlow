import { body, param } from 'express-validator';
import { PaymentMethod, PaymentStatus } from '../types';

export const createPaymentValidator = [
  body('userId')
    .notEmpty().withMessage('User ID is required')
    .isString().withMessage('User ID must be a string'),
  
  body('orderId')
    .notEmpty().withMessage('Order ID is required')
    .isString().withMessage('Order ID must be a string'),
  
  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  
  body('currency')
    .notEmpty().withMessage('Currency is required')
    .isString().withMessage('Currency must be a string')
    .isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
  
  body('method')
    .notEmpty().withMessage('Payment method is required')
    .isIn(Object.values(PaymentMethod)).withMessage('Invalid payment method'),
  
  body('metadata')
    .optional()
    .isObject().withMessage('Metadata must be an object')
];

export const processPaymentValidator = [
  param('paymentId')
    .notEmpty().withMessage('Payment ID is required')
    .isMongoId().withMessage('Invalid payment ID'),
  
  body('walletId')
    .optional()
    .isMongoId().withMessage('Invalid wallet ID'),
  
  body('cryptoPaymentData')
    .optional()
    .isObject().withMessage('Crypto payment data must be an object'),
  
  body('cryptoPaymentData.cryptocurrency')
    .optional()
    .isString().withMessage('Cryptocurrency must be a string'),
  
  body('cryptoPaymentData.transactionHash')
    .optional()
    .isString().withMessage('Transaction hash must be a string'),
  
  body('cryptoPaymentData.fromAddress')
    .optional()
    .isString().withMessage('From address must be a string')
];

export const refundPaymentValidator = [
  param('paymentId')
    .notEmpty().withMessage('Payment ID is required')
    .isMongoId().withMessage('Invalid payment ID'),
  
  body('amount')
    .notEmpty().withMessage('Refund amount is required')
    .isFloat({ min: 0.01 }).withMessage('Refund amount must be greater than 0'),
  
  body('reason')
    .optional()
    .isString().withMessage('Reason must be a string')
    .isLength({ max: 500 }).withMessage('Reason must not exceed 500 characters')
];

export const updatePaymentStatusValidator = [
  param('paymentId')
    .notEmpty().withMessage('Payment ID is required')
    .isMongoId().withMessage('Invalid payment ID'),
  
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(Object.values(PaymentStatus)).withMessage('Invalid payment status')
];