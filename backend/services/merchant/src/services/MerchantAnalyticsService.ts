import { prisma, logger, redis } from '@reskflow/shared';
import { OrderStatus } from '@prisma/client';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';

interface DashboardData {
  overview: {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    completionRate: number;
    averagePreparationTime: number;
    rating: number;
  };
  todayStats: {
    orders: number;
    revenue: number;
    newCustomers: number;
    repeatCustomers: number;
  };
  popularItems: Array<{
    id: string;
    name: string;
    orderCount: number;
    revenue: number;
  }>;
  hourlyOrders: Array<{
    hour: number;
    orderCount: number;
    revenue: number;
  }>;
  ordersByStatus: Record<string, number>;
}

interface RevenueAnalytics {
  period: string;
  data: Array<{
    date: string;
    revenue: number;
    orderCount: number;
    averageOrderValue: number;
  }>;
  totals: {
    revenue: number;
    orders: number;
    growth: number; // Percentage compared to previous period
  };
  breakdown: {
    subtotal: number;
    reskflowFees: number;
    serviceFees: number;
    tips: number;
    discounts: number;
    commissions: number;
    netRevenue: number;
  };
}

export class MerchantAnalyticsService {
  async getDashboardData(params: {
    merchantId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<DashboardData> {
    const { merchantId, startDate, endDate } = params;
    
    // Check cache first
    const cacheKey = `analytics:dashboard:${merchantId}:${startDate || 'all'}:${endDate || 'all'}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const dateFilter = this.getDateFilter(startDate, endDate);

    // Fetch all required data in parallel
    const [
      orders,
      todayOrders,
      merchant,
      popularItems,
      hourlyData,
    ] = await Promise.all([
      prisma.order.findMany({
        where: {
          merchantId,
          ...dateFilter,
        },
        include: {
          items: {
            include: { menuItem: true },
          },
        },
      }),
      prisma.order.findMany({
        where: {
          merchantId,
          createdAt: {
            gte: startOfDay(new Date()),
            lte: endOfDay(new Date()),
          },
        },
      }),
      prisma.merchant.findUnique({
        where: { id: merchantId },
      }),
      this.getPopularItems(merchantId, dateFilter),
      this.getHourlyOrders(merchantId),
    ]);

    // Calculate overview metrics
    const completedOrders = orders.filter(o => o.status === OrderStatus.DELIVERED);
    const totalRevenue = completedOrders.reduce((sum, order) => sum + order.total, 0);
    const averageOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;
    const completionRate = orders.length > 0 ? (completedOrders.length / orders.length) * 100 : 0;

    // Calculate average preparation time
    const preparationTimes = completedOrders
      .filter(o => o.acceptedAt && o.readyAt)
      .map(o => (o.readyAt!.getTime() - o.acceptedAt!.getTime()) / 60000); // minutes
    
    const averagePreparationTime = preparationTimes.length > 0
      ? preparationTimes.reduce((a, b) => a + b, 0) / preparationTimes.length
      : 0;

    // Today's stats
    const todayRevenue = todayOrders
      .filter(o => o.status === OrderStatus.DELIVERED)
      .reduce((sum, order) => sum + order.total, 0);

    // Get unique customers for today
    const todayCustomerIds = new Set(todayOrders.map(o => o.customerId));
    const previousCustomerIds = new Set(
      orders
        .filter(o => o.createdAt < startOfDay(new Date()))
        .map(o => o.customerId)
    );

    const newCustomers = Array.from(todayCustomerIds).filter(
      id => !previousCustomerIds.has(id)
    ).length;
    const repeatCustomers = todayCustomerIds.size - newCustomers;

    // Orders by status
    const ordersByStatus = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const dashboardData: DashboardData = {
      overview: {
        totalOrders: orders.length,
        totalRevenue,
        averageOrderValue,
        completionRate,
        averagePreparationTime,
        rating: merchant?.rating || 0,
      },
      todayStats: {
        orders: todayOrders.length,
        revenue: todayRevenue,
        newCustomers,
        repeatCustomers,
      },
      popularItems,
      hourlyOrders: hourlyData,
      ordersByStatus,
    };

    // Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(dashboardData), 'EX', 300);

    return dashboardData;
  }

  async getRevenueAnalytics(params: {
    merchantId: string;
    period: string;
    startDate?: string;
    endDate?: string;
  }): Promise<RevenueAnalytics> {
    const { merchantId, period, startDate, endDate } = params;

    const dateRange = this.getDateRange(period, startDate, endDate);
    const previousRange = this.getPreviousDateRange(dateRange);

    // Fetch orders for current and previous periods
    const [currentOrders, previousOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          merchantId,
          status: OrderStatus.DELIVERED,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      }),
      prisma.order.findMany({
        where: {
          merchantId,
          status: OrderStatus.DELIVERED,
          createdAt: {
            gte: previousRange.start,
            lte: previousRange.end,
          },
        },
      }),
    ]);

    // Group orders by date
    const ordersByDate = this.groupOrdersByPeriod(currentOrders, period);
    
    // Calculate revenue data
    const data = Object.entries(ordersByDate).map(([date, orders]) => {
      const revenue = orders.reduce((sum, order) => sum + order.total, 0);
      const orderCount = orders.length;
      const averageOrderValue = orderCount > 0 ? revenue / orderCount : 0;

      return {
        date,
        revenue,
        orderCount,
        averageOrderValue,
      };
    });

    // Calculate totals
    const currentRevenue = currentOrders.reduce((sum, order) => sum + order.total, 0);
    const previousRevenue = previousOrders.reduce((sum, order) => sum + order.total, 0);
    const growth = previousRevenue > 0 
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 
      : 0;

    // Calculate revenue breakdown
    const breakdown = this.calculateRevenueBreakdown(currentOrders, merchantId);

    const analytics: RevenueAnalytics = {
      period,
      data,
      totals: {
        revenue: currentRevenue,
        orders: currentOrders.length,
        growth,
      },
      breakdown,
    };

    return analytics;
  }

  private async getPopularItems(
    merchantId: string,
    dateFilter: any
  ): Promise<Array<{ id: string; name: string; orderCount: number; revenue: number }>> {
    const orders = await prisma.order.findMany({
      where: {
        merchantId,
        status: OrderStatus.DELIVERED,
        ...dateFilter,
      },
      include: {
        items: {
          include: { menuItem: true },
        },
      },
    });

    // Aggregate item data
    const itemStats = new Map<string, {
      name: string;
      orderCount: number;
      revenue: number;
    }>();

    orders.forEach(order => {
      order.items.forEach(item => {
        const existing = itemStats.get(item.menuItemId) || {
          name: item.menuItem.name,
          orderCount: 0,
          revenue: 0,
        };

        itemStats.set(item.menuItemId, {
          name: item.menuItem.name,
          orderCount: existing.orderCount + item.quantity,
          revenue: existing.revenue + item.totalPrice,
        });
      });
    });

    // Convert to array and sort by order count
    return Array.from(itemStats.entries())
      .map(([id, stats]) => ({ id, ...stats }))
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 10); // Top 10 items
  }

  private async getHourlyOrders(merchantId: string): Promise<Array<{
    hour: number;
    orderCount: number;
    revenue: number;
  }>> {
    const today = new Date();
    const orders = await prisma.order.findMany({
      where: {
        merchantId,
        createdAt: {
          gte: startOfDay(today),
          lte: endOfDay(today),
        },
      },
    });

    // Initialize hourly data
    const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orderCount: 0,
      revenue: 0,
    }));

    // Aggregate by hour
    orders.forEach(order => {
      const hour = order.createdAt.getHours();
      hourlyData[hour].orderCount++;
      if (order.status === OrderStatus.DELIVERED) {
        hourlyData[hour].revenue += order.total;
      }
    });

    return hourlyData;
  }

  private getDateFilter(startDate?: string, endDate?: string): any {
    if (!startDate && !endDate) {
      return {};
    }

    const filter: any = { createdAt: {} };

    if (startDate) {
      filter.createdAt.gte = new Date(startDate);
    }

    if (endDate) {
      filter.createdAt.lte = new Date(endDate);
    }

    return filter;
  }

  private getDateRange(period: string, startDate?: string, endDate?: string) {
    if (startDate && endDate) {
      return {
        start: new Date(startDate),
        end: new Date(endDate),
      };
    }

    const end = new Date();
    let start: Date;

    switch (period) {
      case 'daily':
        start = startOfDay(end);
        break;
      case 'weekly':
        start = subDays(end, 7);
        break;
      case 'monthly':
        start = subDays(end, 30);
        break;
      case 'yearly':
        start = subDays(end, 365);
        break;
      default:
        start = subDays(end, 30);
    }

    return { start, end };
  }

  private getPreviousDateRange(currentRange: { start: Date; end: Date }) {
    const duration = currentRange.end.getTime() - currentRange.start.getTime();
    return {
      start: new Date(currentRange.start.getTime() - duration),
      end: new Date(currentRange.end.getTime() - duration),
    };
  }

  private groupOrdersByPeriod(orders: any[], period: string): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};

    orders.forEach(order => {
      let key: string;

      switch (period) {
        case 'daily':
          key = format(order.createdAt, 'HH:00');
          break;
        case 'weekly':
        case 'monthly':
          key = format(order.createdAt, 'yyyy-MM-dd');
          break;
        case 'yearly':
          key = format(order.createdAt, 'yyyy-MM');
          break;
        default:
          key = format(order.createdAt, 'yyyy-MM-dd');
      }

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(order);
    });

    return grouped;
  }

  private async calculateRevenueBreakdown(orders: any[], merchantId: string) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    const commissionRate = merchant?.commissionRate || 0.2;

    const breakdown = orders.reduce(
      (acc, order) => {
        acc.subtotal += order.subtotal;
        acc.reskflowFees += order.reskflowFee;
        acc.serviceFees += order.serviceFee;
        acc.tips += order.tip;
        acc.discounts += order.discount;
        return acc;
      },
      {
        subtotal: 0,
        reskflowFees: 0,
        serviceFees: 0,
        tips: 0,
        discounts: 0,
        commissions: 0,
        netRevenue: 0,
      }
    );

    // Calculate commission on subtotal
    breakdown.commissions = breakdown.subtotal * commissionRate;
    
    // Net revenue = subtotal - commissions + tips
    breakdown.netRevenue = breakdown.subtotal - breakdown.commissions + breakdown.tips;

    return breakdown;
  }
}