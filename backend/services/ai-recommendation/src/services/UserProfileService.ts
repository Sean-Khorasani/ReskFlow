import { prisma, redis, logger } from '@reskflow/shared';
import * as natural from 'natural';

interface UserInteraction {
  userId: string;
  itemId: string;
  interactionType: 'view' | 'click' | 'order' | 'rate' | 'favorite';
  context?: string;
  timestamp: Date;
}

interface UserProfile {
  userId: string;
  preferences: {
    categories: { [key: string]: number };
    cuisines: { [key: string]: number };
    priceRange: string;
    dietaryRestrictions: string[];
    allergens: string[];
  };
  behavior: {
    orderFrequency: number;
    averageOrderValue: number;
    preferredOrderTimes: number[];
    reskflowTimePreference: string;
  };
  location: {
    primaryAddress?: any;
    orderLocations: any[];
  };
  interactions: {
    views: number;
    orders: number;
    ratings: number;
    favorites: string[];
  };
  lastUpdated: Date;
}

export class UserProfileService {
  private tfidf: any;

  constructor() {
    this.tfidf = new natural.TfIdf();
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    // Check cache first
    const cached = await redis.get(`user_profile:${userId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Build profile from database
    const profile = await this.buildUserProfile(userId);
    
    // Cache for 1 hour
    await redis.setex(
      `user_profile:${userId}`,
      3600,
      JSON.stringify(profile)
    );

    return profile;
  }

  async updateUserProfile(userId: string): Promise<UserProfile> {
    const profile = await this.buildUserProfile(userId);
    
    // Update cache
    await redis.setex(
      `user_profile:${userId}`,
      3600,
      JSON.stringify(profile)
    );

    // Update profile in database
    await prisma.userProfile.upsert({
      where: { user_id: userId },
      update: {
        preferences: profile.preferences,
        behavior: profile.behavior,
        interactions: profile.interactions,
        updated_at: new Date(),
      },
      create: {
        user_id: userId,
        preferences: profile.preferences,
        behavior: profile.behavior,
        interactions: profile.interactions,
      },
    });

    return profile;
  }

  async recordInteraction(interaction: UserInteraction) {
    // Store interaction
    await prisma.userInteraction.create({
      data: {
        user_id: interaction.userId,
        item_id: interaction.itemId,
        interaction_type: interaction.interactionType,
        context: interaction.context,
        created_at: interaction.timestamp,
      },
    });

    // Update interaction counts in Redis
    const key = `user_interactions:${interaction.userId}`;
    await redis.hincrby(key, interaction.interactionType, 1);
    await redis.expire(key, 7 * 24 * 60 * 60); // 7 days

    // If it's an order, update order-specific metrics
    if (interaction.interactionType === 'order') {
      await this.updateOrderMetrics(interaction.userId, interaction.itemId);
    }
  }

  async getInteractionHistory(
    userId: string,
    limit: number = 100
  ): Promise<UserInteraction[]> {
    const interactions = await prisma.userInteraction.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        item: {
          include: {
            category: true,
            merchant: true,
          },
        },
      },
    });

    return interactions.map(i => ({
      userId: i.user_id,
      itemId: i.item_id,
      interactionType: i.interaction_type as any,
      context: i.context || undefined,
      timestamp: i.created_at,
    }));
  }

  async getSimilarUsers(userId: string, limit: number = 10): Promise<string[]> {
    const userProfile = await this.getUserProfile(userId);
    
    // Find users with similar ordering patterns
    const similarUsers = await prisma.$queryRaw`
      WITH user_categories AS (
        SELECT 
          o.customer_id,
          c.id as category_id,
          COUNT(*) as order_count
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN items i ON oi.item_id = i.id
        JOIN categories c ON i.category_id = c.id
        WHERE o.status = 'DELIVERED'
          AND o.created_at > NOW() - INTERVAL '90 days'
        GROUP BY o.customer_id, c.id
      ),
      user_similarity AS (
        SELECT 
          uc1.customer_id as user1,
          uc2.customer_id as user2,
          SUM(uc1.order_count * uc2.order_count) / 
          (SQRT(SUM(uc1.order_count * uc1.order_count)) * 
           SQRT(SUM(uc2.order_count * uc2.order_count))) as similarity
        FROM user_categories uc1
        JOIN user_categories uc2 
          ON uc1.category_id = uc2.category_id
          AND uc1.customer_id != uc2.customer_id
        WHERE uc1.customer_id = ${userId}
        GROUP BY uc1.customer_id, uc2.customer_id
      )
      SELECT user2 as similar_user_id
      FROM user_similarity
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;

    return (similarUsers as any[]).map(u => u.similar_user_id);
  }

  async getItemAffinityScores(userId: string): Promise<Map<string, number>> {
    // Calculate affinity scores for items based on user behavior
    const scores = new Map<string, number>();

    // Get user's order history
    const orders = await prisma.order.findMany({
      where: {
        customer_id: userId,
        status: 'DELIVERED',
      },
      include: {
        orderItems: {
          include: {
            item: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    // Calculate scores based on recency and frequency
    const now = Date.now();
    orders.forEach((order, orderIndex) => {
      const recencyWeight = Math.exp(-orderIndex * 0.1); // Exponential decay
      const daysSinceOrder = (now - order.created_at.getTime()) / (1000 * 60 * 60 * 24);
      const timeWeight = Math.exp(-daysSinceOrder / 30); // 30-day half-life

      order.orderItems.forEach(orderItem => {
        const currentScore = scores.get(orderItem.item_id) || 0;
        const score = orderItem.quantity * recencyWeight * timeWeight;
        scores.set(orderItem.item_id, currentScore + score);
      });
    });

    return scores;
  }

  private async buildUserProfile(userId: string): Promise<UserProfile> {
    // Get user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get order statistics
    const orderStats = await this.getOrderStatistics(userId);
    const categoryPreferences = await this.getCategoryPreferences(userId);
    const interactionCounts = await this.getInteractionCounts(userId);
    const favorites = await this.getFavorites(userId);

    return {
      userId,
      preferences: {
        categories: categoryPreferences,
        cuisines: await this.getCuisinePreferences(userId),
        priceRange: await this.getPriceRangePreference(userId),
        dietaryRestrictions: user.dietary_restrictions || [],
        allergens: user.allergens || [],
      },
      behavior: {
        orderFrequency: orderStats.frequency,
        averageOrderValue: orderStats.averageValue,
        preferredOrderTimes: orderStats.preferredTimes,
        reskflowTimePreference: orderStats.reskflowTimePreference,
      },
      location: {
        primaryAddress: user.addresses.find(a => a.is_default),
        orderLocations: user.addresses,
      },
      interactions: {
        views: interactionCounts.views || 0,
        orders: interactionCounts.orders || 0,
        ratings: interactionCounts.ratings || 0,
        favorites,
      },
      lastUpdated: new Date(),
    };
  }

  private async getOrderStatistics(userId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orders = await prisma.order.findMany({
      where: {
        customer_id: userId,
        status: 'DELIVERED',
        created_at: { gte: thirtyDaysAgo },
      },
      include: {
        orderItems: true,
      },
    });

    // Calculate frequency (orders per week)
    const frequency = (orders.length / 30) * 7;

    // Calculate average order value
    const totalValue = orders.reduce((sum, order) => sum + order.total, 0);
    const averageValue = orders.length > 0 ? totalValue / orders.length : 0;

    // Find preferred order times (hour of day)
    const hourCounts = new Array(24).fill(0);
    orders.forEach(order => {
      const hour = order.created_at.getHours();
      hourCounts[hour]++;
    });
    const preferredTimes = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(item => item.hour);

    // Determine reskflow time preference
    const avgDeliveryTime = orders.reduce((sum, order) => {
      if (order.delivered_at) {
        return sum + (order.delivered_at.getTime() - order.created_at.getTime());
      }
      return sum;
    }, 0) / orders.length;
    
    const reskflowTimePreference = 
      avgDeliveryTime < 20 * 60 * 1000 ? 'fast' :
      avgDeliveryTime < 35 * 60 * 1000 ? 'moderate' : 'flexible';

    return {
      frequency,
      averageValue,
      preferredTimes,
      reskflowTimePreference,
    };
  }

  private async getCategoryPreferences(userId: string): Promise<{ [key: string]: number }> {
    const categoryOrders = await prisma.$queryRaw`
      SELECT 
        c.name as category_name,
        COUNT(DISTINCT o.id) as order_count,
        SUM(oi.quantity) as total_items
      FROM categories c
      JOIN items i ON i.category_id = c.id
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ${userId}
        AND o.status = 'DELIVERED'
      GROUP BY c.id, c.name
      ORDER BY order_count DESC
    `;

    const preferences: { [key: string]: number } = {};
    let totalOrders = 0;

    (categoryOrders as any[]).forEach(cat => {
      totalOrders += cat.order_count;
    });

    (categoryOrders as any[]).forEach(cat => {
      preferences[cat.category_name] = cat.order_count / totalOrders;
    });

    return preferences;
  }

  private async getCuisinePreferences(userId: string): Promise<{ [key: string]: number }> {
    // Similar to category preferences but for cuisine types
    const cuisineOrders = await prisma.$queryRaw`
      SELECT 
        m.cuisine_type,
        COUNT(DISTINCT o.id) as order_count
      FROM merchants m
      JOIN items i ON i.merchant_id = m.id
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ${userId}
        AND o.status = 'DELIVERED'
        AND m.cuisine_type IS NOT NULL
      GROUP BY m.cuisine_type
      ORDER BY order_count DESC
    `;

    const preferences: { [key: string]: number } = {};
    let totalOrders = 0;

    (cuisineOrders as any[]).forEach(cuisine => {
      totalOrders += cuisine.order_count;
    });

    (cuisineOrders as any[]).forEach(cuisine => {
      preferences[cuisine.cuisine_type] = cuisine.order_count / totalOrders;
    });

    return preferences;
  }

  private async getPriceRangePreference(userId: string): Promise<string> {
    const avgOrderValue = await prisma.order.aggregate({
      where: {
        customer_id: userId,
        status: 'DELIVERED',
      },
      _avg: {
        subtotal: true,
      },
    });

    const avg = avgOrderValue._avg.subtotal || 0;
    
    if (avg < 20) return 'budget';
    if (avg < 40) return 'moderate';
    return 'premium';
  }

  private async getInteractionCounts(userId: string) {
    const counts = await redis.hgetall(`user_interactions:${userId}`);
    return {
      views: parseInt(counts.view || '0'),
      orders: parseInt(counts.order || '0'),
      ratings: parseInt(counts.rate || '0'),
    };
  }

  private async getFavorites(userId: string): Promise<string[]> {
    const favorites = await prisma.favorite.findMany({
      where: { user_id: userId },
      select: { item_id: true },
      orderBy: { created_at: 'desc' },
    });

    return favorites.map(f => f.item_id);
  }

  private async updateOrderMetrics(userId: string, itemId: string) {
    // Update item popularity metrics
    const key = `item_popularity:${itemId}`;
    await redis.zincrby('popular_items', 1, itemId);
    
    // Update user-item affinity
    const affinityKey = `user_item_affinity:${userId}`;
    await redis.zincrby(affinityKey, 1, itemId);
    await redis.expire(affinityKey, 90 * 24 * 60 * 60); // 90 days
  }
}