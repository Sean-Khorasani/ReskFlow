import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';

interface CompensationPolicy {
  id: string;
  name: string;
  triggerType: 'automatic' | 'manual' | 'approval_required';
  conditions: {
    issueType: string;
    severityThreshold: number;
    compensationType: 'refund' | 'credit' | 'discount' | 'replacement';
    compensationAmount: number | 'percentage' | 'full';
    maxAmount?: number;
  }[];
  active: boolean;
}

interface CompensationRequest {
  id: string;
  orderId: string;
  customerId: string;
  merchantId: string;
  reason: string;
  requestedAmount: number;
  approvedAmount?: number;
  type: 'refund' | 'credit' | 'discount' | 'replacement';
  status: 'pending' | 'approved' | 'rejected' | 'processed';
  createdAt: Date;
  processedAt?: Date;
}

interface CompensationCalculation {
  orderId: string;
  baseAmount: number;
  adjustments: {
    reason: string;
    amount: number;
    type: 'add' | 'subtract';
  }[];
  finalAmount: number;
  compensationType: 'refund' | 'credit' | 'discount';
  justification: string;
}

export class CompensationService {
  private policies: Map<string, CompensationPolicy>;

  constructor() {
    this.policies = new Map();
    this.loadCompensationPolicies();
  }

  async calculateCompensation(params: {
    orderId: string;
    issueType: string;
    severity: number;
    customerId: string;
  }): Promise<CompensationCalculation> {
    try {
      // Get order details
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          orderItems: true,
          merchant: true,
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Get customer history for loyalty adjustment
      const customerHistory = await this.getCustomerCompensationHistory(params.customerId);
      
      // Find applicable policy
      const policy = this.findApplicablePolicy(params.issueType, params.severity);
      
      // Calculate base compensation
      let baseAmount = 0;
      let compensationType: 'refund' | 'credit' | 'discount' = 'credit';
      const adjustments: any[] = [];

      if (policy) {
        const condition = policy.conditions.find(c => 
          c.issueType === params.issueType && params.severity >= c.severityThreshold
        );

        if (condition) {
          if (condition.compensationAmount === 'full') {
            baseAmount = order.total;
          } else if (condition.compensationAmount === 'percentage') {
            baseAmount = order.subtotal * 0.5; // 50% default
          } else {
            baseAmount = condition.compensationAmount as number;
          }

          compensationType = condition.compensationType as any;
        }
      }

      // Apply adjustments
      if (customerHistory.totalCompensations === 0) {
        // First-time issue bonus
        adjustments.push({
          reason: 'First-time issue consideration',
          amount: baseAmount * 0.2,
          type: 'add',
        });
      }

      if (customerHistory.frequentCustomer) {
        // Loyalty bonus
        adjustments.push({
          reason: 'Valued customer adjustment',
          amount: baseAmount * 0.15,
          type: 'add',
        });
      }

      if (customerHistory.recentCompensations > 2) {
        // Frequent claims adjustment
        adjustments.push({
          reason: 'Multiple recent claims',
          amount: baseAmount * 0.3,
          type: 'subtract',
        });
      }

      // Calculate final amount
      let finalAmount = baseAmount;
      adjustments.forEach(adj => {
        if (adj.type === 'add') {
          finalAmount += adj.amount;
        } else {
          finalAmount -= adj.amount;
        }
      });

      // Apply max limits
      if (policy && policy.conditions[0]?.maxAmount) {
        finalAmount = Math.min(finalAmount, policy.conditions[0].maxAmount);
      }

      // Ensure minimum compensation
      finalAmount = Math.max(finalAmount, 5); // Minimum $5

      return {
        orderId: params.orderId,
        baseAmount,
        adjustments,
        finalAmount: Number(finalAmount.toFixed(2)),
        compensationType,
        justification: this.generateJustification(params.issueType, params.severity, policy),
      };
    } catch (error) {
      logger.error('Error calculating compensation:', error);
      throw error;
    }
  }

