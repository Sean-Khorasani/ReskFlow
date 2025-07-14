import { body, param } from 'express-validator';
import { WalletStatus } from '../types';

export const createWalletValidator = [
  body('userId')
    .notEmpty().withMessage('User ID is required')
    .isString().withMessage('User ID must be a string'),
  
  body('currency')
    .optional()
    .isString().withMessage('Currency must be a string')
    .isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
  
  body('initialBalance')
    .optional()
    .isFloat({ min: 0 }).withMessage('Initial balance must be non-negative')
];

export const depositValidator = [
  param('walletId')
    .notEmpty().withMessage('Wallet ID is required')
    .isMongoId().withMessage('Invalid wallet ID'),
  
  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  
  body('currency')
    .optional()
    .isString().withMessage('Currency must be a string')
    .isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
  
  body('referenceId')
    .optional()
    .isString().withMessage('Reference ID must be a string'),
  
  body('description')
    .optional()
    .isString().withMessage('Description must be a string')
    .isLength({ max: 500 }).withMessage('Description must not exceed 500 characters'),
  
  body('metadata')
    .optional()
    .isObject().withMessage('Metadata must be an object')
];

export const updateWalletStatusValidator = [
  param('walletId')
    .notEmpty().withMessage('Wallet ID is required')
    .isMongoId().withMessage('Invalid wallet ID'),
  
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(Object.values(WalletStatus)).withMessage('Invalid wallet status')
];