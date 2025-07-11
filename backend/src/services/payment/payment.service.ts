/**
 * Payment Service
 * Handles payment processing, refunds, and payment method management
 */

import { PrismaClient, PaymentStatus, PaymentMethod } from '@prisma/client';
import { EventEmitter } from 'events';
import Stripe from 'stripe';
import { logger } from '../../utils/logger';
import { redisClient } from '../../config/redis';
import { encryptData, decryptData } from '../../utils/encryption';
import { blockchainService } from '../blockchain/blockchain.service';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

interface PaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId?: string;
  paymentMethodType: 'card' | 'wallet' | 'crypto' | 'bank_transfer';
  metadata?: Record<string, any>;
  savePaymentMethod?: boolean;
}

interface RefundRequest {
  paymentId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

interface PaymentMethodData {
  customerId: string;
  type: 'card' | 'bank' | 'wallet' | 'crypto';
  details: any;
  isDefault?: boolean;
}

interface PaymentResult {
  id: string;
  status: PaymentStatus;
  transactionId?: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  metadata?: any;
  error?: string;
}

interface FeeCalculation {
  subtotal: number;
  platformFee: number;
  processingFee: number;
  tax: number;
  total: number;
  merchantPayout: number;
  driverPayout: number;
}

class PaymentService extends EventEmitter {
  private readonly PLATFORM_FEE_PERCENTAGE = 0.15; // 15%
  private readonly PROCESSING_FEE_PERCENTAGE = 0.029; // 2.9%
  private readonly PROCESSING_FEE_FIXED = 0.30; // $0.30
  private readonly TAX_RATE = 0.08; // 8%

  /**
   * Process payment
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Validate payment request
      await this.validatePaymentRequest(request);

      // Calculate fees
      const fees = this.calculateFees(request.amount);

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          orderId: request.orderId,
          customerId: request.customerId,
          amount: request.amount,
          currency: request.currency,
          status: PaymentStatus.PENDING,
          paymentMethod: request.paymentMethodType,
          platformFee: fees.platformFee,
          processingFee: fees.processingFee,
          tax: fees.tax,
          metadata: request.metadata
        }
      });

      // Process based on payment method
      let result: PaymentResult;
      
      switch (request.paymentMethodType) {
        case 'card':
          result = await this.processCardPayment(payment, request);
          break;
        case 'wallet':
          result = await this.processWalletPayment(payment, request);
          break;
        case 'crypto':
          result = await this.processCryptoPayment(payment, request);
          break;
        case 'bank_transfer':
          result = await this.processBankTransfer(payment, request);
          break;
        default:
          throw new Error('Unsupported payment method');
      }

      // Update payment status
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: result.status,
          transactionId: result.transactionId,
          processedAt: result.status === PaymentStatus.COMPLETED ? new Date() : null,
          error: result.error
        }
      });

      // Handle successful payment
      if (result.status === PaymentStatus.COMPLETED) {
        await this.handleSuccessfulPayment(payment, fees);
      }

      // Emit payment event
      this.emit('payment:processed', {
        paymentId: payment.id,
        orderId: request.orderId,
        status: result.status,
        amount: request.amount
      });

      return result;
    } catch (error) {
      logger.error('Payment processing error:', error);
      throw error;
    }
  }

  /**
   * Process card payment via Stripe
   */
  private async processCardPayment(payment: any, request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Create or retrieve Stripe customer
      let stripeCustomerId = await this.getStripeCustomerId(request.customerId);
      
      if (!stripeCustomerId) {
        const customer = await prisma.user.findUnique({
          where: { id: request.customerId }
        });
        
        const stripeCustomer = await stripe.customers.create({
          email: customer?.email,
          metadata: { userId: request.customerId }
        });
        
        stripeCustomerId = stripeCustomer.id;
        
        // Store Stripe customer ID
        await redisClient.setex(
          `stripe_customer:${request.customerId}`,
          7 * 24 * 60 * 60, // 7 days
          stripeCustomerId
        );
      }

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(request.amount * 100), // Convert to cents
        currency: request.currency,
        customer: stripeCustomerId,
        payment_method: request.paymentMethodId,
        confirm: true,
        metadata: {
          paymentId: payment.id,
          orderId: request.orderId,
          ...request.metadata
        }
      });

      // Save payment method if requested
      if (request.savePaymentMethod && request.paymentMethodId) {
        await this.saveStripePaymentMethod(
          request.customerId,
          request.paymentMethodId,
          stripeCustomerId
        );
      }

