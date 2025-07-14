import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface Campaign {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  type: 'email' | 'push' | 'sms' | 'in_app';
  targetAudience: TargetAudience;
  content: CampaignContent;
  schedule: CampaignSchedule;
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'paused';
  metrics?: CampaignMetrics;
  createdAt: Date;
  updatedAt: Date;
}

interface TargetAudience {
  segments: string[];
  filters: {
    lastOrderDays?: number;
    minOrderCount?: number;
    minLifetimeValue?: number;
    location?: { radius: number; latitude: number; longitude: number };
    customAttributes?: Record<string, any>;
  };
  estimatedReach?: number;
}

interface CampaignContent {
  subject?: string;
  headline: string;
  body: string;
  ctaText: string;
  ctaLink: string;
  imageUrl?: string;
  promotionId?: string;
  couponCode?: string;
}

interface CampaignSchedule {
  sendAt?: Date;
  timeZone: string;
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    endDate?: Date;
  };
}

interface CampaignMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  revenue: number;
  unsubscribed: number;
}

interface CampaignPerformance {
  campaign: Campaign;
  metrics: CampaignMetrics;
  conversionRate: number;
  clickThroughRate: number;
  openRate: number;
  roi: number;
  topConvertingSegments: Array<{
    segment: string;
    conversions: number;
    revenue: number;
  }>;
}

export class CampaignService {
  constructor(private campaignQueue: Bull.Queue) {}

