import { prisma, logger } from '@reskflow/shared';
import { RefundService } from './RefundService';
import { ModificationValidationService } from './ModificationValidationService';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface CancellationRequest {
  orderId: string;
  initiatedBy: string;
  reason: string;
  details?: string;
}

interface CancellationResult {
  success: boolean;
  cancellationId: string;
  refundAmount: number;
  refundStatus: string;
  message: string;
  penaltyApplied: boolean;
  penaltyAmount?: number;
}

interface CancellationPolicy {
  canCancel: boolean;
  reason?: string;
  refundPercentage: number;
  penaltyAmount: number;
  cutoffTime?: Date;
  rules: Array<{
    stage: string;
    refundPercentage: number;
    penalty: number;
    description: string;
  }>;
}

interface CancellationAnalytics {
  totalCancellations: number;
  cancellationRate: number;
  byReason: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  byStage: Array<{
    stage: string;
    count: number;
    averageRefund: number;
  }>;
  byInitiator: {
    customer: number;
    merchant: number;
    driver: number;
    system: number;
  };
  financialImpact: {
    totalRefunded: number;
    totalPenalties: number;
    netLoss: number;
  };
  timeToCancel: {
    average: number;
    median: number;
  };
}

export class CancellationService {
  private readonly CANCELLATION_REASONS = {
    customer: [
      'changed_mind',
      'found_alternative',
      'price_too_high',
      'wait_time_too_long',
      'ordered_by_mistake',
      'other',
    ],
    merchant: [
      'out_of_stock',
      'closing_early',
      'too_busy',
      'technical_issue',
      'other',
    ],
    driver: [
      'vehicle_breakdown',
      'accident',
      'emergency',
      'other',
    ],
    system: [
      'payment_failed',
      'fraud_detected',
      'merchant_unavailable',
      'no_drivers_available',
    ],
  };

  constructor(
    private refundService: RefundService,
    private validationService: ModificationValidationService
  ) {}

  async cancelOrder(request: CancellationRequest): Promise<CancellationResult> {
    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: request.orderId },
      include: {
        payment: true,
        reskflow: true,
        merchant: true,
        orderItems: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Check if order can be cancelled
    const canCancel = await this.validationService.canCancelOrder(
      order,
      request.initiatedBy
    );

    if (!canCancel.allowed) {
      throw new Error(canCancel.reason || 'Order cannot be cancelled');
    }

    // Get cancellation policy
    const policy = await this.getCancellationPolicy(request.orderId);

    // Create cancellation record
    const cancellation = await prisma.orderCancellation.create({
      data: {
        id: uuidv4(),
        order_id: request.orderId,
        initiated_by: request.initiatedBy,
        reason: request.reason,
        details: request.details,
        order_status_at_cancellation: order.status,
        refund_percentage: policy.refundPercentage,
        penalty_amount: policy.penaltyAmount,
        created_at: new Date(),
      },
    });

    // Update order status
    await prisma.order.update({
      where: { id: request.orderId },
      data: {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancellation_reason: request.reason,
      },
    });

    // Calculate refund amount
    const refundAmount = this.calculateRefundAmount(
      order,
      policy.refundPercentage,
      policy.penaltyAmount
    );

    // Process refund if applicable
    let refundStatus = 'not_applicable';
    if (refundAmount > 0 && order.payment?.status === 'completed') {
      const refund = await this.refundService.processRefund({
        orderId: request.orderId,
        amount: refundAmount,
        reason: `Order cancelled: ${request.reason}`,
        processedBy: request.initiatedBy,
      });
      refundStatus = refund.status;
    }

    // Update inventory
    await this.restoreInventory(order);

    // Notify all parties
    await this.notifyCancellation(order, cancellation);

    // Handle driver compensation if applicable
    if (order.reskflow && order.status !== 'pending') {
      await this.handleDriverCompensation(order, cancellation);
    }

    return {
      success: true,
      cancellationId: cancellation.id,
      refundAmount,
      refundStatus,
      message: 'Order cancelled successfully',
      penaltyApplied: policy.penaltyAmount > 0,
      penaltyAmount: policy.penaltyAmount,
    };
  }

  async getCancellationPolicy(orderId: string): Promise<CancellationPolicy> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        merchant: true,
        reskflow: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Get merchant cancellation policy
    const merchantPolicy = order.merchant.cancellation_policy || this.getDefaultPolicy();

    // Calculate time-based factors
    const orderAge = dayjs().diff(order.created_at, 'minute');
    const timeToDelivery = order.estimated_reskflow_time
      ? dayjs(order.estimated_reskflow_time).diff(dayjs(), 'minute')
      : null;

