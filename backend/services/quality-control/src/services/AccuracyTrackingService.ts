import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';
import { EventEmitter } from 'events';

interface OrderItem {
  itemId: string;
  quantity: number;
  modifiers: string[];
  specialInstructions?: string;
}

interface AccuracyReport {
  orderId: string;
  merchantId: string;
  orderedItems: OrderItem[];
  receivedItems: OrderItem[];
  missingItems: OrderItem[];
  incorrectItems: OrderItem[];
  extraItems: OrderItem[];
  accuracyScore: number;
  issues: AccuracyIssue[];
  reportedAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}

interface AccuracyIssue {
  type: 'missing' | 'incorrect' | 'extra' | 'quality' | 'packaging';
  itemId?: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  photoEvidence?: string[];
}

interface MerchantAccuracyMetrics {
  merchantId: string;
  totalOrders: number;
  accurateOrders: number;
  accuracyRate: number;
  commonIssues: { issue: string; count: number }[];
  trending: 'improving' | 'stable' | 'declining';
  lastUpdated: Date;
}

export class AccuracyTrackingService extends EventEmitter {
  private readonly ACCURACY_THRESHOLD = 0.95; // 95% accuracy required
  private readonly ISSUE_WINDOW_HOURS = 24;

  async reportOrderIssue(params: {
    orderId: string;
    customerId: string;
    issues: AccuracyIssue[];
    receivedItems?: OrderItem[];
    photoEvidence?: string[];
  }): Promise<AccuracyReport> {
    try {
      // Get order details
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          orderItems: {
            include: { item: true },
          },
          merchant: true,
        },
      });

      if (!order || order.customer_id !== params.customerId) {
        throw new Error('Order not found or unauthorized');
      }

      // Verify order was delivered recently
      const reskflowTime = order.delivered_at;
      if (!reskflowTime || dayjs().diff(reskflowTime, 'hour') > this.ISSUE_WINDOW_HOURS) {
        throw new Error('Issue reporting window has expired');
      }

      // Create accuracy report
      const orderedItems = this.formatOrderItems(order.orderItems);
      const receivedItems = params.receivedItems || orderedItems;
      
      const comparison = this.compareItems(orderedItems, receivedItems);
      const accuracyScore = this.calculateAccuracyScore(comparison);

      const report = await prisma.accuracyReport.create({
        data: {
          order_id: params.orderId,
          merchant_id: order.merchant_id,
          customer_id: params.customerId,
          ordered_items: orderedItems,
          received_items: receivedItems,
          missing_items: comparison.missing,
          incorrect_items: comparison.incorrect,
          extra_items: comparison.extra,
          accuracy_score: accuracyScore,
          issues: params.issues,
          photo_evidence: params.photoEvidence || [],
          reported_at: new Date(),
          status: 'pending',
        },
      });

      // Notify merchant
      this.emit('accuracy-issue-reported', {
        reportId: report.id,
        merchantId: order.merchant_id,
        orderId: params.orderId,
        issues: params.issues,
      });

      // Update merchant metrics
      await this.updateMerchantMetrics(order.merchant_id);

      // Check if automatic compensation should be triggered
      if (accuracyScore < 0.8) {
        await this.triggerAutomaticCompensation(report);
      }

      return this.formatAccuracyReport(report);
    } catch (error) {
      logger.error('Error reporting order issue:', error);
      throw error;
    }
  }

  async verifyOrderAccuracy(params: {
    orderId: string;
    customerId: string;
    photoEvidence?: string[];
  }): Promise<{
    verified: boolean;
    accuracyScore: number;
    detectedIssues: AccuracyIssue[];
  }> {
    try {
      // Get order details
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          orderItems: {
            include: { item: true },
          },
        },
      });

      if (!order || order.customer_id !== params.customerId) {
        throw new Error('Order not found or unauthorized');
      }

      // If photo evidence provided, analyze it
      let detectedIssues: AccuracyIssue[] = [];
      let photoAnalysisScore = 1.0;

      if (params.photoEvidence && params.photoEvidence.length > 0) {
        const analysis = await this.analyzePhotoEvidence(
          params.photoEvidence,
          order.orderItems
        );
        detectedIssues = analysis.issues;
        photoAnalysisScore = analysis.score;
      }

      // Record verification
      await prisma.orderVerification.create({
        data: {
          order_id: params.orderId,
          customer_id: params.customerId,
          verification_type: params.photoEvidence ? 'photo' : 'manual',
          accuracy_score: photoAnalysisScore,
          detected_issues: detectedIssues,
          verified_at: new Date(),
        },
      });

      return {
        verified: true,
        accuracyScore: photoAnalysisScore,
        detectedIssues,
      };
    } catch (error) {
      logger.error('Error verifying order accuracy:', error);
      throw error;
    }
  }

  async getMerchantAccuracyMetrics(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<MerchantAccuracyMetrics> {
    try {
      // Get all orders and reports for the period
      const [orders, reports] = await Promise.all([
        prisma.order.count({
          where: {
            merchant_id: merchantId,
            delivered_at: {
              gte: period.start,
              lte: period.end,
            },
          },
        }),
        prisma.accuracyReport.findMany({
          where: {
            merchant_id: merchantId,
            reported_at: {
              gte: period.start,
              lte: period.end,
            },
          },
        }),
      ]);

      // Calculate metrics
      const accurateOrders = orders - reports.length;
      const accuracyRate = orders > 0 ? accurateOrders / orders : 1;

      // Analyze common issues
      const issueMap = new Map<string, number>();
      reports.forEach(report => {
        report.issues.forEach(issue => {
          const key = `${issue.type}:${issue.description}`;
          issueMap.set(key, (issueMap.get(key) || 0) + 1);
        });
      });

      const commonIssues = Array.from(issueMap.entries())
        .map(([issue, count]) => ({ issue, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Determine trend
      const trending = await this.calculateAccuracyTrend(merchantId, accuracyRate);

      return {
        merchantId,
        totalOrders: orders,
        accurateOrders,
        accuracyRate,
        commonIssues,
        trending,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error('Error getting merchant accuracy metrics:', error);
      throw error;
    }
  }

  async resolveAccuracyReport(params: {
    reportId: string;
    merchantId: string;
    resolution: 'refund' | 'credit' | 'replacement' | 'apology' | 'disputed';
    compensationAmount?: number;
    notes?: string;
  }): Promise<AccuracyReport> {
    try {
      const report = await prisma.accuracyReport.findUnique({
        where: { id: params.reportId },
      });

      if (!report || report.merchant_id !== params.merchantId) {
        throw new Error('Report not found or unauthorized');
      }

      if (report.status !== 'pending') {
        throw new Error('Report already resolved');
      }

      // Update report
      const updated = await prisma.accuracyReport.update({
        where: { id: params.reportId },
        data: {
          status: 'resolved',
          resolution: params.resolution,
          resolved_at: new Date(),
          resolution_notes: params.notes,
          compensation_amount: params.compensationAmount,
        },
      });

      // Process compensation
      if (params.resolution !== 'disputed' && params.compensationAmount) {
        await this.processCompensation({
          orderId: report.order_id,
          customerId: report.customer_id,
          amount: params.compensationAmount,
          reason: `Accuracy issue resolution: ${params.resolution}`,
        });
      }

      // Notify customer
      this.emit('accuracy-issue-resolved', {
        reportId: params.reportId,
        customerId: report.customer_id,
        resolution: params.resolution,
      });

      return this.formatAccuracyReport(updated);
    } catch (error) {
      logger.error('Error resolving accuracy report:', error);
      throw error;
    }
  }

  async getAccuracyTrends(params: {
    merchantId?: string;
    period: 'day' | 'week' | 'month';
    limit?: number;
  }): Promise<{
    period: string;
    accuracyRate: number;
    totalOrders: number;
    reportedIssues: number;
  }[]> {
    const groupBy = params.period === 'day' ? 'day' : params.period === 'week' ? 'week' : 'month';
    const limit = params.limit || 30;

    const trends = await prisma.$queryRaw`
      WITH order_counts AS (
        SELECT 
          DATE_TRUNC(${groupBy}, delivered_at) as period,
          COUNT(*) as total_orders
        FROM orders
        WHERE delivered_at IS NOT NULL
          ${params.merchantId ? `AND merchant_id = ${params.merchantId}` : ''}
          AND delivered_at >= NOW() - INTERVAL '${limit} ${groupBy}s'
        GROUP BY period
      ),
      report_counts AS (
        SELECT 
          DATE_TRUNC(${groupBy}, reported_at) as period,
          COUNT(*) as reported_issues
        FROM accuracy_reports
        WHERE reported_at >= NOW() - INTERVAL '${limit} ${groupBy}s'
          ${params.merchantId ? `AND merchant_id = ${params.merchantId}` : ''}
        GROUP BY period
      )
      SELECT 
        o.period::text,
        o.total_orders::int,
        COALESCE(r.reported_issues, 0)::int as reported_issues,
        CASE 
          WHEN o.total_orders > 0 
          THEN ((o.total_orders - COALESCE(r.reported_issues, 0))::float / o.total_orders)
          ELSE 1
        END as accuracy_rate
      FROM order_counts o
      LEFT JOIN report_counts r ON o.period = r.period
      ORDER BY o.period DESC
    `;

    return trends;
  }

  async getCustomerReportHistory(customerId: string): Promise<AccuracyReport[]> {
    const reports = await prisma.accuracyReport.findMany({
      where: { customer_id: customerId },
      orderBy: { reported_at: 'desc' },
      take: 20,
    });

    return reports.map(report => this.formatAccuracyReport(report));
  }

  private formatOrderItems(orderItems: any[]): OrderItem[] {
    return orderItems.map(item => ({
      itemId: item.item_id,
      quantity: item.quantity,
      modifiers: item.modifiers || [],
      specialInstructions: item.special_instructions,
    }));
  }

  private compareItems(ordered: OrderItem[], received: OrderItem[]): {
    missing: OrderItem[];
    incorrect: OrderItem[];
    extra: OrderItem[];
  } {
    const orderedMap = new Map(ordered.map(item => [item.itemId, item]));
    const receivedMap = new Map(received.map(item => [item.itemId, item]));

    const missing: OrderItem[] = [];
    const incorrect: OrderItem[] = [];
    const extra: OrderItem[] = [];

    // Check ordered items
    ordered.forEach(orderedItem => {
      const receivedItem = receivedMap.get(orderedItem.itemId);
      if (!receivedItem) {
        missing.push(orderedItem);
      } else if (
        receivedItem.quantity !== orderedItem.quantity ||
        !this.arraysEqual(receivedItem.modifiers, orderedItem.modifiers)
      ) {
        incorrect.push(orderedItem);
      }
    });

    // Check for extra items
    received.forEach(receivedItem => {
      if (!orderedMap.has(receivedItem.itemId)) {
        extra.push(receivedItem);
      }
    });

    return { missing, incorrect, extra };
  }

  private calculateAccuracyScore(comparison: {
    missing: OrderItem[];
    incorrect: OrderItem[];
    extra: OrderItem[];
  }): number {
    const totalIssues = 
      comparison.missing.length + 
      comparison.incorrect.length + 
      comparison.extra.length;

    if (totalIssues === 0) return 1.0;

    // Weight different types of issues
    const missingWeight = 1.0;
    const incorrectWeight = 0.7;
    const extraWeight = 0.3;

    const weightedIssues = 
      comparison.missing.length * missingWeight +
      comparison.incorrect.length * incorrectWeight +
      comparison.extra.length * extraWeight;

    // Assuming average order has 5 items
    const baselineItems = 5;
    const score = Math.max(0, 1 - (weightedIssues / baselineItems));

    return Number(score.toFixed(2));
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, index) => val === sortedB[index]);
  }

  private async analyzePhotoEvidence(
    photos: string[],
    orderItems: any[]
  ): Promise<{
    score: number;
    issues: AccuracyIssue[];
  }> {
    // In a real implementation, this would use computer vision
    // For now, return a mock analysis
    return {
      score: 0.95,
      issues: [],
    };
  }

  private async calculateAccuracyTrend(
    merchantId: string,
    currentRate: number
  ): Promise<'improving' | 'stable' | 'declining'> {
    // Get previous period accuracy
    const previousPeriod = await this.getMerchantAccuracyMetrics(
      merchantId,
      {
        start: dayjs().subtract(60, 'day').toDate(),
        end: dayjs().subtract(30, 'day').toDate(),
      }
    );

    const difference = currentRate - previousPeriod.accuracyRate;

    if (difference > 0.02) return 'improving';
    if (difference < -0.02) return 'declining';
    return 'stable';
  }

  private async triggerAutomaticCompensation(report: any): Promise<void> {
    // Calculate compensation based on severity
    const order = await prisma.order.findUnique({
      where: { id: report.order_id },
    });

    if (!order) return;

    let compensationAmount = 0;
    if (report.accuracy_score < 0.5) {
      compensationAmount = order.subtotal; // Full refund
    } else if (report.accuracy_score < 0.8) {
      compensationAmount = order.subtotal * 0.5; // 50% refund
    }

    if (compensationAmount > 0) {
      await this.processCompensation({
        orderId: report.order_id,
        customerId: report.customer_id,
        amount: compensationAmount,
        reason: 'Automatic compensation for order accuracy issues',
      });

      // Update report
      await prisma.accuracyReport.update({
        where: { id: report.id },
        data: {
          auto_compensation_amount: compensationAmount,
          auto_compensation_at: new Date(),
        },
      });
    }
  }

  private async processCompensation(params: {
    orderId: string;
    customerId: string;
    amount: number;
    reason: string;
  }): Promise<void> {
    // Create credit in customer account
    await prisma.customerCredit.create({
      data: {
        customer_id: params.customerId,
        order_id: params.orderId,
        amount: params.amount,
        reason: params.reason,
        expires_at: dayjs().add(90, 'day').toDate(),
        created_at: new Date(),
      },
    });

    logger.info(`Processed compensation: ${params.amount} for customer ${params.customerId}`);
  }

  private formatAccuracyReport(report: any): AccuracyReport {
    return {
      orderId: report.order_id,
      merchantId: report.merchant_id,
      orderedItems: report.ordered_items,
      receivedItems: report.received_items,
      missingItems: report.missing_items,
      incorrectItems: report.incorrect_items,
      extraItems: report.extra_items,
      accuracyScore: report.accuracy_score,
      issues: report.issues,
      reportedAt: report.reported_at,
      resolvedAt: report.resolved_at,
      resolution: report.resolution,
    };
  }

  private async updateMerchantMetrics(merchantId: string): Promise<void> {
    // Queue metric update job
    this.emit('update-merchant-metrics', { merchantId });
  }
}