  async createCampaign(params: {
    merchantId: string;
    name: string;
    description: string;
    type: string;
    targetAudience: TargetAudience;
    content: CampaignContent;
    schedule: CampaignSchedule;
  }): Promise<Campaign> {
    // Estimate audience reach
    const estimatedReach = await this.estimateAudienceReach(
      params.merchantId,
      params.targetAudience
    );

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        id: uuidv4(),
        merchant_id: params.merchantId,
        name: params.name,
        description: params.description,
        type: params.type,
        target_audience: {
          ...params.targetAudience,
          estimatedReach,
        },
        content: params.content,
        schedule: params.schedule,
        status: params.schedule.sendAt ? 'scheduled' : 'draft',
        metrics: {
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          converted: 0,
          revenue: 0,
          unsubscribed: 0,
        },
      },
    });

    // Schedule campaign if needed
    if (params.schedule.sendAt) {
      const delay = dayjs(params.schedule.sendAt).diff(dayjs(), 'millisecond');
      if (delay > 0) {
        await this.campaignQueue.add(
          'send-campaign',
          { campaignId: campaign.id },
          { delay }
        );
      }
    }

    return this.mapToCampaign(campaign);
  }

  async updateCampaign(
    campaignId: string,
    merchantId: string,
    updates: Partial<Campaign>
  ): Promise<Campaign> {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        merchant_id: merchantId,
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (campaign.status === 'running' || campaign.status === 'completed') {
      throw new Error('Cannot update running or completed campaign');
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        name: updates.name,
        description: updates.description,
        target_audience: updates.targetAudience,
        content: updates.content,
        schedule: updates.schedule,
        updated_at: new Date(),
      },
    });

    return this.mapToCampaign(updated);
  }

  async sendCampaign(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign || campaign.status === 'completed') {
      return;
    }

    // Update status
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'running',
        started_at: new Date(),
      },
    });

    // Get target audience
    const recipients = await this.getTargetAudience(
      campaign.merchant_id,
      campaign.target_audience
    );

    logger.info(`Sending campaign ${campaignId} to ${recipients.length} recipients`);

    // Send to each recipient
    for (const recipient of recipients) {
      await this.sendToRecipient(campaign, recipient);
    }

    // Update metrics
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        'metrics.sent': recipients.length,
      },
    });

    // Schedule metrics update
    await this.campaignQueue.add(
      'update-metrics',
      { campaignId },
      { delay: 3600000 } // 1 hour
    );
  }

  async pauseCampaign(campaignId: string, merchantId: string): Promise<void> {
    await prisma.campaign.update({
      where: {
        id: campaignId,
        merchant_id: merchantId,
      },
      data: {
        status: 'paused',
        paused_at: new Date(),
      },
    });
  }

  async resumeCampaign(campaignId: string, merchantId: string): Promise<void> {
    await prisma.campaign.update({
      where: {
        id: campaignId,
        merchant_id: merchantId,
      },
      data: {
        status: 'scheduled',
        resumed_at: new Date(),
      },
    });
  }

  async getCampaignPerformance(
    campaignId: string,
    merchantId: string
  ): Promise<CampaignPerformance> {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        merchant_id: merchantId,
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Get detailed metrics
    const metrics = await this.getDetailedMetrics(campaignId);

    // Calculate rates
    const openRate = metrics.sent > 0 ? (metrics.opened / metrics.sent) * 100 : 0;
    const clickThroughRate = metrics.opened > 0 
      ? (metrics.clicked / metrics.opened) * 100 
      : 0;
    const conversionRate = metrics.clicked > 0 
      ? (metrics.converted / metrics.clicked) * 100 
      : 0;

    // Calculate ROI
    const campaignCost = this.estimateCampaignCost(campaign.type, metrics.sent);
    const roi = campaignCost > 0 ? ((metrics.revenue - campaignCost) / campaignCost) * 100 : 0;

    // Get segment performance
    const segmentPerformance = await this.getSegmentPerformance(campaignId);

    return {
      campaign: this.mapToCampaign(campaign),
      metrics,
      conversionRate,
      clickThroughRate,
      openRate,
      roi,
      topConvertingSegments: segmentPerformance,
    };
  }

  async trackCampaignEvent(params: {
    campaignId: string;
    recipientId: string;
    event: 'delivered' | 'opened' | 'clicked' | 'converted' | 'unsubscribed';
    revenue?: number;
    metadata?: any;
  }): Promise<void> {
    // Record event
    await prisma.campaignEvent.create({
      data: {
        id: uuidv4(),
        campaign_id: params.campaignId,
        recipient_id: params.recipientId,
        event: params.event,
        revenue: params.revenue,
        metadata: params.metadata || {},
        created_at: new Date(),
      },
    });

    // Update campaign metrics
    const metricUpdate: any = {};
    metricUpdate[`metrics.${params.event}`] = { increment: 1 };
    
    if (params.revenue) {
      metricUpdate['metrics.revenue'] = { increment: params.revenue };
    }

    await prisma.campaign.update({
      where: { id: params.campaignId },
      data: metricUpdate,
    });
  }

  async updateCampaignMetrics(campaignId: string): Promise<void> {
    const events = await prisma.campaignEvent.groupBy({
      by: ['event'],
      where: { campaign_id: campaignId },
      _count: true,
    });

    const revenue = await prisma.campaignEvent.aggregate({
      where: {
        campaign_id: campaignId,
        event: 'converted',
      },
      _sum: { revenue: true },
    });

    const metrics: CampaignMetrics = {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      converted: 0,
      revenue: revenue._sum.revenue || 0,
      unsubscribed: 0,
    };

    events.forEach(e => {
      metrics[e.event as keyof CampaignMetrics] = e._count;
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { metrics },
    });
  }

  async getActiveCampaigns(merchantId: string): Promise<Campaign[]> {
    const campaigns = await prisma.campaign.findMany({
      where: {
        merchant_id: merchantId,
        status: { in: ['scheduled', 'running'] },
      },
      orderBy: { created_at: 'desc' },
    });

    return campaigns.map(c => this.mapToCampaign(c));
  }

  private async estimateAudienceReach(
    merchantId: string,
    targetAudience: TargetAudience
  ): Promise<number> {
    let query = prisma.customer.findMany({
      where: {
        orders: {
          some: {
            merchant_id: merchantId,
            status: 'delivered',
          },
        },
      },
      select: { id: true },
    });

    // Apply filters
    if (targetAudience.filters.lastOrderDays) {
      const cutoffDate = dayjs()
        .subtract(targetAudience.filters.lastOrderDays, 'day')
        .toDate();
      
      query = prisma.customer.findMany({
        where: {
          orders: {
            some: {
              merchant_id: merchantId,
              status: 'delivered',
              created_at: { gte: cutoffDate },
            },
          },
        },
        select: { id: true },
      });
    }

    const customers = await query;
    return customers.length;
  }

  private async getTargetAudience(
    merchantId: string,
    targetAudience: any
  ): Promise<any[]> {
    // Get customers based on filters
    const filters = targetAudience.filters;
    const where: any = {
      orders: {
        some: {
          merchant_id: merchantId,
          status: 'delivered',
        },
      },
    };

    if (filters.lastOrderDays) {
      where.orders.some.created_at = {
        gte: dayjs().subtract(filters.lastOrderDays, 'day').toDate(),
      };
    }

    const customers = await prisma.customer.findMany({
      where,
      include: {
        notificationPreferences: true,
        orders: {
          where: {
            merchant_id: merchantId,
            status: 'delivered',
          },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    // Apply additional filters
    return customers.filter(customer => {
      if (filters.minOrderCount) {
        // Would need to query order count
        return true;
      }
      return true;
    });
  }

  private async sendToRecipient(campaign: any, recipient: any): Promise<void> {
    // Check if recipient has opted out
    if (recipient.notificationPreferences?.marketing_opt_out) {
      return;
    }

    // Create campaign recipient record
    await prisma.campaignRecipient.create({
      data: {
        id: uuidv4(),
        campaign_id: campaign.id,
        customer_id: recipient.id,
        status: 'pending',
        sent_at: new Date(),
      },
    });

    // Send based on campaign type
    switch (campaign.type) {
      case 'email':
        await this.sendEmailCampaign(campaign, recipient);
        break;
      case 'push':
        await this.sendPushCampaign(campaign, recipient);
        break;
      case 'sms':
        await this.sendSMSCampaign(campaign, recipient);
        break;
      case 'in_app':
        await this.sendInAppCampaign(campaign, recipient);
        break;
    }
  }

  private async sendEmailCampaign(campaign: any, recipient: any): Promise<void> {
    // This would integrate with email service
    logger.info(`Sending email campaign to ${recipient.email}`);
  }

  private async sendPushCampaign(campaign: any, recipient: any): Promise<void> {
    // This would integrate with push notification service
    logger.info(`Sending push campaign to ${recipient.id}`);
  }

  private async sendSMSCampaign(campaign: any, recipient: any): Promise<void> {
    // This would integrate with SMS service
    logger.info(`Sending SMS campaign to ${recipient.phone}`);
  }

  private async sendInAppCampaign(campaign: any, recipient: any): Promise<void> {
    // Create in-app message
    await prisma.inAppMessage.create({
      data: {
        id: uuidv4(),
        customer_id: recipient.id,
        campaign_id: campaign.id,
        title: campaign.content.headline,
        body: campaign.content.body,
        cta_text: campaign.content.ctaText,
        cta_link: campaign.content.ctaLink,
        image_url: campaign.content.imageUrl,
        is_read: false,
        created_at: new Date(),
      },
    });
  }

  private async getDetailedMetrics(campaignId: string): Promise<CampaignMetrics> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    return campaign?.metrics || {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      converted: 0,
      revenue: 0,
      unsubscribed: 0,
    };
  }

  private async getSegmentPerformance(campaignId: string): Promise<any[]> {
    // This would analyze performance by customer segment
    return [];
  }

  private estimateCampaignCost(type: string, recipientCount: number): number {
    const costPerRecipient = {
      email: 0.001,
      push: 0.0001,
      sms: 0.01,
      in_app: 0,
    };

    return (costPerRecipient[type as keyof typeof costPerRecipient] || 0) * recipientCount;
  }

  private mapToCampaign(dbCampaign: any): Campaign {
    return {
      id: dbCampaign.id,
      merchantId: dbCampaign.merchant_id,
      name: dbCampaign.name,
      description: dbCampaign.description,
      type: dbCampaign.type,
      targetAudience: dbCampaign.target_audience,
      content: dbCampaign.content,
      schedule: dbCampaign.schedule,
      status: dbCampaign.status,
      metrics: dbCampaign.metrics,
      createdAt: dbCampaign.created_at,
      updatedAt: dbCampaign.updated_at,
    };
  }
}