    // Determine refund percentage based on order status and time
    let refundPercentage = 100;
    let penaltyAmount = 0;
    let canCancel = true;
    let reason;

    const rules = [];

    switch (order.status) {
      case 'pending':
        refundPercentage = 100;
        rules.push({
          stage: 'pending',
          refundPercentage: 100,
          penalty: 0,
          description: 'Full refund for unconfirmed orders',
        });
        break;

      case 'confirmed':
        if (orderAge < 5) {
          refundPercentage = 100;
        } else if (orderAge < 10) {
          refundPercentage = 90;
          penaltyAmount = order.total * 0.1;
        } else {
          refundPercentage = 80;
          penaltyAmount = order.total * 0.2;
        }
        rules.push({
          stage: 'confirmed',
          refundPercentage,
          penalty: penaltyAmount,
          description: 'Partial refund after merchant confirmation',
        });
        break;

      case 'preparing':
        if (merchantPolicy.allowCancellationDuringPreparation) {
          refundPercentage = 50;
          penaltyAmount = order.total * 0.5;
        } else {
          canCancel = false;
          reason = 'Cannot cancel while order is being prepared';
        }
        rules.push({
          stage: 'preparing',
          refundPercentage,
          penalty: penaltyAmount,
          description: 'Limited refund during preparation',
        });
        break;

      case 'ready':
      case 'assigned':
      case 'picked_up':
        canCancel = false;
        reason = 'Order has already been prepared/picked up';
        refundPercentage = 0;
        rules.push({
          stage: order.status,
          refundPercentage: 0,
          penalty: order.total,
          description: 'No refund after preparation complete',
        });
        break;

      case 'delivered':
      case 'cancelled':
        canCancel = false;
        reason = 'Order already completed/cancelled';
        break;
    }

    // Apply time-based penalties
    if (timeToDelivery && timeToDelivery < 30 && canCancel) {
      penaltyAmount += order.reskflow_fee;
      rules.push({
        stage: 'near_reskflow',
        refundPercentage: refundPercentage - 10,
        penalty: order.reskflow_fee,
        description: 'Additional penalty for last-minute cancellation',
      });
    }

