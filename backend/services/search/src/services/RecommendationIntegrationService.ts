import { prisma, logger } from '@reskflow/shared';
import axios from 'axios';

interface RecommendationRequest {
  userId: string;
  location: { latitude: number; longitude: number };
  context: {
    time: Date;
    weather?: string;
    occasion?: string;
  };
  excludeIds?: string[];
  limit?: number;
}

interface Recommendation {
  id: string;
  type: 'merchant' | 'item' | 'cuisine';
  score: number;
  reason: string;
  metadata?: any;
}

interface CrossSellSuggestion {
  itemId: string;
  name: string;
  price: number;
  reason: string;
  complementScore: number;
}

export class RecommendationIntegrationService {
  private recommendationServiceUrl: string;

  constructor() {
    this.recommendationServiceUrl = process.env.RECOMMENDATION_SERVICE_URL || 'http://recommendation-service:3013';
  }

  async getPersonalizedRecommendations(
    request: RecommendationRequest
  ): Promise<Recommendation[]> {
    try {
      // Call the recommendation service
      const response = await axios.post(
        `${this.recommendationServiceUrl}/api/recommendations/personalized`,
        {
          userId: request.userId,
          location: request.location,
          context: request.context,
          excludeIds: request.excludeIds,
          limit: request.limit || 20,
        }
      );

      return response.data.recommendations;
    } catch (error) {
      logger.error('Error getting personalized recommendations:', error);
      // Fallback to local recommendations
      return this.getFallbackRecommendations(request);
    }
  }

  async enhanceSearchResults(params: {
    userId: string;
    searchResults: any[];
    query?: string;
    location: { latitude: number; longitude: number };
  }): Promise<any[]> {
    try {
      // Get user's recommendation profile
      const profile = await this.getUserRecommendationProfile(params.userId);
      
      // Score each result based on recommendation factors
      const enhancedResults = await Promise.all(
        params.searchResults.map(async (result) => {
          const recommendationScore = await this.calculateRecommendationScore(
            result,
            profile,
            params.query
          );

          return {
            ...result,
            recommendationScore,
            personalizedScore: result.matchScore * 0.7 + recommendationScore * 0.3,
            recommendationReasons: this.getRecommendationReasons(result, profile),
          };
        })
      );

      // Re-sort by personalized score
      return enhancedResults.sort((a, b) => b.personalizedScore - a.personalizedScore);
    } catch (error) {
      logger.error('Error enhancing search results:', error);
      return params.searchResults;
    }
  }

  async getCrossSellSuggestions(params: {
    itemId: string;
    userId: string;
    cartItems?: string[];
  }): Promise<CrossSellSuggestion[]> {
    try {
      // Get frequently bought together items
      const frequentPairs = await this.getFrequentlyBoughtTogether(params.itemId);
      
      // Get complementary items
      const complementaryItems = await this.getComplementaryItems(params.itemId);
      
      // Filter out items already in cart
      const suggestions = [...frequentPairs, ...complementaryItems]
        .filter(item => !params.cartItems?.includes(item.id))
        .map(item => ({
          itemId: item.id,
          name: item.name,
          price: item.price,
          reason: item.reason,
          complementScore: item.score,
        }));

      // Sort by complement score
      return suggestions.sort((a, b) => b.complementScore - a.complementScore).slice(0, 5);
    } catch (error) {
      logger.error('Error getting cross-sell suggestions:', error);
      return [];
    }
  }

