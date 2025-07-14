import { prisma, logger, redis } from '@reskflow/shared';
import { RevenueAnalyticsService } from './RevenueAnalyticsService';
import { PerformanceAnalyticsService } from './PerformanceAnalyticsService';
import { CustomerAnalyticsService } from './CustomerAnalyticsService';
import dayjs from 'dayjs';

interface DashboardData {
  overview: {
    todayRevenue: number;
    todayOrders: number;
    activeOrders: number;
    averageRating: number;
    revenueGrowth: number;
    orderGrowth: number;
  };
  revenueChart: {
    labels: string[];
    data: number[];
  };
  orderStatus: {
    pending: number;
    preparing: number;
    ready: number;
    delivering: number;
  };
  topItems: Array<{
    name: string;
    orders: number;
    revenue: number;
  }>;
  customerMetrics: {
    newCustomers: number;
    returningCustomers: number;
    averageOrderValue: number;
  };
  performanceMetrics: {
    averagePreparationTime: number;
    onTimeDeliveryRate: number;
    customerSatisfaction: number;
  };
  alerts: Array<{
    type: 'warning' | 'error' | 'info';
    message: string;
    timestamp: Date;
  }>;
}

interface RealtimeMetrics {
  activeOrders: number;
  ordersInLastHour: number;
  revenueInLastHour: number;
  averageWaitTime: number;
  staffEfficiency: number;
  currentQueueLength: number;
}

interface BusinessInsight {
  type: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  recommendations: string[];
  potentialRevenue?: number;
}

interface PlatformMetrics {
  totalMerchants: number;
  activeMerchants: number;
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  averageOrderValue: number;
  topMerchants: Array<{
    id: string;
    name: string;
    revenue: number;
    orders: number;
  }>;
  growthMetrics: {
    merchantGrowth: number;
    orderGrowth: number;
    revenueGrowth: number;
    customerGrowth: number;
  };
}

export class DashboardService {
  constructor(
    private revenueAnalytics: RevenueAnalyticsService,
    private performanceAnalytics: PerformanceAnalyticsService,
    private customerAnalytics: CustomerAnalyticsService
  ) {}

