import { prisma, logger, redis } from '@reskflow/shared';
import dayjs from 'dayjs';
import { groupBy, orderBy } from 'lodash';

interface PerformanceMetrics {
  orderMetrics: {
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    averagePreparationTime: number;
    averageDeliveryTime: number;
    onTimeDeliveryRate: number;
  };
  operationalMetrics: {
    acceptanceRate: number;
    cancellationRate: number;
    refundRate: number;
    averageRating: number;
    totalReviews: number;
  };
  efficiencyMetrics: {
    ordersPerHour: number;
    peakHours: number[];
    utilizationRate: number;
    itemsPerOrder: number;
  };
  trends: {
    orderGrowth: number;
    revenueGrowth: number;
    ratingTrend: number;
  };
}

interface ItemPerformance {
  itemId: string;
  name: string;
  category: string;
  totalOrders: number;
  totalRevenue: number;
  averageRating: number;
  preparationTime: number;
  profitMargin: number;
  trend: 'up' | 'down' | 'stable';
  popularityScore: number;
}

interface MerchantComparison {
  merchant1: {
    id: string;
    name: string;
    metrics: PerformanceMetrics;
  };
  merchant2: {
    id: string;
    name: string;
    metrics: PerformanceMetrics;
  };
  comparison: {
    revenueRatio: number;
    orderVolumeRatio: number;
    ratingDifference: number;
    efficiencyScore: number;
  };
}

