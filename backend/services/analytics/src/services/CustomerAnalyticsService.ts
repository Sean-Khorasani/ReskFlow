import { prisma, logger, redis } from '@reskflow/shared';
import dayjs from 'dayjs';
import { groupBy } from 'lodash';

interface CustomerMetrics {
  overview: {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    churnedCustomers: number;
    averageLifetimeValue: number;
    averageOrderFrequency: number;
  };
  segments: {
    vip: number;
    regular: number;
    occasional: number;
    new: number;
    atRisk: number;
    lost: number;
  };
  behavior: {
    averageOrderValue: number;
    averageItemsPerOrder: number;
    preferredOrderTimes: number[];
    preferredCategories: string[];
    repeatPurchaseRate: number;
  };
  satisfaction: {
    averageRating: number;
    nps: number;
    reviewRate: number;
    complaintRate: number;
  };
}

interface CustomerSegment {
  segmentName: string;
  customerCount: number;
  percentage: number;
  characteristics: {
    avgOrderValue: number;
    avgOrderFrequency: number;
    avgLifetimeValue: number;
    preferredCategories: string[];
    churnRisk: 'low' | 'medium' | 'high';
  };
  recommendations: string[];
}

interface CustomerProfile {
  customerId: string;
  segment: string;
  metrics: {
    totalOrders: number;
    totalSpent: number;
    averageOrderValue: number;
    lastOrderDate: Date;
    daysSinceLastOrder: number;
    favoriteItems: Array<{
      itemId: string;
      name: string;
      orderCount: number;
    }>;
    orderFrequency: number;
    lifetimeValue: number;
  };
  predictions: {
    churnProbability: number;
    nextOrderProbability: number;
    expectedNextOrderDate?: Date;
    recommendedActions: string[];
  };
}

export class CustomerAnalyticsService {
  async getCustomerMetrics(
    merchantId: string,
    period: string = '30d'
  ): Promise<CustomerMetrics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all customers who ordered from merchant
    const customers = await prisma.$queryRaw`
      SELECT DISTINCT
        c.id,
        c.created_at,
        COUNT(DISTINCT o.id) as order_count,
        SUM(o.total) as total_spent,
        MAX(o.delivered_at) as last_order_date,
        MIN(o.delivered_at) as first_order_date
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.merchant_id = ${merchantId}
        AND o.status = 'delivered'
      GROUP BY c.id, c.created_at
    `;

    const customerList = customers as any[];
    const recentCustomers = customerList.filter(
      c => dayjs(c.last_order_date).isAfter(startDate)
    );

    // Calculate segments
    const segments = this.segmentCustomers(customerList);

    // Get new customers
    const newCustomers = customerList.filter(
      c => dayjs(c.created_at).isAfter(startDate)
    ).length;