  async requestCompensation(params: {
    orderId: string;
    customerId: string;
    reason: string;
    requestedAmount?: number;
    evidence?: string[];
  }): Promise<CompensationRequest> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: { merchant: true },
      });

      if (!order || order.customer_id !== params.customerId) {
        throw new Error('Order not found or unauthorized');
      }

      // Check for existing request
      const existing = await prisma.compensationRequest.findFirst({
        where: {
          order_id: params.orderId,
          status: { in: ['pending', 'approved'] },
        },
      });

      if (existing) {
        throw new Error('Compensation request already exists for this order');
      }

      // Analyze the reason to determine compensation
      const analysis = await this.analyzeCompensationReason(params.reason);
      
      // Calculate suggested compensation
      const calculation = await this.calculateCompensation({
        orderId: params.orderId,
        issueType: analysis.issueType,
        severity: analysis.severity,
        customerId: params.customerId,
      });

      // Create request
      const request = await prisma.compensationRequest.create({
        data: {
          order_id: params.orderId,
          customer_id: params.customerId,
          merchant_id: order.merchant_id,
          reason: params.reason,
          issue_type: analysis.issueType,
          severity: analysis.severity,
          requested_amount: params.requestedAmount || calculation.finalAmount,
          suggested_amount: calculation.finalAmount,
          type: calculation.compensationType,
          status: this.requiresApproval(calculation.finalAmount) ? 'pending' : 'approved',
          evidence: params.evidence || [],
          created_at: new Date(),
        },
      });

      // Auto-approve if within limits
      if (request.status === 'approved') {
        await this.processCompensation(request.id);
      }

      return this.formatCompensationRequest(request);
    } catch (error) {
      logger.error('Error requesting compensation:', error);
      throw error;
    }
  }

  async approveCompensation(params: {
    requestId: string;
    approvedBy: string;
    approvedAmount?: number;
    notes?: string;
  }): Promise<CompensationRequest> {
    try {
      const request = await prisma.compensationRequest.findUnique({
        where: { id: params.requestId },
      });

      if (!request || request.status !== 'pending') {
        throw new Error('Request not found or already processed');
      }

      // Update request
      const updated = await prisma.compensationRequest.update({
        where: { id: params.requestId },
        data: {
          status: 'approved',
          approved_amount: params.approvedAmount || request.suggested_amount,
          approved_by: params.approvedBy,
          approved_at: new Date(),
          approval_notes: params.notes,
        },
      });

      // Process compensation
      await this.processCompensation(params.requestId);

      return this.formatCompensationRequest(updated);
    } catch (error) {
      logger.error('Error approving compensation:', error);
      throw error;
    }
  }

  async rejectCompensation(params: {
    requestId: string;
    rejectedBy: string;
    reason: string;
  }): Promise<CompensationRequest> {
    try {
      const updated = await prisma.compensationRequest.update({
        where: { id: params.requestId },
        data: {
          status: 'rejected',
          rejected_by: params.rejectedBy,
          rejected_at: new Date(),
          rejection_reason: params.reason,
        },
      });

      return this.formatCompensationRequest(updated);
    } catch (error) {
      logger.error('Error rejecting compensation:', error);
      throw error;
    }
  }

  async getCompensationHistory(params: {
    customerId?: string;
    merchantId?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
  }): Promise<CompensationRequest[]> {
    const where: any = {};

    if (params.customerId) where.customer_id = params.customerId;
    if (params.merchantId) where.merchant_id = params.merchantId;
    if (params.status) where.status = params.status;
    if (params.startDate || params.endDate) {
      where.created_at = {};
      if (params.startDate) where.created_at.gte = params.startDate;
      if (params.endDate) where.created_at.lte = params.endDate;
    }

    const requests = await prisma.compensationRequest.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return requests.map(request => this.formatCompensationRequest(request));
  }

  async getCompensationStats(params: {
    merchantId?: string;
    period: { start: Date; end: Date };
  }): Promise<{
    totalRequests: number;
    totalApproved: number;
    totalAmount: number;
    averageAmount: number;
    approvalRate: number;
    byType: Record<string, number>;
    byReason: Record<string, number>;
  }> {
    const where: any = {
      created_at: {
        gte: params.period.start,
        lte: params.period.end,
      },
    };

    if (params.merchantId) where.merchant_id = params.merchantId;

    const requests = await prisma.compensationRequest.findMany({ where });

    const stats = {
      totalRequests: requests.length,
      totalApproved: requests.filter(r => r.status === 'approved').length,
      totalAmount: 0,
      averageAmount: 0,
      approvalRate: 0,
      byType: {} as Record<string, number>,
      byReason: {} as Record<string, number>,
    };

    requests.forEach(request => {
      if (request.status === 'approved' || request.status === 'processed') {
        stats.totalAmount += request.approved_amount || 0;
      }

      // Count by type
      stats.byType[request.type] = (stats.byType[request.type] || 0) + 1;

      // Count by reason
      stats.byReason[request.issue_type] = (stats.byReason[request.issue_type] || 0) + 1;
    });

    stats.averageAmount = stats.totalApproved > 0 ? stats.totalAmount / stats.totalApproved : 0;
    stats.approvalRate = stats.totalRequests > 0 ? stats.totalApproved / stats.totalRequests : 0;

    return stats;
  }

  private async processCompensation(requestId: string): Promise<void> {
    const request = await prisma.compensationRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== 'approved') {
      throw new Error('Request not approved');
    }

    const amount = request.approved_amount || request.suggested_amount;

    try {
      switch (request.type) {
        case 'refund':
          await this.processRefund(request.order_id, amount);
          break;
        case 'credit':
          await this.processCredit(request.customer_id, amount, request.order_id);
          break;
        case 'discount':
          await this.processDiscount(request.customer_id, amount);
          break;
        case 'replacement':
          await this.processReplacement(request.order_id);
          break;
      }

      // Update request status
      await prisma.compensationRequest.update({
        where: { id: requestId },
        data: {
          status: 'processed',
          processed_at: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error processing compensation:', error);
      throw error;
    }
  }

  private async processRefund(orderId: string, amount: number): Promise<void> {
    // Create refund record
    await prisma.refund.create({
      data: {
        order_id: orderId,
        amount,
        reason: 'Quality issue compensation',
        status: 'pending',
        created_at: new Date(),
      },
    });

    // In production, this would integrate with payment gateway
    logger.info(`Refund initiated for order ${orderId}: $${amount}`);
  }

  private async processCredit(
    customerId: string,
    amount: number,
    orderId: string
  ): Promise<void> {
    await prisma.customerCredit.create({
      data: {
        customer_id: customerId,
        order_id: orderId,
        amount,
        reason: 'Quality issue compensation',
        expires_at: dayjs().add(90, 'day').toDate(),
        created_at: new Date(),
      },
    });
  }

  private async processDiscount(customerId: string, amount: number): Promise<void> {
    // Create discount code
    const code = this.generateDiscountCode();
    
    await prisma.discountCode.create({
      data: {
        code,
        customer_id: customerId,
        type: 'fixed',
        value: amount,
        max_uses: 1,
        expires_at: dayjs().add(30, 'day').toDate(),
        created_at: new Date(),
      },
    });
  }

  private async processReplacement(orderId: string): Promise<void> {
    // Create replacement order
    const originalOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!originalOrder) return;

    // Clone order with replacement flag
    await prisma.order.create({
      data: {
        ...originalOrder,
        id: undefined,
        original_order_id: orderId,
        is_replacement: true,
        total: 0, // No charge for replacement
        created_at: new Date(),
      },
    });
  }

  private loadCompensationPolicies(): void {
    // Load default policies
    const policies: CompensationPolicy[] = [
      {
        id: 'missing-items',
        name: 'Missing Items Policy',
        triggerType: 'automatic',
        conditions: [
          {
            issueType: 'missing_items',
            severityThreshold: 1,
            compensationType: 'refund',
            compensationAmount: 'full',
          },
        ],
        active: true,
      },
      {
        id: 'late-reskflow',
        name: 'Late Delivery Policy',
        triggerType: 'automatic',
        conditions: [
          {
            issueType: 'late_reskflow',
            severityThreshold: 30, // 30+ minutes late
            compensationType: 'credit',
            compensationAmount: 10,
            maxAmount: 20,
          },
        ],
        active: true,
      },
      {
        id: 'food-quality',
        name: 'Food Quality Policy',
        triggerType: 'approval_required',
        conditions: [
          {
            issueType: 'food_quality',
            severityThreshold: 3,
            compensationType: 'credit',
            compensationAmount: 'percentage',
          },
        ],
        active: true,
      },
    ];

    policies.forEach(policy => this.policies.set(policy.id, policy));
  }

  private findApplicablePolicy(issueType: string, severity: number): CompensationPolicy | null {
    for (const policy of this.policies.values()) {
      if (!policy.active) continue;
      
      const applicable = policy.conditions.some(condition =>
        condition.issueType === issueType && severity >= condition.severityThreshold
      );

      if (applicable) return policy;
    }

    return null;
  }

  private async getCustomerCompensationHistory(customerId: string): Promise<{
    totalCompensations: number;
    recentCompensations: number;
    totalAmount: number;
    frequentCustomer: boolean;
  }> {
    const thirtyDaysAgo = dayjs().subtract(30, 'day').toDate();
    
    const [total, recent, orders] = await Promise.all([
      prisma.compensationRequest.count({
        where: {
          customer_id: customerId,
          status: { in: ['approved', 'processed'] },
        },
      }),
      prisma.compensationRequest.count({
        where: {
          customer_id: customerId,
          status: { in: ['approved', 'processed'] },
          created_at: { gte: thirtyDaysAgo },
        },
      }),
      prisma.order.count({
        where: {
          customer_id: customerId,
          created_at: { gte: dayjs().subtract(90, 'day').toDate() },
        },
      }),
    ]);

    const amounts = await prisma.compensationRequest.aggregate({
      where: {
        customer_id: customerId,
        status: { in: ['approved', 'processed'] },
      },
      _sum: {
        approved_amount: true,
      },
    });

    return {
      totalCompensations: total,
      recentCompensations: recent,
      totalAmount: amounts._sum.approved_amount || 0,
      frequentCustomer: orders >= 10,
    };
  }

  private async analyzeCompensationReason(reason: string): Promise<{
    issueType: string;
    severity: number;
  }> {
    // Simple keyword analysis - in production, use NLP
    const lowerReason = reason.toLowerCase();
    
    if (lowerReason.includes('missing') || lowerReason.includes('did not receive')) {
      return { issueType: 'missing_items', severity: 5 };
    }
    if (lowerReason.includes('late') || lowerReason.includes('delay')) {
      return { issueType: 'late_reskflow', severity: 3 };
    }
    if (lowerReason.includes('cold') || lowerReason.includes('quality')) {
      return { issueType: 'food_quality', severity: 3 };
    }
    if (lowerReason.includes('wrong') || lowerReason.includes('incorrect')) {
      return { issueType: 'wrong_items', severity: 4 };
    }

    return { issueType: 'other', severity: 2 };
  }

  private requiresApproval(amount: number): boolean {
    // Require approval for amounts over $50
    return amount > 50;
  }

  private generateJustification(
    issueType: string,
    severity: number,
    policy: CompensationPolicy | null
  ): string {
    if (!policy) {
      return 'Compensation calculated based on standard guidelines';
    }

    const reasons = {
      missing_items: 'Full refund for missing items per policy',
      late_reskflow: 'Credit applied for reskflow delay',
      food_quality: 'Partial compensation for quality issues',
      wrong_items: 'Compensation for incorrect order',
    };

    return reasons[issueType as keyof typeof reasons] || 'Standard compensation applied';
  }

  private generateDiscountCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'COMP';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private formatCompensationRequest(request: any): CompensationRequest {
    return {
      id: request.id,
      orderId: request.order_id,
      customerId: request.customer_id,
      merchantId: request.merchant_id,
      reason: request.reason,
      requestedAmount: request.requested_amount,
      approvedAmount: request.approved_amount,
      type: request.type,
      status: request.status,
      createdAt: request.created_at,
      processedAt: request.processed_at,
    };
  }
}