export class PerformanceAnalyticsService {
  async getMerchantPerformance(
    merchantId: string,
    period: string = '7d'
  ): Promise<PerformanceMetrics> {
    const days = parseInt(period) || 7;
    const startDate = dayjs().subtract(days, 'day').toDate();
    const previousStartDate = dayjs().subtract(days * 2, 'day').toDate();

    // Get current period data
    const currentOrders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
      },
      include: {
        reskflow: true,
        reviews: true,
      },
    });

    // Get previous period data for trends
    const previousOrders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        created_at: {
          gte: previousStartDate,
          lt: startDate,
        },
      },
    });

    // Calculate order metrics
    const completedOrders = currentOrders.filter(o => o.status === 'delivered');
    const cancelledOrders = currentOrders.filter(o => o.status === 'cancelled');

    const preparationTimes = completedOrders
      .filter(o => o.accepted_at && o.ready_at)
      .map(o => o.ready_at!.getTime() - o.accepted_at!.getTime());

    const reskflowTimes = completedOrders
      .filter(o => o.reskflow?.picked_up_at && o.reskflow?.delivered_at)
      .map(o => o.reskflow!.delivered_at!.getTime() - o.reskflow!.picked_up_at!.getTime());

    const onTimeDeliveries = completedOrders.filter(o => {
      if (!o.reskflow?.delivered_at || !o.estimated_reskflow_time) return false;
      return o.reskflow.delivered_at <= o.estimated_reskflow_time;
    }).length;

    // Calculate operational metrics
    const acceptedOrders = currentOrders.filter(o => o.accepted_at);
    const refundedOrders = currentOrders.filter(o => o.refund_amount && o.refund_amount > 0);
    
    const ratings = currentOrders
      .flatMap(o => o.reviews)
      .filter(r => r.rating_type === 'merchant')
      .map(r => r.rating);

    // Calculate efficiency metrics
    const ordersByHour = groupBy(currentOrders, o => dayjs(o.created_at).hour());
    const peakHours = orderBy(
      Object.entries(ordersByHour),
      ([_, orders]) => orders.length,
      'desc'
    )
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    const operatingHours = await this.getOperatingHours(merchantId);
    const totalOperatingHours = operatingHours * days;
    const ordersPerHour = currentOrders.length / totalOperatingHours;

    const totalItems = currentOrders.reduce((sum, o) => sum + (o.items_count || 0), 0);
    const itemsPerOrder = currentOrders.length > 0 ? totalItems / currentOrders.length : 0;

    // Calculate trends
    const currentRevenue = completedOrders.reduce((sum, o) => sum + o.total, 0);
    const previousRevenue = previousOrders
      .filter(o => o.status === 'delivered')
      .reduce((sum, o) => sum + o.total, 0);

    const orderGrowth = previousOrders.length > 0
      ? ((currentOrders.length - previousOrders.length) / previousOrders.length) * 100
      : 0;

    const revenueGrowth = previousRevenue > 0
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
      : 0;

    return {
      orderMetrics: {
        totalOrders: currentOrders.length,
        completedOrders: completedOrders.length,
        cancelledOrders: cancelledOrders.length,
        averagePreparationTime: preparationTimes.length > 0
          ? preparationTimes.reduce((a, b) => a + b, 0) / preparationTimes.length / 1000 / 60
          : 0,
        averageDeliveryTime: reskflowTimes.length > 0
          ? reskflowTimes.reduce((a, b) => a + b, 0) / reskflowTimes.length / 1000 / 60
          : 0,
        onTimeDeliveryRate: completedOrders.length > 0
          ? (onTimeDeliveries / completedOrders.length) * 100
          : 0,
      },
      operationalMetrics: {
        acceptanceRate: currentOrders.length > 0
          ? (acceptedOrders.length / currentOrders.length) * 100
          : 0,
        cancellationRate: currentOrders.length > 0
          ? (cancelledOrders.length / currentOrders.length) * 100
          : 0,
        refundRate: currentOrders.length > 0
          ? (refundedOrders.length / currentOrders.length) * 100
          : 0,
        averageRating: ratings.length > 0
          ? ratings.reduce((a, b) => a + b, 0) / ratings.length
          : 0,
        totalReviews: ratings.length,
      },
      efficiencyMetrics: {
        ordersPerHour,
        peakHours,
        utilizationRate: (completedOrders.length / currentOrders.length) * 100,
        itemsPerOrder,
      },
      trends: {
        orderGrowth,
        revenueGrowth,
        ratingTrend: 0, // Placeholder
      },
    };
  }

  async getTopPerformingItems(
    merchantId: string,
    period: string = '30d',
    limit: number = 10
  ): Promise<ItemPerformance[]> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get item performance data
    const itemStats = await prisma.$queryRaw`
      SELECT 
        i.id,
        i.name,
        c.name as category,
        COUNT(DISTINCT oi.order_id) as order_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.price * oi.quantity) as total_revenue,
        AVG(r.rating) as avg_rating,
        COUNT(DISTINCT r.id) as review_count,
        AVG(i.preparation_time) as prep_time,
        AVG((oi.price - i.cost) / oi.price) as profit_margin
      FROM items i
      JOIN categories c ON i.category_id = c.id
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN reviews r ON r.item_id = i.id
      WHERE i.merchant_id = ${merchantId}
        AND o.status = 'delivered'
        AND o.delivered_at >= ${startDate}
      GROUP BY i.id, i.name, c.name
      ORDER BY total_revenue DESC
      LIMIT ${limit}
    `;

    // Calculate trends
    const previousStartDate = dayjs().subtract(days * 2, 'day').toDate();
    const previousStats = await this.getPreviousItemStats(
      merchantId,
      previousStartDate,
      startDate
    );

    return (itemStats as any[]).map(item => {
      const previousItem = previousStats.find(p => p.id === item.id);
      const trend = this.calculateTrend(
        item.order_count,
        previousItem?.order_count || 0
      );

      return {
        itemId: item.id,
        name: item.name,
        category: item.category,
        totalOrders: item.order_count,
        totalRevenue: item.total_revenue,
        averageRating: item.avg_rating || 0,
        preparationTime: item.prep_time || 15,
        profitMargin: item.profit_margin || 0.3,
        trend,
        popularityScore: this.calculatePopularityScore(item),
      };
    });
  }

  async compareMerchants(
    merchantId1: string,
    merchantId2: string,
    period: string = '30d'
  ): Promise<MerchantComparison> {
    const [merchant1, merchant2] = await Promise.all([
      prisma.merchant.findUnique({ where: { id: merchantId1 } }),
      prisma.merchant.findUnique({ where: { id: merchantId2 } }),
    ]);

    if (!merchant1 || !merchant2) {
      throw new Error('One or both merchants not found');
    }

    const [metrics1, metrics2] = await Promise.all([
      this.getMerchantPerformance(merchantId1, period),
      this.getMerchantPerformance(merchantId2, period),
    ]);

    // Calculate comparison metrics
    const revenue1 = await this.getMerchantRevenue(merchantId1, period);
    const revenue2 = await this.getMerchantRevenue(merchantId2, period);

    const revenueRatio = revenue2 > 0 ? revenue1 / revenue2 : 0;
    const orderVolumeRatio = metrics2.orderMetrics.totalOrders > 0
      ? metrics1.orderMetrics.totalOrders / metrics2.orderMetrics.totalOrders
      : 0;
    const ratingDifference = metrics1.operationalMetrics.averageRating - 
                           metrics2.operationalMetrics.averageRating;

    const efficiencyScore1 = this.calculateEfficiencyScore(metrics1);
    const efficiencyScore2 = this.calculateEfficiencyScore(metrics2);

    return {
      merchant1: {
        id: merchantId1,
        name: merchant1.name,
        metrics: metrics1,
      },
      merchant2: {
        id: merchantId2,
        name: merchant2.name,
        metrics: metrics2,
      },
      comparison: {
        revenueRatio,
        orderVolumeRatio,
        ratingDifference,
        efficiencyScore: efficiencyScore1 / efficiencyScore2,
      },
    };
  }

  async calculateMerchantScores() {
    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
    });

    for (const merchant of merchants) {
      const performance = await this.getMerchantPerformance(merchant.id, '30d');
      
      // Calculate overall score (0-100)
      const score = this.calculateOverallScore(performance);

      // Store score
      await prisma.merchantScore.upsert({
        where: { merchant_id: merchant.id },
        update: {
          performance_score: score.performance,
          reliability_score: score.reliability,
          customer_satisfaction_score: score.satisfaction,
          overall_score: score.overall,
          updated_at: new Date(),
        },
        create: {
          merchant_id: merchant.id,
          performance_score: score.performance,
          reliability_score: score.reliability,
          customer_satisfaction_score: score.satisfaction,
          overall_score: score.overall,
        },
      });
    }

    logger.info(`Updated scores for ${merchants.length} merchants`);
  }

  async aggregateDailyPerformance() {
    const yesterday = dayjs().subtract(1, 'day').startOf('day');
    const today = dayjs().startOf('day');

    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
    });

    for (const merchant of merchants) {
      const metrics = await this.getMerchantPerformance(merchant.id, '1d');
      
      await prisma.performanceAggregation.create({
        data: {
          merchant_id: merchant.id,
          date: yesterday.toDate(),
          total_orders: metrics.orderMetrics.totalOrders,
          completed_orders: metrics.orderMetrics.completedOrders,
          cancelled_orders: metrics.orderMetrics.cancelledOrders,
          avg_preparation_time: metrics.orderMetrics.averagePreparationTime,
          avg_reskflow_time: metrics.orderMetrics.averageDeliveryTime,
          on_time_rate: metrics.orderMetrics.onTimeDeliveryRate,
          acceptance_rate: metrics.operationalMetrics.acceptanceRate,
          avg_rating: metrics.operationalMetrics.averageRating,
          orders_per_hour: metrics.efficiencyMetrics.ordersPerHour,
        },
      });
    }
  }

  private async getOperatingHours(merchantId: string): Promise<number> {
    // Get merchant operating hours
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { operating_hours: true },
    });

    if (!merchant?.operating_hours) return 12; // Default 12 hours

    // Calculate total operating hours per day
    let totalHours = 0;
    const hours = merchant.operating_hours as any;

    Object.values(hours).forEach((dayHours: any) => {
      if (dayHours.open && dayHours.close) {
        const openTime = dayjs(`2000-01-01 ${dayHours.open}`);
        const closeTime = dayjs(`2000-01-01 ${dayHours.close}`);
        totalHours += closeTime.diff(openTime, 'hour');
      }
    });

    return totalHours / 7; // Average per day
  }

  private async getPreviousItemStats(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ) {
    const stats = await prisma.$queryRaw`
      SELECT 
        i.id,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM items i
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE i.merchant_id = ${merchantId}
        AND o.status = 'delivered'
        AND o.delivered_at >= ${startDate}
        AND o.delivered_at < ${endDate}
      GROUP BY i.id
    `;

    return stats as any[];
  }

  private calculateTrend(current: number, previous: number): 'up' | 'down' | 'stable' {
    if (previous === 0) return current > 0 ? 'up' : 'stable';
    
    const change = ((current - previous) / previous) * 100;
    
    if (change > 10) return 'up';
    if (change < -10) return 'down';
    return 'stable';
  }

  private calculatePopularityScore(item: any): number {
    // Normalize different factors to 0-1 scale
    const orderScore = Math.min(item.order_count / 100, 1);
    const revenueScore = Math.min(item.total_revenue / 10000, 1);
    const ratingScore = (item.avg_rating || 0) / 5;
    
    // Weighted average
    return (orderScore * 0.4 + revenueScore * 0.4 + ratingScore * 0.2) * 100;
  }

  private async getMerchantRevenue(merchantId: string, period: string): Promise<number> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    const result = await prisma.order.aggregate({
      where: {
        merchant_id: merchantId,
        status: 'delivered',
        delivered_at: { gte: startDate },
      },
      _sum: {
        total: true,
      },
    });

    return result._sum.total || 0;
  }

  private calculateEfficiencyScore(metrics: PerformanceMetrics): number {
    const weights = {
      onTime: 0.3,
      acceptance: 0.2,
      utilization: 0.2,
      speed: 0.3,
    };

    const scores = {
      onTime: metrics.orderMetrics.onTimeDeliveryRate / 100,
      acceptance: metrics.operationalMetrics.acceptanceRate / 100,
      utilization: metrics.efficiencyMetrics.utilizationRate / 100,
      speed: Math.min(30 / (metrics.orderMetrics.averageDeliveryTime || 30), 1),
    };

    return Object.entries(weights).reduce(
      (total, [key, weight]) => total + scores[key as keyof typeof scores] * weight,
      0
    ) * 100;
  }

  private calculateOverallScore(performance: PerformanceMetrics) {
    const performanceScore = 
      (performance.orderMetrics.onTimeDeliveryRate * 0.4) +
      (performance.efficiencyMetrics.utilizationRate * 0.3) +
      (performance.efficiencyMetrics.ordersPerHour * 2 * 0.3); // Normalized

    const reliabilityScore = 
      (performance.operationalMetrics.acceptanceRate * 0.5) +
      ((100 - performance.operationalMetrics.cancellationRate) * 0.3) +
      ((100 - performance.operationalMetrics.refundRate) * 0.2);

    const satisfactionScore = 
      (performance.operationalMetrics.averageRating * 20) * 0.7 + // Convert to 100 scale
      (Math.min(performance.operationalMetrics.totalReviews / 50, 1) * 100 * 0.3);

    const overall = (performanceScore * 0.4) + 
                   (reliabilityScore * 0.3) + 
                   (satisfactionScore * 0.3);

    return {
      performance: Math.min(performanceScore, 100),
      reliability: Math.min(reliabilityScore, 100),
      satisfaction: Math.min(satisfactionScore, 100),
      overall: Math.min(overall, 100),
    };
  }
}