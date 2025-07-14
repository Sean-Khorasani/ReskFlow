import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';

interface UserPreferences {
  userId: string;
  dietaryRestrictions: string[];
  allergens: string[];
  cuisinePreferences: string[];
  dislikedCuisines: string[];
  priceRange: {
    min: number;
    max: number;
  };
  preferredMealTimes: {
    breakfast: string;
    lunch: string;
    dinner: string;
  };
  spiceLevel: 'mild' | 'medium' | 'hot';
  portionSize: 'small' | 'regular' | 'large';
  healthGoals: string[];
  reskflowPreferences: {
    speed: 'fast' | 'standard' | 'eco';
    contactless: boolean;
    instructions?: string;
  };
}

interface BehaviorPattern {
  type: string;
  value: any;
  frequency: number;
  lastOccurrence: Date;
  confidence: number;
}

interface PreferenceInsight {
  category: string;
  insight: string;
  confidence: number;
  recommendation?: string;
}

export class PreferenceService {
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    let preferences = await prisma.userPreferences.findUnique({
      where: { user_id: userId },
    });

    if (!preferences) {
      // Create default preferences
      preferences = await this.createDefaultPreferences(userId);
    }

    // Enhance with learned preferences
    const learnedPreferences = await this.getLearnedPreferences(userId);
    