    return {
      canCancel,
      reason,
      refundPercentage,
      penaltyAmount,
      cutoffTime: order.estimated_reskflow_time
        ? dayjs(order.estimated_reskflow_time).subtract(30, 'minute').toDate()
        : undefined,
      rules,
    };
  }

  async getCancellationAnalytics(
    merchantId: string,
    period: string = '30d'
  ): Promise<CancellationAnalytics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all cancellations
    const cancellations = await prisma.$queryRaw`
      SELECT 
        oc.*,
        o.merchant_id,
        o.total,
        o.status as order_status
      FROM order_cancellations oc
      JOIN orders o ON oc.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND oc.created_at >= ${startDate}
    `;

    const cancellationList = cancellations as any[];

    // Get total orders for rate calculation
    const totalOrders = await prisma.order.count({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
      },
    });

    // Calculate metrics
    const totalCancellations = cancellationList.length;
    const cancellationRate = totalOrders > 0 
      ? (totalCancellations / totalOrders) * 100 
      : 0;

    // Group by reason
    const reasonCounts = new Map<string, number>();
    cancellationList.forEach(c => {
      const reason = c.reason || 'other';
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    const byReason = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / totalCancellations) * 100,
      }))
      .sort((a, b) => b.count - a.count);

    // Group by stage
    const stageCounts = new Map<string, { count: number; refunds: number[] }>();
    cancellationList.forEach(c => {
      const stage = c.order_status_at_cancellation;
      if (!stageCounts.has(stage)) {
        stageCounts.set(stage, { count: 0, refunds: [] });
      }
      const stats = stageCounts.get(stage)!;
      stats.count++;
      const refundAmount = (c.total * c.refund_percentage) / 100 - c.penalty_amount;
      stats.refunds.push(Math.max(0, refundAmount));
    });

    const byStage = Array.from(stageCounts.entries())
      .map(([stage, stats]) => ({
        stage,
        count: stats.count,
        averageRefund: stats.refunds.length > 0
          ? stats.refunds.reduce((a, b) => a + b, 0) / stats.refunds.length
          : 0,
      }));

    // Group by initiator
    const initiatorCounts = {
      customer: 0,
      merchant: 0,
      driver: 0,
      system: 0,
    };

    cancellationList.forEach(c => {
      // Determine initiator type based on user role
      const initiatorType = this.getInitiatorType(c.initiated_by);
      if (initiatorType in initiatorCounts) {
        initiatorCounts[initiatorType as keyof typeof initiatorCounts]++;
      }
    });

    // Calculate financial impact
    const financialImpact = cancellationList.reduce(
      (acc, c) => {
        const refundAmount = (c.total * c.refund_percentage) / 100;
        acc.totalRefunded += refundAmount;
        acc.totalPenalties += c.penalty_amount || 0;
        return acc;
      },
      { totalRefunded: 0, totalPenalties: 0, netLoss: 0 }
    );
    financialImpact.netLoss = financialImpact.totalRefunded - financialImpact.totalPenalties;

    // Calculate time to cancel
    const cancelTimes = cancellationList
      .map(c => dayjs(c.created_at).diff(c.order_created_at, 'minute'))
      .sort((a, b) => a - b);

    const timeToCancel = {
      average: cancelTimes.length > 0
        ? cancelTimes.reduce((a, b) => a + b, 0) / cancelTimes.length
        : 0,
      median: cancelTimes.length > 0
        ? cancelTimes[Math.floor(cancelTimes.length / 2)]
        : 0,
    };

    return {
      totalCancellations,
      cancellationRate,
      byReason,
      byStage,
      byInitiator: initiatorCounts,
      financialImpact,
      timeToCancel,
    };
  }

  private calculateRefundAmount(
    order: any,
    refundPercentage: number,
    penaltyAmount: number
  ): number {
    const baseRefund = (order.total * refundPercentage) / 100;
    const finalRefund = Math.max(0, baseRefund - penaltyAmount);
    return Math.round(finalRefund * 100) / 100; // Round to 2 decimal places
  }

  private async restoreInventory(order: any): Promise<void> {
    for (const item of order.orderItems) {
      await prisma.item.update({
        where: { id: item.item_id },
        data: {
          stock_quantity: { increment: item.quantity },
        },
      });
    }
  }

  private async notifyCancellation(order: any, cancellation: any): Promise<void> {
    // Notify customer
    await this.sendCancellationNotification(order.customer_id, {
      orderId: order.id,
      reason: cancellation.reason,
      refundAmount: this.calculateRefundAmount(
        order,
        cancellation.refund_percentage,
        cancellation.penalty_amount
      ),
    });

    // Notify merchant
    await this.sendCancellationNotification(order.merchant_id, {
      orderId: order.id,
      reason: cancellation.reason,
      initiatedBy: cancellation.initiated_by,
    });

    // Notify driver if assigned
    if (order.reskflow?.driver_id) {
      await this.sendCancellationNotification(order.reskflow.driver_id, {
        orderId: order.id,
        reason: cancellation.reason,
      });
    }
  }

  private async handleDriverCompensation(order: any, cancellation: any): Promise<void> {
    if (!order.reskflow || order.reskflow.status === 'pending') {
      return;
    }

    // Calculate compensation based on progress
    let compensationAmount = 0;
    
    if (order.reskflow.status === 'assigned') {
      compensationAmount = order.reskflow_fee * 0.25;
    } else if (order.reskflow.status === 'arrived_at_pickup') {
      compensationAmount = order.reskflow_fee * 0.5;
    } else if (order.reskflow.status === 'picked_up') {
      compensationAmount = order.reskflow_fee * 0.75;
    }

    if (compensationAmount > 0) {
      await prisma.driverCompensation.create({
        data: {
          id: uuidv4(),
          driver_id: order.reskflow.driver_id,
          order_id: order.id,
          cancellation_id: cancellation.id,
          amount: compensationAmount,
          reason: 'Order cancelled after assignment',
          status: 'pending',
        },
      });
    }
  }

  private getDefaultPolicy(): any {
    return {
      allowCancellationDuringPreparation: false,
      refundPercentages: {
        pending: 100,
        confirmed: 90,
        preparing: 50,
        ready: 0,
      },
      penalties: {
        lastMinute: 10, // Percentage
        noShow: 100,
      },
    };
  }

  private getInitiatorType(userId: string): string {
    // This would check user role from database
    // For now, return based on ID pattern
    if (userId.startsWith('customer_')) return 'customer';
    if (userId.startsWith('merchant_')) return 'merchant';
    if (userId.startsWith('driver_')) return 'driver';
    if (userId.startsWith('system')) return 'system';
    return 'customer';
  }

  private async sendCancellationNotification(
    recipientId: string,
    data: any
  ): Promise<void> {
    // Send notification through notification service
    logger.info(`Sending cancellation notification to ${recipientId}`, data);
  }
}