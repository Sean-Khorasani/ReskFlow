import { prisma, logger, redis } from '@reskflow/shared';
import dayjs from 'dayjs';
import { groupBy, sumBy } from 'lodash';

interface RevenueData {
  period: string;
  revenue: number;
  orders: number;
  averageOrderValue: number;
  growth: number;
  breakdown?: {
    sales: number;
    reskflow: number;
    service: number;
    tips: number;
    discounts: number;
    refunds: number;
  };
}

interface RevenueBreakdown {
  byCategory: Array<{
    category: string;
    revenue: number;
    percentage: number;
    orders: number;
  }>;
  byPaymentMethod: Array<{
    method: string;
    revenue: number;
    percentage: number;
  }>;
  byOrderType: Array<{
    type: string;
    revenue: number;
    percentage: number;
  }>;
  byTimeOfDay: Array<{
    hour: number;
    revenue: number;
    orders: number;
  }>;
  byDayOfWeek: Array<{
    day: string;
    revenue: number;
    orders: number;
  }>;
}

export class RevenueAnalyticsService {
  async getMerchantRevenue(
    merchantId: string,
    startDate?: string,
    endDate?: string,
    granularity: string = 'day'
  ): Promise<RevenueData[]> {
    const start = startDate ? dayjs(startDate) : dayjs().subtract(30, 'day');
    const end = endDate ? dayjs(endDate) : dayjs();

    // Check cache
    const cacheKey = `revenue:${merchantId}:${start.format('YYYY-MM-DD')}:${end.format('YYYY-MM-DD')}:${granularity}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get orders in date range
    const orders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        status: 'delivered',
        delivered_at: {
          gte: start.toDate(),
          lte: end.toDate(),
        },
      },
      select: {
        id: true,
        total: true,
        subtotal: true,
        reskflow_fee: true,
        service_fee: true,
        tip: true,
        discount_amount: true,
        refund_amount: true,
        delivered_at: true,
      },
    });

    // Group by period
    const grouped = this.groupOrdersByPeriod(orders, granularity);
    
    // Calculate revenue for each period
    const revenueData: RevenueData[] = [];
    const periods = this.generatePeriods(start, end, granularity);

    for (const period of periods) {
      const periodOrders = grouped[period] || [];
      const revenue = sumBy(periodOrders, 'total');
      const previousPeriod = this.getPreviousPeriod(period, granularity);
      const previousRevenue = grouped[previousPeriod] 
        ? sumBy(grouped[previousPeriod], 'total') 
        : revenue;

      const growth = previousRevenue > 0 
        ? ((revenue - previousRevenue) / previousRevenue) * 100 
        : 0;

      revenueData.push({
        period,
        revenue,
        orders: periodOrders.length,
        averageOrderValue: periodOrders.length > 0 ? revenue / periodOrders.length : 0,
        growth,
        breakdown: {
          sales: sumBy(periodOrders, 'subtotal'),
          reskflow: sumBy(periodOrders, 'reskflow_fee'),
          service: sumBy(periodOrders, 'service_fee'),
          tips: sumBy(periodOrders, 'tip'),
          discounts: sumBy(periodOrders, 'discount_amount'),
          refunds: sumBy(periodOrders, 'refund_amount'),
        },
      });
    }

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(revenueData));
    return revenueData;
  }

  async getRevenueBreakdown(
    merchantId: string,
    period: string = '30d'
  ): Promise<RevenueBreakdown> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get detailed order data
    const orders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        status: 'delivered',
        delivered_at: { gte: startDate },
      },
      include: {
        orderItems: {
          include: {
            item: {
              include: {
                category: true,
              },
            },
          },
        },
        payment: true,
      },
    });

    const totalRevenue = sumBy(orders, 'total');

    // By category
    const categoryRevenue = new Map<string, { revenue: number; orders: Set<string> }>();
    
    orders.forEach(order => {
      order.orderItems.forEach(item => {
        const category = item.item.category.name;
        if (!categoryRevenue.has(category)) {
          categoryRevenue.set(category, { revenue: 0, orders: new Set() });
        }
        const data = categoryRevenue.get(category)!;
        data.revenue += item.price * item.quantity;
        data.orders.add(order.id);
      });
    });

    const byCategory = Array.from(categoryRevenue.entries())
      .map(([category, data]) => ({
        category,
        revenue: data.revenue,
        percentage: (data.revenue / totalRevenue) * 100,
        orders: data.orders.size,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // By payment method
    const paymentGroups = groupBy(orders, 'payment.method');
    const byPaymentMethod = Object.entries(paymentGroups)
      .map(([method, orders]) => ({
        method: method || 'unknown',
        revenue: sumBy(orders, 'total'),
        percentage: (sumBy(orders, 'total') / totalRevenue) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // By order type
    const typeGroups = groupBy(orders, 'order_type');
    const byOrderType = Object.entries(typeGroups)
      .map(([type, orders]) => ({
        type: type || 'reskflow',
        revenue: sumBy(orders, 'total'),
        percentage: (sumBy(orders, 'total') / totalRevenue) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // By time of day
    const hourlyRevenue = new Array(24).fill(0).map(() => ({ revenue: 0, orders: 0 }));
    orders.forEach(order => {
      const hour = dayjs(order.delivered_at).hour();
      hourlyRevenue[hour].revenue += order.total;
      hourlyRevenue[hour].orders++;
    });

    const byTimeOfDay = hourlyRevenue.map((data, hour) => ({
      hour,
      revenue: data.revenue,
      orders: data.orders,
    }));

    // By day of week
    const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weeklyRevenue = new Array(7).fill(0).map(() => ({ revenue: 0, orders: 0 }));
    
    orders.forEach(order => {
      const day = dayjs(order.delivered_at).day();
      weeklyRevenue[day].revenue += order.total;
      weeklyRevenue[day].orders++;
    });

    const byDayOfWeek = weeklyRevenue.map((data, index) => ({
      day: weekDays[index],
      revenue: data.revenue,
      orders: data.orders,
    }));

    return {
      byCategory,
      byPaymentMethod,
      byOrderType,
      byTimeOfDay,
      byDayOfWeek,
    };
  }

  async aggregateDailyRevenue() {
    const yesterday = dayjs().subtract(1, 'day').startOf('day');
    const today = dayjs().startOf('day');

    // Get all merchants
    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
    });

    for (const merchant of merchants) {
      // Calculate yesterday's revenue
      const revenue = await prisma.order.aggregate({
        where: {
          merchant_id: merchant.id,
          status: 'delivered',
          delivered_at: {
            gte: yesterday.toDate(),
            lt: today.toDate(),
          },
        },
        _sum: {
          total: true,
          subtotal: true,
          reskflow_fee: true,
          service_fee: true,
          tip: true,
          discount_amount: true,
        },
        _count: true,
      });

      // Store in aggregation table
      await prisma.revenueAggregation.create({
        data: {
          merchant_id: merchant.id,
          date: yesterday.toDate(),
          total_revenue: revenue._sum.total || 0,
          sales_revenue: revenue._sum.subtotal || 0,
          reskflow_revenue: revenue._sum.reskflow_fee || 0,
          service_revenue: revenue._sum.service_fee || 0,
          tips_revenue: revenue._sum.tip || 0,
          discounts: revenue._sum.discount_amount || 0,
          order_count: revenue._count,
          average_order_value: revenue._count > 0 
            ? (revenue._sum.total || 0) / revenue._count 
            : 0,
        },
      });
    }

    logger.info(`Aggregated daily revenue for ${merchants.length} merchants`);
  }

  private groupOrdersByPeriod(orders: any[], granularity: string) {
    const grouped: { [key: string]: any[] } = {};

    orders.forEach(order => {
      const period = this.getPeriodKey(order.delivered_at, granularity);
      if (!grouped[period]) {
        grouped[period] = [];
      }
      grouped[period].push(order);
    });

    return grouped;
  }

  private getPeriodKey(date: Date, granularity: string): string {
    const d = dayjs(date);
    
    switch (granularity) {
      case 'hour':
        return d.format('YYYY-MM-DD HH:00');
      case 'day':
        return d.format('YYYY-MM-DD');
      case 'week':
        return d.startOf('week').format('YYYY-MM-DD');
      case 'month':
        return d.format('YYYY-MM');
      case 'year':
        return d.format('YYYY');
      default:
        return d.format('YYYY-MM-DD');
    }
  }

  private generatePeriods(start: dayjs.Dayjs, end: dayjs.Dayjs, granularity: string): string[] {
    const periods: string[] = [];
    let current = start;

    while (current.isBefore(end) || current.isSame(end)) {
      periods.push(this.getPeriodKey(current.toDate(), granularity));
      
      switch (granularity) {
        case 'hour':
          current = current.add(1, 'hour');
          break;
        case 'day':
          current = current.add(1, 'day');
          break;
        case 'week':
          current = current.add(1, 'week');
          break;
        case 'month':
          current = current.add(1, 'month');
          break;
        case 'year':
          current = current.add(1, 'year');
          break;
      }
    }

    return [...new Set(periods)]; // Remove duplicates
  }

  private getPreviousPeriod(period: string, granularity: string): string {
    const date = dayjs(period);
    
    switch (granularity) {
      case 'hour':
        return date.subtract(1, 'hour').format('YYYY-MM-DD HH:00');
      case 'day':
        return date.subtract(1, 'day').format('YYYY-MM-DD');
      case 'week':
        return date.subtract(1, 'week').format('YYYY-MM-DD');
      case 'month':
        return date.subtract(1, 'month').format('YYYY-MM');
      case 'year':
        return date.subtract(1, 'year').format('YYYY');
      default:
        return date.subtract(1, 'day').format('YYYY-MM-DD');
    }
  }
}