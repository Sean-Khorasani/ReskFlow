/**
 * Promotional Campaigns Service
 * Manages merchant promotions, discounts, and marketing campaigns
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { analyticsService } from '../analytics/analytics.service';

const prisma = new PrismaClient();

interface Campaign {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  type: 'discount' | 'bogo' | 'bundle' | 'free_reskflow' | 'loyalty_points' | 'flash_sale' | 'happy_hour';
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
  startDate: Date;
  endDate: Date;
  budget?: number;
  spentBudget: number;
  targetAudience: TargetAudience;
  conditions: CampaignConditions;
  rewards: CampaignRewards;
  channels: ('app' | 'web' | 'email' | 'push' | 'sms')[];
  performance: CampaignPerformance;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: Date;
}

interface TargetAudience {
  segments: CustomerSegment[];
  customFilters?: {
    minOrders?: number;
    lastOrderDays?: number;
    location?: { radius: number; lat: number; lng: number };
    tags?: string[];
  };
  estimatedReach?: number;
}

interface CustomerSegment {
  id: string;
  name: string;
  type: 'new_customers' | 'loyal_customers' | 'dormant_customers' | 'high_value' | 'location_based' | 'custom';
  criteria: any;
}

interface CampaignConditions {
  minOrderAmount?: number;
  maxUsesPerCustomer?: number;
  totalMaxUses?: number;
  validDays?: number[]; // 0-6, Sunday-Saturday
  validHours?: { start: string; end: string };
  applicableProducts?: string[];
  applicableCategories?: string[];
  excludedProducts?: string[];
  requiresPromoCode?: boolean;
  promoCode?: string;
  stackable?: boolean;
}

interface CampaignRewards {
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  maxDiscountAmount?: number;
  freeDelivery?: boolean;
  bonusLoyaltyPoints?: number;
  freeItems?: Array<{ productId: string; quantity: number }>;
  bundlePrice?: number;
  bogoType?: 'buy_one_get_one' | 'buy_two_get_one' | 'custom';
  bogoProducts?: string[];
}

interface CampaignPerformance {
  views: number;
  clicks: number;
  conversions: number;
  ordersGenerated: number;
  revenueGenerated: number;
  discountGiven: number;
  newCustomersAcquired: number;
  conversionRate: number;
  roi: number;
  averageOrderValue: number;
}

interface PromoCode {
  id: string;
  code: string;
  campaignId: string;
  type: 'single_use' | 'multi_use' | 'unique_per_customer';
  maxUses?: number;
  currentUses: number;
  expiresAt?: Date;
  metadata?: any;
}

interface CampaignAnalytics {
  campaignId: string;
  date: Date;
  hourlyMetrics: Array<{
    hour: number;
    views: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>;
  customerMetrics: {
    newCustomers: number;
    returningCustomers: number;
    averageOrderValue: number;
    topProducts: Array<{ productId: string; quantity: number; revenue: number }>;
  };
  channelMetrics: Record<string, {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
  }>;
}

export class PromotionalCampaignsService extends EventEmitter {
  private activeCampaigns: Map<string, Campaign> = new Map();
  private campaignJobs: Map<string, CronJob> = new Map();

  constructor() {
    super();
    this.initializeScheduledJobs();
    this.loadActiveCampaigns();
  }

  /**
   * Initialize scheduled jobs
   */
  private initializeScheduledJobs() {
    // Check campaign schedules every minute
    const scheduleJob = new CronJob('* * * * *', async () => {
      await this.checkCampaignSchedules();
    });
    scheduleJob.start();

    // Update campaign performance every 5 minutes
    const performanceJob = new CronJob('*/5 * * * *', async () => {
      await this.updateCampaignPerformance();
    });
    performanceJob.start();

    // Daily campaign report
    const reportJob = new CronJob('0 9 * * *', async () => {
      await this.generateDailyReports();
    });
    reportJob.start();
  }

  /**
   * Create campaign
   */
  async createCampaign(
    merchantId: string,
    data: Omit<Campaign, 'id' | 'merchantId' | 'spentBudget' | 'performance' | 'status'>
  ): Promise<Campaign> {
    try {
      // Validate merchant
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
      });

      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Validate promo code if required
      if (data.conditions.requiresPromoCode && data.conditions.promoCode) {
        const existingCode = await prisma.promoCode.findUnique({
          where: { code: data.conditions.promoCode },
        });

        if (existingCode) {
          throw new Error('Promo code already exists');
        }
      }

      // Estimate target audience reach
      const estimatedReach = await this.estimateAudienceReach(data.targetAudience);
      data.targetAudience.estimatedReach = estimatedReach;

      // Create campaign
      const campaign: Campaign = {
        id: `campaign_${Date.now()}`,
        merchantId,
        ...data,
        status: 'draft',
        spentBudget: 0,
        performance: {
          views: 0,
          clicks: 0,
          conversions: 0,
          ordersGenerated: 0,
          revenueGenerated: 0,
          discountGiven: 0,
          newCustomersAcquired: 0,
          conversionRate: 0,
          roi: 0,
          averageOrderValue: 0,
        },
      };

      await prisma.campaign.create({ data: campaign });

      // Create promo codes if needed
      if (data.conditions.requiresPromoCode) {
        await this.createPromoCodes(campaign);
      }

      // Schedule campaign if start date is in future
      if (campaign.startDate > new Date()) {
        await this.scheduleCampaign(campaign);
      }

      // Emit event
      this.emit('campaign:created', {
        campaign,
        merchant,
      });

      logger.info(`Campaign created: ${campaign.name}`, {
        campaignId: campaign.id,
        merchantId,
      });

      return campaign;

    } catch (error) {
      logger.error('Failed to create campaign', error);
      throw error;
    }
  }

  /**
   * Update campaign
   */
  async updateCampaign(
    campaignId: string,
    merchantId: string,
    updates: Partial<Campaign>
  ): Promise<Campaign> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign || campaign.merchantId !== merchantId) {
        throw new Error('Campaign not found or unauthorized');
      }

      if (campaign.status === 'completed' || campaign.status === 'cancelled') {
        throw new Error('Cannot update completed or cancelled campaign');
      }

      // Update campaign
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: updates,
      });

      // Reschedule if dates changed
      if (updates.startDate || updates.endDate) {
        await this.rescheduleCampaign(updatedCampaign);
      }

      // Update active campaigns map
      if (updatedCampaign.status === 'active') {
        this.activeCampaigns.set(campaignId, updatedCampaign);
      } else {
        this.activeCampaigns.delete(campaignId);
      }

      return updatedCampaign;

    } catch (error) {
      logger.error('Failed to update campaign', error);
      throw error;
    }
  }

  /**
   * Start campaign
   */
  async startCampaign(campaignId: string, merchantId: string): Promise<void> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign || campaign.merchantId !== merchantId) {
        throw new Error('Campaign not found or unauthorized');
      }

      if (campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'paused') {
        throw new Error('Campaign cannot be started from current status');
      }

      // Update status
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'active',
          startDate: campaign.status === 'draft' ? new Date() : campaign.startDate,
        },
      });

      // Add to active campaigns
      this.activeCampaigns.set(campaignId, { ...campaign, status: 'active' });

      // Notify target audience
      await this.notifyTargetAudience(campaign);

      // Create campaign analytics entry
      await this.initializeCampaignAnalytics(campaignId);

      // Emit event
      this.emit('campaign:started', {
        campaignId,
        campaign,
      });

      logger.info(`Campaign started: ${campaign.name}`, { campaignId });

    } catch (error) {
      logger.error('Failed to start campaign', error);
      throw error;
    }
  }

  /**
   * Pause campaign
   */
  async pauseCampaign(campaignId: string, merchantId: string, reason?: string): Promise<void> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign || campaign.merchantId !== merchantId) {
        throw new Error('Campaign not found or unauthorized');
      }

      if (campaign.status !== 'active') {
        throw new Error('Only active campaigns can be paused');
      }

      // Update status
      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'paused',
          pausedAt: new Date(),
          pauseReason: reason,
        },
      });

      // Remove from active campaigns
      this.activeCampaigns.delete(campaignId);

      // Emit event
      this.emit('campaign:paused', {
        campaignId,
        reason,
      });

    } catch (error) {
      logger.error('Failed to pause campaign', error);
      throw error;
    }
  }

  /**
   * Apply campaign to order
   */
  async applyCampaignToOrder(
    orderId: string,
    customerId: string,
    promoCode?: string
  ): Promise<{
    applied: boolean;
    campaign?: Campaign;
    discount?: number;
    freeDelivery?: boolean;
    bonusPoints?: number;
    message?: string;
  }> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: { product: true },
          },
          merchant: true,
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Find applicable campaigns
      let applicableCampaigns: Campaign[] = [];

      if (promoCode) {
        // Find campaign by promo code
        const code = await prisma.promoCode.findUnique({
          where: { code: promoCode },
          include: { campaign: true },
        });

        if (!code || !code.campaign || code.campaign.merchantId !== order.merchantId) {
          return { applied: false, message: 'Invalid promo code' };
        }

        if (!this.validatePromoCode(code)) {
          return { applied: false, message: 'Promo code expired or usage limit reached' };
        }

        applicableCampaigns = [code.campaign];
      } else {
        // Find auto-apply campaigns
        applicableCampaigns = Array.from(this.activeCampaigns.values()).filter(
          campaign => campaign.merchantId === order.merchantId &&
                     !campaign.conditions.requiresPromoCode
        );
      }

      // Filter and sort by best value
      const validCampaigns = await this.filterValidCampaigns(
        applicableCampaigns,
        order,
        customerId
      );

      if (validCampaigns.length === 0) {
        return { applied: false, message: 'No applicable promotions found' };
      }

      // Apply best campaign
      const bestCampaign = validCampaigns[0];
      const application = await this.calculateCampaignApplication(bestCampaign, order);

      // Record campaign usage
      await this.recordCampaignUsage(bestCampaign.id, orderId, customerId, application);

      // Update promo code usage if applicable
      if (promoCode) {
        await prisma.promoCode.update({
          where: { code: promoCode },
          data: { currentUses: { increment: 1 } },
        });
      }

      return {
        applied: true,
        campaign: bestCampaign,
        ...application,
      };

    } catch (error) {
      logger.error('Failed to apply campaign to order', error);
      return { applied: false, message: 'Error applying promotion' };
    }
  }

  /**
   * Get merchant campaigns
   */
  async getMerchantCampaigns(
    merchantId: string,
    filters?: {
      status?: Campaign['status'][];
      type?: Campaign['type'][];
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<Campaign[]> {
    const where: any = { merchantId };

    if (filters?.status) {
      where.status = { in: filters.status };
    }

    if (filters?.type) {
      where.type = { in: filters.type };
    }

    if (filters?.startDate || filters?.endDate) {
      where.startDate = {};
      if (filters.startDate) {
        where.startDate.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.startDate.lte = filters.endDate;
      }
    }

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return campaigns;
  }

  /**
   * Get campaign analytics
   */
  async getCampaignAnalytics(
    campaignId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    overview: CampaignPerformance;
    daily: CampaignAnalytics[];
    customerSegments: any;
    productPerformance: any;
    channelPerformance: any;
  }> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Get daily analytics
    const dailyAnalytics = await prisma.campaignAnalytics.findMany({
      where: {
        campaignId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Get customer segment breakdown
    const customerSegments = await this.getCustomerSegmentAnalytics(campaignId, startDate, endDate);

    // Get product performance
    const productPerformance = await this.getProductPerformanceAnalytics(campaignId, startDate, endDate);

    // Get channel performance
    const channelPerformance = await this.getChannelPerformanceAnalytics(campaignId, startDate, endDate);

    return {
      overview: campaign.performance,
      daily: dailyAnalytics,
      customerSegments,
      productPerformance,
      channelPerformance,
    };
  }

  /**
   * Create A/B test campaign
   */
  async createABTestCampaign(
    merchantId: string,
    baseConfig: Omit<Campaign, 'id' | 'merchantId' | 'spentBudget' | 'performance' | 'status'>,
    variants: Array<{
      name: string;
      changes: Partial<Campaign>;
      trafficPercentage: number;
    }>
  ): Promise<{
    testId: string;
    campaigns: Campaign[];
  }> {
    try {
      // Validate traffic percentages
      const totalTraffic = variants.reduce((sum, v) => sum + v.trafficPercentage, 0);
      if (totalTraffic !== 100) {
        throw new Error('Traffic percentages must sum to 100');
      }

      const testId = `abtest_${Date.now()}`;
      const campaigns: Campaign[] = [];

      // Create control campaign
      const controlCampaign = await this.createCampaign(merchantId, {
        ...baseConfig,
        name: `${baseConfig.name} - Control`,
        metadata: { abTestId: testId, variant: 'control' },
      });
      campaigns.push(controlCampaign);

      // Create variant campaigns
      for (const variant of variants) {
        const variantConfig = {
          ...baseConfig,
          ...variant.changes,
          name: `${baseConfig.name} - ${variant.name}`,
          metadata: {
            abTestId: testId,
            variant: variant.name,
            trafficPercentage: variant.trafficPercentage,
          },
        };

        const variantCampaign = await this.createCampaign(merchantId, variantConfig);
        campaigns.push(variantCampaign);
      }

      // Create A/B test record
      await prisma.abTest.create({
        data: {
          id: testId,
          merchantId,
          name: `${baseConfig.name} A/B Test`,
          status: 'active',
          campaigns: campaigns.map(c => c.id),
          startDate: baseConfig.startDate,
          endDate: baseConfig.endDate,
        },
      });

      return { testId, campaigns };

    } catch (error) {
      logger.error('Failed to create A/B test campaign', error);
      throw error;
    }
  }

  /**
   * Get recommended campaigns
   */
  async getRecommendedCampaigns(merchantId: string): Promise<Array<{
    type: Campaign['type'];
    reason: string;
    estimatedImpact: {
      revenueIncrease: number;
      newCustomers: number;
      roi: number;
    };
    suggestedConfig: Partial<Campaign>;
  }>> {
    const recommendations = [];

    // Analyze merchant performance
    const merchantStats = await analyticsService.getMerchantStats(merchantId, 30);

    // New customer acquisition campaign
    if (merchantStats.newCustomerRate < 0.1) {
      recommendations.push({
        type: 'discount' as const,
        reason: 'Low new customer acquisition rate',
        estimatedImpact: {
          revenueIncrease: merchantStats.averageOrderValue * 50,
          newCustomers: 50,
          roi: 2.5,
        },
        suggestedConfig: {
          name: 'New Customer Welcome Offer',
          type: 'discount',
          targetAudience: {
            segments: [{ id: 'new', name: 'New Customers', type: 'new_customers', criteria: {} }],
          },
          rewards: {
            discountType: 'percentage',
            discountValue: 20,
            maxDiscountAmount: 10,
          },
        },
      });
    }

    // Dormant customer reactivation
    if (merchantStats.dormantCustomers > 100) {
      recommendations.push({
        type: 'discount' as const,
        reason: 'High number of dormant customers',
        estimatedImpact: {
          revenueIncrease: merchantStats.averageOrderValue * merchantStats.dormantCustomers * 0.1,
          newCustomers: 0,
          roi: 3.0,
        },
        suggestedConfig: {
          name: 'We Miss You - Come Back Offer',
          type: 'discount',
          targetAudience: {
            segments: [{ id: 'dormant', name: 'Dormant Customers', type: 'dormant_customers', criteria: {} }],
          },
          rewards: {
            discountType: 'percentage',
            discountValue: 25,
            freeDelivery: true,
          },
        },
      });
    }

    // Happy hour campaign for slow periods
    if (merchantStats.slowHours.length > 0) {
      recommendations.push({
        type: 'happy_hour' as const,
        reason: 'Boost sales during slow hours',
        estimatedImpact: {
          revenueIncrease: merchantStats.averageOrderValue * 30,
          newCustomers: 10,
          roi: 2.0,
        },
        suggestedConfig: {
          name: 'Happy Hour Special',
          type: 'happy_hour',
          conditions: {
            validHours: {
              start: merchantStats.slowHours[0].toString().padStart(2, '0') + ':00',
              end: (merchantStats.slowHours[merchantStats.slowHours.length - 1] + 1).toString().padStart(2, '0') + ':00',
            },
          },
          rewards: {
            discountType: 'percentage',
            discountValue: 15,
          },
        },
      });
    }

    return recommendations;
  }

  /**
   * Private helper methods
   */

  private async loadActiveCampaigns(): Promise<void> {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'active',
        endDate: { gte: new Date() },
      },
    });

    campaigns.forEach(campaign => {
      this.activeCampaigns.set(campaign.id, campaign);
    });

    logger.info(`Loaded ${campaigns.length} active campaigns`);
  }

  private async estimateAudienceReach(audience: TargetAudience): Promise<number> {
    let baseCount = 0;

    for (const segment of audience.segments) {
      const count = await this.getSegmentCount(segment);
      baseCount += count;
    }

    // Apply custom filters
    if (audience.customFilters) {
      // This would be more sophisticated in production
      baseCount = Math.floor(baseCount * 0.7);
    }

    return baseCount;
  }

  private async getSegmentCount(segment: CustomerSegment): Promise<number> {
    switch (segment.type) {
      case 'new_customers':
        return await prisma.customer.count({
          where: {
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        });

      case 'loyal_customers':
        return await prisma.customer.count({
          where: {
            orders: {
              some: {
                createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
              },
            },
          },
        });

      case 'dormant_customers':
        return await prisma.customer.count({
          where: {
            orders: {
              none: {
                createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
              },
            },
          },
        });

      default:
        return 0;
    }
  }

  private async createPromoCodes(campaign: Campaign): Promise<void> {
    if (!campaign.conditions.requiresPromoCode) return;

    await prisma.promoCode.create({
      data: {
        code: campaign.conditions.promoCode!,
        campaignId: campaign.id,
        type: 'multi_use',
        maxUses: campaign.conditions.totalMaxUses,
        currentUses: 0,
        expiresAt: campaign.endDate,
      },
    });
  }

  private async scheduleCampaign(campaign: Campaign): Promise<void> {
    const job = new CronJob(campaign.startDate, async () => {
      await this.startCampaign(campaign.id, campaign.merchantId);
    });

    job.start();
    this.campaignJobs.set(campaign.id, job);
  }

  private async rescheduleCampaign(campaign: Campaign): Promise<void> {
    // Cancel existing job
    const existingJob = this.campaignJobs.get(campaign.id);
    if (existingJob) {
      existingJob.stop();
      this.campaignJobs.delete(campaign.id);
    }

    // Schedule new job if needed
    if (campaign.status === 'scheduled' && campaign.startDate > new Date()) {
      await this.scheduleCampaign(campaign);
    }
  }

  private validatePromoCode(code: PromoCode): boolean {
    if (code.expiresAt && code.expiresAt < new Date()) {
      return false;
    }

    if (code.maxUses && code.currentUses >= code.maxUses) {
      return false;
    }

    return true;
  }

  private async filterValidCampaigns(
    campaigns: Campaign[],
    order: any,
    customerId: string
  ): Promise<Campaign[]> {
    const validCampaigns = [];

    for (const campaign of campaigns) {
      if (await this.validateCampaignForOrder(campaign, order, customerId)) {
        validCampaigns.push(campaign);
      }
    }

    // Sort by best value for customer
    return validCampaigns.sort((a, b) => {
      const valueA = this.calculateCampaignValue(a, order);
      const valueB = this.calculateCampaignValue(b, order);
      return valueB - valueA;
    });
  }

  private async validateCampaignForOrder(
    campaign: Campaign,
    order: any,
    customerId: string
  ): Promise<boolean> {
    const conditions = campaign.conditions;

    // Check minimum order amount
    if (conditions.minOrderAmount && order.subtotal < conditions.minOrderAmount) {
      return false;
    }

    // Check customer usage
    if (conditions.maxUsesPerCustomer) {
      const usage = await prisma.campaignUsage.count({
        where: {
          campaignId: campaign.id,
          customerId,
        },
      });

      if (usage >= conditions.maxUsesPerCustomer) {
        return false;
      }
    }

    // Check total usage
    if (conditions.totalMaxUses) {
      const totalUsage = await prisma.campaignUsage.count({
        where: { campaignId: campaign.id },
      });

      if (totalUsage >= conditions.totalMaxUses) {
        return false;
      }
    }

    // Check valid days
    if (conditions.validDays && conditions.validDays.length > 0) {
      const today = new Date().getDay();
      if (!conditions.validDays.includes(today)) {
        return false;
      }
    }

    // Check valid hours
    if (conditions.validHours) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      if (currentTime < conditions.validHours.start || currentTime > conditions.validHours.end) {
        return false;
      }
    }

    // Check applicable products
    if (conditions.applicableProducts && conditions.applicableProducts.length > 0) {
      const orderProductIds = order.items.map(item => item.productId);
      const hasApplicableProduct = orderProductIds.some(id => 
        conditions.applicableProducts!.includes(id)
      );

      if (!hasApplicableProduct) {
        return false;
      }
    }

    // Check excluded products
    if (conditions.excludedProducts && conditions.excludedProducts.length > 0) {
      const orderProductIds = order.items.map(item => item.productId);
      const hasExcludedProduct = orderProductIds.some(id => 
        conditions.excludedProducts!.includes(id)
      );

      if (hasExcludedProduct) {
        return false;
      }
    }

    // Check budget
    if (campaign.budget && campaign.spentBudget >= campaign.budget) {
      return false;
    }

    return true;
  }

  private calculateCampaignValue(campaign: Campaign, order: any): number {
    const rewards = campaign.rewards;
    let value = 0;

    if (rewards.discountType === 'percentage') {
      value = order.subtotal * (rewards.discountValue! / 100);
      if (rewards.maxDiscountAmount) {
        value = Math.min(value, rewards.maxDiscountAmount);
      }
    } else if (rewards.discountType === 'fixed') {
      value = rewards.discountValue!;
    }

    if (rewards.freeDelivery) {
      value += order.reskflowFee || 0;
    }

    if (rewards.bonusLoyaltyPoints) {
      value += rewards.bonusLoyaltyPoints * 0.01; // Assuming 1 point = $0.01
    }

    return value;
  }

  private async calculateCampaignApplication(campaign: Campaign, order: any): Promise<{
    discount: number;
    freeDelivery: boolean;
    bonusPoints: number;
  }> {
    const rewards = campaign.rewards;
    const result = {
      discount: 0,
      freeDelivery: false,
      bonusPoints: 0,
    };

    // Calculate discount
    if (rewards.discountType === 'percentage') {
      result.discount = order.subtotal * (rewards.discountValue! / 100);
      if (rewards.maxDiscountAmount) {
        result.discount = Math.min(result.discount, rewards.maxDiscountAmount);
      }
    } else if (rewards.discountType === 'fixed') {
      result.discount = Math.min(rewards.discountValue!, order.subtotal);
    }

    // Apply campaign-specific logic
    switch (campaign.type) {
      case 'bogo':
        result.discount = await this.calculateBogoDiscount(campaign, order);
        break;

      case 'bundle':
        result.discount = await this.calculateBundleDiscount(campaign, order);
        break;
    }

    result.freeDelivery = rewards.freeDelivery || false;
    result.bonusPoints = rewards.bonusLoyaltyPoints || 0;

    return result;
  }

  private async calculateBogoDiscount(campaign: Campaign, order: any): Promise<number> {
    const rewards = campaign.rewards;
    if (!rewards.bogoType || !rewards.bogoProducts) return 0;

    const eligibleItems = order.items.filter(item => 
      rewards.bogoProducts!.includes(item.productId)
    );

    if (eligibleItems.length === 0) return 0;

    // Sort by price descending
    eligibleItems.sort((a, b) => b.product.price - a.product.price);

    let discount = 0;

    switch (rewards.bogoType) {
      case 'buy_one_get_one':
        // Free items are every second item
        for (let i = 1; i < eligibleItems.length; i += 2) {
          discount += eligibleItems[i].product.price * eligibleItems[i].quantity;
        }
        break;

      case 'buy_two_get_one':
        // Free items are every third item
        for (let i = 2; i < eligibleItems.length; i += 3) {
          discount += eligibleItems[i].product.price * eligibleItems[i].quantity;
        }
        break;
    }

    return discount;
  }

  private async calculateBundleDiscount(campaign: Campaign, order: any): Promise<number> {
    const rewards = campaign.rewards;
    if (!rewards.bundlePrice) return 0;

    const conditions = campaign.conditions;
    if (!conditions.applicableProducts || conditions.applicableProducts.length === 0) return 0;

    // Check if order contains all bundle items
    const bundleItems = conditions.applicableProducts;
    const orderProductIds = order.items.map(item => item.productId);

    const hasAllItems = bundleItems.every(id => orderProductIds.includes(id));
    if (!hasAllItems) return 0;

    // Calculate bundle discount
    const bundleItemsTotal = order.items
      .filter(item => bundleItems.includes(item.productId))
      .reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

    return Math.max(0, bundleItemsTotal - rewards.bundlePrice);
  }

  private async recordCampaignUsage(
    campaignId: string,
    orderId: string,
    customerId: string,
    application: any
  ): Promise<void> {
    await prisma.campaignUsage.create({
      data: {
        campaignId,
        orderId,
        customerId,
        discountAmount: application.discount,
        usedAt: new Date(),
      },
    });

    // Update campaign performance
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        performance: {
          update: {
            conversions: { increment: 1 },
            ordersGenerated: { increment: 1 },
            discountGiven: { increment: application.discount },
          },
        },
        spentBudget: { increment: application.discount },
      },
    });
  }

  private async notifyTargetAudience(campaign: Campaign): Promise<void> {
    const audience = await this.getTargetAudienceCustomers(campaign.targetAudience);

    for (const channel of campaign.channels) {
      switch (channel) {
        case 'push':
          await this.sendPushNotifications(campaign, audience);
          break;
        case 'email':
          await this.sendEmailCampaign(campaign, audience);
          break;
        case 'sms':
          await this.sendSMSCampaign(campaign, audience);
          break;
      }
    }
  }

  private async getTargetAudienceCustomers(audience: TargetAudience): Promise<any[]> {
    let customers = [];

    for (const segment of audience.segments) {
      const segmentCustomers = await this.getSegmentCustomers(segment);
      customers = [...customers, ...segmentCustomers];
    }

    // Remove duplicates
    const uniqueCustomers = Array.from(new Map(customers.map(c => [c.id, c])).values());

    // Apply custom filters
    if (audience.customFilters) {
      return this.applyCustomFilters(uniqueCustomers, audience.customFilters);
    }

    return uniqueCustomers;
  }

  private async getSegmentCustomers(segment: CustomerSegment): Promise<any[]> {
    // Implementation would fetch customers based on segment criteria
    return [];
  }

  private applyCustomFilters(customers: any[], filters: any): any[] {
    return customers.filter(customer => {
      if (filters.minOrders && customer.orderCount < filters.minOrders) {
        return false;
      }

      if (filters.lastOrderDays) {
        const daysSinceLastOrder = customer.lastOrderDate 
          ? (Date.now() - customer.lastOrderDate.getTime()) / (24 * 60 * 60 * 1000)
          : Infinity;
        
        if (daysSinceLastOrder > filters.lastOrderDays) {
          return false;
        }
      }

      // Location filter would use geospatial queries

      return true;
    });
  }

  private async sendPushNotifications(campaign: Campaign, audience: any[]): Promise<void> {
    const notifications = audience.map(customer => 
      notificationService.sendCustomerNotification(
        customer.id,
        campaign.name,
        campaign.description,
        {
          type: 'promotional_campaign',
          campaignId: campaign.id,
          promoCode: campaign.conditions.promoCode,
        }
      )
    );

    await Promise.all(notifications);
  }

  private async sendEmailCampaign(campaign: Campaign, audience: any[]): Promise<void> {
    // Implementation for email campaign
  }

  private async sendSMSCampaign(campaign: Campaign, audience: any[]): Promise<void> {
    // Implementation for SMS campaign
  }

  private async initializeCampaignAnalytics(campaignId: string): Promise<void> {
    await prisma.campaignAnalytics.create({
      data: {
        campaignId,
        date: new Date(),
        hourlyMetrics: [],
        customerMetrics: {
          newCustomers: 0,
          returningCustomers: 0,
          averageOrderValue: 0,
          topProducts: [],
        },
        channelMetrics: {},
      },
    });
  }

  private async checkCampaignSchedules(): Promise<void> {
    // Start scheduled campaigns
    const campaignsToStart = await prisma.campaign.findMany({
      where: {
        status: 'scheduled',
        startDate: { lte: new Date() },
      },
    });

    for (const campaign of campaignsToStart) {
      await this.startCampaign(campaign.id, campaign.merchantId);
    }

    // End expired campaigns
    const campaignsToEnd = await prisma.campaign.findMany({
      where: {
        status: 'active',
        endDate: { lte: new Date() },
      },
    });

    for (const campaign of campaignsToEnd) {
      await this.endCampaign(campaign.id);
    }
  }

  private async endCampaign(campaignId: string): Promise<void> {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    this.activeCampaigns.delete(campaignId);

    // Stop scheduled job
    const job = this.campaignJobs.get(campaignId);
    if (job) {
      job.stop();
      this.campaignJobs.delete(campaignId);
    }

    this.emit('campaign:completed', { campaignId });
  }

  private async updateCampaignPerformance(): Promise<void> {
    for (const [campaignId, campaign] of this.activeCampaigns) {
      const performance = await this.calculateCampaignPerformance(campaignId);
      
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { performance },
      });

      // Update in memory
      campaign.performance = performance;
    }
  }

  private async calculateCampaignPerformance(campaignId: string): Promise<CampaignPerformance> {
    const usage = await prisma.campaignUsage.findMany({
      where: { campaignId },
      include: {
        order: true,
        customer: true,
      },
    });

    const performance: CampaignPerformance = {
      views: 0, // Would track via analytics
      clicks: 0, // Would track via analytics
      conversions: usage.length,
      ordersGenerated: usage.length,
      revenueGenerated: usage.reduce((sum, u) => sum + u.order.total, 0),
      discountGiven: usage.reduce((sum, u) => sum + u.discountAmount, 0),
      newCustomersAcquired: usage.filter(u => u.customer.createdAt >= u.campaign.startDate).length,
      conversionRate: 0,
      roi: 0,
      averageOrderValue: 0,
    };

    if (performance.conversions > 0) {
      performance.averageOrderValue = performance.revenueGenerated / performance.conversions;
    }

    if (performance.clicks > 0) {
      performance.conversionRate = (performance.conversions / performance.clicks) * 100;
    }

    if (performance.discountGiven > 0) {
      performance.roi = ((performance.revenueGenerated - performance.discountGiven) / performance.discountGiven) * 100;
    }

    return performance;
  }

  private async generateDailyReports(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const [campaignId, campaign] of this.activeCampaigns) {
      const analytics = await this.generateDailyAnalytics(campaignId, yesterday);
      
      await prisma.campaignAnalytics.create({
        data: analytics,
      });

      // Send report to merchant
      await this.sendCampaignReport(campaign, analytics);
    }
  }

  private async generateDailyAnalytics(campaignId: string, date: Date): Promise<CampaignAnalytics> {
    // Implementation for daily analytics generation
    return {
      campaignId,
      date,
      hourlyMetrics: [],
      customerMetrics: {
        newCustomers: 0,
        returningCustomers: 0,
        averageOrderValue: 0,
        topProducts: [],
      },
      channelMetrics: {},
    };
  }

  private async sendCampaignReport(campaign: Campaign, analytics: CampaignAnalytics): Promise<void> {
    // Send daily performance report to merchant
  }

  private async getCustomerSegmentAnalytics(
    campaignId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Implementation for customer segment analytics
    return {};
  }

  private async getProductPerformanceAnalytics(
    campaignId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Implementation for product performance analytics
    return {};
  }

  private async getChannelPerformanceAnalytics(
    campaignId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Implementation for channel performance analytics
    return {};
  }
}

// Export singleton instance
export const promotionalCampaignsService = new PromotionalCampaignsService();