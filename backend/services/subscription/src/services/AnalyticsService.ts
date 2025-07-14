import { prisma, logger, redis } from '@reskflow/shared';
import dayjs from 'dayjs';

interface SubscriptionEvent {
  event: string;
  subscriptionId: string;
  userId: string;
  planId?: string;
  revenue?: number;
  metadata?: any;
}

interface SubscriptionMetrics {
  overview: {
    totalSubscribers: number;
    activeSubscribers: number;
    trialingSubscribers: number;
    churnedSubscribers: number;
    monthlyRecurringRevenue: number;
    annualRecurringRevenue: number;
    averageRevenuePerUser: number;
  };
  growth: {
    newSubscribers: number;
    churned: number;
    netGrowth: number;
    growthRate: number;
  };
  retention: {
    monthlyChurnRate: number;
    retentionRate: number;
    averageLifetimeValue: number;
    averageSubscriptionLength: number;
  };
  planDistribution: Array<{
    planName: string;
    subscribers: number;
    percentage: number;
    revenue: number;
  }>;
  benefitUsage: {
    freeDeliveryUsage: number;
    creditsUsed: number;
    averageSavingsPerUser: number;
  };
}

export class AnalyticsService {
  async trackSubscriptionEvent(event: SubscriptionEvent) {
    try {
      await prisma.subscriptionEvent.create({
        data: {
          event_type: event.event,
          subscription_id: event.subscriptionId,
          user_id: event.userId,
          plan_id: event.planId,
          revenue: event.revenue,
          metadata: event.metadata || {},
          created_at: new Date(),
        },
      });

      // Update real-time metrics in Redis
      await this.updateRealtimeMetrics(event);
    } catch (error) {
      logger.error('Failed to track subscription event', error);
    }
  }

