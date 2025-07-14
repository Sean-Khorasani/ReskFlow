import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface RefundRequest {
  orderId: string;
  amount: number;
  reason: string;
  items?: Array<{
    itemId: string;
    quantity: number;
    amount: number;
  }>;
  processedBy: string;
}

interface Refund {
  id: string;
  orderId: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  reason: string;
  type: 'full' | 'partial' | 'item';
  paymentMethod: string;
  transactionId?: string;
  processedBy: string;
  processedAt?: Date;
  createdAt: Date;
}

interface RefundResult {
  success: boolean;
  refundId: string;
  amount: number;
  status: string;
  estimatedTime: string;
  message: string;
}

interface RefundPolicy {
  eligible: boolean;
  reason?: string;
  maxRefundAmount: number;
  eligibleItems: Array<{
    itemId: string;
    name: string;
    maxRefundAmount: number;
    quantity: number;
  }>;
  processingTime: string;
  refundMethod: string;
}

export class RefundService {
  constructor(private refundQueue: Bull.Queue) {}

  async processRefund(request: RefundRequest): Promise<RefundResult> {
    // Validate order
    const order = await prisma.order.findUnique({
      where: { id: request.orderId },
      include: {
        payment: true,
        refunds: true,
        orderItems: {
          include: { item: true },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Check if payment was completed
    if (!order.payment || order.payment.status !== 'completed') {
      throw new Error('No completed payment found for this order');
    }

    // Validate refund amount
    const totalRefunded = order.refunds.reduce((sum, r) => sum + r.amount, 0);
    const maxRefundable = order.total - totalRefunded;

    if (request.amount > maxRefundable) {
      throw new Error(`Maximum refundable amount is $${maxRefundable.toFixed(2)}`);
    }

    // Determine refund type
    const refundType = this.determineRefundType(request, order);

    // Create refund record
    const refund = await prisma.refund.create({
      data: {
        id: uuidv4(),
        order_id: request.orderId,
        payment_id: order.payment.id,
        amount: request.amount,
        status: 'pending',
        reason: request.reason,
        type: refundType,
        items: request.items || [],
        processed_by: request.processedBy,
        created_at: new Date(),
      },
    });

    // Queue refund processing
    await this.refundQueue.add('process-refund', {
      refundId: refund.id,
      paymentMethod: order.payment.method,
      paymentDetails: order.payment.details,
    });

    // Send notification
    await this.refundQueue.add('notify-refund', {
      refundId: refund.id,
      customerId: order.customer_id,
      type: 'initiated',
    });

    return {
      success: true,
      refundId: refund.id,
      amount: request.amount,
      status: 'pending',
      estimatedTime: this.getEstimatedProcessingTime(order.payment.method),
      message: 'Refund initiated successfully',
    };
  }

  async executeRefund(data: {
    refundId: string;
    paymentMethod: string;
    paymentDetails: any;
  }): Promise<void> {
    const refund = await prisma.refund.findUnique({
      where: { id: data.refundId },
    });

    if (!refund || refund.status !== 'pending') {
      return;
    }

    try {
      // Update status to processing
      await prisma.refund.update({
        where: { id: data.refundId },
        data: { status: 'processing' },
      });

      // Process refund based on payment method
      let transactionId: string;
      
      switch (data.paymentMethod) {
        case 'card':
          transactionId = await this.processCardRefund(refund, data.paymentDetails);
          break;
        case 'wallet':
          transactionId = await this.processWalletRefund(refund, data.paymentDetails);
          break;
        case 'crypto':
          transactionId = await this.processCryptoRefund(refund, data.paymentDetails);
          break;
        default:
          throw new Error(`Unsupported payment method: ${data.paymentMethod}`);
      }

      // Update refund status
      await prisma.refund.update({
        where: { id: data.refundId },
        data: {
          status: 'completed',
          transaction_id: transactionId,
          processed_at: new Date(),
        },
      });

      // Update order refund amount
      await prisma.order.update({
        where: { id: refund.order_id },
        data: {
          refund_amount: { increment: refund.amount },
        },
      });

      // Send success notification
      await this.refundQueue.add('notify-refund', {
        refundId: refund.id,
        type: 'completed',
      });

    } catch (error) {
      logger.error('Refund processing failed:', error);
      
      // Update status to failed
      await prisma.refund.update({
        where: { id: data.refundId },
        data: {
          status: 'failed',
          error: error.message,
          failed_at: new Date(),
        },
      });

      // Send failure notification
      await this.refundQueue.add('notify-refund', {
        refundId: refund.id,
        type: 'failed',
        error: error.message,
      });
    }
  }

  async getRefundDetails(orderId: string, userId: string): Promise<{
    refunds: Refund[];
    totalRefunded: number;
    pendingRefunds: number;
    refundPolicy: RefundPolicy;
  }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        refunds: true,
        orderItems: {
          include: { item: true },
        },
        payment: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Verify user has access
    if (order.customer_id !== userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (!user || (user.merchant_id !== order.merchant_id && user.role !== 'ADMIN')) {
        throw new Error('Unauthorized access');
      }
    }

    const refunds = order.refunds.map(r => this.mapToRefund(r));
    const totalRefunded = refunds
      .filter(r => r.status === 'completed')
      .reduce((sum, r) => sum + r.amount, 0);
    const pendingRefunds = refunds
      .filter(r => r.status === 'pending' || r.status === 'processing')
      .reduce((sum, r) => sum + r.amount, 0);

    const refundPolicy = await this.getRefundPolicy(order);

    return {
      refunds,
      totalRefunded,
      pendingRefunds,
      refundPolicy,
    };
  }

  async getRefundPolicy(order: any): Promise<RefundPolicy> {
    const totalRefunded = order.refunds
      ?.filter((r: any) => r.status === 'completed')
      .reduce((sum: number, r: any) => sum + r.amount, 0) || 0;

    const maxRefundAmount = order.total - totalRefunded;
    const orderAge = dayjs().diff(order.created_at, 'day');

    // Determine eligibility
    let eligible = true;
    let reason;

    if (order.status === 'cancelled') {
      eligible = false;
      reason = 'Order already cancelled';
    } else if (orderAge > 30) {
      eligible = false;
      reason = 'Refund period expired (30 days)';
    } else if (maxRefundAmount <= 0) {
      eligible = false;
      reason = 'Order already fully refunded';
    }

    // Get eligible items
    const eligibleItems = order.orderItems.map((item: any) => {
      const itemRefunds = order.refunds
        ?.filter((r: any) => r.status === 'completed' && r.items?.some((i: any) => i.itemId === item.item_id))
        .reduce((sum: number, r: any) => {
          const itemRefund = r.items.find((i: any) => i.itemId === item.item_id);
          return sum + (itemRefund?.amount || 0);
        }, 0) || 0;

      return {
        itemId: item.item_id,
        name: item.item.name,
        maxRefundAmount: (item.price * item.quantity) - itemRefunds,
        quantity: item.quantity,
      };
    }).filter((item: any) => item.maxRefundAmount > 0);

    return {
      eligible,
      reason,
      maxRefundAmount,
      eligibleItems,
      processingTime: this.getEstimatedProcessingTime(order.payment?.method),
      refundMethod: order.payment?.method || 'original payment method',
    };
  }

  async notifyRefundStatus(data: {
    refundId: string;
    type: string;
    error?: string;
  }): Promise<void> {
    const refund = await prisma.refund.findUnique({
      where: { id: data.refundId },
      include: {
        order: {
          include: { customer: true },
        },
      },
    });

    if (!refund) return;

    // Send notification based on type
    const notificationData = {
      orderId: refund.order_id,
      refundAmount: refund.amount,
      status: data.type,
      error: data.error,
    };

    // This would integrate with notification service
    logger.info(`Sending refund notification: ${data.type}`, notificationData);
  }

  private determineRefundType(request: RefundRequest, order: any): string {
    if (request.amount === order.total) {
      return 'full';
    } else if (request.items && request.items.length > 0) {
      return 'item';
    } else {
      return 'partial';
    }
  }

  private getEstimatedProcessingTime(paymentMethod: string): string {
    const processingTimes: { [key: string]: string } = {
      card: '3-5 business days',
      wallet: '1-2 business days',
      crypto: '1-24 hours',
      cash: 'Instant',
    };

    return processingTimes[paymentMethod] || '3-5 business days';
  }

  private async processCardRefund(refund: any, paymentDetails: any): Promise<string> {
    // This would integrate with payment processor (Stripe, etc.)
    logger.info('Processing card refund:', {
      refundId: refund.id,
      amount: refund.amount,
    });

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return `card_refund_${uuidv4()}`;
  }

  private async processWalletRefund(refund: any, paymentDetails: any): Promise<string> {
    // Process wallet refund
    logger.info('Processing wallet refund:', {
      refundId: refund.id,
      amount: refund.amount,
    });

    // Add funds back to wallet
    await prisma.wallet.update({
      where: { customer_id: refund.order.customer_id },
      data: {
        balance: { increment: refund.amount },
      },
    });

    // Create wallet transaction
    await prisma.walletTransaction.create({
      data: {
        id: uuidv4(),
        wallet_id: paymentDetails.wallet_id,
        type: 'credit',
        amount: refund.amount,
        description: `Refund for order #${refund.order_id}`,
        reference_type: 'refund',
        reference_id: refund.id,
      },
    });

    return `wallet_refund_${uuidv4()}`;
  }

  private async processCryptoRefund(refund: any, paymentDetails: any): Promise<string> {
    // Process crypto refund
    logger.info('Processing crypto refund:', {
      refundId: refund.id,
      amount: refund.amount,
      crypto: paymentDetails.cryptocurrency,
    });

    // This would integrate with blockchain service
    await new Promise(resolve => setTimeout(resolve, 2000));

    return `crypto_refund_${uuidv4()}`;
  }

  private mapToRefund(dbRefund: any): Refund {
    return {
      id: dbRefund.id,
      orderId: dbRefund.order_id,
      amount: dbRefund.amount,
      status: dbRefund.status,
      reason: dbRefund.reason,
      type: dbRefund.type,
      paymentMethod: dbRefund.payment?.method || 'unknown',
      transactionId: dbRefund.transaction_id,
      processedBy: dbRefund.processed_by,
      processedAt: dbRefund.processed_at,
      createdAt: dbRefund.created_at,
    };
  }
}