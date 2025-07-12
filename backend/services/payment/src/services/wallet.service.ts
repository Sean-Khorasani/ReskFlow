import { WalletModel, WalletTransactionModel } from '../models';
import {
  Wallet,
  WalletTransaction,
  CreateWalletDto,
  DepositDto,
  ChargeWalletDto,
  TransactionType,
  WalletStatus,
  TransactionResult,
  PaginatedResponse,
  PaginationParams,
  TransactionFilter
} from '../types';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';
import { config } from '../config';

export class WalletService {
  async createWallet(data: CreateWalletDto): Promise<Wallet> {
    try {
      // Check if wallet already exists
      const existingWallet = await WalletModel.findOne({ userId: data.userId });
      if (existingWallet) {
        throw new AppError('Wallet already exists for this user', 409);
      }

      const wallet = await WalletModel.create({
        userId: data.userId,
        currency: data.currency,
        balance: data.initialBalance || 0,
        status: WalletStatus.ACTIVE
      });

      // Create initial transaction if there's an initial balance
      if (data.initialBalance && data.initialBalance > 0) {
        await this.createTransaction({
          walletId: wallet.id,
          type: TransactionType.DEPOSIT,
          amount: data.initialBalance,
          currency: data.currency,
          balanceBefore: 0,
          balanceAfter: data.initialBalance,
          description: 'Initial wallet balance'
        });
      }

      logger.info(`Wallet created for user ${data.userId}`);
      return wallet.toJSON();
    } catch (error) {
      logger.error('Error creating wallet:', error);
      throw error;
    }
  }

  async getWallet(userId: string): Promise<Wallet | null> {
    const wallet = await WalletModel.findOne({ userId });
    return wallet ? wallet.toJSON() : null;
  }

  async getWalletById(walletId: string): Promise<Wallet | null> {
    const wallet = await WalletModel.findById(walletId);
    return wallet ? wallet.toJSON() : null;
  }

  async deposit(data: DepositDto): Promise<TransactionResult> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Lock wallet for update
      const wallet = await WalletModel.findById(data.walletId).session(session);
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new AppError('Wallet is not active', 400);
      }

      // Check deposit limits
      if (data.amount < config.limits.minDepositAmount) {
        throw new AppError(`Minimum deposit amount is ${config.limits.minDepositAmount}`, 400);
      }

      if (data.amount > config.limits.maxDepositAmount) {
        throw new AppError(`Maximum deposit amount is ${config.limits.maxDepositAmount}`, 400);
      }

      const newBalance = wallet.balance + data.amount;

      // Check wallet balance limit
      if (newBalance > config.limits.maxWalletBalance) {
        throw new AppError(`Wallet balance cannot exceed ${config.limits.maxWalletBalance}`, 400);
      }

      // Update wallet balance
      wallet.balance = newBalance;
      await wallet.save({ session });

      // Create transaction record
      const transaction = await this.createTransaction({
        walletId: wallet.id,
        type: TransactionType.DEPOSIT,
        amount: data.amount,
        currency: data.currency,
        balanceBefore: wallet.balance - data.amount,
        balanceAfter: wallet.balance,
        referenceId: data.referenceId,
        description: data.description || 'Wallet deposit',
        metadata: data.metadata
      }, session);

      await session.commitTransaction();

      logger.info(`Deposit successful: ${data.amount} to wallet ${data.walletId}`);
      return {
        success: true,
        transactionId: transaction.id,
        details: {
          newBalance: wallet.balance,
          amount: data.amount
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error processing deposit:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async chargeWallet(data: ChargeWalletDto): Promise<TransactionResult> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Lock wallet for update
      const wallet = await WalletModel.findById(data.walletId).session(session);
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new AppError('Wallet is not active', 400);
      }

      if (!wallet.hasSufficientBalance(data.amount)) {
        throw new AppError('Insufficient wallet balance', 400);
      }

      // Update wallet balance
      wallet.balance -= data.amount;
      await wallet.save({ session });

      // Create transaction record
      const transaction = await this.createTransaction({
        walletId: wallet.id,
        type: TransactionType.PAYMENT,
        amount: -data.amount,
        currency: wallet.currency,
        balanceBefore: wallet.balance + data.amount,
        balanceAfter: wallet.balance,
        referenceId: data.paymentId,
        description: data.description || 'Payment charge'
      }, session);

      await session.commitTransaction();

      logger.info(`Wallet charged: ${data.amount} from wallet ${data.walletId}`);
      return {
        success: true,
        transactionId: transaction.id,
        details: {
          newBalance: wallet.balance,
          chargedAmount: data.amount
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error charging wallet:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async refundToWallet(walletId: string, amount: number, paymentId: string): Promise<TransactionResult> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Lock wallet for update
      const wallet = await WalletModel.findById(walletId).session(session);
      if (!wallet) {
        throw new AppError('Wallet not found', 404);
      }

      // Update wallet balance
      wallet.balance += amount;
      await wallet.save({ session });

      // Create transaction record
      const transaction = await this.createTransaction({
        walletId: wallet.id,
        type: TransactionType.REFUND,
        amount: amount,
        currency: wallet.currency,
        balanceBefore: wallet.balance - amount,
        balanceAfter: wallet.balance,
        referenceId: paymentId,
        description: 'Payment refund'
      }, session);

      await session.commitTransaction();

      logger.info(`Refund successful: ${amount} to wallet ${walletId}`);
      return {
        success: true,
        transactionId: transaction.id,
        details: {
          newBalance: wallet.balance,
          refundedAmount: amount
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error processing refund:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getTransactionHistory(
    filter: TransactionFilter,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<WalletTransaction>> {
    const query: any = {};
    
    if (filter.walletId) query.walletId = filter.walletId;
    if (filter.type) query.type = filter.type;
    if (filter.fromDate || filter.toDate) {
      query.createdAt = {};
      if (filter.fromDate) query.createdAt.$gte = filter.fromDate;
      if (filter.toDate) query.createdAt.$lte = filter.toDate;
    }
    if (filter.minAmount !== undefined || filter.maxAmount !== undefined) {
      query.amount = {};
      if (filter.minAmount !== undefined) query.amount.$gte = filter.minAmount;
      if (filter.maxAmount !== undefined) query.amount.$lte = filter.maxAmount;
    }

    const total = await WalletTransactionModel.countDocuments(query);
    const totalPages = Math.ceil(total / pagination.limit);
    const skip = (pagination.page - 1) * pagination.limit;

    const transactions = await WalletTransactionModel
      .find(query)
      .sort({ [pagination.sortBy || 'createdAt']: pagination.sortOrder === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(pagination.limit);

    return {
      data: transactions.map(t => t.toJSON()),
      total,
      page: pagination.page,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1
    };
  }

  async updateWalletStatus(walletId: string, status: WalletStatus): Promise<Wallet> {
    const wallet = await WalletModel.findByIdAndUpdate(
      walletId,
      { status },
      { new: true }
    );

    if (!wallet) {
      throw new AppError('Wallet not found', 404);
    }

    logger.info(`Wallet ${walletId} status updated to ${status}`);
    return wallet.toJSON();
  }

  private async createTransaction(
    data: Partial<WalletTransaction>,
    session?: mongoose.ClientSession
  ): Promise<WalletTransaction> {
    const transaction = await WalletTransactionModel.create([data], { session });
    return transaction[0].toJSON();
  }
}