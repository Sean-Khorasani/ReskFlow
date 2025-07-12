import { body, param } from 'express-validator';
import { CryptoCurrency, BlockchainNetwork } from '../types';

export const createDepositAddressValidator = [
  body('userId')
    .notEmpty().withMessage('User ID is required')
    .isString().withMessage('User ID must be a string'),
  
  body('walletId')
    .notEmpty().withMessage('Wallet ID is required')
    .isMongoId().withMessage('Invalid wallet ID'),
  
  body('cryptocurrency')
    .notEmpty().withMessage('Cryptocurrency is required')
    .isIn(Object.values(CryptoCurrency)).withMessage('Invalid cryptocurrency'),
  
  body('network')
    .notEmpty().withMessage('Network is required')
    .isIn(Object.values(BlockchainNetwork)).withMessage('Invalid blockchain network'),
  
  body('amount')
    .optional()
    .isFloat({ min: 0.00000001 }).withMessage('Amount must be greater than 0')
];

export const cryptoWebhookValidator = [
  body('transactionHash')
    .notEmpty().withMessage('Transaction hash is required')
    .isString().withMessage('Transaction hash must be a string'),
  
  body('fromAddress')
    .notEmpty().withMessage('From address is required')
    .isString().withMessage('From address must be a string'),
  
  body('toAddress')
    .notEmpty().withMessage('To address is required')
    .isString().withMessage('To address must be a string'),
  
  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isFloat({ min: 0 }).withMessage('Amount must be greater than 0'),
  
  body('cryptocurrency')
    .notEmpty().withMessage('Cryptocurrency is required')
    .isIn(Object.values(CryptoCurrency)).withMessage('Invalid cryptocurrency'),
  
  body('network')
    .notEmpty().withMessage('Network is required')
    .isIn(Object.values(BlockchainNetwork)).withMessage('Invalid blockchain network'),
  
  body('confirmations')
    .notEmpty().withMessage('Confirmations is required')
    .isInt({ min: 0 }).withMessage('Confirmations must be a non-negative integer'),
  
  body('blockNumber')
    .notEmpty().withMessage('Block number is required')
    .isInt({ min: 0 }).withMessage('Block number must be a non-negative integer')
];