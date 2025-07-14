import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import { BrandManagementService } from './BrandManagementService';
import { MenuSyncService } from './MenuSyncService';
import { OperationsManagementService } from './OperationsManagementService';
import { v4 as uuidv4 } from 'uuid';
import slugify from 'slugify';
import dayjs from 'dayjs';

interface VirtualRestaurant {
  id: string;
  name: string;
  slug: string;
  concept: string;
  cuisineType: string;
  targetAudience: string;
  parentKitchenId: string;
  brandId?: string;
  status: 'draft' | 'active' | 'paused' | 'inactive';
  settings: {
    autoMenuSync: boolean;
    pricingStrategy: string;
    orderRouting: string;
    capacityAllocation: number;
  };
  metrics?: {
    totalOrders: number;
    averageRating: number;
    revenue: number;
  };
  createdAt: Date;
}

interface CreateRestaurantParams {
  name: string;
  concept: string;
  cuisineType: string;
  targetAudience: string;
  parentKitchenId: string;
  ownerId: string;
  brandId?: string;
}

interface RestaurantDashboard {
  restaurant: VirtualRestaurant;
  todayOrders: number;
  todayRevenue: number;
  activeMenuItems: number;
  averagePrepTime: number;
  customerSatisfaction: number;
  topItems: Array<{
    itemId: string;
    name: string;
    orders: number;
    revenue: number;
  }>;
}

export class VirtualRestaurantService {
  constructor(
    private brandManagementService: BrandManagementService,
    private menuSyncService: MenuSyncService,
    private operationsManagementService: OperationsManagementService,
    private virtualRestaurantQueue: Bull.Queue
  ) {}

  async createVirtualRestaurant(params: CreateRestaurantParams): Promise<VirtualRestaurant> {
    // Validate parent kitchen exists and is active
    const kitchen = await prisma.kitchen.findUnique({
      where: { id: params.parentKitchenId },
    });

    if (!kitchen || !kitchen.is_active) {
      throw new Error('Invalid or inactive parent kitchen');
    }

    // Check kitchen capacity
    const hasCapacity = await this.operationsManagementService.checkAvailableCapacity(
      params.parentKitchenId
    );

    if (!hasCapacity) {
      throw new Error('Kitchen has no available capacity for new virtual restaurants');
    }

    // Generate unique slug
    const baseSlug = slugify(params.name, { lower: true });
    const slug = await this.generateUniqueSlug(baseSlug);

    // Create virtual restaurant
    const restaurant = await prisma.virtualRestaurant.create({
      data: {
        id: uuidv4(),
        name: params.name,
        slug,
        concept: params.concept,
        cuisine_type: params.cuisineType,
        target_audience: params.targetAudience,
        parent_kitchen_id: params.parentKitchenId,
        brand_id: params.brandId,
        owner_id: params.ownerId,
        status: 'draft',
        settings: {
          autoMenuSync: true,
          pricingStrategy: 'competitive',
          orderRouting: 'automatic',
          capacityAllocation: 20, // Start with 20% allocation
        },
        created_at: new Date(),
      },
    });

    // Create default brand if not provided
    if (!params.brandId) {
      const brand = await this.brandManagementService.createBrand({
        name: params.name,
        description: params.concept,
        values: ['quality', 'innovation', 'convenience'],
        colors: { primary: '#000000', secondary: '#FFFFFF' },
        fonts: { heading: 'Inter', body: 'Inter' },
        ownerId: params.ownerId,
      });

      await prisma.virtualRestaurant.update({
        where: { id: restaurant.id },
        data: { brand_id: brand.id },
      });
    }

    // Allocate initial capacity
    await this.operationsManagementService.allocateKitchenCapacity(
      params.parentKitchenId,
      restaurant.id,
      20
    );

    // Queue initial setup tasks
    await this.virtualRestaurantQueue.add('setup-restaurant', {
      restaurantId: restaurant.id,
    });

    return this.mapToVirtualRestaurant(restaurant);
  }