    return this.mergePreferences(preferences, learnedPreferences);
  }

  async updateUserPreferences(
    userId: string,
    updates: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const existing = await prisma.userPreferences.findUnique({
      where: { user_id: userId },
    });

    if (existing) {
      await prisma.userPreferences.update({
        where: { user_id: userId },
        data: {
          dietary_restrictions: updates.dietaryRestrictions,
          allergens: updates.allergens,
          cuisine_preferences: updates.cuisinePreferences,
          disliked_cuisines: updates.dislikedCuisines,
          price_range: updates.priceRange,
          preferred_meal_times: updates.preferredMealTimes,
          spice_level: updates.spiceLevel,
          portion_size: updates.portionSize,
          health_goals: updates.healthGoals,
          reskflow_preferences: updates.reskflowPreferences,
          updated_at: new Date(),
        },
      });
    } else {
      await this.createDefaultPreferences(userId, updates);
    }

    return this.getUserPreferences(userId);
  }

  async learnFromBehavior(
    userId: string,
    action: string,
    data: any
  ): Promise<void> {
    // Track user behavior for preference learning
    await prisma.userBehavior.create({
      data: {
        user_id: userId,
        action,
        data,
        created_at: new Date(),
      },
    });

    // Analyze patterns based on action type
    switch (action) {
      case 'order_placed':
        await this.analyzeOrderPatterns(userId, data);
        break;
      case 'item_viewed':
        await this.analyzeViewingPatterns(userId, data);
        break;
      case 'search_performed':
        await this.analyzeSearchPatterns(userId, data);
        break;
      case 'item_favorited':
        await this.analyzeFavoritePatterns(userId, data);
        break;
      case 'review_submitted':
        await this.analyzeReviewPatterns(userId, data);
        break;
    }
  }

  async getPreferenceInsights(userId: string): Promise<PreferenceInsight[]> {
    const insights: PreferenceInsight[] = [];
    
    // Get user's order history
    const recentOrders = await prisma.order.findMany({
      where: {
        customer_id: userId,
        created_at: { gte: dayjs().subtract(30, 'day').toDate() },
      },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
    });

    // Analyze ordering patterns
    const orderAnalysis = this.analyzeOrderHistory(recentOrders);
    
    // Generate insights
    if (orderAnalysis.favoriteCategory) {
      insights.push({
        category: 'cuisine',
        insight: `You order ${orderAnalysis.favoriteCategory} most frequently`,
        confidence: 0.9,
        recommendation: `Try exploring more ${orderAnalysis.favoriteCategory} restaurants`,
      });
    }

    if (orderAnalysis.averageSpend > 0) {
      insights.push({
        category: 'budget',
        insight: `Your average order is $${orderAnalysis.averageSpend.toFixed(2)}`,
        confidence: 0.95,
      });
    }

    if (orderAnalysis.peakOrderTime) {
      insights.push({
        category: 'timing',
        insight: `You usually order around ${orderAnalysis.peakOrderTime}`,
        confidence: 0.8,
        recommendation: 'Set up scheduled orders for convenience',
      });
    }

    // Dietary pattern insights
    const dietaryPatterns = await this.analyzeDietaryPatterns(userId);
    insights.push(...dietaryPatterns);

    return insights;
  }

  async getPredictedPreferences(
    userId: string,
    context: {
      time: Date;
      location?: { latitude: number; longitude: number };
      weather?: string;
    }
  ): Promise<{
    predictedCuisine: string;
    predictedPriceRange: { min: number; max: number };
    predictedItems: string[];
    confidence: number;
  }> {
    // Get historical data
    const orderHistory = await this.getOrderHistoryWithContext(userId);
    
    // Analyze patterns based on context
    const timeOfDay = context.time.getHours();
    const dayOfWeek = context.time.getDay();
    
    // Find similar past orders
    const similarOrders = orderHistory.filter(order => {
      const orderHour = order.created_at.getHours();
      const orderDay = order.created_at.getDay();
      
      return Math.abs(orderHour - timeOfDay) <= 1 && orderDay === dayOfWeek;
    });

    if (similarOrders.length === 0) {
      // Return default predictions
      return {
        predictedCuisine: 'american',
        predictedPriceRange: { min: 10, max: 30 },
        predictedItems: [],
        confidence: 0.3,
      };
    }

    // Aggregate preferences from similar orders
    const cuisineCounts = new Map<string, number>();
    const prices: number[] = [];
    const itemCounts = new Map<string, number>();

    similarOrders.forEach(order => {
      if (order.merchant?.cuisine_type) {
        cuisineCounts.set(
          order.merchant.cuisine_type,
          (cuisineCounts.get(order.merchant.cuisine_type) || 0) + 1
        );
      }
      
      prices.push(order.total);
      
      order.orderItems.forEach(item => {
        itemCounts.set(
          item.item.name,
          (itemCounts.get(item.item.name) || 0) + 1
        );
      });
    });

    // Get most frequent cuisine
    const predictedCuisine = Array.from(cuisineCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'american';

    // Calculate price range
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const predictedPriceRange = {
      min: Math.max(10, avgPrice * 0.7),
      max: avgPrice * 1.3,
    };

    // Get top predicted items
    const predictedItems = Array.from(itemCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([item]) => item);

    const confidence = Math.min(0.9, similarOrders.length / 10);

    return {
      predictedCuisine,
      predictedPriceRange,
      predictedItems,
      confidence,
    };
  }

  async getPersonalizationScore(userId: string): Promise<{
    score: number;
    factors: {
      profileCompleteness: number;
      behaviorData: number;
      consistencyScore: number;
    };
    recommendations: string[];
  }> {
    const preferences = await prisma.userPreferences.findUnique({
      where: { user_id: userId },
    });

    const behaviorCount = await prisma.userBehavior.count({
      where: { user_id: userId },
    });

    const orderCount = await prisma.order.count({
      where: { customer_id: userId },
    });

    // Calculate profile completeness
    let profileCompleteness = 0;
    if (preferences) {
      if (preferences.dietary_restrictions?.length > 0) profileCompleteness += 20;
      if (preferences.cuisine_preferences?.length > 0) profileCompleteness += 20;
      if (preferences.price_range) profileCompleteness += 20;
      if (preferences.reskflow_preferences) profileCompleteness += 20;
      if (preferences.health_goals?.length > 0) profileCompleteness += 20;
    }

    // Calculate behavior data score
    const behaviorData = Math.min(100, behaviorCount * 2);

    // Calculate consistency score
    const consistencyScore = await this.calculateConsistencyScore(userId);

    const overallScore = (profileCompleteness + behaviorData + consistencyScore) / 3;

    const recommendations: string[] = [];
    if (profileCompleteness < 60) {
      recommendations.push('Complete your dietary preferences for better recommendations');
    }
    if (behaviorData < 50) {
      recommendations.push('Order more to help us learn your preferences');
    }
    if (consistencyScore < 70) {
      recommendations.push('Your preferences vary - consider updating your profile');
    }

    return {
      score: Math.round(overallScore),
      factors: {
        profileCompleteness,
        behaviorData,
        consistencyScore,
      },
      recommendations,
    };
  }

  private async createDefaultPreferences(
    userId: string,
    initialData?: Partial<UserPreferences>
  ): Promise<any> {
    return await prisma.userPreferences.create({
      data: {
        user_id: userId,
        dietary_restrictions: initialData?.dietaryRestrictions || [],
        allergens: initialData?.allergens || [],
        cuisine_preferences: initialData?.cuisinePreferences || [],
        disliked_cuisines: initialData?.dislikedCuisines || [],
        price_range: initialData?.priceRange || { min: 10, max: 50 },
        preferred_meal_times: initialData?.preferredMealTimes || {
          breakfast: '08:00',
          lunch: '12:00',
          dinner: '19:00',
        },
        spice_level: initialData?.spiceLevel || 'medium',
        portion_size: initialData?.portionSize || 'regular',
        health_goals: initialData?.healthGoals || [],
        reskflow_preferences: initialData?.reskflowPreferences || {
          speed: 'standard',
          contactless: true,
        },
        created_at: new Date(),
      },
    });
  }

  private async getLearnedPreferences(userId: string): Promise<any> {
    // Analyze recent behavior patterns
    const recentBehaviors = await prisma.userBehavior.findMany({
      where: {
        user_id: userId,
        created_at: { gte: dayjs().subtract(90, 'day').toDate() },
      },
      orderBy: { created_at: 'desc' },
    });

    const patterns = this.extractPatterns(recentBehaviors);
    
    return {
      learnedCuisines: patterns.cuisines,
      learnedPriceRange: patterns.priceRange,
      learnedSpiceLevel: patterns.spiceLevel,
      learnedHealthPreferences: patterns.healthPreferences,
    };
  }

  private mergePreferences(stored: any, learned: any): UserPreferences {
    return {
      userId: stored.user_id,
      dietaryRestrictions: stored.dietary_restrictions || [],
      allergens: stored.allergens || [],
      cuisinePreferences: [
        ...(stored.cuisine_preferences || []),
        ...(learned.learnedCuisines || []),
      ].filter((v, i, a) => a.indexOf(v) === i), // Remove duplicates
      dislikedCuisines: stored.disliked_cuisines || [],
      priceRange: learned.learnedPriceRange || stored.price_range,
      preferredMealTimes: stored.preferred_meal_times,
      spiceLevel: learned.learnedSpiceLevel || stored.spice_level,
      portionSize: stored.portion_size,
      healthGoals: [
        ...(stored.health_goals || []),
        ...(learned.learnedHealthPreferences || []),
      ].filter((v, i, a) => a.indexOf(v) === i),
      reskflowPreferences: stored.reskflow_preferences,
    };
  }

  private extractPatterns(behaviors: any[]): any {
    const cuisineCounts = new Map<string, number>();
    const prices: number[] = [];
    const spiceLevels = new Map<string, number>();
    const healthTags = new Map<string, number>();

    behaviors.forEach(behavior => {
      if (behavior.action === 'order_placed' && behavior.data) {
        if (behavior.data.cuisine) {
          cuisineCounts.set(
            behavior.data.cuisine,
            (cuisineCounts.get(behavior.data.cuisine) || 0) + 1
          );
        }
        if (behavior.data.total) {
          prices.push(behavior.data.total);
        }
        if (behavior.data.items) {
          behavior.data.items.forEach((item: any) => {
            if (item.spiceLevel) {
              spiceLevels.set(
                item.spiceLevel,
                (spiceLevels.get(item.spiceLevel) || 0) + 1
              );
            }
            if (item.healthTags) {
              item.healthTags.forEach((tag: string) => {
                healthTags.set(tag, (healthTags.get(tag) || 0) + 1);
              });
            }
          });
        }
      }
    });

    // Extract top patterns
    const topCuisines = Array.from(cuisineCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cuisine]) => cuisine);

    const avgPrice = prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 25;

    const priceRange = {
      min: Math.max(5, avgPrice * 0.6),
      max: avgPrice * 1.5,
    };

    const preferredSpiceLevel = Array.from(spiceLevels.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    const topHealthTags = Array.from(healthTags.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);

    return {
      cuisines: topCuisines,
      priceRange,
      spiceLevel: preferredSpiceLevel,
      healthPreferences: topHealthTags,
    };
  }

  private async analyzeOrderPatterns(userId: string, orderData: any): Promise<void> {
    // Extract patterns from order
    const patterns: BehaviorPattern[] = [];

    if (orderData.merchant?.cuisine_type) {
      patterns.push({
        type: 'cuisine_preference',
        value: orderData.merchant.cuisine_type,
        frequency: 1,
        lastOccurrence: new Date(),
        confidence: 0.8,
      });
    }

    if (orderData.total) {
      patterns.push({
        type: 'price_preference',
        value: orderData.total,
        frequency: 1,
        lastOccurrence: new Date(),
        confidence: 0.7,
      });
    }

    // Store patterns
    for (const pattern of patterns) {
      await prisma.behaviorPattern.upsert({
        where: {
          user_id_type_value: {
            user_id: userId,
            type: pattern.type,
            value: pattern.value.toString(),
          },
        },
        update: {
          frequency: { increment: 1 },
          last_occurrence: pattern.lastOccurrence,
          confidence: pattern.confidence,
        },
        create: {
          user_id: userId,
          type: pattern.type,
          value: pattern.value.toString(),
          frequency: 1,
          last_occurrence: pattern.lastOccurrence,
          confidence: pattern.confidence,
        },
      });
    }
  }

  private async analyzeViewingPatterns(userId: string, data: any): Promise<void> {
    // Track item viewing patterns
    if (data.itemId && data.viewDuration > 5) {
      await prisma.behaviorPattern.upsert({
        where: {
          user_id_type_value: {
            user_id: userId,
            type: 'item_interest',
            value: data.itemId,
          },
        },
        update: {
          frequency: { increment: 1 },
          last_occurrence: new Date(),
        },
        create: {
          user_id: userId,
          type: 'item_interest',
          value: data.itemId,
          frequency: 1,
          last_occurrence: new Date(),
          confidence: 0.5,
        },
      });
    }
  }

  private async analyzeSearchPatterns(userId: string, data: any): Promise<void> {
    // Track search patterns
    if (data.query) {
      const searchTerms = data.query.toLowerCase().split(' ');
      
      for (const term of searchTerms) {
        if (this.isCuisineRelated(term) || this.isDietaryRelated(term)) {
          await prisma.behaviorPattern.upsert({
            where: {
              user_id_type_value: {
                user_id: userId,
                type: 'search_preference',
                value: term,
              },
            },
            update: {
              frequency: { increment: 1 },
              last_occurrence: new Date(),
            },
            create: {
              user_id: userId,
              type: 'search_preference',
              value: term,
              frequency: 1,
              last_occurrence: new Date(),
              confidence: 0.6,
            },
          });
        }
      }
    }
  }

  private async analyzeFavoritePatterns(userId: string, data: any): Promise<void> {
    // High confidence signal for preferences
    if (data.itemId) {
      const item = await prisma.item.findUnique({
        where: { id: data.itemId },
        include: { merchant: true },
      });

      if (item) {
        // Track cuisine preference
        if (item.merchant.cuisine_type) {
          await prisma.behaviorPattern.upsert({
            where: {
              user_id_type_value: {
                user_id: userId,
                type: 'cuisine_favorite',
                value: item.merchant.cuisine_type,
              },
            },
            update: {
              frequency: { increment: 2 }, // Higher weight for favorites
              last_occurrence: new Date(),
              confidence: 0.9,
            },
            create: {
              user_id: userId,
              type: 'cuisine_favorite',
              value: item.merchant.cuisine_type,
              frequency: 2,
              last_occurrence: new Date(),
              confidence: 0.9,
            },
          });
        }
      }
    }
  }

  private async analyzeReviewPatterns(userId: string, data: any): Promise<void> {
    // Extract preferences from review content
    if (data.rating >= 4 && data.itemId) {
      const item = await prisma.item.findUnique({
        where: { id: data.itemId },
        include: { dietary_info: true },
      });

      if (item?.dietary_info?.tags) {
        for (const tag of item.dietary_info.tags) {
          await prisma.behaviorPattern.upsert({
            where: {
              user_id_type_value: {
                user_id: userId,
                type: 'dietary_positive',
                value: tag,
              },
            },
            update: {
              frequency: { increment: 1 },
              last_occurrence: new Date(),
              confidence: 0.8,
            },
            create: {
              user_id: userId,
              type: 'dietary_positive',
              value: tag,
              frequency: 1,
              last_occurrence: new Date(),
              confidence: 0.8,
            },
          });
        }
      }
    }
  }

  private analyzeOrderHistory(orders: any[]): any {
    const categories = new Map<string, number>();
    const spendTotals: number[] = [];
    const orderTimes: number[] = [];

    orders.forEach(order => {
      // Track categories
      order.orderItems.forEach((item: any) => {
        if (item.item.category) {
          categories.set(
            item.item.category,
            (categories.get(item.item.category) || 0) + 1
          );
        }
      });

      // Track spending
      spendTotals.push(order.total);

      // Track order times
      orderTimes.push(order.created_at.getHours());
    });

    const favoriteCategory = Array.from(categories.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    const averageSpend = spendTotals.length > 0
      ? spendTotals.reduce((a, b) => a + b, 0) / spendTotals.length
      : 0;

    const hourCounts = new Map<number, number>();
    orderTimes.forEach(hour => {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });

    const peakHour = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    const peakOrderTime = peakHour !== undefined
      ? `${peakHour}:00 - ${peakHour + 1}:00`
      : null;

    return {
      favoriteCategory,
      averageSpend,
      peakOrderTime,
    };
  }

  private async analyzeDietaryPatterns(userId: string): Promise<PreferenceInsight[]> {
    const insights: PreferenceInsight[] = [];

    const patterns = await prisma.behaviorPattern.findMany({
      where: {
        user_id: userId,
        type: { in: ['dietary_positive', 'dietary_negative'] },
      },
      orderBy: { frequency: 'desc' },
      take: 5,
    });

    patterns.forEach(pattern => {
      if (pattern.frequency > 3) {
        insights.push({
          category: 'dietary',
          insight: `You frequently choose ${pattern.value} options`,
          confidence: pattern.confidence,
          recommendation: `Add ${pattern.value} to your dietary preferences for better matches`,
        });
      }
    });

    return insights;
  }

  private async getOrderHistoryWithContext(userId: string): Promise<any[]> {
    return await prisma.order.findMany({
      where: {
        customer_id: userId,
        created_at: { gte: dayjs().subtract(180, 'day').toDate() },
      },
      include: {
        merchant: true,
        orderItems: {
          include: { item: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  private async calculateConsistencyScore(userId: string): Promise<number> {
    const patterns = await prisma.behaviorPattern.findMany({
      where: { user_id: userId },
    });

    if (patterns.length === 0) return 50;

    // Group patterns by type
    const typeGroups = new Map<string, any[]>();
    patterns.forEach(pattern => {
      if (!typeGroups.has(pattern.type)) {
        typeGroups.set(pattern.type, []);
      }
      typeGroups.get(pattern.type)!.push(pattern);
    });

    // Calculate consistency for each type
    let totalConsistency = 0;
    let typeCount = 0;

    typeGroups.forEach((patterns, type) => {
      if (patterns.length > 1) {
        // Sort by frequency
        patterns.sort((a, b) => b.frequency - a.frequency);
        
        // Calculate how dominant the top choice is
        const topFrequency = patterns[0].frequency;
        const totalFrequency = patterns.reduce((sum, p) => sum + p.frequency, 0);
        const dominance = topFrequency / totalFrequency;
        
        totalConsistency += dominance * 100;
        typeCount++;
      }
    });

    return typeCount > 0 ? totalConsistency / typeCount : 50;
  }

  private isCuisineRelated(term: string): boolean {
    const cuisineTerms = [
      'italian', 'chinese', 'mexican', 'indian', 'thai', 'japanese',
      'american', 'french', 'greek', 'korean', 'vietnamese', 'mediterranean',
    ];
    return cuisineTerms.includes(term.toLowerCase());
  }

  private isDietaryRelated(term: string): boolean {
    const dietaryTerms = [
      'vegan', 'vegetarian', 'gluten-free', 'keto', 'paleo', 'dairy-free',
      'halal', 'kosher', 'organic', 'healthy', 'low-carb', 'sugar-free',
    ];
    return dietaryTerms.includes(term.toLowerCase());
  }
}