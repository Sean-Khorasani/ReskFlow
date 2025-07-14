import { PaymentModel } from '../models';
import {
  Payment,
  CreatePaymentDto,
  ProcessPaymentDto,
  RefundPaymentDto,
  PaymentStatus,
  PaymentMethod,
  TransactionResult
} from '../types';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { WalletService } from './wallet.service';
import { CryptoService } from './crypto.service';
import mongoose from 'mongoose';

export class PaymentService {
  private walletService: WalletService;
  private cryptoService: CryptoService;

  constructor() {
    this.walletService = new WalletService();
    this.cryptoService = new CryptoService();
  }

  async createPayment(data: CreatePaymentDto): Promise<Payment> {
    try {
      // Check if payment already exists for the order
      const existingPayment = await PaymentModel.findOne({ orderId: data.orderId });
      if (existingPayment) {
        throw new AppError('Payment already exists for this order', 409);
      }

      const payment = await PaymentModel.create({
        userId: data.userId,
        orderId: data.orderId,
        amount: data.amount,
        currency: data.currency,
        method: data.method,
        status: PaymentStatus.PENDING,
        metadata: data.metadata
      });

      logger.info(`Payment created: ${payment.id} for order ${data.orderId}`);
      return payment.toJSON();
    } catch (error) {
      logger.error('Error creating payment:', error);
      throw error;
    }
  }

  async processPayment(data: ProcessPaymentDto): Promise<TransactionResult> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const payment = await PaymentModel.findById(data.paymentId).session(session);
      if (!payment) {
        throw new AppError('Payment not found', 404);
      }

      if (payment.status !== PaymentStatus.PENDING) {
        throw new AppError('Payment has already been processed', 400);
      }

      payment.status = PaymentStatus.PROCESSING;
      await payment.save({ session });

      let result: TransactionResult;

      switch (payment.method) {
        case PaymentMethod.WALLET:
          if (!data.walletId) {
            throw new AppError('Wallet ID is required for wallet payments', 400);
          }
          result = await this.processWalletPayment(payment, data.walletId, session);
          break;

        case PaymentMethod.CRYPTO:
          if (!data.cryptoPaymentData) {
            throw new AppError('Crypto payment data is required', 400);
          }
          result = await this.processCryptoPayment(payment, data.cryptoPaymentData, session);
          break;

        default:
          throw new AppError('Invalid payment method', 400);
      }

      if (result.success) {
        payment.status = PaymentStatus.COMPLETED;
        if (payment.method === PaymentMethod.WALLET) {
          payment.walletTransactionId = result.transactionId;
        } else if (payment.method === PaymentMethod.CRYPTO) {
          payment.cryptoTransactionId = result.transactionId;
        }
      } else {
        payment.status = PaymentStatus.FAILED;
      }

      await payment.save({ session });
      await session.commitTransaction();

      logger.info(`Payment processed: ${payment.id} - Status: ${payment.status}`);
      return result;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error processing payment:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async refundPayment(data: RefundPaymentDto): Promise<TransactionResult> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const payment = await PaymentModel.findById(data.paymentId).session(session);
      if (!payment) {
        throw new AppError('Payment not found', 404);
      }

      if (payment.status !== PaymentStatus.COMPLETED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
        throw new AppError('Payment cannot be refunded', 400);
      }

      const totalRefunded = (payment.refundedAmount || 0) + data.amount;
      if (totalRefunded > payment.amount) {
        throw new AppError('Refund amount exceeds payment amount', 400);
      }

      // Process refund to wallet
      const wallet = await this.walletService.getWallet(payment.userId);
      if (!wallet) {
        throw new AppError('User wallet not found', 404);
      }

      const result = await this.walletService.refundToWallet(
        wallet.id,
        data.amount,
        payment.id
      );

      if (result.success) {
        payment.refundedAmount = totalRefunded;
        payment.status = totalRefunded === payment.amount 
          ? PaymentStatus.REFUNDED 
          : PaymentStatus.PARTIALLY_REFUNDED;
        
        await payment.save({ session });
        await session.commitTransaction();

        logger.info(`Payment refunded: ${payment.id} - Amount: ${data.amount}`);
        return result;
      } else {
        throw new AppError('Refund failed', 500);
      }
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error refunding payment:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getPayment(paymentId: string): Promise<Payment | null> {
    const payment = await PaymentModel.findById(paymentId);
    return payment ? payment.toJSON() : null;
  }

  async getPaymentByOrderId(orderId: string): Promise<Payment | null> {
    const payment = await PaymentModel.findOne({ orderId });
    return payment ? payment.toJSON() : null;
  }

  async getUserPayments(userId: string): Promise<Payment[]> {
    const payments = await PaymentModel
      .find({ userId })
      .sort({ createdAt: -1 });
    
    return payments.map(p => p.toJSON());
  }

  async updatePaymentStatus(paymentId: string, status: PaymentStatus): Promise<Payment> {
    const payment = await PaymentModel.findByIdAndUpdate(
      paymentId,
      { status },
      { new: true }
    );

    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    logger.info(`Payment ${paymentId} status updated to ${status}`);
    return payment.toJSON();
  }

  private async processWalletPayment(
    payment: any,
    walletId: string,
    session: mongoose.ClientSession
  ): Promise<TransactionResult> {
    try {
      const result = await this.walletService.chargeWallet({
        walletId,
        amount: payment.amount,
        paymentId: payment.id,
        description: `Payment for order ${payment.orderId}`
      });

      return result;
    } catch (error) {
      logger.error('Error processing wallet payment:', error);
      throw error;
    }
  }

  private async processCryptoPayment(
    payment: any,
    cryptoData: any,
    session: mongoose.ClientSession
  ): Promise<TransactionResult> {
    try {
      // In a real implementation, this would verify the crypto transaction
      // For now, we'll create a mock crypto transaction record
      logger.info('Processing crypto payment:', cryptoData);
      
      // This would typically interact with the crypto service to verify the transaction
      return {
        success: true,
        transactionId: 'crypto_tx_' + Date.now(),
        details: {
          cryptocurrency: cryptoData.cryptocurrency,
          transactionHash: cryptoData.transactionHash
        }
      };
    } catch (error) {
      logger.error('Error processing crypto payment:', error);
      throw error;
    }
  }
}