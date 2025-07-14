import { UserProfileService } from './UserProfileService';
import { HybridRecommendationService } from './HybridRecommendationService';
import { redis, logger, prisma } from '@reskflow/shared';
import * as tf from '@tensorflow/tfjs-node';

interface RecommendationParams {
  userId: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  limit: number;
  offset: number;
  context?: string;
}

interface TrendingParams {
  location?: {
    latitude: number;
    longitude: number;
  };
  timeRange: string;
  limit: number;
}

export class RecommendationEngine {
  private userProfileService: UserProfileService;
  private hybridRecommendation: HybridRecommendationService;
  private model: tf.LayersModel | null = null;

  constructor(
    userProfileService: UserProfileService,
    hybridRecommendation: HybridRecommendationService
  ) {
    this.userProfileService = userProfileService;
    this.hybridRecommendation = hybridRecommendation;
  }

  async initialize() {
    try {
      // Load pre-trained model if exists
      const modelPath = './models/recommendation-model';
      try {
        this.model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
        logger.info('Loaded pre-trained recommendation model');
      } catch (error) {
        logger.info('No pre-trained model found, will train on first use');
      }
    } catch (error) {
      logger.error('Failed to initialize recommendation engine', error);
    }
  }

  async getRecommendations(params: RecommendationParams) {
    const { userId, location, limit, offset, context } = params;
    
    // Check cache first
    const cacheKey = `recommendations:${userId}:${JSON.stringify(params)}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get user profile
    const userProfile = await this.userProfileService.getUserProfile(userId);
    
    // Get base recommendations from hybrid system
    const recommendations = await this.hybridRecommendation.getRecommendations({
      userId,
      userProfile,
      limit: limit * 2, // Get more for filtering
      context,
    });

    // Apply location filtering if provided
    let filtered = recommendations;
    if (location) {
      filtered = await this.filterByLocation(recommendations, location, 10); // 10km radius
    }

    // Apply personalization based on user preferences
    const personalized = await this.personalizeRecommendations(
      filtered,
      userProfile
    );

    // Apply pagination
    const paginated = personalized.slice(offset, offset + limit);

    // Enhance with additional data
    const enhanced = await this.enhanceRecommendations(paginated);

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(enhanced));

    return enhanced;
  }

  async getTrendingItems(params: TrendingParams) {
    const { location, timeRange, limit } = params;
    
    // Calculate time window
    const now = new Date();
    const startTime = new Date();
    switch (timeRange) {
      case 'hour':
        startTime.setHours(now.getHours() - 1);
        break;
      case 'day':
        startTime.setDate(now.getDate() - 1);
        break;
      case 'week':
        startTime.setDate(now.getDate() - 7);
        break;
      default:
        startTime.setDate(now.getDate() - 1);
    }

    // Get trending items based on order volume
    const trending = await prisma.$queryRaw`
      SELECT 
        i.id,
        i.name,
        i.description,
        i.price,
        i.image_url,
        m.id as merchant_id,
        m.name as merchant_name,
        COUNT(DISTINCT oi.order_id) as order_count,
        AVG(r.rating) as avg_rating
      FROM items i
      JOIN merchants m ON i.merchant_id = m.id
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN reviews r ON i.id = r.item_id
      WHERE o.created_at >= ${startTime}
      ${location ? prisma.Prisma.sql`
        AND ST_DWithin(
          m.location::geography,
          ST_MakePoint(${location.longitude}, ${location.latitude})::geography,
          10000
        )
      ` : prisma.Prisma.empty}
      GROUP BY i.id, m.id
      ORDER BY order_count DESC
      LIMIT ${limit}
    `;

    return trending;
  }

  async getPersonalizedCategories(userId: string) {
    const userProfile = await this.userProfileService.getUserProfile(userId);
    
    // Get user's category preferences from order history
    const categoryStats = await prisma.$queryRaw`
      SELECT 
        c.id,
        c.name,
        c.icon,
        COUNT(DISTINCT o.id) as order_count,
        MAX(o.created_at) as last_ordered
      FROM categories c
      JOIN items i ON i.category_id = c.id
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ${userId}
        AND o.status = 'DELIVERED'
      GROUP BY c.id
      ORDER BY order_count DESC, last_ordered DESC
    `;

    // Get all categories
    const allCategories = await prisma.category.findMany({
      where: { active: true },
    });

    // Merge and personalize
    const personalized = this.mergeAndPersonalizeCategories(
      categoryStats as any[],
      allCategories,
      userProfile
    );

    return personalized;
  }

  async explainRecommendation(userId: string, itemId: string) {
    const userProfile = await this.userProfileService.getUserProfile(userId);
    
    // Get item details
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        category: true,
        merchant: true,
      },
    });

    if (!item) {
      throw new Error('Item not found');
    }

    // Generate explanation
    const reasons = [];

    // Check if user ordered this before
    const previousOrders = await prisma.order.count({
      where: {
        customer_id: userId,
        orderItems: {
          some: { item_id: itemId },
        },
        status: 'DELIVERED',
      },
    });

    if (previousOrders > 0) {
      reasons.push({
        type: 'reorder',
        message: `You've ordered this ${previousOrders} time${previousOrders > 1 ? 's' : ''} before`,
        weight: 0.3,
      });
    }

    // Check similar items
    const similarItemsOrdered = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT i.id) as count
      FROM items i
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ${userId}
        AND o.status = 'DELIVERED'
        AND i.category_id = ${item.category_id}
        AND i.id != ${itemId}
    `;

    if ((similarItemsOrdered as any[])[0]?.count > 0) {
      reasons.push({
        type: 'category_preference',
        message: `Based on your interest in ${item.category.name}`,
        weight: 0.2,
      });
    }

    // Check ratings
    const avgRating = await prisma.review.aggregate({
      where: { item_id: itemId },
      _avg: { rating: true },
      _count: true,
    });

    if (avgRating._count > 10 && avgRating._avg.rating! > 4.5) {
      reasons.push({
        type: 'highly_rated',
        message: `Highly rated by ${avgRating._count} customers`,
        weight: 0.2,
      });
    }

    // Check trending
    const recentOrders = await prisma.order.count({
      where: {
        orderItems: {
          some: { item_id: itemId },
        },
        created_at: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (recentOrders > 50) {
      reasons.push({
        type: 'trending',
        message: 'Trending in your area',
        weight: 0.15,
      });
    }

    // Sort by weight
    reasons.sort((a, b) => b.weight - a.weight);

    return {
      item,
      reasons,
      confidence: reasons.reduce((sum, r) => sum + r.weight, 0),
    };
  }

  async assignToExperiment(userId: string, experimentId: string) {
    // Simple A/B test assignment
    const hash = this.hashCode(userId + experimentId);
    const variant = hash % 2 === 0 ? 'control' : 'treatment';
    
    // Store assignment
    await redis.setex(
      `experiment:${experimentId}:${userId}`,
      30 * 24 * 60 * 60, // 30 days
      variant
    );

    return variant;
  }

  async trackExperimentEvent(
    experimentId: string,
    userId: string,
    event: string,
    value?: any
  ) {
    const variant = await redis.get(`experiment:${experimentId}:${userId}`);
    if (!variant) {
      throw new Error('User not assigned to experiment');
    }

    // Store event
    const eventData = {
      experimentId,
      userId,
      variant,
      event,
      value,
      timestamp: new Date(),
    };

    await redis.lpush(
      `experiment:${experimentId}:events`,
      JSON.stringify(eventData)
    );

    // Trim to last 10000 events
    await redis.ltrim(`experiment:${experimentId}:events`, 0, 9999);
  }

  async getMetrics() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get recommendation performance metrics
    const metrics = {
      totalRecommendations: await redis.get('metrics:recommendations:total') || 0,
      clickThroughRate: await this.calculateCTR(dayAgo, now),
      conversionRate: await this.calculateConversionRate(dayAgo, now),
      averageOrderValue: await this.calculateAOV(dayAgo, now),
      popularityBias: await this.calculatePopularityBias(),
      coverageRate: await this.calculateCoverageRate(),
      noveltyScore: await this.calculateNoveltyScore(),
    };

    return metrics;
  }

  private async filterByLocation(
    items: any[],
    location: { latitude: number; longitude: number },
    radiusKm: number
  ) {
    // Filter items by merchant location
    const filtered = [];
    
    for (const item of items) {
      const merchant = await prisma.merchant.findUnique({
        where: { id: item.merchant_id },
      });
      
      if (merchant && merchant.latitude && merchant.longitude) {
        const distance = this.calculateDistance(
          location.latitude,
          location.longitude,
          merchant.latitude,
          merchant.longitude
        );
        
        if (distance <= radiusKm) {
          filtered.push({ ...item, distance });
        }
      }
    }

    // Sort by distance
    return filtered.sort((a, b) => a.distance - b.distance);
  }

  private async personalizeRecommendations(items: any[], userProfile: any) {
    // Apply user preferences
    return items.map(item => {
      let score = item.score || 1;

      // Boost based on dietary preferences
      if (userProfile.dietary_preferences?.includes(item.dietary_info)) {
        score *= 1.2;
      }

      // Boost based on price range preference
      if (this.isInPriceRange(item.price, userProfile.price_preference)) {
        score *= 1.1;
      }

      // Penalize if contains allergens
      if (userProfile.allergens?.some((a: string) => item.allergens?.includes(a))) {
        score *= 0.3;
      }

      return { ...item, score };
    }).sort((a, b) => b.score - a.score);
  }

  private async enhanceRecommendations(items: any[]) {
    // Add additional data to recommendations
    const enhanced = [];
    
    for (const item of items) {
      const enhanced_item = {
        ...item,
        merchant: await prisma.merchant.findUnique({
          where: { id: item.merchant_id },
          select: {
            id: true,
            name: true,
            logo_url: true,
            rating: true,
            reskflow_time: true,
            reskflow_fee: true,
          },
        }),
        reviews: await prisma.review.aggregate({
          where: { item_id: item.id },
          _avg: { rating: true },
          _count: true,
        }),
      };
      
      enhanced.push(enhanced_item);
    }

    return enhanced;
  }

  private mergeAndPersonalizeCategories(
    userStats: any[],
    allCategories: any[],
    userProfile: any
  ) {
    const statsMap = new Map(userStats.map(s => [s.id, s]));
    
    return allCategories
      .map(category => {
        const stats = statsMap.get(category.id);
        const score = stats ? stats.order_count * 2 + 10 : 10;
        
        return {
          ...category,
          order_count: stats?.order_count || 0,
          last_ordered: stats?.last_ordered || null,
          score,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private isInPriceRange(price: number, preference?: string): boolean {
    if (!preference) return true;
    
    switch (preference) {
      case 'budget':
        return price < 15;
      case 'moderate':
        return price >= 15 && price < 30;
      case 'premium':
        return price >= 30;
      default:
        return true;
    }
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private async calculateCTR(startTime: Date, endTime: Date) {
    // Simplified CTR calculation
    return 0.15; // 15% placeholder
  }

  private async calculateConversionRate(startTime: Date, endTime: Date) {
    // Simplified conversion rate
    return 0.08; // 8% placeholder
  }

  private async calculateAOV(startTime: Date, endTime: Date) {
    // Average order value for recommended items
    return 28.50; // $28.50 placeholder
  }

  private async calculatePopularityBias() {
    // Measure how much recommendations favor popular items
    return 0.35; // 35% bias placeholder
  }

  private async calculateCoverageRate() {
    // Percentage of catalog that gets recommended
    return 0.72; // 72% coverage placeholder
  }

  private async calculateNoveltyScore() {
    // How often new items are recommended
    return 0.45; // 45% novelty placeholder
  }
}