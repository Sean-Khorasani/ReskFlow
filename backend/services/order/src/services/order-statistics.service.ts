import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

interface StatisticsFilter {
  startDate?: Date;
  endDate?: Date;
  merchantId?: string;
}

interface RevenueFilter extends StatisticsFilter {
  groupBy?: 'day' | 'week' | 'month';
}

export class OrderStatisticsService {
  async getOrderStatistics(filter: StatisticsFilter) {
    const where: Prisma.OrderWhereInput = {
      ...(filter.merchantId && { merchantId: filter.merchantId }),
      ...(filter.startDate && {
        createdAt: {
          gte: filter.startDate,
          ...(filter.endDate && { lte: filter.endDate }),
        },
      }),
    };

    const [
      totalOrders,
      completedOrders,
      cancelledOrders,
      averageOrderValue,
      ordersByStatus,
      ordersByDeliveryType,
    ] = await Promise.all([
      // Total orders
      prisma.order.count({ where }),
      
      // Completed orders
      prisma.order.count({
        where: {
          ...where,
          status: OrderStatus.COMPLETED,
        },
      }),
      
      // Cancelled orders
      prisma.order.count({
        where: {
          ...where,
          status: OrderStatus.CANCELLED,
        },
      }),
      
      // Average order value
      prisma.order.aggregate({
        where: {
          ...where,
          status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
        },
        _avg: {
          total: true,
        },
      }),
      
      // Orders by status
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      
      // Orders by reskflow type
      prisma.order.groupBy({
        by: ['reskflowType'],
        where,
        _count: true,
      }),
    ]);

    // Calculate completion rate
    const completionRate = totalOrders > 0 
      ? (completedOrders / totalOrders) * 100 
      : 0;

    // Calculate average preparation time
    const avgPrepTime = await this.calculateAveragePreparationTime(where);

    return {
      totalOrders,
      completedOrders,
      cancelledOrders,
      completionRate: Math.round(completionRate * 100) / 100,
      averageOrderValue: averageOrderValue._avg.total || 0,
      averagePreparationTime: avgPrepTime,
      ordersByStatus: ordersByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>),
      ordersByDeliveryType: ordersByDeliveryType.reduce((acc, item) => {
        acc[item.reskflowType] = item._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  async getRevenueStatistics(filter: RevenueFilter) {
    const where: Prisma.OrderWhereInput = {
      ...(filter.merchantId && { merchantId: filter.merchantId }),
      ...(filter.startDate && {
        createdAt: {
          gte: filter.startDate,
          ...(filter.endDate && { lte: filter.endDate }),
        },
      }),
      status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
    };

    // Total revenue
    const totalRevenue = await prisma.order.aggregate({
      where,
      _sum: {
        total: true,
        subtotal: true,
        tax: true,
        reskflowFee: true,
        serviceFee: true,
        discount: true,
      },
    });

    // Revenue over time
    const revenueOverTime = await this.getRevenueOverTime(where, filter.groupBy || 'day');

    // Top revenue generating merchants (if admin)
    const topMerchants = !filter.merchantId 
      ? await this.getTopMerchants(where) 
      : null;

    return {
      totalRevenue: totalRevenue._sum.total || 0,
      subtotal: totalRevenue._sum.subtotal || 0,
      totalTax: totalRevenue._sum.tax || 0,
      totalDeliveryFees: totalRevenue._sum.reskflowFee || 0,
      totalServiceFees: totalRevenue._sum.serviceFee || 0,
      totalDiscounts: totalRevenue._sum.discount || 0,
      revenueOverTime,
      topMerchants,
    };
  }

  async getPopularItems(filter: {
    merchantId?: string;
    limit: number;
  }) {
    const items = await prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        order: {
          ...(filter.merchantId && { merchantId: filter.merchantId }),
          status: { in: [OrderStatus.COMPLETED, OrderStatus.DELIVERED] },
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        quantity: true,
        totalPrice: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: filter.limit,
    });

    return items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      orderCount: item._count.id,
      totalQuantity: item._sum.quantity || 0,
      totalRevenue: item._sum.totalPrice || 0,
    }));
  }

  private async calculateAveragePreparationTime(where: Prisma.OrderWhereInput) {
    const completedOrders = await prisma.order.findMany({
      where: {
        ...where,
        status: OrderStatus.COMPLETED,
        completedAt: { not: null },
      },
      select: {
        createdAt: true,
        completedAt: true,
      },
    });

    if (completedOrders.length === 0) return 0;

    const totalTime = completedOrders.reduce((sum, order) => {
      const prepTime = order.completedAt!.getTime() - order.createdAt.getTime();
      return sum + prepTime;
    }, 0);

    return Math.round(totalTime / completedOrders.length / 1000 / 60); // in minutes
  }

  private async getRevenueOverTime(
    where: Prisma.OrderWhereInput,
    groupBy: 'day' | 'week' | 'month'
  ) {
    // This is a simplified version. In production, you'd use proper date grouping
    const orders = await prisma.order.findMany({
      where,
      select: {
        createdAt: true,
        total: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Group by date period
    const grouped = new Map<string, number>();
    
    orders.forEach(order => {
      let key: string;
      const date = order.createdAt;
      
      switch (groupBy) {
        case 'day':
          key = date.toISOString().split('T')[0];
          break;
        case 'week':
          const weekNumber = this.getWeekNumber(date);
          key = `${date.getFullYear()}-W${weekNumber}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
      }
      
      grouped.set(key, (grouped.get(key) || 0) + order.total);
    });

    return Array.from(grouped.entries()).map(([period, revenue]) => ({
      period,
      revenue,
    }));
  }

  private async getTopMerchants(where: Prisma.OrderWhereInput) {
    const merchants = await prisma.order.groupBy({
      by: ['merchantId'],
      where,
      _sum: {
        total: true,
      },
      _count: true,
      orderBy: {
        _sum: {
          total: 'desc',
        },
      },
      take: 5,
    });

    return merchants.map(merchant => ({
      merchantId: merchant.merchantId,
      totalRevenue: merchant._sum.total || 0,
      orderCount: merchant._count,
    }));
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}