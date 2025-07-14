import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';

interface VirtualRestaurantAnalytics {
  overview: {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    customerCount: number;
    repeatCustomerRate: number;
  };
  performance: {
    orderGrowth: number;
    revenueGrowth: number;
    averageRating: number;
    averagePrepTime: number;
    cancellationRate: number;
  };
  topMetrics: {
    topItems: Array<{
      itemId: string;
      name: string;
      orders: number;
      revenue: number;
    }>;
    topCategories: Array<{
      category: string;
      orders: number;
      revenue: number;
    }>;
    peakHours: Array<{
      hour: number;
      orders: number;
    }>;
  };
  customerInsights: {
    demographics: {
      ageGroups: Array<{ group: string; percentage: number }>;
      locations: Array<{ area: string; customers: number }>;
    };
    behavior: {
      averageOrderFrequency: number;
      preferredOrderTimes: number[];
      averageItemsPerOrder: number;
    };
  };
}

interface KitchenPerformanceMetrics {
  efficiency: {
    utilizationRate: number;
    orderThroughput: number;
    averagePrepTime: number;
    onTimeRate: number;
  };
  virtualRestaurants: Array<{
    id: string;
    name: string;
    ordersProcessed: number;
    revenue: number;
    efficiency: number;
  }>;
  stationMetrics: Array<{
    station: string;
    ordersProcessed: number;
    averageTime: number;
    efficiency: number;
  }>;
  recommendations: string[];
}

interface BrandComparison {
  brands: Array<{
    brandId: string;
    name: string;
    metrics: {
      orders: number;
      revenue: number;
      averageOrderValue: number;
      customerSatisfaction: number;
      marketShare: number;
    };
  }>;
  winner: {
    category: string;
    brandId: string;
    value: number;
  }[];
}

interface OptimizationSuggestion {
  type: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
  potentialImpact: {
    revenue: number;
    efficiency: number;
  };
  implementation: string;
}

export class AnalyticsService {
  async getVirtualRestaurantAnalytics(
    restaurantId: string,
    period: string = '30d'
  ): Promise<VirtualRestaurantAnalytics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();
    const previousStartDate = dayjs().subtract(days * 2, 'day').toDate();

    // Get current period data
    const currentOrders = await prisma.order.findMany({
      where: {
        virtual_restaurant_id: restaurantId,
        created_at: { gte: startDate },
      },
      include: {
        customer: true,
        orderItems: {
          include: { item: true },
        },
        review: true,
      },
    });

    // Get previous period data for comparison
    const previousOrders = await prisma.order.findMany({
      where: {
        virtual_restaurant_id: restaurantId,
        created_at: {
          gte: previousStartDate,
          lt: startDate,
        },
      },
    });

    // Calculate overview metrics
    const totalOrders = currentOrders.length;
    const totalRevenue = currentOrders.reduce((sum, order) => sum + order.total, 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    const uniqueCustomers = new Set(currentOrders.map(o => o.customer_id));
    const customerCount = uniqueCustomers.size;
    
    const repeatCustomers = await this.getRepeatCustomers(restaurantId, startDate);
    const repeatCustomerRate = customerCount > 0 ? (repeatCustomers / customerCount) * 100 : 0;

    // Calculate performance metrics
    const previousTotal = previousOrders.length;
    const orderGrowth = previousTotal > 0 
      ? ((totalOrders - previousTotal) / previousTotal) * 100 
      : 0;

    const previousRevenue = previousOrders.reduce((sum, order) => sum + order.total, 0);
    const revenueGrowth = previousRevenue > 0
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
      : 0;

    const ratings = currentOrders
      .filter(o => o.review?.rating)
      .map(o => o.review!.rating);
    const averageRating = ratings.length > 0
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0;

    const prepTimes = currentOrders
      .filter(o => o.prepared_at)
      .map(o => dayjs(o.prepared_at).diff(o.created_at, 'minute'));
    const averagePrepTime = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length
      : 0;

    const cancelledOrders = currentOrders.filter(o => o.status === 'cancelled').length;
    const cancellationRate = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0;

    // Get top metrics
    const topItems = await this.getTopItems(restaurantId, startDate);
    const topCategories = await this.getTopCategories(restaurantId, startDate);
    const peakHours = await this.getPeakHours(restaurantId, startDate);

    // Get customer insights
    const demographics = await this.getCustomerDemographics(currentOrders);
    const behavior = await this.getCustomerBehavior(restaurantId, startDate);

    return {
      overview: {
        totalOrders,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        customerCount,
        repeatCustomerRate: Math.round(repeatCustomerRate * 10) / 10,
      },
      performance: {
        orderGrowth: Math.round(orderGrowth * 10) / 10,
        revenueGrowth: Math.round(revenueGrowth * 10) / 10,
        averageRating: Math.round(averageRating * 10) / 10,
        averagePrepTime: Math.round(averagePrepTime),
        cancellationRate: Math.round(cancellationRate * 10) / 10,
      },
      topMetrics: {
        topItems,
        topCategories,
        peakHours,
      },
      customerInsights: {
        demographics,
        behavior,
      },
    };
  }

