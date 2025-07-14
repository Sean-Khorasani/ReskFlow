import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import { DiscountService } from './DiscountService';
import { CouponService } from './CouponService';
import { LoyaltyService } from './LoyaltyService';
import { CampaignService } from './CampaignService';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface Promotion {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  type: 'percentage' | 'fixed' | 'bogo' | 'bundle' | 'loyalty' | 'free_reskflow';
  value: number;
  conditions: PromotionConditions;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'expired';
  startDate: Date;
  endDate: Date;
  usageLimit?: number;
  usageCount: number;
  customerLimit?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PromotionConditions {
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  applicableItems?: string[];
  applicableCategories?: string[];
  excludedItems?: string[];
  customerSegments?: string[];
  dayOfWeek?: number[];
  timeOfDay?: { start: string; end: string };
  reskflowTypes?: string[];
  paymentMethods?: string[];
  firstOrderOnly?: boolean;
  requiresCoupon?: boolean;
}

interface PromotionAnalytics {
  totalPromotions: number;
  activePromotions: number;
  totalRevenue: number;
  totalDiscountGiven: number;
  averageDiscountPercentage: number;
  topPromotions: Array<{
    id: string;
    name: string;
    usageCount: number;
    revenue: number;
    discountGiven: number;
  }>;
  conversionRate: number;
  customerAcquisition: number;
  repeatPurchaseRate: number;
}

export class PromotionService {
  constructor(
    private discountService: DiscountService,
    private couponService: CouponService,
    private loyaltyService: LoyaltyService,
    private campaignService: CampaignService,
    private promotionQueue: Bull.Queue
  ) {}

  async createPromotion(params: {
    merchantId: string;
    name: string;
    description: string;
    type: string;
    value: number;
    conditions: PromotionConditions;
    startDate: Date;
    endDate: Date;
    usageLimit?: number;
    customerLimit?: number;
    createdBy: string;
    requiresCoupon?: boolean;
    couponPrefix?: string;
  }): Promise<Promotion> {
    // Validate dates
    if (dayjs(params.endDate).isBefore(params.startDate)) {
      throw new Error('End date must be after start date');
    }

    // Create promotion
    const promotion = await prisma.promotion.create({
      data: {
        id: uuidv4(),
        merchant_id: params.merchantId,
        name: params.name,
        description: params.description,
        type: params.type,
        value: params.value,
        conditions: params.conditions,
        status: this.determineInitialStatus(params.startDate),
        start_date: params.startDate,
        end_date: params.endDate,
        usage_limit: params.usageLimit,
        usage_count: 0,
        customer_limit: params.customerLimit,
        created_by: params.createdBy,
      },
    });

    // Generate coupons if required
    if (params.requiresCoupon && params.conditions.requiresCoupon) {
      await this.couponService.generatePromotionCoupon(
        promotion.id,
        params.couponPrefix || params.name.toUpperCase().replace(/\s+/g, '')
      );
    }

    // Schedule activation if needed
    if (promotion.status === 'scheduled') {
      const delay = dayjs(params.startDate).diff(dayjs(), 'millisecond');
      await this.promotionQueue.add(
        'activate-promotion',
        { promotionId: promotion.id },
        { delay }
      );
    }

    // Schedule deactivation
    const deactivateDelay = dayjs(params.endDate).diff(dayjs(), 'millisecond');
    await this.promotionQueue.add(
      'deactivate-promotion',
      { promotionId: promotion.id },
      { delay: deactivateDelay }
    );

    return this.mapToPromotion(promotion);
  }

  async getPromotion(promotionId: string, merchantId?: string): Promise<Promotion> {
    const promotion = await prisma.promotion.findFirst({
      where: {
        id: promotionId,
        ...(merchantId && { merchant_id: merchantId }),
      },
    });

    if (!promotion) {
      throw new Error('Promotion not found');
    }

    return this.mapToPromotion(promotion);
  }

  async getMerchantPromotions(
    merchantId: string,
    filters: {
      status?: string;
      type?: string;
      page: number;
      limit: number;
    }
  ): Promise<{
    promotions: Promotion[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const where = {
      merchant_id: merchantId,
      ...(filters.status && { status: filters.status }),
      ...(filters.type && { type: filters.type }),
    };

    const [promotions, total] = await Promise.all([
      prisma.promotion.findMany({
        where,
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        orderBy: { created_at: 'desc' },
      }),
      prisma.promotion.count({ where }),
    ]);

    return {
      promotions: promotions.map(p => this.mapToPromotion(p)),
      total,
      page: filters.page,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async updatePromotion(
    promotionId: string,
    merchantId: string,
    updates: Partial<Promotion>
  ): Promise<Promotion> {
    const existing = await this.getPromotion(promotionId, merchantId);

    if (existing.status === 'expired') {
      throw new Error('Cannot update expired promotion');
    }

    const updated = await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        name: updates.name,
        description: updates.description,
        value: updates.value,
        conditions: updates.conditions,
        end_date: updates.endDate,
        usage_limit: updates.usageLimit,
        customer_limit: updates.customerLimit,
        updated_at: new Date(),
      },
    });

    return this.mapToPromotion(updated);
  }

  async activatePromotion(promotionId: string): Promise<void> {
    await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        status: 'active',
        activated_at: new Date(),
      },
    });

    logger.info(`Activated promotion: ${promotionId}`);
  }

  async deactivatePromotion(promotionId: string, merchantId?: string): Promise<void> {
    const where = {
      id: promotionId,
      ...(merchantId && { merchant_id: merchantId }),
    };

    await prisma.promotion.update({
      where,
      data: {
        status: 'expired',
        deactivated_at: new Date(),
      },
    });

    logger.info(`Deactivated promotion: ${promotionId}`);
  }

  async pausePromotion(promotionId: string, merchantId: string): Promise<void> {
    await prisma.promotion.update({
      where: {
        id: promotionId,
        merchant_id: merchantId,
      },
      data: {
        status: 'paused',
        paused_at: new Date(),
      },
    });
  }

  async resumePromotion(promotionId: string, merchantId: string): Promise<void> {
    const promotion = await this.getPromotion(promotionId, merchantId);

    if (dayjs().isAfter(promotion.endDate)) {
      throw new Error('Cannot resume expired promotion');
    }

    await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        status: 'active',
        resumed_at: new Date(),
      },
    });
  }

  async getActivePromotions(
    merchantId: string,
    customerId?: string,
    orderDetails?: {
      items: any[];
      subtotal: number;
      reskflowType: string;
      paymentMethod: string;
    }
  ): Promise<Promotion[]> {
    const now = new Date();

    // Get all active promotions
    const promotions = await prisma.promotion.findMany({
      where: {
        merchant_id: merchantId,
        status: 'active',
        start_date: { lte: now },
        end_date: { gte: now },
      },
    });

    // Filter based on conditions
    const eligiblePromotions = [];

    for (const promotion of promotions) {
      const isEligible = await this.checkPromotionEligibility(
        promotion,
        customerId,
        orderDetails
      );

      if (isEligible) {
        eligiblePromotions.push(this.mapToPromotion(promotion));
      }
    }

    return eligiblePromotions;
  }

  async recordPromotionUsage(
    promotionId: string,
    orderId: string,
    customerId: string,
    discountAmount: number
  ): Promise<void> {
    // Update usage count
    await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        usage_count: { increment: 1 },
      },
    });

    // Record usage details
    await prisma.promotionUsage.create({
      data: {
        promotion_id: promotionId,
        order_id: orderId,
        customer_id: customerId,
        discount_amount: discountAmount,
        used_at: new Date(),
      },
    });
  }

  async updatePromotionStatuses(): Promise<void> {
    const now = new Date();

    // Activate scheduled promotions
    const toActivate = await prisma.promotion.findMany({
      where: {
        status: 'scheduled',
        start_date: { lte: now },
        end_date: { gte: now },
      },
    });

    for (const promotion of toActivate) {
      await this.activatePromotion(promotion.id);
    }

    // Expire ended promotions
    const toExpire = await prisma.promotion.findMany({
      where: {
        status: { in: ['active', 'paused'] },
        end_date: { lt: now },
      },
    });

    for (const promotion of toExpire) {
      await this.deactivatePromotion(promotion.id);
    }

    // Check usage limits
    const limitReached = await prisma.promotion.findMany({
      where: {
        status: 'active',
        usage_limit: { not: null },
      },
    });

    for (const promotion of limitReached) {
      if (promotion.usage_count >= promotion.usage_limit!) {
        await this.deactivatePromotion(promotion.id);
      }
    }

    logger.info(`Updated promotion statuses: ${toActivate.length} activated, ${toExpire.length} expired`);
  }

  async getPromotionAnalytics(
    merchantId: string,
    period: string = '30d'
  ): Promise<PromotionAnalytics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all promotions
    const [totalPromotions, activePromotions] = await Promise.all([
      prisma.promotion.count({ where: { merchant_id: merchantId } }),
      prisma.promotion.count({
        where: {
          merchant_id: merchantId,
          status: 'active',
        },
      }),
    ]);

    // Get usage statistics
    const usageStats = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.name,
        COUNT(DISTINCT pu.id) as usage_count,
        SUM(pu.discount_amount) as total_discount,
        SUM(o.total) as total_revenue
      FROM promotions p
      LEFT JOIN promotion_usage pu ON p.id = pu.promotion_id
      LEFT JOIN orders o ON pu.order_id = o.id
      WHERE p.merchant_id = ${merchantId}
        AND pu.used_at >= ${startDate}
      GROUP BY p.id, p.name
      ORDER BY usage_count DESC
      LIMIT 10
    `;

    // Calculate metrics
    const totalStats = await prisma.promotionUsage.aggregate({
      where: {
        promotion: { merchant_id: merchantId },
        used_at: { gte: startDate },
      },
      _sum: { discount_amount: true },
      _count: true,
    });

    const orderStats = await prisma.order.aggregate({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
        promotionUsage: { some: {} },
      },
      _sum: { total: true },
      _count: true,
    });

    const totalOrders = await prisma.order.count({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
      },
    });

    // Customer acquisition
    const newCustomers = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT c.id) as count
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      JOIN promotion_usage pu ON o.id = pu.order_id
      WHERE o.merchant_id = ${merchantId}
        AND o.created_at >= ${startDate}
        AND NOT EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.customer_id = c.id
            AND o2.merchant_id = ${merchantId}
            AND o2.created_at < o.created_at
        )
    `;

    return {
      totalPromotions,
      activePromotions,
      totalRevenue: orderStats._sum.total || 0,
      totalDiscountGiven: totalStats._sum.discount_amount || 0,
      averageDiscountPercentage: orderStats._sum.total
        ? ((totalStats._sum.discount_amount || 0) / orderStats._sum.total) * 100
        : 0,
      topPromotions: (usageStats as any[]).map(s => ({
        id: s.id,
        name: s.name,
        usageCount: s.usage_count,
        revenue: s.total_revenue || 0,
        discountGiven: s.total_discount || 0,
      })),
      conversionRate: totalOrders > 0 ? (orderStats._count / totalOrders) * 100 : 0,
      customerAcquisition: (newCustomers as any[])[0]?.count || 0,
      repeatPurchaseRate: 0, // Would need more complex query
    };
  }

  private determineInitialStatus(startDate: Date): string {
    if (dayjs(startDate).isAfter(dayjs())) {
      return 'scheduled';
    }
    return 'active';
  }

  private async checkPromotionEligibility(
    promotion: any,
    customerId?: string,
    orderDetails?: any
  ): Promise<boolean> {
    const conditions = promotion.conditions as PromotionConditions;

    // Check minimum order amount
    if (conditions.minOrderAmount && orderDetails) {
      if (orderDetails.subtotal < conditions.minOrderAmount) {
        return false;
      }
    }

    // Check customer segments
    if (conditions.customerSegments?.length && customerId) {
      const customerSegment = await this.getCustomerSegment(customerId);
      if (!conditions.customerSegments.includes(customerSegment)) {
        return false;
      }
    }

    // Check first order only
    if (conditions.firstOrderOnly && customerId) {
      const orderCount = await prisma.order.count({
        where: {
          customer_id: customerId,
          merchant_id: promotion.merchant_id,
          status: 'delivered',
        },
      });
      if (orderCount > 0) {
        return false;
      }
    }

    // Check day of week
    if (conditions.dayOfWeek?.length) {
      const currentDay = dayjs().day();
      if (!conditions.dayOfWeek.includes(currentDay)) {
        return false;
      }
    }

    // Check time of day
    if (conditions.timeOfDay) {
      const currentTime = dayjs().format('HH:mm');
      if (currentTime < conditions.timeOfDay.start || currentTime > conditions.timeOfDay.end) {
        return false;
      }
    }

    // Check customer usage limit
    if (promotion.customer_limit && customerId) {
      const customerUsage = await prisma.promotionUsage.count({
        where: {
          promotion_id: promotion.id,
          customer_id: customerId,
        },
      });
      if (customerUsage >= promotion.customer_limit) {
        return false;
      }
    }

    return true;
  }

  private async getCustomerSegment(customerId: string): Promise<string> {
    // This would integrate with customer segmentation logic
    // For now, return a default segment
    return 'regular';
  }

  private mapToPromotion(dbPromotion: any): Promotion {
    return {
      id: dbPromotion.id,
      merchantId: dbPromotion.merchant_id,
      name: dbPromotion.name,
      description: dbPromotion.description,
      type: dbPromotion.type,
      value: dbPromotion.value,
      conditions: dbPromotion.conditions,
      status: dbPromotion.status,
      startDate: dbPromotion.start_date,
      endDate: dbPromotion.end_date,
      usageLimit: dbPromotion.usage_limit,
      usageCount: dbPromotion.usage_count,
      customerLimit: dbPromotion.customer_limit,
      createdBy: dbPromotion.created_by,
      createdAt: dbPromotion.created_at,
      updatedAt: dbPromotion.updated_at,
    };
  }
}