  async getSubscriptionAnalytics(
    startDate?: string,
    endDate?: string
  ): Promise<SubscriptionMetrics> {
    const start = startDate ? dayjs(startDate).toDate() : dayjs().subtract(30, 'day').toDate();
    const end = endDate ? dayjs(endDate).toDate() : new Date();

    // Check cache
    const cacheKey = `subscription_analytics:${start.toISOString()}:${end.toISOString()}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [
      overview,
      growth,
      retention,
      planDistribution,
      benefitUsage,
    ] = await Promise.all([
      this.getOverviewMetrics(),
      this.getGrowthMetrics(start, end),
      this.getRetentionMetrics(start, end),
      this.getPlanDistribution(),
      this.getBenefitUsageMetrics(start, end),
    ]);

    const metrics: SubscriptionMetrics = {
      overview,
      growth,
      retention,
      planDistribution,
      benefitUsage,
    };

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(metrics));
    return metrics;
  }

  private async getOverviewMetrics() {
    const [
      totalSubscribers,
      activeSubscribers,
      trialingSubscribers,
      churnedThisMonth,
    ] = await Promise.all([
      prisma.subscription.count(),
      prisma.subscription.count({
        where: { status: 'active' },
      }),
      prisma.subscription.count({
        where: { status: 'trialing' },
      }),
      prisma.subscription.count({
        where: {
          status: 'canceled',
          canceled_at: {
            gte: dayjs().startOf('month').toDate(),
          },
        },
      }),
    ]);

    // Calculate MRR and ARR
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { status: 'active' },
      include: { plan: true },
    });

    const monthlyRecurringRevenue = activeSubscriptions.reduce((sum, sub) => {
      const monthlyAmount = sub.plan.billing_cycle === 'annual' 
        ? sub.amount / 12 
        : sub.amount;
      return sum + monthlyAmount;
    }, 0);

    const annualRecurringRevenue = monthlyRecurringRevenue * 12;
    const averageRevenuePerUser = activeSubscribers > 0 
      ? monthlyRecurringRevenue / activeSubscribers 
      : 0;

    return {
      totalSubscribers,
      activeSubscribers,
      trialingSubscribers,
      churnedSubscribers: churnedThisMonth,
      monthlyRecurringRevenue,
      annualRecurringRevenue,
      averageRevenuePerUser,
    };
  }

  private async getGrowthMetrics(startDate: Date, endDate: Date) {
    const newSubscribers = await prisma.subscription.count({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const churned = await prisma.subscription.count({
      where: {
        canceled_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const netGrowth = newSubscribers - churned;

    // Get previous period for growth rate calculation
    const daysDiff = dayjs(endDate).diff(startDate, 'day');
    const prevStart = dayjs(startDate).subtract(daysDiff, 'day').toDate();
    
    const previousActive = await prisma.subscription.count({
      where: {
        created_at: { lt: startDate },
        OR: [
          { canceled_at: null },
          { canceled_at: { gt: startDate } },
        ],
      },
    });

    const growthRate = previousActive > 0
      ? (netGrowth / previousActive) * 100
      : 0;

    return {
      newSubscribers,
      churned,
      netGrowth,
      growthRate,
    };
  }

  private async getRetentionMetrics(startDate: Date, endDate: Date) {
    // Get subscriptions that were active at start of period
    const activeAtStart = await prisma.subscription.count({
      where: {
        created_at: { lt: startDate },
        OR: [
          { canceled_at: null },
          { canceled_at: { gt: startDate } },
        ],
      },
    });

    // Get how many of those churned during period
    const churnedDuringPeriod = await prisma.subscription.count({
      where: {
        created_at: { lt: startDate },
        canceled_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const monthlyChurnRate = activeAtStart > 0
      ? (churnedDuringPeriod / activeAtStart) * 100
      : 0;

    const retentionRate = 100 - monthlyChurnRate;

    // Calculate average lifetime value
    const completedSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'canceled',
        canceled_at: { not: null },
      },
      select: {
        created_at: true,
        canceled_at: true,
        amount: true,
        plan: {
          select: { billing_cycle: true },
        },
      },
    });

    let totalLifetimeValue = 0;
    let totalMonths = 0;

    completedSubscriptions.forEach(sub => {
      if (sub.canceled_at) {
        const months = dayjs(sub.canceled_at).diff(sub.created_at, 'month') || 1;
        const monthlyValue = sub.plan.billing_cycle === 'annual'
          ? sub.amount / 12
          : sub.amount;
        totalLifetimeValue += monthlyValue * months;
        totalMonths += months;
      }
    });

    const averageLifetimeValue = completedSubscriptions.length > 0
      ? totalLifetimeValue / completedSubscriptions.length
      : 0;

    const averageSubscriptionLength = completedSubscriptions.length > 0
      ? totalMonths / completedSubscriptions.length
      : 0;

    return {
      monthlyChurnRate,
      retentionRate,
      averageLifetimeValue,
      averageSubscriptionLength,
    };
  }

  private async getPlanDistribution() {
    const planStats = await prisma.subscription.groupBy({
      by: ['plan_id'],
      where: { status: 'active' },
      _count: true,
    });

    const plans = await prisma.subscriptionPlan.findMany();
    const planMap = new Map(plans.map(p => [p.id, p]));

    const total = planStats.reduce((sum, stat) => sum + stat._count, 0);

    return planStats.map(stat => {
      const plan = planMap.get(stat.plan_id)!;
      const subscribers = stat._count;
      const monthlyRevenue = plan.billing_cycle === 'annual'
        ? (plan.price / 12) * subscribers
        : plan.price * subscribers;

      return {
        planName: plan.name,
        subscribers,
        percentage: total > 0 ? (subscribers / total) * 100 : 0,
        revenue: monthlyRevenue,
      };
    });
  }

  private async getBenefitUsageMetrics(startDate: Date, endDate: Date) {
    const benefitUsage = await prisma.benefitUsage.groupBy({
      by: ['benefit_type'],
      where: {
        used_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        value_saved: true,
      },
      _count: true,
    });

    const freeDeliveryUsage = benefitUsage.find(
      b => b.benefit_type === 'free_reskflow'
    )?._count || 0;

    const creditsUsed = benefitUsage.find(
      b => b.benefit_type === 'monthly_credits'
    )?._sum.value_saved || 0;

    const totalSavings = benefitUsage.reduce(
      (sum, b) => sum + (b._sum.value_saved || 0),
      0
    );

    const activeUsers = await prisma.subscription.count({
      where: { status: 'active' },
    });

    const averageSavingsPerUser = activeUsers > 0
      ? totalSavings / activeUsers
      : 0;

    return {
      freeDeliveryUsage,
      creditsUsed,
      averageSavingsPerUser,
    };
  }

  private async updateRealtimeMetrics(event: SubscriptionEvent) {
    const metricsKey = 'subscription_metrics:realtime';
    
    switch (event.event) {
      case 'subscription_created':
        await redis.hincrby(metricsKey, 'new_subscribers_today', 1);
        if (event.revenue) {
          await redis.hincrbyfloat(metricsKey, 'revenue_today', event.revenue);
        }
        break;
        
      case 'subscription_canceled':
        await redis.hincrby(metricsKey, 'churned_today', 1);
        break;
        
      case 'plan_changed':
        await redis.hincrby(metricsKey, 'plan_changes_today', 1);
        break;
    }

    // Set expiry for daily metrics
    await redis.expire(metricsKey, 86400); // 24 hours
  }

  async getRealtimeMetrics() {
    const metricsKey = 'subscription_metrics:realtime';
    const metrics = await redis.hgetall(metricsKey);
    
    return {
      newSubscribersToday: parseInt(metrics.new_subscribers_today || '0'),
      churnedToday: parseInt(metrics.churned_today || '0'),
      planChangesToday: parseInt(metrics.plan_changes_today || '0'),
      revenueToday: parseFloat(metrics.revenue_today || '0'),
    };
  }
}