      return {
        id: payment.id,
        status: paymentIntent.status === 'succeeded' 
          ? PaymentStatus.COMPLETED 
          : PaymentStatus.FAILED,
        transactionId: paymentIntent.id,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'card'
      };
    } catch (error: any) {
      logger.error('Stripe payment error:', error);
      
      return {
        id: payment.id,
        status: PaymentStatus.FAILED,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'card',
        error: error.message
      };
    }
  }

  /**
   * Process wallet payment
   */
  private async processWalletPayment(payment: any, request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Get wallet balance
      const wallet = await prisma.wallet.findUnique({
        where: { userId: request.customerId }
      });

      if (!wallet || wallet.balance < request.amount) {
        throw new Error('Insufficient wallet balance');
      }

      // Deduct from wallet
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: {
            decrement: request.amount
          }
        }
      });

      // Create wallet transaction
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEBIT',
          amount: request.amount,
          description: `Payment for order ${request.orderId}`,
          referenceId: payment.id,
          referenceType: 'PAYMENT'
        }
      });

      return {
        id: payment.id,
        status: PaymentStatus.COMPLETED,
        transactionId: `wallet_${payment.id}`,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'wallet'
      };
    } catch (error: any) {
      logger.error('Wallet payment error:', error);
      
      return {
        id: payment.id,
        status: PaymentStatus.FAILED,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'wallet',
        error: error.message
      };
    }
  }

  /**
   * Process crypto payment
   */
  private async processCryptoPayment(payment: any, request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Create blockchain payment
      const blockchainPayment = await blockchainService.createPayment({
        orderId: request.orderId,
        amount: request.amount,
        payerAddress: request.metadata?.walletAddress,
        currency: request.metadata?.cryptoCurrency || 'MATIC'
      });

      // Monitor payment on blockchain
      blockchainService.monitorPayment(blockchainPayment.id, async (status) => {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: status === 'confirmed' ? PaymentStatus.COMPLETED : PaymentStatus.PENDING,
            transactionId: blockchainPayment.transactionHash
          }
        });

        if (status === 'confirmed') {
          const fees = this.calculateFees(request.amount);
          await this.handleSuccessfulPayment(payment, fees);
        }
      });

      return {
        id: payment.id,
        status: PaymentStatus.PENDING,
        transactionId: blockchainPayment.id,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'crypto',
        metadata: {
          paymentAddress: blockchainPayment.paymentAddress,
          expectedAmount: blockchainPayment.expectedAmount
        }
      };
    } catch (error: any) {
      logger.error('Crypto payment error:', error);
      
      return {
        id: payment.id,
        status: PaymentStatus.FAILED,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'crypto',
        error: error.message
      };
    }
  }

  /**
   * Process bank transfer
   */
  private async processBankTransfer(payment: any, request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Create bank transfer request
      // This would integrate with a bank API or ACH processor
      const transferReference = `REF${Date.now()}`;
      
      // Store transfer details
      await redisClient.setex(
        `bank_transfer:${transferReference}`,
        7 * 24 * 60 * 60, // 7 days
        JSON.stringify({
          paymentId: payment.id,
          amount: request.amount,
          customerId: request.customerId
        })
      );

      return {
        id: payment.id,
        status: PaymentStatus.PENDING,
        transactionId: transferReference,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'bank_transfer',
        metadata: {
          reference: transferReference,
          instructions: 'Bank transfer instructions will be sent via email'
        }
      };
    } catch (error: any) {
      logger.error('Bank transfer error:', error);
      
      return {
        id: payment.id,
        status: PaymentStatus.FAILED,
        amount: request.amount,
        currency: request.currency,
        paymentMethod: 'bank_transfer',
        error: error.message
      };
    }
  }

  /**
   * Process refund
   */
  async processRefund(request: RefundRequest): Promise<PaymentResult> {
    try {
      // Get original payment
      const payment = await prisma.payment.findUnique({
        where: { id: request.paymentId }
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new Error('Can only refund completed payments');
      }

      // Validate refund amount
      const refundAmount = request.amount || payment.amount;
      const existingRefunds = await prisma.refund.aggregate({
        where: { paymentId: payment.id },
        _sum: { amount: true }
      });

      const totalRefunded = existingRefunds._sum.amount || 0;
      if (totalRefunded + refundAmount > payment.amount) {
        throw new Error('Refund amount exceeds payment amount');
      }

      // Create refund record
      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          amount: refundAmount,
          reason: request.reason || 'Customer requested',
          status: 'PENDING',
          metadata: request.metadata
        }
      });

      // Process refund based on payment method
      let result: PaymentResult;
      
      switch (payment.paymentMethod) {
        case 'card':
          result = await this.processStripeRefund(payment, refund, refundAmount);
          break;
        case 'wallet':
          result = await this.processWalletRefund(payment, refund, refundAmount);
          break;
        case 'crypto':
          result = await this.processCryptoRefund(payment, refund, refundAmount);
          break;
        default:
          throw new Error('Refund not supported for this payment method');
      }

      // Update refund status
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: result.status === PaymentStatus.COMPLETED ? 'COMPLETED' : 'FAILED',
          processedAt: result.status === PaymentStatus.COMPLETED ? new Date() : null,
          transactionId: result.transactionId
        }
      });

      // Update payment if fully refunded
      if (totalRefunded + refundAmount >= payment.amount) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED }
        });
      }

      // Emit refund event
      this.emit('payment:refunded', {
        paymentId: payment.id,
        refundId: refund.id,
        amount: refundAmount
      });

      // Send notification
      await notificationService.sendNotification({
        userId: payment.customerId,
        type: 'REFUND_PROCESSED',
        title: 'Refund Processed',
        message: `Your refund of ${refundAmount} ${payment.currency} has been processed.`,
        data: {
          paymentId: payment.id,
          refundId: refund.id,
          amount: refundAmount
        }
      });

      return result;
    } catch (error) {
      logger.error('Refund processing error:', error);
      throw error;
    }
  }

  /**
   * Process Stripe refund
   */
  private async processStripeRefund(payment: any, refund: any, amount: number): Promise<PaymentResult> {
    try {
      const stripeRefund = await stripe.refunds.create({
        payment_intent: payment.transactionId,
        amount: Math.round(amount * 100), // Convert to cents
        metadata: {
          refundId: refund.id,
          paymentId: payment.id
        }
      });

      return {
        id: refund.id,
        status: stripeRefund.status === 'succeeded' 
          ? PaymentStatus.COMPLETED 
          : PaymentStatus.FAILED,
        transactionId: stripeRefund.id,
        amount: amount,
        currency: payment.currency,
        paymentMethod: 'card'
      };
    } catch (error: any) {
      return {
        id: refund.id,
        status: PaymentStatus.FAILED,
        amount: amount,
        currency: payment.currency,
        paymentMethod: 'card',
        error: error.message
      };
    }
  }

  /**
   * Process wallet refund
   */
  private async processWalletRefund(payment: any, refund: any, amount: number): Promise<PaymentResult> {
    try {
      // Add to wallet
      const wallet = await prisma.wallet.findUnique({
        where: { userId: payment.customerId }
      });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: {
            increment: amount
          }
        }
      });

      // Create wallet transaction
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amount: amount,
          description: `Refund for payment ${payment.id}`,
          referenceId: refund.id,
          referenceType: 'REFUND'
        }
      });

      return {
        id: refund.id,
        status: PaymentStatus.COMPLETED,
        transactionId: `wallet_refund_${refund.id}`,
        amount: amount,
        currency: payment.currency,
        paymentMethod: 'wallet'
      };
    } catch (error: any) {
      return {
        id: refund.id,
        status: PaymentStatus.FAILED,
        amount: amount,
        currency: payment.currency,
        paymentMethod: 'wallet',
        error: error.message
      };
    }
  }

  /**
   * Process crypto refund
   */
  private async processCryptoRefund(payment: any, refund: any, amount: number): Promise<PaymentResult> {
    try {
      // Initiate blockchain refund
      const blockchainRefund = await blockchainService.initiateRefund({
        originalPaymentId: payment.transactionId,
        amount: amount,
        recipientAddress: payment.metadata?.payerAddress
      });

      return {
        id: refund.id,
        status: PaymentStatus.PENDING,
        transactionId: blockchainRefund.transactionHash,
        amount: amount,
        currency: payment.currency,
        paymentMethod: 'crypto'
      };
    } catch (error: any) {
      return {
        id: refund.id,
        status: PaymentStatus.FAILED,
        amount: amount,
        currency: payment.currency,
        paymentMethod: 'crypto',
        error: error.message
      };
    }
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(data: PaymentMethodData): Promise<PaymentMethod> {
    try {
      // Encrypt sensitive data
      const encryptedDetails = encryptData(JSON.stringify(data.details));

      // Create payment method
      const paymentMethod = await prisma.paymentMethod.create({
        data: {
          userId: data.customerId,
          type: data.type,
          last4: data.details.last4 || data.details.accountLast4,
          brand: data.details.brand || data.type,
          expiryMonth: data.details.expiryMonth,
          expiryYear: data.details.expiryYear,
          isDefault: data.isDefault || false,
          encryptedDetails: encryptedDetails,
          fingerprint: this.generateFingerprint(data.details)
        }
      });

      // Set as default if requested
      if (data.isDefault) {
        await this.setDefaultPaymentMethod(data.customerId, paymentMethod.id);
      }

      return paymentMethod;
    } catch (error) {
      logger.error('Error adding payment method:', error);
      throw error;
    }
  }

  /**
   * Get payment methods
   */
  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    try {
      const paymentMethods = await prisma.paymentMethod.findMany({
        where: {
          userId: customerId,
          isDeleted: false
        },
        orderBy: [
          { isDefault: 'desc' },
          { createdAt: 'desc' }
        ]
      });

      // Decrypt details for each method
      return paymentMethods.map(method => ({
        ...method,
        encryptedDetails: undefined // Don't send encrypted data
      }));
    } catch (error) {
      logger.error('Error getting payment methods:', error);
      throw error;
    }
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    try {
      const paymentMethod = await prisma.paymentMethod.findFirst({
        where: {
          id: paymentMethodId,
          userId: customerId
        }
      });

      if (!paymentMethod) {
        throw new Error('Payment method not found');
      }

      // Soft delete
      await prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDeleted: true }
      });

      // If it was default, set another as default
      if (paymentMethod.isDefault) {
        const nextDefault = await prisma.paymentMethod.findFirst({
          where: {
            userId: customerId,
            isDeleted: false,
            id: { not: paymentMethodId }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (nextDefault) {
          await this.setDefaultPaymentMethod(customerId, nextDefault.id);
        }
      }
    } catch (error) {
      logger.error('Error deleting payment method:', error);
      throw error;
    }
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    try {
      // Remove current default
      await prisma.paymentMethod.updateMany({
        where: {
          userId: customerId,
          isDefault: true
        },
        data: { isDefault: false }
      });

      // Set new default
      await prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDefault: true }
      });
    } catch (error) {
      logger.error('Error setting default payment method:', error);
      throw error;
    }
  }

  /**
   * Get payment history
   */
  async getPaymentHistory(customerId: string, params: {
    limit?: number;
    offset?: number;
    status?: PaymentStatus;
    startDate?: Date;
    endDate?: Date;
  }) {
    try {
      const { limit = 20, offset = 0, status, startDate, endDate } = params;

      const where: any = { customerId };
      
      if (status) where.status = status;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                merchant: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            },
            refunds: true
          },
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.payment.count({ where })
      ]);

      return {
        payments,
        total,
        limit,
        offset
      };
    } catch (error) {
      logger.error('Error getting payment history:', error);
      throw error;
    }
  }

  /**
   * Calculate fees
   */
  private calculateFees(amount: number): FeeCalculation {
    const subtotal = amount;
    const processingFee = (subtotal * this.PROCESSING_FEE_PERCENTAGE) + this.PROCESSING_FEE_FIXED;
    const platformFee = subtotal * this.PLATFORM_FEE_PERCENTAGE;
    const tax = subtotal * this.TAX_RATE;
    const total = subtotal + tax;
    
    // Calculate payouts
    const totalFees = platformFee + processingFee;
    const netAmount = subtotal - totalFees;
    const merchantPayout = netAmount * 0.8; // 80% to merchant
    const driverPayout = netAmount * 0.2; // 20% to driver

    return {
      subtotal,
      platformFee,
      processingFee,
      tax,
      total,
      merchantPayout,
      driverPayout
    };
  }

  /**
   * Handle successful payment
   */
  private async handleSuccessfulPayment(payment: any, fees: FeeCalculation): Promise<void> {
    try {
      // Create payout records
      await Promise.all([
        // Merchant payout
        prisma.payout.create({
          data: {
            recipientId: payment.order.merchantId,
            recipientType: 'MERCHANT',
            amount: fees.merchantPayout,
            currency: payment.currency,
            status: 'PENDING',
            paymentId: payment.id
          }
        }),
        // Driver payout (if assigned)
        payment.order.driverId && prisma.payout.create({
          data: {
            recipientId: payment.order.driverId,
            recipientType: 'DRIVER',
            amount: fees.driverPayout,
            currency: payment.currency,
            status: 'PENDING',
            paymentId: payment.id
          }
        })
      ]);

      // Record on blockchain
      if (process.env.BLOCKCHAIN_ENABLED === 'true') {
        await blockchainService.recordPayment({
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          fees: fees,
          timestamp: new Date()
        });
      }

      // Update order status
      await prisma.order.update({
        where: { id: payment.orderId },
        data: { 
          paymentStatus: 'PAID',
          paidAt: new Date()
        }
      });

      // Send notifications
      await Promise.all([
        // Customer notification
        notificationService.sendNotification({
          userId: payment.customerId,
          type: 'PAYMENT_SUCCESS',
          title: 'Payment Successful',
          message: `Your payment of ${payment.amount} ${payment.currency} has been processed.`,
          data: { paymentId: payment.id, orderId: payment.orderId }
        }),
        // Merchant notification
        notificationService.sendNotification({
          userId: payment.order.merchantId,
          type: 'PAYMENT_RECEIVED',
          title: 'Payment Received',
          message: `Payment received for order ${payment.order.orderNumber}`,
          data: { paymentId: payment.id, orderId: payment.orderId }
        })
      ]);
    } catch (error) {
      logger.error('Error handling successful payment:', error);
      // Don't throw - payment was successful, these are follow-up actions
    }
  }

  /**
   * Validate payment request
   */
  private async validatePaymentRequest(request: PaymentRequest): Promise<void> {
    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: request.orderId }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.paymentStatus === 'PAID') {
      throw new Error('Order already paid');
    }

    // Validate amount
    if (request.amount !== order.totalAmount) {
      throw new Error('Payment amount does not match order total');
    }

    // Check for duplicate payment attempts
    const recentPayment = await prisma.payment.findFirst({
      where: {
        orderId: request.orderId,
        status: PaymentStatus.PENDING,
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
        }
      }
    });

    if (recentPayment) {
      throw new Error('Payment already in progress');
    }
  }

  /**
   * Get Stripe customer ID
   */
  private async getStripeCustomerId(customerId: string): Promise<string | null> {
    const cached = await redisClient.get(`stripe_customer:${customerId}`);
    return cached;
  }

  /**
   * Save Stripe payment method
   */
  private async saveStripePaymentMethod(
    customerId: string,
    paymentMethodId: string,
    stripeCustomerId: string
  ): Promise<void> {
    try {
      // Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId
      });

      // Get payment method details
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

      // Save to database
      await this.addPaymentMethod({
        customerId,
        type: 'card',
        details: {
          last4: paymentMethod.card?.last4,
          brand: paymentMethod.card?.brand,
          expiryMonth: paymentMethod.card?.exp_month,
          expiryYear: paymentMethod.card?.exp_year,
          stripePaymentMethodId: paymentMethodId
        }
      });
    } catch (error) {
      logger.error('Error saving Stripe payment method:', error);
      // Don't throw - payment can still proceed
    }
  }

  /**
   * Generate fingerprint for payment method
   */
  private generateFingerprint(details: any): string {
    const data = JSON.stringify({
      type: details.type,
      last4: details.last4,
      brand: details.brand
    });
    
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get payment statistics
   */
  async getPaymentStatistics(params: {
    merchantId?: string;
    startDate: Date;
    endDate: Date;
  }) {
    try {
      const where: any = {
        createdAt: {
          gte: params.startDate,
          lte: params.endDate
        }
      };

      if (params.merchantId) {
        where.order = { merchantId: params.merchantId };
      }

      const [
        totalRevenue,
        totalTransactions,
        averageTransaction,
        paymentsByMethod,
        paymentsByStatus,
        refundStats
      ] = await Promise.all([
        prisma.payment.aggregate({
          where: { ...where, status: PaymentStatus.COMPLETED },
          _sum: { amount: true }
        }),
        prisma.payment.count({ where }),
        prisma.payment.aggregate({
          where: { ...where, status: PaymentStatus.COMPLETED },
          _avg: { amount: true }
        }),
        prisma.payment.groupBy({
          by: ['paymentMethod'],
          where,
          _count: true,
          _sum: { amount: true }
        }),
        prisma.payment.groupBy({
          by: ['status'],
          where,
          _count: true
        }),
        prisma.refund.aggregate({
          where: {
            createdAt: {
              gte: params.startDate,
              lte: params.endDate
            },
            status: 'COMPLETED'
          },
          _sum: { amount: true },
          _count: true
        })
      ]);

      return {
        totalRevenue: totalRevenue._sum.amount || 0,
        totalTransactions,
        averageTransaction: averageTransaction._avg.amount || 0,
        paymentMethods: paymentsByMethod.map(item => ({
          method: item.paymentMethod,
          count: item._count,
          total: item._sum.amount || 0
        })),
        paymentStatus: paymentsByStatus.map(item => ({
          status: item.status,
          count: item._count
        })),
        refunds: {
          total: refundStats._sum.amount || 0,
          count: refundStats._count || 0
        },
        period: {
          start: params.startDate,
          end: params.endDate
        }
      };
    } catch (error) {
      logger.error('Error getting payment statistics:', error);
      throw error;
    }
  }
}

export const paymentService = new PaymentService();