  async getSimilarItemRecommendations(
    itemId: string,
    limit: number = 10
  ): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.recommendationServiceUrl}/api/recommendations/similar-items/${itemId}`,
        { params: { limit } }
      );

      return response.data.similarItems;
    } catch (error) {
      logger.error('Error getting similar items:', error);
      // Fallback to local similarity calculation
      return this.calculateLocalSimilarItems(itemId, limit);
    }
  }

  async getSearchQueryExpansions(query: string): Promise<string[]> {
    try {
      // Use recommendation service to expand query
      const response = await axios.post(
        `${this.recommendationServiceUrl}/api/recommendations/query-expansion`,
        { query }
      );

      return response.data.expansions;
    } catch (error) {
      logger.error('Error getting query expansions:', error);
      // Simple local expansion
      return this.getLocalQueryExpansions(query);
    }
  }

  async trackSearchInteraction(data: {
    userId: string;
    searchId: string;
    query?: string;
    clickedResults: string[];
    dwellTime: number;
  }): Promise<void> {
    try {
      // Send interaction data to recommendation service
      await axios.post(
        `${this.recommendationServiceUrl}/api/recommendations/track-interaction`,
        {
          type: 'search',
          userId: data.userId,
          sessionId: data.searchId,
          query: data.query,
          interactions: data.clickedResults.map(resultId => ({
            itemId: resultId,
            action: 'click',
            dwellTime: data.dwellTime,
          })),
          timestamp: new Date(),
        }
      );
    } catch (error) {
      logger.error('Error tracking search interaction:', error);
    }
  }

  private async getFallbackRecommendations(
    request: RecommendationRequest
  ): Promise<Recommendation[]> {
    // Simple fallback logic using local data
    const popularItems = await prisma.item.findMany({
      where: {
        is_available: true,
        merchant: {
          is_active: true,
          // Location-based filtering would go here
        },
      },
      orderBy: {
        order_count: 'desc',
      },
      take: request.limit || 20,
    });

    return popularItems.map((item, index) => ({
      id: item.id,
      type: 'item' as const,
      score: 1 - (index * 0.05), // Decreasing score by position
      reason: 'Popular in your area',
      metadata: {
        orderCount: item.order_count,
        rating: item.rating,
      },
    }));
  }

  private async getUserRecommendationProfile(userId: string): Promise<any> {
    // Get user's order history
    const recentOrders = await prisma.order.findMany({
      where: { customer_id: userId },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    // Analyze preferences
    const cuisineFrequency = new Map<string, number>();
    const priceRanges: number[] = [];
    const categoryFrequency = new Map<string, number>();

    recentOrders.forEach(order => {
      order.orderItems.forEach(orderItem => {
        if (orderItem.item.cuisine) {
          cuisineFrequency.set(
            orderItem.item.cuisine,
            (cuisineFrequency.get(orderItem.item.cuisine) || 0) + 1
          );
        }
        if (orderItem.item.category) {
          categoryFrequency.set(
            orderItem.item.category,
            (categoryFrequency.get(orderItem.item.category) || 0) + 1
          );
        }
        priceRanges.push(orderItem.item.price);
      });
    });

    const avgPrice = priceRanges.length > 0
      ? priceRanges.reduce((a, b) => a + b, 0) / priceRanges.length
      : 25;

    return {
      favoriteCuisines: Array.from(cuisineFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cuisine]) => cuisine),
      favoriteCategories: Array.from(categoryFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category]) => category),
      averagePrice: avgPrice,
      priceRange: {
        min: Math.min(...priceRanges, avgPrice * 0.5),
        max: Math.max(...priceRanges, avgPrice * 1.5),
      },
      orderCount: recentOrders.length,
    };
  }

  private async calculateRecommendationScore(
    item: any,
    profile: any,
    query?: string
  ): Promise<number> {
    let score = 0.5; // Base score

    // Cuisine match
    if (profile.favoriteCuisines.includes(item.cuisine)) {
      score += 0.2;
    }

    // Category match
    if (profile.favoriteCategories.includes(item.category)) {
      score += 0.15;
    }

    // Price range match
    if (item.price >= profile.priceRange.min && item.price <= profile.priceRange.max) {
      score += 0.1;
    }

    // Rating boost
    if (item.rating >= 4.5) {
      score += 0.1;
    }

    // Query relevance (if provided)
    if (query && item.name.toLowerCase().includes(query.toLowerCase())) {
      score += 0.15;
    }

    // Popularity boost
    if (item.orderCount > 100) {
      score += 0.05;
    }

    return Math.min(score, 1.0);
  }

  private getRecommendationReasons(item: any, profile: any): string[] {
    const reasons: string[] = [];

    if (profile.favoriteCuisines.includes(item.cuisine)) {
      reasons.push(`You often order ${item.cuisine} food`);
    }

    if (item.rating >= 4.5) {
      reasons.push('Highly rated');
    }

    if (item.orderCount > 100) {
      reasons.push('Popular choice');
    }

    if (item.preparationTime <= 20) {
      reasons.push('Quick preparation');
    }

    return reasons;
  }

  private async getFrequentlyBoughtTogether(itemId: string): Promise<any[]> {
    // Find orders that included this item
    const orders = await prisma.order.findMany({
      where: {
        orderItems: {
          some: { item_id: itemId },
        },
      },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
      take: 100,
    });

    // Count co-occurrences
    const coOccurrences = new Map<string, { item: any; count: number }>();

    orders.forEach(order => {
      const otherItems = order.orderItems.filter(oi => oi.item_id !== itemId);
      otherItems.forEach(orderItem => {
        const existing = coOccurrences.get(orderItem.item_id);
        if (existing) {
          existing.count++;
        } else {
          coOccurrences.set(orderItem.item_id, {
            item: orderItem.item,
            count: 1,
          });
        }
      });
    });

    // Convert to array and sort by frequency
    return Array.from(coOccurrences.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(({ item, count }) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        reason: 'Frequently bought together',
        score: count / orders.length,
      }));
  }

  private async getComplementaryItems(itemId: string): Promise<any[]> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
    });

    if (!item) return [];

    // Define complementary categories
    const complementaryMap: Record<string, string[]> = {
      'burger': ['fries', 'drinks', 'desserts'],
      'pizza': ['drinks', 'sides', 'desserts'],
      'sushi': ['miso soup', 'edamame', 'drinks'],
      'sandwich': ['chips', 'drinks', 'cookies'],
      'salad': ['soup', 'drinks', 'bread'],
    };

    const complementaryCategories = complementaryMap[item.category?.toLowerCase()] || [];

    if (complementaryCategories.length === 0) return [];

    // Find items in complementary categories
    const complementaryItems = await prisma.item.findMany({
      where: {
        merchant_id: item.merchant_id,
        category: { in: complementaryCategories },
        is_available: true,
      },
      orderBy: { order_count: 'desc' },
      take: 10,
    });

    return complementaryItems.map(ci => ({
      id: ci.id,
      name: ci.name,
      price: ci.price,
      reason: `Goes well with ${item.name}`,
      score: 0.8,
    }));
  }

  private async calculateLocalSimilarItems(
    itemId: string,
    limit: number
  ): Promise<any[]> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: { dietary_info: true },
    });

    if (!item) return [];

    // Find similar items based on category, price range, and dietary info
    const similarItems = await prisma.item.findMany({
      where: {
        id: { not: itemId },
        category: item.category,
        price: {
          gte: item.price * 0.7,
          lte: item.price * 1.3,
        },
        is_available: true,
      },
      include: { dietary_info: true },
      orderBy: { rating: 'desc' },
      take: limit * 2, // Get extra to filter
    });

    // Score similarity
    const scoredItems = similarItems.map(si => {
      let similarityScore = 0.5; // Base score

      // Same merchant boost
      if (si.merchant_id === item.merchant_id) {
        similarityScore += 0.2;
      }

      // Price similarity
      const priceDiff = Math.abs(si.price - item.price) / item.price;
      similarityScore += (1 - priceDiff) * 0.2;

      // Dietary match
      if (item.dietary_info && si.dietary_info) {
        const sharedTags = item.dietary_info.tags.filter(tag =>
          si.dietary_info!.tags.includes(tag)
        );
        similarityScore += (sharedTags.length / item.dietary_info.tags.length) * 0.1;
      }

      return {
        ...si,
        similarityScore,
      };
    });

    // Sort by similarity and return top results
    return scoredItems
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, limit);
  }

  private getLocalQueryExpansions(query: string): string[] {
    const expansions: string[] = [];
    const queryLower = query.toLowerCase();

    // Category expansions
    const categoryMap: Record<string, string[]> = {
      'burger': ['hamburger', 'cheeseburger', 'beef burger'],
      'pizza': ['pizzas', 'italian pizza', 'pizza pie'],
      'chinese': ['chinese food', 'asian', 'chinese cuisine'],
      'coffee': ['cafe', 'espresso', 'latte'],
    };

    for (const [key, values] of Object.entries(categoryMap)) {
      if (queryLower.includes(key)) {
        expansions.push(...values);
      }
    }

    // Add plural/singular variations
    if (queryLower.endsWith('s')) {
      expansions.push(queryLower.slice(0, -1));
    } else {
      expansions.push(queryLower + 's');
    }

    return [...new Set(expansions)].filter(e => e !== query);
  }
}