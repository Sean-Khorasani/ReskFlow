import { Request, Response, NextFunction } from 'express';
import { WalletService } from '../services';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';

export class WalletController {
  private walletService: WalletService;

  constructor() {
    this.walletService = new WalletService();
  }

  createWallet = asyncHandler(async (req: Request, res: Response) => {
    const { userId, currency, initialBalance } = req.body;

    const wallet = await this.walletService.createWallet({
      userId,
      currency: currency || 'USD',
      initialBalance
    });

    res.status(201).json({
      success: true,
      data: wallet
    });
  });

  getWallet = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const wallet = await this.walletService.getWallet(userId);
    if (!wallet) {
      throw new AppError('Wallet not found', 404);
    }

    res.json({
      success: true,
      data: wallet
    });
  });

  getWalletById = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params;

    const wallet = await this.walletService.getWalletById(walletId);
    if (!wallet) {
      throw new AppError('Wallet not found', 404);
    }

    res.json({
      success: true,
      data: wallet
    });
  });

  deposit = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params;
    const { amount, currency, referenceId, description, metadata } = req.body;

    const result = await this.walletService.deposit({
      walletId,
      amount,
      currency: currency || 'USD',
      referenceId,
      description,
      metadata
    });

    res.json({
      success: true,
      data: result
    });
  });

  getTransactionHistory = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params;
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      type,
      fromDate,
      toDate,
      minAmount,
      maxAmount
    } = req.query;

    const transactions = await this.walletService.getTransactionHistory(
      {
        walletId,
        type: type as string,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
        minAmount: minAmount ? parseFloat(minAmount as string) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount as string) : undefined
      },
      {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        sortBy: sortBy as string,
        sortOrder: sortOrder as 'asc' | 'desc'
      }
    );

    res.json({
      success: true,
      data: transactions
    });
  });

  updateWalletStatus = asyncHandler(async (req: Request, res: Response) => {
    const { walletId } = req.params;
    const { status } = req.body;

    const wallet = await this.walletService.updateWalletStatus(walletId, status);

    res.json({
      success: true,
      data: wallet
    });
  });
}