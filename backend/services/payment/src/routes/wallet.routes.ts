import { Router } from 'express';
import { WalletController } from '../controllers';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import {
  createWalletValidator,
  depositValidator
} from '../validators/wallet.validators';

const router = Router();
const walletController = new WalletController();

// Create a new wallet
router.post(
  '/',
  authenticate,
  createWalletValidator,
  validateRequest,
  walletController.createWallet
);

// Get wallet by user ID
router.get(
  '/user/:userId',
  authenticate,
  walletController.getWallet
);

// Get wallet by ID
router.get(
  '/:walletId',
  authenticate,
  walletController.getWalletById
);

// Deposit to wallet
router.post(
  '/:walletId/deposit',
  authenticate,
  depositValidator,
  validateRequest,
  walletController.deposit
);

// Get transaction history
router.get(
  '/:walletId/transactions',
  authenticate,
  walletController.getTransactionHistory
);

// Update wallet status (admin only)
router.patch(
  '/:walletId/status',
  authenticate,
  walletController.updateWalletStatus
);

export default router;