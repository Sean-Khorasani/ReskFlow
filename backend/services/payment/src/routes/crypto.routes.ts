import { Router } from 'express';
import { CryptoController } from '../controllers';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import {
  createDepositAddressValidator
} from '../validators/crypto.validators';

const router = Router();
const cryptoController = new CryptoController();

// Create deposit address
router.post(
  '/deposit-address',
  authenticate,
  createDepositAddressValidator,
  validateRequest,
  cryptoController.createDepositAddress
);

// Get crypto transaction by ID
router.get(
  '/transactions/:transactionId',
  authenticate,
  cryptoController.getCryptoTransaction
);

// Get user's crypto transactions
router.get(
  '/transactions/user/:userId',
  authenticate,
  cryptoController.getUserCryptoTransactions
);

// Get exchange rate for a cryptocurrency
router.get(
  '/rates/:cryptocurrency',
  cryptoController.getExchangeRate
);

// Get all exchange rates
router.get(
  '/rates',
  cryptoController.getExchangeRates
);

// Convert amount between currencies
router.get(
  '/convert',
  cryptoController.convertAmount
);

export default router;