  async getMerchantDashboard(
    merchantId: string,
    period: string = 'today'
  ): Promise<DashboardData> {
    const cacheKey = `dashboard:${merchantId}:${period}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get date range
    const { startDate, endDate } = this.getDateRange(period);

    // Get overview metrics
    const overview = await this.getOverviewMetrics(merchantId, startDate, endDate);

    // Get revenue chart data
    const revenueChart = await this.getRevenueChartData(merchantId, period);

    // Get order status
    const orderStatus = await this.getOrderStatusBreakdown(merchantId);

    // Get top items
    const topItems = await this.getTopSellingItems(merchantId, startDate, endDate);

    // Get customer metrics
    const customerMetrics = await this.getCustomerMetrics(merchantId, startDate, endDate);

    // Get performance metrics
    const performanceMetrics = await this.getPerformanceMetrics(merchantId, startDate, endDate);

    // Get alerts
    const alerts = await this.getMerchantAlerts(merchantId);

    const dashboardData: DashboardData = {
      overview,
      revenueChart,
      orderStatus,
      topItems,
      customerMetrics,
      performanceMetrics,
      alerts,
    };

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(dashboardData));
    return dashboardData;
  }

  async getRealtimeMetrics(merchantId: string): Promise<RealtimeMetrics> {
    const now = dayjs();
    const oneHourAgo = now.subtract(1, 'hour');

    // Get active orders
    const activeOrders = await prisma.order.count({
      where: {
        merchant_id: merchantId,
        status: { in: ['confirmed', 'preparing', 'ready', 'assigned'] },
      },
    });

    // Get orders in last hour
    const recentOrders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        created_at: { gte: oneHourAgo.toDate() },
      },
    });

    const ordersInLastHour = recentOrders.length;
    const revenueInLastHour = recentOrders.reduce((sum, o) => sum + o.total, 0);

    // Calculate average wait time
    const completedOrders = recentOrders.filter(o => o.ready_at);
    const waitTimes = completedOrders
      .map(o => o.ready_at!.getTime() - o.created_at.getTime())
      .filter(t => t > 0);
    
    const averageWaitTime = waitTimes.length > 0
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length / 1000 / 60
      : 0;

    // Calculate staff efficiency
    const targetPreparationTime = 15; // minutes
    const staffEfficiency = averageWaitTime > 0
      ? Math.min((targetPreparationTime / averageWaitTime) * 100, 100)
      : 100;

    // Get current queue length
    const currentQueueLength = await prisma.order.count({
      where: {
        merchant_id: merchantId,
        status: { in: ['confirmed', 'preparing'] },
      },
    });

    return {
      activeOrders,
      ordersInLastHour,
      revenueInLastHour,
      averageWaitTime,
      staffEfficiency,
      currentQueueLength,
    };
  }

  async getBusinessInsights(merchantId: string): Promise<BusinessInsight[]> {
    const insights: BusinessInsight[] = [];

    // Get merchant data
    const performance = await this.performanceAnalytics.getMerchantPerformance(
      merchantId,
      '30d'
    );
    const customerData = await this.customerAnalytics.getCustomerMetrics(
      merchantId,
      '30d'
    );

    // Peak hours insight
    if (performance.efficiencyMetrics.peakHours.length > 0) {
      const peakHours = performance.efficiencyMetrics.peakHours;
      insights.push({
        type: 'peak_hours',
        title: 'Optimize for Peak Hours',
        description: `Your busiest hours are ${peakHours.map(h => `${h}:00`).join(', ')}. Consider staffing adjustments.`,
        impact: 'high',
        recommendations: [
          'Schedule more staff during peak hours',
          'Prepare popular items in advance',
          'Consider surge pricing during peak times',
        ],
        potentialRevenue: performance.efficiencyMetrics.ordersPerHour * 25 * 30, // Estimate
      });
    }

    // Customer retention insight
    if (customerData.behavior.repeatPurchaseRate < 30) {
      insights.push({
        type: 'customer_retention',
        title: 'Improve Customer Retention',
        description: `Your repeat purchase rate is ${customerData.behavior.repeatPurchaseRate.toFixed(1)}%, which is below average.`,
        impact: 'high',
        recommendations: [
          'Launch a loyalty program',
          'Send targeted promotions to past customers',
          'Improve customer service and order quality',
        ],
        potentialRevenue: customerData.overview.totalCustomers * 20, // Estimate
      });
    }

    // Menu optimization insight
    const topItems = await this.performanceAnalytics.getTopPerformingItems(
      merchantId,
      '30d',
      20
    );
    const lowPerformers = topItems.filter(item => item.popularityScore < 20);
    
    if (lowPerformers.length > 5) {
      insights.push({
        type: 'menu_optimization',
        title: 'Menu Optimization Opportunity',
        description: `${lowPerformers.length} items have low popularity scores. Consider menu refinement.`,
        impact: 'medium',
        recommendations: [
          'Remove or update underperforming items',
          'Highlight popular items more prominently',
          'Bundle slow-moving items with popular ones',
        ],
      });
    }

    // Delivery performance insight
    if (performance.orderMetrics.onTimeDeliveryRate < 85) {
      insights.push({
        type: 'reskflow_performance',
        title: 'Delivery Performance Needs Improvement',
        description: `On-time reskflow rate is ${performance.orderMetrics.onTimeDeliveryRate.toFixed(1)}%, affecting customer satisfaction.`,
        impact: 'high',
        recommendations: [
          'Review preparation time estimates',
          'Optimize kitchen workflows',
          'Consider batching orders for efficiency',
        ],
      });
    }

    // Rating improvement insight
    if (performance.operationalMetrics.averageRating < 4.5) {
      insights.push({
        type: 'rating_improvement',
        title: 'Focus on Rating Improvement',
        description: `Your average rating of ${performance.operationalMetrics.averageRating.toFixed(1)} has room for improvement.`,
        impact: 'high',
        recommendations: [
          'Follow up with dissatisfied customers',
          'Implement quality control measures',
          'Train staff on customer service',
        ],
      });
    }

    // Order value insight
    if (customerData.behavior.averageOrderValue < 30) {
      insights.push({
        type: 'order_value',
        title: 'Increase Average Order Value',
        description: `Average order value is $${customerData.behavior.averageOrderValue.toFixed(2)}, below platform average.`,
        impact: 'medium',
        recommendations: [
          'Implement upselling strategies',
          'Create combo deals and bundles',
          'Offer free reskflow on larger orders',
        ],
        potentialRevenue: customerData.overview.totalCustomers * 5 * 12, // Monthly estimate
      });
    }

    return insights.sort((a, b) => {
      const impactOrder = { high: 3, medium: 2, low: 1 };
      return impactOrder[b.impact] - impactOrder[a.impact];
    });
  }

  async getPlatformMetrics(period: string = '30d'): Promise<PlatformMetrics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get total metrics
    const [
      totalMerchants,
      activeMerchants,
      totalOrders,
      totalCustomers,
    ] = await Promise.all([
      prisma.merchant.count(),
      prisma.merchant.count({
        where: {
          is_active: true,
          lastOrderAt: { gte: startDate },
        },
      }),
      prisma.order.count({
        where: {
          created_at: { gte: startDate },
          status: 'delivered',
        },
      }),
      prisma.customer.count({
        where: {
          created_at: { gte: startDate },
        },
      }),
    ]);

    // Get revenue
    const revenueResult = await prisma.order.aggregate({
      where: {
        created_at: { gte: startDate },
        status: 'delivered',
      },
      _sum: { total: true },
    });
    const totalRevenue = revenueResult._sum.total || 0;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Get top merchants
    const topMerchants = await prisma.$queryRaw`
      SELECT 
        m.id,
        m.name,
        COUNT(o.id) as order_count,
        SUM(o.total) as revenue
      FROM merchants m
      JOIN orders o ON m.id = o.merchant_id
      WHERE o.created_at >= ${startDate}
        AND o.status = 'delivered'
      GROUP BY m.id, m.name
      ORDER BY revenue DESC
      LIMIT 10
    `;

    // Calculate growth metrics
    const previousStartDate = dayjs(startDate).subtract(days, 'day').toDate();
    
    const previousMetrics = await this.getPreviousPeriodMetrics(
      previousStartDate,
      startDate
    );

    const growthMetrics = {
      merchantGrowth: this.calculateGrowth(
        activeMerchants,
        previousMetrics.merchants
      ),
      orderGrowth: this.calculateGrowth(
        totalOrders,
        previousMetrics.orders
      ),
      revenueGrowth: this.calculateGrowth(
        totalRevenue,
        previousMetrics.revenue
      ),
      customerGrowth: this.calculateGrowth(
        totalCustomers,
        previousMetrics.customers
      ),
    };

    return {
      totalMerchants,
      activeMerchants,
      totalOrders,
      totalRevenue,
      totalCustomers,
      averageOrderValue,
      topMerchants: (topMerchants as any[]).map(m => ({
        id: m.id,
        name: m.name,
        revenue: m.revenue,
        orders: m.order_count,
      })),
      growthMetrics,
    };
  }

  private getDateRange(period: string) {
    const now = dayjs();
    let startDate: Date;
    let endDate = now.endOf('day').toDate();

    switch (period) {
      case 'today':
        startDate = now.startOf('day').toDate();
        break;
      case 'yesterday':
        startDate = now.subtract(1, 'day').startOf('day').toDate();
        endDate = now.subtract(1, 'day').endOf('day').toDate();
        break;
      case 'week':
        startDate = now.subtract(7, 'day').startOf('day').toDate();
        break;
      case 'month':
        startDate = now.subtract(30, 'day').startOf('day').toDate();
        break;
      default:
        startDate = now.startOf('day').toDate();
    }

    return { startDate, endDate };
  }

  private async getOverviewMetrics(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ) {
    const [todayStats, yesterdayStats] = await Promise.all([
      prisma.order.aggregate({
        where: {
          merchant_id: merchantId,
          created_at: { gte: startDate, lte: endDate },
          status: { not: 'cancelled' },
        },
        _sum: { total: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: {
          merchant_id: merchantId,
          created_at: {
            gte: dayjs(startDate).subtract(1, 'day').toDate(),
            lte: dayjs(endDate).subtract(1, 'day').toDate(),
          },
          status: { not: 'cancelled' },
        },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    const activeOrders = await prisma.order.count({
      where: {
        merchant_id: merchantId,
        status: { in: ['confirmed', 'preparing', 'ready', 'assigned'] },
      },
    });

    const ratings = await prisma.review.aggregate({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
        rating_type: 'overall',
      },
      _avg: { rating: true },
    });

    const todayRevenue = todayStats._sum.total || 0;
    const yesterdayRevenue = yesterdayStats._sum.total || 0;
    const todayOrders = todayStats._count;
    const yesterdayOrders = yesterdayStats._count;

    return {
      todayRevenue,
      todayOrders,
      activeOrders,
      averageRating: ratings._avg.rating || 0,
      revenueGrowth: this.calculateGrowth(todayRevenue, yesterdayRevenue),
      orderGrowth: this.calculateGrowth(todayOrders, yesterdayOrders),
    };
  }

  private async getRevenueChartData(merchantId: string, period: string) {
    const days = period === 'today' ? 24 : 7; // Hours for today, days for week
    const isToday = period === 'today';
    
    const labels: string[] = [];
    const data: number[] = [];

    if (isToday) {
      // Hourly data for today
      for (let hour = 0; hour < 24; hour++) {
        const startTime = dayjs().startOf('day').add(hour, 'hour').toDate();
        const endTime = dayjs().startOf('day').add(hour + 1, 'hour').toDate();

        const result = await prisma.order.aggregate({
          where: {
            merchant_id: merchantId,
            created_at: { gte: startTime, lt: endTime },
            status: { not: 'cancelled' },
          },
          _sum: { total: true },
        });

        labels.push(`${hour}:00`);
        data.push(result._sum.total || 0);
      }
    } else {
      // Daily data for week
      for (let i = days - 1; i >= 0; i--) {
        const date = dayjs().subtract(i, 'day');
        const startTime = date.startOf('day').toDate();
        const endTime = date.endOf('day').toDate();

        const result = await prisma.order.aggregate({
          where: {
            merchant_id: merchantId,
            created_at: { gte: startTime, lte: endTime },
            status: { not: 'cancelled' },
          },
          _sum: { total: true },
        });

        labels.push(date.format('MMM DD'));
        data.push(result._sum.total || 0);
      }
    }

    return { labels, data };
  }

  private async getOrderStatusBreakdown(merchantId: string) {
    const statuses = await prisma.order.groupBy({
      by: ['status'],
      where: {
        merchant_id: merchantId,
        status: { in: ['confirmed', 'preparing', 'ready', 'assigned'] },
      },
      _count: true,
    });

    const statusMap: any = {
      confirmed: 'pending',
      preparing: 'preparing',
      ready: 'ready',
      assigned: 'delivering',
    };

    const breakdown = {
      pending: 0,
      preparing: 0,
      ready: 0,
      delivering: 0,
    };

    statuses.forEach(s => {
      const key = statusMap[s.status];
      if (key) {
        breakdown[key as keyof typeof breakdown] = s._count;
      }
    });

    return breakdown;
  }

  private async getTopSellingItems(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ) {
    const topItems = await prisma.$queryRaw`
      SELECT 
        i.name,
        COUNT(oi.id) as order_count,
        SUM(oi.price * oi.quantity) as revenue
      FROM items i
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE i.merchant_id = ${merchantId}
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
        AND o.status != 'cancelled'
      GROUP BY i.id, i.name
      ORDER BY revenue DESC
      LIMIT 5
    `;

    return (topItems as any[]).map(item => ({
      name: item.name,
      orders: item.order_count,
      revenue: item.revenue,
    }));
  }

  private async getCustomerMetrics(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ) {
    const newCustomers = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT c.id) as count
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.merchant_id = ${merchantId}
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
        AND NOT EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.customer_id = c.id
            AND o2.merchant_id = ${merchantId}
            AND o2.created_at < ${startDate}
        )
    `;

    const returningCustomers = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT c.id) as count
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.merchant_id = ${merchantId}
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
        AND EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.customer_id = c.id
            AND o2.merchant_id = ${merchantId}
            AND o2.created_at < ${startDate}
        )
    `;

    const avgOrderValue = await prisma.order.aggregate({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate, lte: endDate },
        status: { not: 'cancelled' },
      },
      _avg: { total: true },
    });

    return {
      newCustomers: (newCustomers as any[])[0]?.count || 0,
      returningCustomers: (returningCustomers as any[])[0]?.count || 0,
      averageOrderValue: avgOrderValue._avg.total || 0,
    };
  }

  private async getPerformanceMetrics(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ) {
    const orders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate, lte: endDate },
        status: 'delivered',
      },
      include: {
        reskflow: true,
        reviews: true,
      },
    });

    // Calculate average preparation time
    const prepTimes = orders
      .filter(o => o.accepted_at && o.ready_at)
      .map(o => o.ready_at!.getTime() - o.accepted_at!.getTime());
    
    const averagePreparationTime = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length / 1000 / 60
      : 0;

    // Calculate on-time reskflow rate
    const onTimeDeliveries = orders.filter(o => {
      if (!o.reskflow?.delivered_at || !o.estimated_reskflow_time) return false;
      return o.reskflow.delivered_at <= o.estimated_reskflow_time;
    }).length;

    const onTimeDeliveryRate = orders.length > 0
      ? (onTimeDeliveries / orders.length) * 100
      : 0;

    // Calculate customer satisfaction
    const ratings = orders
      .flatMap(o => o.reviews)
      .filter(r => r.rating_type === 'overall')
      .map(r => r.rating);
    
    const customerSatisfaction = ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 20
      : 0;

    return {
      averagePreparationTime,
      onTimeDeliveryRate,
      customerSatisfaction,
    };
  }

  private async getMerchantAlerts(merchantId: string): Promise<any[]> {
    const alerts: any[] = [];
    const now = dayjs();

    // Check for low inventory
    const lowStockItems = await prisma.item.count({
      where: {
        merchant_id: merchantId,
        stock_quantity: { lt: 10 },
        track_inventory: true,
      },
    });

    if (lowStockItems > 0) {
      alerts.push({
        type: 'warning',
        message: `${lowStockItems} items are running low on stock`,
        timestamp: now.toDate(),
      });
    }

    // Check for high cancellation rate
    const recentOrders = await prisma.order.groupBy({
      by: ['status'],
      where: {
        merchant_id: merchantId,
        created_at: { gte: now.subtract(1, 'hour').toDate() },
      },
      _count: true,
    });

    const totalRecent = recentOrders.reduce((sum, s) => sum + s._count, 0);
    const cancelledRecent = recentOrders.find(s => s.status === 'cancelled')?._count || 0;
    
    if (totalRecent > 10 && cancelledRecent / totalRecent > 0.2) {
      alerts.push({
        type: 'error',
        message: 'High cancellation rate detected in the last hour',
        timestamp: now.toDate(),
      });
    }

    // Check for long preparation times
    const preparingOrders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        status: 'preparing',
        accepted_at: { lt: now.subtract(30, 'minute').toDate() },
      },
    });

    if (preparingOrders.length > 0) {
      alerts.push({
        type: 'warning',
        message: `${preparingOrders.length} orders have been preparing for over 30 minutes`,
        timestamp: now.toDate(),
      });
    }

    return alerts.slice(0, 5); // Limit to 5 most recent alerts
  }

  private calculateGrowth(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  private async getPreviousPeriodMetrics(startDate: Date, endDate: Date) {
    const [merchants, orders, revenue, customers] = await Promise.all([
      prisma.merchant.count({
        where: {
          is_active: true,
          created_at: { lte: endDate },
        },
      }),
      prisma.order.count({
        where: {
          created_at: { gte: startDate, lte: endDate },
          status: 'delivered',
        },
      }),
      prisma.order.aggregate({
        where: {
          created_at: { gte: startDate, lte: endDate },
          status: 'delivered',
        },
        _sum: { total: true },
      }),
      prisma.customer.count({
        where: {
          created_at: { lte: endDate },
        },
      }),
    ]);

    return {
      merchants,
      orders,
      revenue: revenue._sum.total || 0,
      customers,
    };
  }
}