  async getKitchenPerformance(
    kitchenId: string,
    period: string = '7d'
  ): Promise<KitchenPerformanceMetrics> {
    const days = parseInt(period) || 7;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get kitchen data
    const kitchen = await prisma.kitchen.findUnique({
      where: { id: kitchenId },
      include: {
        virtualRestaurants: {
          where: { status: 'active' },
        },
      },
    });

    if (!kitchen) {
      throw new Error('Kitchen not found');
    }

    // Get all orders processed
    const orders = await prisma.order.findMany({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
        },
        created_at: { gte: startDate },
      },
      include: {
        virtualRestaurant: true,
      },
    });

    // Calculate efficiency metrics
    const totalOrders = orders.length;
    const maxCapacity = kitchen.max_orders_per_hour * 24 * days;
    const utilizationRate = (totalOrders / maxCapacity) * 100;

    const completedOrders = orders.filter(o => o.delivered_at);
    const onTimeDeliveries = completedOrders.filter(o => 
      o.delivered_at! <= o.promised_reskflow_time!
    );
    const onTimeRate = completedOrders.length > 0
      ? (onTimeDeliveries.length / completedOrders.length) * 100
      : 0;

    const prepTimes = orders
      .filter(o => o.prepared_at)
      .map(o => dayjs(o.prepared_at).diff(o.created_at, 'minute'));
    const averagePrepTime = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length
      : 0;

    const orderThroughput = totalOrders / (days * 24); // Orders per hour

    // Get virtual restaurant metrics
    const vrMetrics = await this.getVirtualRestaurantMetrics(orders);

    // Get station metrics
    const stationMetrics = await this.getStationMetrics(kitchenId, startDate);

    // Generate recommendations
    const recommendations = this.generateKitchenRecommendations({
      utilizationRate,
      onTimeRate,
      averagePrepTime,
      stationMetrics,
    });

    return {
      efficiency: {
        utilizationRate: Math.round(utilizationRate * 10) / 10,
        orderThroughput: Math.round(orderThroughput * 10) / 10,
        averagePrepTime: Math.round(averagePrepTime),
        onTimeRate: Math.round(onTimeRate * 10) / 10,
      },
      virtualRestaurants: vrMetrics,
      stationMetrics,
      recommendations,
    };
  }

  async compareBrandPerformance(
    brandIds: string[],
    period: string = '30d'
  ): Promise<BrandComparison> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    const brandMetrics: any[] = [];

    for (const brandId of brandIds) {
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        include: {
          virtualRestaurants: true,
        },
      });

      if (!brand) continue;

      // Get all orders for brand's virtual restaurants
      const orders = await prisma.order.findMany({
        where: {
          virtual_restaurant_id: {
            in: brand.virtualRestaurants.map(vr => vr.id),
          },
          created_at: { gte: startDate },
        },
        include: {
          review: true,
        },
      });

      const totalOrders = orders.length;
      const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const ratings = orders
        .filter(o => o.review?.rating)
        .map(o => o.review!.rating);
      const customerSatisfaction = ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

      brandMetrics.push({
        brandId: brand.id,
        name: brand.name,
        metrics: {
          orders: totalOrders,
          revenue: totalRevenue,
          averageOrderValue: Math.round(averageOrderValue * 100) / 100,
          customerSatisfaction: Math.round(customerSatisfaction * 10) / 10,
          marketShare: 0, // Will calculate after all brands
        },
      });
    }

    // Calculate market share
    const totalMarketOrders = brandMetrics.reduce((sum, b) => sum + b.metrics.orders, 0);
    brandMetrics.forEach(brand => {
      brand.metrics.marketShare = totalMarketOrders > 0
        ? Math.round((brand.metrics.orders / totalMarketOrders) * 1000) / 10
        : 0;
    });

    // Determine winners
    const winners = [
      {
        category: 'Most Orders',
        brandId: brandMetrics.sort((a, b) => b.metrics.orders - a.metrics.orders)[0]?.brandId,
        value: brandMetrics[0]?.metrics.orders || 0,
      },
      {
        category: 'Highest Revenue',
        brandId: brandMetrics.sort((a, b) => b.metrics.revenue - a.metrics.revenue)[0]?.brandId,
        value: brandMetrics[0]?.metrics.revenue || 0,
      },
      {
        category: 'Best Customer Satisfaction',
        brandId: brandMetrics.sort((a, b) => b.metrics.customerSatisfaction - a.metrics.customerSatisfaction)[0]?.brandId,
        value: brandMetrics[0]?.metrics.customerSatisfaction || 0,
      },
    ];

    return {
      brands: brandMetrics,
      winner: winners,
    };
  }

  async getOptimizationSuggestions(kitchenId: string): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    // Analyze kitchen performance
    const performance = await this.getKitchenPerformance(kitchenId, '7d');

    // Check utilization
    if (performance.efficiency.utilizationRate < 50) {
      suggestions.push({
        type: 'capacity',
        priority: 'high',
        description: 'Kitchen is underutilized. Consider adding more virtual restaurants.',
        potentialImpact: {
          revenue: 50,
          efficiency: 30,
        },
        implementation: 'Launch 2-3 additional virtual restaurant concepts targeting different cuisines or demographics.',
      });
    } else if (performance.efficiency.utilizationRate > 85) {
      suggestions.push({
        type: 'capacity',
        priority: 'high',
        description: 'Kitchen is near capacity. Consider optimizing operations or expanding.',
        potentialImpact: {
          revenue: 20,
          efficiency: -10,
        },
        implementation: 'Streamline menu items, improve station efficiency, or add equipment/staff.',
      });
    }

    // Check prep time
    if (performance.efficiency.averagePrepTime > 20) {
      suggestions.push({
        type: 'efficiency',
        priority: 'medium',
        description: 'Prep times are above target. Optimize kitchen workflow.',
        potentialImpact: {
          revenue: 15,
          efficiency: 25,
        },
        implementation: 'Review station assignments, simplify complex items, and improve ingredient prep.',
      });
    }

    // Check virtual restaurant performance
    const underperformingVRs = performance.virtualRestaurants.filter(vr => vr.efficiency < 60);
    if (underperformingVRs.length > 0) {
      suggestions.push({
        type: 'menu',
        priority: 'medium',
        description: `${underperformingVRs.length} virtual restaurants are underperforming.`,
        potentialImpact: {
          revenue: 30,
          efficiency: 20,
        },
        implementation: 'Review menu offerings, pricing, and marketing for underperforming brands.',
      });
    }

    // Analyze menu overlap
    const menuOverlap = await this.analyzeMenuOverlap(kitchenId);
    if (menuOverlap.overlapPercentage > 30) {
      suggestions.push({
        type: 'menu',
        priority: 'low',
        description: 'High menu overlap between virtual restaurants. Differentiate offerings.',
        potentialImpact: {
          revenue: 10,
          efficiency: 15,
        },
        implementation: 'Create unique signature items for each brand to reduce cannibalization.',
      });
    }

    // Check station bottlenecks
    const bottlenecks = performance.stationMetrics.filter(s => s.efficiency < 70);
    if (bottlenecks.length > 0) {
      suggestions.push({
        type: 'operations',
        priority: 'high',
        description: `${bottlenecks.length} stations are bottlenecks in operations.`,
        potentialImpact: {
          revenue: 25,
          efficiency: 35,
        },
        implementation: `Focus on improving efficiency at: ${bottlenecks.map(b => b.station).join(', ')}`,
      });
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  async generatePerformanceReport(data: {
    kitchenId: string;
    period: string;
  }): Promise<void> {
    logger.info('Generating performance report:', data);
    
    // Generate comprehensive report
    const performance = await this.getKitchenPerformance(data.kitchenId, data.period);
    const suggestions = await this.getOptimizationSuggestions(data.kitchenId);

    // Store report
    await prisma.performanceReport.create({
      data: {
        kitchen_id: data.kitchenId,
        period: data.period,
        metrics: performance,
        suggestions,
        generated_at: new Date(),
      },
    });
  }

  private async getRepeatCustomers(restaurantId: string, since: Date): Promise<number> {
    const result = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT customer_id) as count
      FROM (
        SELECT customer_id, COUNT(*) as order_count
        FROM orders
        WHERE virtual_restaurant_id = ${restaurantId}
          AND created_at >= ${since}
        GROUP BY customer_id
        HAVING COUNT(*) > 1
      ) repeat_customers
    ` as any[];

    return result[0]?.count || 0;
  }

  private async getTopItems(restaurantId: string, since: Date): Promise<any[]> {
    const items = await prisma.$queryRaw`
      SELECT 
        oi.item_id,
        i.name,
        COUNT(DISTINCT oi.order_id) as order_count,
        SUM(oi.price * oi.quantity) as revenue
      FROM order_items oi
      JOIN items i ON oi.item_id = i.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.virtual_restaurant_id = ${restaurantId}
        AND o.created_at >= ${since}
      GROUP BY oi.item_id, i.name
      ORDER BY order_count DESC
      LIMIT 10
    ` as any[];

    return items.map(item => ({
      itemId: item.item_id,
      name: item.name,
      orders: parseInt(item.order_count),
      revenue: parseFloat(item.revenue),
    }));
  }

  private async getTopCategories(restaurantId: string, since: Date): Promise<any[]> {
    const categories = await prisma.$queryRaw`
      SELECT 
        i.category,
        COUNT(DISTINCT o.id) as order_count,
        SUM(oi.price * oi.quantity) as revenue
      FROM order_items oi
      JOIN items i ON oi.item_id = i.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.virtual_restaurant_id = ${restaurantId}
        AND o.created_at >= ${since}
      GROUP BY i.category
      ORDER BY revenue DESC
      LIMIT 5
    ` as any[];

    return categories.map(cat => ({
      category: cat.category,
      orders: parseInt(cat.order_count),
      revenue: parseFloat(cat.revenue),
    }));
  }

  private async getPeakHours(restaurantId: string, since: Date): Promise<any[]> {
    const hours = await prisma.$queryRaw`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as order_count
      FROM orders
      WHERE virtual_restaurant_id = ${restaurantId}
        AND created_at >= ${since}
      GROUP BY hour
      ORDER BY hour
    ` as any[];

    return hours.map(h => ({
      hour: parseInt(h.hour),
      orders: parseInt(h.order_count),
    }));
  }

  private async getCustomerDemographics(orders: any[]): Promise<any> {
    // In production, this would use actual customer data
    return {
      ageGroups: [
        { group: '18-25', percentage: 25 },
        { group: '26-35', percentage: 35 },
        { group: '36-45', percentage: 25 },
        { group: '46+', percentage: 15 },
      ],
      locations: [
        { area: 'Downtown', customers: 450 },
        { area: 'Suburbs', customers: 320 },
        { area: 'University Area', customers: 280 },
      ],
    };
  }

  private async getCustomerBehavior(restaurantId: string, since: Date): Promise<any> {
    const orders = await prisma.order.findMany({
      where: {
        virtual_restaurant_id: restaurantId,
        created_at: { gte: since },
      },
      include: {
        orderItems: true,
      },
    });

    // Group orders by customer
    const customerOrders = new Map<string, any[]>();
    orders.forEach(order => {
      if (!customerOrders.has(order.customer_id)) {
        customerOrders.set(order.customer_id, []);
      }
      customerOrders.get(order.customer_id)!.push(order);
    });

    // Calculate average order frequency (orders per week)
    const frequencies = Array.from(customerOrders.values()).map(orders => {
      if (orders.length < 2) return 0;
      const firstOrder = orders[0].created_at;
      const lastOrder = orders[orders.length - 1].created_at;
      const weeks = dayjs(lastOrder).diff(firstOrder, 'week') || 1;
      return orders.length / weeks;
    });

    const averageOrderFrequency = frequencies.length > 0
      ? frequencies.reduce((a, b) => a + b, 0) / frequencies.length
      : 0;

    // Get preferred order times
    const orderHours = orders.map(o => o.created_at.getHours());
    const hourCounts = new Map<number, number>();
    orderHours.forEach(hour => {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });
    
    const preferredOrderTimes = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => hour);

    // Calculate average items per order
    const itemCounts = orders.map(o => o.orderItems.length);
    const averageItemsPerOrder = itemCounts.length > 0
      ? itemCounts.reduce((a, b) => a + b, 0) / itemCounts.length
      : 0;

    return {
      averageOrderFrequency: Math.round(averageOrderFrequency * 10) / 10,
      preferredOrderTimes,
      averageItemsPerOrder: Math.round(averageItemsPerOrder * 10) / 10,
    };
  }

  private async getVirtualRestaurantMetrics(orders: any[]): Promise<any[]> {
    const vrMap = new Map<string, any>();

    orders.forEach(order => {
      const vrId = order.virtual_restaurant_id;
      if (!vrMap.has(vrId)) {
        vrMap.set(vrId, {
          id: vrId,
          name: order.virtualRestaurant.name,
          orders: 0,
          revenue: 0,
          prepTimes: [],
        });
      }

      const vr = vrMap.get(vrId);
      vr.orders++;
      vr.revenue += order.total;
      
      if (order.prepared_at) {
        vr.prepTimes.push(
          dayjs(order.prepared_at).diff(order.created_at, 'minute')
        );
      }
    });

    return Array.from(vrMap.values()).map(vr => {
      const avgPrepTime = vr.prepTimes.length > 0
        ? vr.prepTimes.reduce((a: number, b: number) => a + b, 0) / vr.prepTimes.length
        : 15;

      const efficiency = Math.min(100, Math.max(0, 100 - (avgPrepTime - 15) * 2));

      return {
        id: vr.id,
        name: vr.name,
        ordersProcessed: vr.orders,
        revenue: Math.round(vr.revenue * 100) / 100,
        efficiency: Math.round(efficiency),
      };
    });
  }

  private async getStationMetrics(kitchenId: string, since: Date): Promise<any[]> {
    const assignments = await prisma.stationAssignment.findMany({
      where: {
        station: {
          kitchen_id: kitchenId,
        },
        assigned_at: { gte: since },
      },
      include: {
        station: true,
      },
    });

    const stationMap = new Map<string, any>();

    assignments.forEach(assignment => {
      const stationName = assignment.station.name;
      if (!stationMap.has(stationName)) {
        stationMap.set(stationName, {
          station: stationName,
          orders: 0,
          totalTime: 0,
        });
      }

      const station = stationMap.get(stationName);
      station.orders++;
      
      if (assignment.completed_at) {
        const duration = dayjs(assignment.completed_at).diff(assignment.assigned_at, 'minute');
        station.totalTime += duration;
      }
    });

    return Array.from(stationMap.values()).map(station => {
      const averageTime = station.orders > 0 ? station.totalTime / station.orders : 0;
      const efficiency = Math.min(100, Math.max(0, 100 - (averageTime - 10) * 3));

      return {
        station: station.station,
        ordersProcessed: station.orders,
        averageTime: Math.round(averageTime),
        efficiency: Math.round(efficiency),
      };
    });
  }

  private generateKitchenRecommendations(metrics: any): string[] {
    const recommendations: string[] = [];

    if (metrics.utilizationRate < 50) {
      recommendations.push('Kitchen capacity is underutilized - consider adding more virtual restaurants');
    }

    if (metrics.onTimeRate < 85) {
      recommendations.push('On-time reskflow rate is below target - review preparation and reskflow processes');
    }

    if (metrics.averagePrepTime > 20) {
      recommendations.push('Preparation times are high - optimize kitchen workflow and staffing');
    }

    const inefficientStations = metrics.stationMetrics.filter((s: any) => s.efficiency < 70);
    if (inefficientStations.length > 0) {
      recommendations.push(
        `Improve efficiency at these stations: ${inefficientStations.map((s: any) => s.station).join(', ')}`
      );
    }

    return recommendations;
  }

  private async analyzeMenuOverlap(kitchenId: string): Promise<{
    overlapPercentage: number;
    sharedItems: string[];
  }> {
    const virtualRestaurants = await prisma.virtualRestaurant.findMany({
      where: {
        parent_kitchen_id: kitchenId,
        status: 'active',
      },
      include: {
        menu: {
          include: {
            items: true,
          },
        },
      },
    });

    const itemMap = new Map<string, Set<string>>();

    virtualRestaurants.forEach(vr => {
      vr.menu?.items.forEach(item => {
        const key = `${item.name}-${item.category}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, new Set());
        }
        itemMap.get(key)!.add(vr.id);
      });
    });

    const sharedItems = Array.from(itemMap.entries())
      .filter(([_, vrs]) => vrs.size > 1)
      .map(([item]) => item);

    const totalUniqueItems = itemMap.size;
    const overlapPercentage = totalUniqueItems > 0
      ? (sharedItems.length / totalUniqueItems) * 100
      : 0;

    return {
      overlapPercentage: Math.round(overlapPercentage),
      sharedItems: sharedItems.slice(0, 10), // Top 10 shared items
    };
  }
}