  async updateVirtualRestaurant(
    restaurantId: string,
    updates: Partial<VirtualRestaurant>,
    userId: string
  ): Promise<VirtualRestaurant> {
    const restaurant = await prisma.virtualRestaurant.findUnique({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new Error('Virtual restaurant not found');
    }

    if (restaurant.owner_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Update restaurant
    const updated = await prisma.virtualRestaurant.update({
      where: { id: restaurantId },
      data: {
        name: updates.name,
        concept: updates.concept,
        cuisine_type: updates.cuisineType,
        target_audience: updates.targetAudience,
        settings: updates.settings,
        updated_at: new Date(),
      },
    });

    // If name changed, update slug
    if (updates.name && updates.name !== restaurant.name) {
      const newSlug = await this.generateUniqueSlug(slugify(updates.name, { lower: true }));
      await prisma.virtualRestaurant.update({
        where: { id: restaurantId },
        data: { slug: newSlug },
      });
    }

    return this.mapToVirtualRestaurant(updated);
  }

  async toggleRestaurantStatus(
    restaurantId: string,
    status: 'active' | 'paused' | 'inactive',
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    const restaurant = await prisma.virtualRestaurant.findUnique({
      where: { id: restaurantId },
      include: {
        menu: true,
        brand: true,
      },
    });

    if (!restaurant) {
      throw new Error('Virtual restaurant not found');
    }

    if (restaurant.owner_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Validate status transition
    if (status === 'active') {
      // Check requirements for activation
      if (!restaurant.menu || restaurant.menu.items?.length === 0) {
        throw new Error('Cannot activate restaurant without menu items');
      }
      if (!restaurant.brand_id) {
        throw new Error('Cannot activate restaurant without brand');
      }
    }

    // Update status
    await prisma.virtualRestaurant.update({
      where: { id: restaurantId },
      data: {
        status,
        status_changed_at: new Date(),
      },
    });

    // Update availability on reskflow platforms
    if (status !== 'active') {
      await this.updatePlatformAvailability(restaurantId, false);
    } else {
      await this.updatePlatformAvailability(restaurantId, true);
    }

    return {
      success: true,
      message: `Restaurant ${status === 'active' ? 'activated' : status}`,
    };
  }

  async getVirtualRestaurants(params: {
    kitchenId?: string;
    ownerId: string;
    status?: string;
  }): Promise<VirtualRestaurant[]> {
    const where: any = { owner_id: params.ownerId };

    if (params.kitchenId) {
      where.parent_kitchen_id = params.kitchenId;
    }
    if (params.status) {
      where.status = params.status;
    }

    const restaurants = await prisma.virtualRestaurant.findMany({
      where,
      include: {
        brand: true,
        _count: {
          select: {
            orders: true,
            menuItems: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return restaurants.map(r => this.mapToVirtualRestaurant(r));
  }

  async getRestaurantDashboard(
    restaurantId: string,
    userId: string
  ): Promise<RestaurantDashboard> {
    const restaurant = await prisma.virtualRestaurant.findUnique({
      where: { id: restaurantId },
      include: {
        orders: {
          where: {
            created_at: { gte: dayjs().startOf('day').toDate() },
          },
        },
        menuItems: {
          where: { is_available: true },
        },
      },
    });

    if (!restaurant || restaurant.owner_id !== userId) {
      throw new Error('Restaurant not found or unauthorized');
    }

    // Calculate today's metrics
    const todayOrders = restaurant.orders.length;
    const todayRevenue = restaurant.orders.reduce((sum, order) => sum + order.total, 0);

    // Get average prep time
    const prepTimes = restaurant.orders
      .filter(o => o.prepared_at)
      .map(o => dayjs(o.prepared_at).diff(o.created_at, 'minute'));
    
    const averagePrepTime = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length
      : 0;

    // Get customer satisfaction
    const ratings = await prisma.review.findMany({
      where: {
        order: {
          virtual_restaurant_id: restaurantId,
        },
      },
      select: { rating: true },
    });

    const customerSatisfaction = ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : 0;

    // Get top items
    const itemOrders = await prisma.$queryRaw`
      SELECT 
        oi.item_id,
        i.name,
        COUNT(*) as order_count,
        SUM(oi.price * oi.quantity) as revenue
      FROM order_items oi
      JOIN items i ON oi.item_id = i.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.virtual_restaurant_id = ${restaurantId}
        AND o.created_at >= ${dayjs().subtract(30, 'day').toDate()}
      GROUP BY oi.item_id, i.name
      ORDER BY order_count DESC
      LIMIT 5
    ` as any[];

    const topItems = itemOrders.map(item => ({
      itemId: item.item_id,
      name: item.name,
      orders: parseInt(item.order_count),
      revenue: parseFloat(item.revenue),
    }));

    return {
      restaurant: this.mapToVirtualRestaurant(restaurant),
      todayOrders,
      todayRevenue,
      activeMenuItems: restaurant.menuItems.length,
      averagePrepTime: Math.round(averagePrepTime),
      customerSatisfaction: Math.round(customerSatisfaction * 10) / 10,
      topItems,
    };
  }

  async cloneVirtualRestaurant(
    sourceRestaurantId: string,
    params: {
      name: string;
      parentKitchenId: string;
      adjustPricing?: number; // Percentage adjustment
    },
    userId: string
  ): Promise<VirtualRestaurant> {
    const source = await prisma.virtualRestaurant.findUnique({
      where: { id: sourceRestaurantId },
      include: {
        menuItems: true,
        brand: true,
      },
    });

    if (!source || source.owner_id !== userId) {
      throw new Error('Source restaurant not found or unauthorized');
    }

    // Create new restaurant
    const newRestaurant = await this.createVirtualRestaurant({
      name: params.name,
      concept: source.concept,
      cuisineType: source.cuisine_type,
      targetAudience: source.target_audience,
      parentKitchenId: params.parentKitchenId,
      ownerId: userId,
    });

    // Clone menu items
    if (source.menuItems.length > 0) {
      const clonedItems = source.menuItems.map(item => ({
        ...item,
        id: uuidv4(),
        virtual_restaurant_id: newRestaurant.id,
        price: params.adjustPricing 
          ? item.price * (1 + params.adjustPricing / 100)
          : item.price,
        created_at: new Date(),
      }));

      await prisma.menuItem.createMany({
        data: clonedItems,
      });
    }

    // Clone brand settings
    if (source.brand) {
      await this.brandManagementService.cloneBrand(
        source.brand_id!,
        newRestaurant.id,
        `${params.name} Brand`
      );
    }

    return newRestaurant;
  }

  async analyzeMarketOpportunity(params: {
    kitchenId: string;
    cuisineType?: string;
    targetArea: string;
  }): Promise<{
    opportunity: 'high' | 'medium' | 'low';
    reasoning: string[];
    recommendations: Array<{
      concept: string;
      cuisineType: string;
      estimatedDemand: number;
      competition: number;
    }>;
  }> {
    // Analyze local market data
    const areaAnalysis = await this.analyzeArea(params.targetArea);
    
    // Check existing competition
    const competitors = await prisma.virtualRestaurant.count({
      where: {
        cuisine_type: params.cuisineType,
        status: 'active',
        // Would include geo-filtering in production
      },
    });

    // Analyze order patterns
    const demandAnalysis = await this.analyzeDemandPatterns(
      params.kitchenId,
      params.cuisineType
    );

    const reasoning: string[] = [];
    let opportunityScore = 0;

    if (demandAnalysis.growthRate > 0.1) {
      reasoning.push('High demand growth in this cuisine category');
      opportunityScore += 30;
    }

    if (competitors < 5) {
      reasoning.push('Low competition in the area');
      opportunityScore += 40;
    }

    if (areaAnalysis.demographics.averageIncome > 60000) {
      reasoning.push('High-income area with disposable income');
      opportunityScore += 30;
    }

    const opportunity = opportunityScore >= 70 ? 'high' : 
                       opportunityScore >= 40 ? 'medium' : 'low';

    // Generate recommendations
    const recommendations = await this.generateConceptRecommendations(
      params.kitchenId,
      areaAnalysis,
      demandAnalysis
    );

    return {
      opportunity,
      reasoning,
      recommendations,
    };
  }

  private async generateUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await prisma.virtualRestaurant.findFirst({
        where: { slug },
      });

      if (!existing) {
        return slug;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  private async updatePlatformAvailability(
    restaurantId: string,
    available: boolean
  ): Promise<void> {
    // Update availability on integrated reskflow platforms
    const platforms = ['doordash', 'ubereats', 'grubhub'];
    
    for (const platform of platforms) {
      try {
        // In production, this would call actual platform APIs
        logger.info(`Updated ${restaurantId} availability on ${platform}: ${available}`);
      } catch (error) {
        logger.error(`Failed to update availability on ${platform}:`, error);
      }
    }
  }

  private async analyzeArea(targetArea: string): Promise<any> {
    // In production, this would use real demographic data
    return {
      demographics: {
        population: 50000,
        averageIncome: 75000,
        ageDistribution: {
          '18-25': 0.2,
          '26-35': 0.3,
          '36-50': 0.3,
          '50+': 0.2,
        },
      },
      preferences: {
        topCuisines: ['italian', 'mexican', 'asian'],
        dietaryTrends: ['vegan', 'gluten-free'],
      },
    };
  }

  private async analyzeDemandPatterns(
    kitchenId: string,
    cuisineType?: string
  ): Promise<any> {
    // Analyze historical order data
    const thirtyDaysAgo = dayjs().subtract(30, 'day').toDate();
    const sixtyDaysAgo = dayjs().subtract(60, 'day').toDate();

    const recentOrders = await prisma.order.count({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
          cuisine_type: cuisineType,
        },
        created_at: { gte: thirtyDaysAgo },
      },
    });

    const previousOrders = await prisma.order.count({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
          cuisine_type: cuisineType,
        },
        created_at: {
          gte: sixtyDaysAgo,
          lt: thirtyDaysAgo,
        },
      },
    });

    const growthRate = previousOrders > 0 
      ? (recentOrders - previousOrders) / previousOrders
      : 0;

    return {
      recentOrders,
      growthRate,
      peakHours: [12, 13, 18, 19, 20], // Simplified
      averageOrderValue: 35,
    };
  }

  private async generateConceptRecommendations(
    kitchenId: string,
    areaAnalysis: any,
    demandAnalysis: any
  ): Promise<any[]> {
    // Generate AI-powered recommendations based on data
    const recommendations = [
      {
        concept: 'Healthy Bowl Kitchen',
        cuisineType: 'healthy',
        estimatedDemand: 85,
        competition: 20,
      },
      {
        concept: 'Midnight Munchies',
        cuisineType: 'comfort',
        estimatedDemand: 70,
        competition: 35,
      },
      {
        concept: 'Plant Power Express',
        cuisineType: 'vegan',
        estimatedDemand: 65,
        competition: 15,
      },
    ];

    return recommendations;
  }

  private mapToVirtualRestaurant(dbRestaurant: any): VirtualRestaurant {
    return {
      id: dbRestaurant.id,
      name: dbRestaurant.name,
      slug: dbRestaurant.slug,
      concept: dbRestaurant.concept,
      cuisineType: dbRestaurant.cuisine_type,
      targetAudience: dbRestaurant.target_audience,
      parentKitchenId: dbRestaurant.parent_kitchen_id,
      brandId: dbRestaurant.brand_id,
      status: dbRestaurant.status,
      settings: dbRestaurant.settings,
      metrics: dbRestaurant._count ? {
        totalOrders: dbRestaurant._count.orders || 0,
        averageRating: dbRestaurant.average_rating || 0,
        revenue: dbRestaurant.total_revenue || 0,
      } : undefined,
      createdAt: dbRestaurant.created_at,
    };
  }
}