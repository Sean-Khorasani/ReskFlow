import { body, param, query } from 'express-validator';
import { DeliveryType, OrderStatus } from '@prisma/client';

export const createOrderValidator = [
  body('cartId')
    .isString()
    .notEmpty()
    .withMessage('Cart ID is required'),
  body('reskflowType')
    .isIn(Object.values(DeliveryType))
    .withMessage('Invalid reskflow type'),
  body('reskflowAddress')
    .optional()
    .isObject()
    .withMessage('Delivery address must be an object'),
  body('reskflowAddress.street')
    .if(body('reskflowType').equals('DELIVERY'))
    .notEmpty()
    .withMessage('Street address is required for reskflow'),
  body('reskflowAddress.city')
    .if(body('reskflowType').equals('DELIVERY'))
    .notEmpty()
    .withMessage('City is required for reskflow'),
  body('reskflowAddress.postalCode')
    .if(body('reskflowType').equals('DELIVERY'))
    .notEmpty()
    .withMessage('Postal code is required for reskflow'),
  body('reskflowTime')
    .optional()
    .isISO8601()
    .withMessage('Invalid reskflow time format'),
  body('customerNotes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Customer notes must be less than 500 characters'),
  body('paymentMethodId')
    .optional()
    .isString()
    .withMessage('Invalid payment method ID'),
];

export const updateOrderValidator = [
  body('status')
    .optional()
    .isIn(Object.values(OrderStatus))
    .withMessage('Invalid order status'),
  body('merchantNotes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Merchant notes must be less than 500 characters'),
  body('reskflowTime')
    .optional()
    .isISO8601()
    .withMessage('Invalid reskflow time format'),
];

export const cancelOrderValidator = [
  body('reason')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Cancellation reason must be less than 200 characters'),
];

export const rateOrderValidator = [
  body('foodRating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Food rating must be between 1 and 5'),
  body('reskflowRating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Delivery rating must be between 1 and 5'),
  body('overallRating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Overall rating must be between 1 and 5'),
  body('comment')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Comment must be less than 1000 characters'),
];

export const orderIdValidator = [
  param('orderId')
    .isUUID()
    .withMessage('Invalid order ID format'),
];

export const paginationValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(Object.values(OrderStatus))
    .withMessage('Invalid order status'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
];