    // Calculate behavior metrics
    const recentOrders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        status: 'delivered',
        delivered_at: { gte: startDate },
      },
      include: {
        orderItems: {
          include: {
            item: {
              include: { category: true },
            },
          },
        },
        reviews: true,
      },
    });

    const ordersByCustomer = groupBy(recentOrders, 'customer_id');
    const returningCustomers = Object.values(ordersByCustomer)
      .filter(orders => orders.length > 1).length;

    // Calculate average lifetime value
    const totalLifetimeValue = customerList.reduce(
      (sum, c) => sum + parseFloat(c.total_spent),
      0
    );
    const averageLifetimeValue = customerList.length > 0
      ? totalLifetimeValue / customerList.length
      : 0;

    // Calculate average order frequency (orders per month)
    const avgOrderFrequency = customerList.reduce((sum, c) => {
      const monthsActive = dayjs(c.last_order_date).diff(c.first_order_date, 'month') || 1;
      return sum + (c.order_count / monthsActive);
    }, 0) / customerList.length;

    // Calculate behavior patterns
    const allItems = recentOrders.flatMap(o => o.orderItems);
    const categoryCount = new Map<string, number>();
    
    allItems.forEach(item => {
      const category = item.item.category.name;
      categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    });

    const preferredCategories = Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category]) => category);

    const orderTimes = recentOrders.map(o => dayjs(o.created_at).hour());
    const timeFrequency = new Array(24).fill(0);
    orderTimes.forEach(hour => timeFrequency[hour]++);
    
    const preferredOrderTimes = timeFrequency
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(t => t.hour);

    // Calculate satisfaction metrics
    const reviews = recentOrders.flatMap(o => o.reviews);
    const ratings = reviews
      .filter(r => r.rating_type === 'overall')
      .map(r => r.rating);

    const averageRating = ratings.length > 0
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0;

    const reviewRate = recentOrders.length > 0
      ? (reviews.length / recentOrders.length) * 100
      : 0;

    // Calculate repeat purchase rate
    const customersWithRepeatPurchases = Object.values(ordersByCustomer)
      .filter(orders => orders.length > 1).length;
    const repeatPurchaseRate = recentCustomers.length > 0
      ? (customersWithRepeatPurchases / recentCustomers.length) * 100
      : 0;

    return {
      overview: {
        totalCustomers: customerList.length,
        newCustomers,
        returningCustomers,
        churnedCustomers: segments.lost,
        averageLifetimeValue,
        averageOrderFrequency: avgOrderFrequency || 0,
      },
      segments,
      behavior: {
        averageOrderValue: recentOrders.length > 0
          ? recentOrders.reduce((sum, o) => sum + o.total, 0) / recentOrders.length
          : 0,
        averageItemsPerOrder: recentOrders.length > 0
          ? allItems.length / recentOrders.length
          : 0,
        preferredOrderTimes,
        preferredCategories,
        repeatPurchaseRate,
      },
      satisfaction: {
        averageRating,
        nps: this.calculateNPS(reviews),
        reviewRate,
        complaintRate: 0, // Placeholder
      },
    };
  }

  async getCustomerSegments(merchantId: string): Promise<CustomerSegment[]> {
    const customers = await this.getAllMerchantCustomers(merchantId);
    
    const segments: Map<string, any[]> = new Map();
    
    // Segment customers
    customers.forEach(customer => {
      const segment = this.determineCustomerSegment(customer);
      if (!segments.has(segment)) {
        segments.set(segment, []);
      }
      segments.get(segment)!.push(customer);
    });

    // Build segment details
    const segmentDetails: CustomerSegment[] = [];
    const totalCustomers = customers.length;

    for (const [segmentName, segmentCustomers] of segments) {
      const avgOrderValue = segmentCustomers.reduce(
        (sum, c) => sum + (c.total_spent / c.order_count),
        0
      ) / segmentCustomers.length;

      const avgLifetimeValue = segmentCustomers.reduce(
        (sum, c) => sum + c.total_spent,
        0
      ) / segmentCustomers.length;

      const avgOrderFrequency = segmentCustomers.reduce((sum, c) => {
        const monthsActive = dayjs(c.last_order_date).diff(c.first_order_date, 'month') || 1;
        return sum + (c.order_count / monthsActive);
      }, 0) / segmentCustomers.length;

      segmentDetails.push({
        segmentName,
        customerCount: segmentCustomers.length,
        percentage: (segmentCustomers.length / totalCustomers) * 100,
        characteristics: {
          avgOrderValue,
          avgOrderFrequency,
          avgLifetimeValue,
          preferredCategories: [], // Would need additional query
          churnRisk: this.assessChurnRisk(segmentName),
        },
        recommendations: this.getSegmentRecommendations(segmentName),
      });
    }

    return segmentDetails.sort((a, b) => b.customerCount - a.customerCount);
  }

  async getCustomerProfile(
    merchantId: string,
    customerId: string
  ): Promise<CustomerProfile> {
    const customerData = await prisma.$queryRaw`
      SELECT 
        c.id,
        COUNT(DISTINCT o.id) as order_count,
        SUM(o.total) as total_spent,
        MAX(o.delivered_at) as last_order_date,
        MIN(o.delivered_at) as first_order_date,
        AVG(o.total) as avg_order_value
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE c.id = ${customerId}
        AND o.merchant_id = ${merchantId}
        AND o.status = 'delivered'
      GROUP BY c.id
    `;

    if (!customerData || (customerData as any[]).length === 0) {
      throw new Error('Customer not found');
    }

    const customer = (customerData as any[])[0];
    const daysSinceLastOrder = dayjs().diff(customer.last_order_date, 'day');

    // Get favorite items
    const favoriteItems = await prisma.$queryRaw`
      SELECT 
        i.id,
        i.name,
        COUNT(*) as order_count
      FROM items i
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ${customerId}
        AND o.merchant_id = ${merchantId}
        AND o.status = 'delivered'
      GROUP BY i.id, i.name
      ORDER BY order_count DESC
      LIMIT 5
    `;

    // Calculate order frequency
    const monthsActive = dayjs(customer.last_order_date).diff(
      customer.first_order_date,
      'month'
    ) || 1;
    const orderFrequency = customer.order_count / monthsActive;

    // Determine segment
    const segment = this.determineCustomerSegment(customer);

    // Calculate predictions
    const churnProbability = this.calculateChurnProbability(
      daysSinceLastOrder,
      orderFrequency
    );

    const nextOrderProbability = this.calculateNextOrderProbability(
      daysSinceLastOrder,
      orderFrequency
    );

    const expectedNextOrderDate = this.predictNextOrderDate(
      customer.last_order_date,
      orderFrequency
    );

    return {
      customerId,
      segment,
      metrics: {
        totalOrders: customer.order_count,
        totalSpent: customer.total_spent,
        averageOrderValue: customer.avg_order_value,
        lastOrderDate: customer.last_order_date,
        daysSinceLastOrder,
        favoriteItems: (favoriteItems as any[]).map(item => ({
          itemId: item.id,
          name: item.name,
          orderCount: item.order_count,
        })),
        orderFrequency,
        lifetimeValue: customer.total_spent,
      },
      predictions: {
        churnProbability,
        nextOrderProbability,
        expectedNextOrderDate,
        recommendedActions: this.getCustomerRecommendations(
          segment,
          churnProbability
        ),
      },
    };
  }

  async updateAllCustomerSegments() {
    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
    });

    for (const merchant of merchants) {
      await this.updateMerchantCustomerSegments(merchant.id);
    }

    logger.info(`Updated customer segments for ${merchants.length} merchants`);
  }

  async aggregateDailyCustomerMetrics() {
    const yesterday = dayjs().subtract(1, 'day').startOf('day');
    const today = dayjs().startOf('day');

    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
    });

    for (const merchant of merchants) {
      const metrics = await this.getCustomerMetrics(merchant.id, '1d');
      
      await prisma.customerAggregation.create({
        data: {
          merchant_id: merchant.id,
          date: yesterday.toDate(),
          new_customers: metrics.overview.newCustomers,
          returning_customers: metrics.overview.returningCustomers,
          total_customers: metrics.overview.totalCustomers,
          avg_order_value: metrics.behavior.averageOrderValue,
          repeat_purchase_rate: metrics.behavior.repeatPurchaseRate,
          avg_rating: metrics.satisfaction.averageRating,
        },
      });
    }
  }

  private async getAllMerchantCustomers(merchantId: string) {
    const customers = await prisma.$queryRaw`
      SELECT 
        c.id,
        c.created_at,
        COUNT(DISTINCT o.id) as order_count,
        SUM(o.total) as total_spent,
        MAX(o.delivered_at) as last_order_date,
        MIN(o.delivered_at) as first_order_date,
        AVG(o.total) as avg_order_value
      FROM customers c
      JOIN orders o ON c.id = o.customer_id
      WHERE o.merchant_id = ${merchantId}
        AND o.status = 'delivered'
      GROUP BY c.id, c.created_at
    `;

    return customers as any[];
  }

  private segmentCustomers(customers: any[]) {
    const segments = {
      vip: 0,
      regular: 0,
      occasional: 0,
      new: 0,
      atRisk: 0,
      lost: 0,
    };

    customers.forEach(customer => {
      const segment = this.determineCustomerSegment(customer);
      segments[segment as keyof typeof segments]++;
    });

    return segments;
  }

  private determineCustomerSegment(customer: any): string {
    const daysSinceLastOrder = dayjs().diff(customer.last_order_date, 'day');
    const monthsActive = dayjs(customer.last_order_date).diff(
      customer.first_order_date,
      'month'
    ) || 1;
    const orderFrequency = customer.order_count / monthsActive;
    const avgOrderValue = customer.total_spent / customer.order_count;

    // Lost customers (no order in 90+ days)
    if (daysSinceLastOrder > 90) {
      return 'lost';
    }

    // At risk (no order in 45-90 days)
    if (daysSinceLastOrder > 45) {
      return 'atRisk';
    }

    // New customers (first order within 30 days)
    if (dayjs(customer.first_order_date).isAfter(dayjs().subtract(30, 'day'))) {
      return 'new';
    }

    // VIP (high frequency and high value)
    if (orderFrequency >= 4 && avgOrderValue > 50) {
      return 'vip';
    }

    // Regular (moderate frequency)
    if (orderFrequency >= 2) {
      return 'regular';
    }

    // Occasional
    return 'occasional';
  }

  private calculateNPS(reviews: any[]): number {
    if (reviews.length === 0) return 0;

    const ratings = reviews
      .filter(r => r.rating_type === 'overall')
      .map(r => r.rating);

    const promoters = ratings.filter(r => r >= 4.5).length;
    const detractors = ratings.filter(r => r < 3.5).length;

    return ((promoters - detractors) / ratings.length) * 100;
  }

  private assessChurnRisk(segment: string): 'low' | 'medium' | 'high' {
    switch (segment) {
      case 'vip':
      case 'regular':
        return 'low';
      case 'new':
      case 'occasional':
        return 'medium';
      case 'atRisk':
      case 'lost':
        return 'high';
      default:
        return 'medium';
    }
  }

  private getSegmentRecommendations(segment: string): string[] {
    const recommendations: { [key: string]: string[] } = {
      vip: [
        'Offer exclusive deals and early access',
        'Provide personalized service',
        'Create VIP rewards program',
      ],
      regular: [
        'Send targeted promotions',
        'Encourage higher order values',
        'Introduce loyalty rewards',
      ],
      occasional: [
        'Send re-engagement campaigns',
        'Offer limited-time discounts',
        'Highlight new menu items',
      ],
      new: [
        'Send welcome offers',
        'Encourage second purchase',
        'Request feedback',
      ],
      atRisk: [
        'Send win-back campaigns',
        'Offer significant discounts',
        'Survey for feedback',
      ],
      lost: [
        'Launch re-activation campaign',
        'Offer comeback incentives',
        'Investigate churn reasons',
      ],
    };

    return recommendations[segment] || [];
  }

  private calculateChurnProbability(
    daysSinceLastOrder: number,
    orderFrequency: number
  ): number {
    // Simple churn probability model
    const expectedDaysBetweenOrders = 30 / orderFrequency;
    const daysOverdue = Math.max(0, daysSinceLastOrder - expectedDaysBetweenOrders);
    
    // Sigmoid function for smooth probability
    const x = daysOverdue / 30; // Normalize to months
    return 1 / (1 + Math.exp(-x + 1));
  }

  private calculateNextOrderProbability(
    daysSinceLastOrder: number,
    orderFrequency: number
  ): number {
    const expectedDaysBetweenOrders = 30 / orderFrequency;
    
    if (daysSinceLastOrder >= expectedDaysBetweenOrders) {
      return 0.8; // High probability if due
    }
    
    return (daysSinceLastOrder / expectedDaysBetweenOrders) * 0.8;
  }

  private predictNextOrderDate(
    lastOrderDate: Date,
    orderFrequency: number
  ): Date | undefined {
    if (orderFrequency === 0) return undefined;
    
    const daysBetweenOrders = 30 / orderFrequency;
    return dayjs(lastOrderDate).add(daysBetweenOrders, 'day').toDate();
  }

  private getCustomerRecommendations(
    segment: string,
    churnProbability: number
  ): string[] {
    const recommendations: string[] = [];

    if (churnProbability > 0.7) {
      recommendations.push('Send immediate win-back offer');
      recommendations.push('Personal outreach from merchant');
    } else if (churnProbability > 0.4) {
      recommendations.push('Send re-engagement campaign');
      recommendations.push('Offer limited-time discount');
    }

    const segmentRecs = this.getSegmentRecommendations(segment);
    recommendations.push(...segmentRecs);

    return recommendations.slice(0, 5); // Limit to 5 recommendations
  }

  private async updateMerchantCustomerSegments(merchantId: string) {
    const customers = await this.getAllMerchantCustomers(merchantId);
    
    for (const customer of customers) {
      const segment = this.determineCustomerSegment(customer);
      
      await prisma.customerSegment.upsert({
        where: {
          customer_id_merchant_id: {
            customer_id: customer.id,
            merchant_id: merchantId,
          },
        },
        update: {
          segment,
          updated_at: new Date(),
        },
        create: {
          customer_id: customer.id,
          merchant_id: merchantId,
          segment,
        },
      });
    }
  }
}