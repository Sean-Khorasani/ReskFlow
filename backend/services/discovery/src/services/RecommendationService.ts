import { prisma, logger, redis } from '@reskflow/shared';
import { MerchantStatus, OrderStatus } from '@prisma/client';
import * as geolib from 'geolib';
import { GeolocationService } from './GeolocationService';

interface Recommendation {
  merchant: any;
  score: number;
  reason: string;
  distance?: number;
  reskflowTime?: number;
}

export class RecommendationService {
  private geolocationService: GeolocationService;

  constructor() {
    this.geolocationService = new GeolocationService();
  }

  async getPersonalizedRecommendations(
    userId: string,
    latitude?: number,
    longitude?: number,
    limit: number = 10
  ): Promise<Recommendation[]> {
    try {
      // Get user's order history
      const userOrders = await prisma.order.findMany({
        where: {
          customerId: userId,
          status: OrderStatus.DELIVERED,
        },
        include: {
          merchant: true,
          items: {
            include: { menuItem: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Extract user preferences
      const preferences = this.extractUserPreferences(userOrders);

      // Get candidate merchants
      const candidates = await this.getCandidateMerchants(latitude, longitude);

      // Score and rank merchants
      const recommendations = candidates
        .map(merchant => this.scoreMerchant(merchant, preferences, userOrders))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // Add location-based info if available
      if (latitude && longitude) {
        recommendations.forEach(rec => {
          const primaryLocation = rec.merchant.locations[0];
          if (primaryLocation) {
            rec.distance = geolib.getDistance(
              { latitude, longitude },
              {
                latitude: primaryLocation.latitude,
                longitude: primaryLocation.longitude,
              }
            ) / 1000;
            rec.reskflowTime = Math.round(15 + rec.distance * 3);
          }
        });
      }

      return recommendations;
    } catch (error) {
      logger.error('Failed to get personalized recommendations', error);
      return [];
    }
  }

  async getPopularMerchants(
    latitude?: number,
    longitude?: number,
    timeRange: string = 'week',
    limit: number = 20
  ): Promise<any[]> {
    try {
      // Calculate date range
      const daysAgo = timeRange === 'day' ? 1 : timeRange === 'week' ? 7 : 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      // Get popular merchants based on order volume
      const popularMerchants = await prisma.merchant.findMany({
        where: {
          status: MerchantStatus.ACTIVE,
          orders: {
            some: {
              createdAt: { gte: startDate },
              status: OrderStatus.DELIVERED,
            },
          },
        },
        include: {
          locations: true,
          _count: {
            select: {
              orders: {
                where: {
                  createdAt: { gte: startDate },
                  status: OrderStatus.DELIVERED,
                },
              },
            },
          },
        },
        orderBy: {
          orders: {
            _count: 'desc',
          },
        },
        take: limit * 2, // Get extra to filter by location
      });

      // Filter by location if provided
      let results = popularMerchants;
      if (latitude && longitude) {
        results = popularMerchants.filter(merchant => {
          const primaryLocation = merchant.locations[0];
          if (!primaryLocation) return false;

          const distance = geolib.getDistance(
            { latitude, longitude },
            {
              latitude: primaryLocation.latitude,
              longitude: primaryLocation.longitude,
            }
          ) / 1000;

          return distance <= merchant.reskflowRadius;
        });
      }

      return results.slice(0, limit).map(merchant => ({
        ...merchant,
        orderCount: merchant._count.orders,
        trending: merchant._count.orders > 10, // Simple trending indicator
      }));
    } catch (error) {
      logger.error('Failed to get popular merchants', error);
      return [];
    }
  }

  async getNewMerchants(
    latitude?: number,
    longitude?: number,
    days: number = 30,
    limit: number = 20
  ): Promise<any[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const newMerchants = await prisma.merchant.findMany({
        where: {
          status: MerchantStatus.ACTIVE,
          createdAt: { gte: cutoffDate },
        },
        include: {
          locations: true,
          promotions: {
            where: {
              isActive: true,
              validFrom: { lte: new Date() },
              validTo: { gte: new Date() },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 2,
      });

      // Filter by location if provided
      let results = newMerchants;
      if (latitude && longitude) {
        results = newMerchants.filter(merchant => {
          const primaryLocation = merchant.locations[0];
          if (!primaryLocation) return false;

          const distance = geolib.getDistance(
            { latitude, longitude },
            {
              latitude: primaryLocation.latitude,
              longitude: primaryLocation.longitude,
            }
          ) / 1000;

          return distance <= merchant.reskflowRadius;
        });
      }

      return results.slice(0, limit).map(merchant => ({
        ...merchant,
        isNew: true,
        daysOld: Math.floor((Date.now() - merchant.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        hasNewCustomerPromo: merchant.promotions.some(p => p.newUsersOnly),
      }));
    } catch (error) {
      logger.error('Failed to get new merchants', error);
      return [];
    }
  }

  async getSimilarMerchants(
    merchantId: string,
    limit: number = 10
  ): Promise<any[]> {
    try {
      const targetMerchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: { menuItems: true },
      });

      if (!targetMerchant) {
        return [];
      }

      // Find merchants with similar cuisine types
      const similarMerchants = await prisma.merchant.findMany({
        where: {
          id: { not: merchantId },
          status: MerchantStatus.ACTIVE,
          cuisineTypes: {
            hasSome: targetMerchant.cuisineTypes,
          },
        },
        include: {
          locations: true,
          _count: {
            select: { orders: true },
          },
        },
        orderBy: { rating: 'desc' },
        take: limit * 2,
      });

      // Calculate similarity scores
      const scored = similarMerchants.map(merchant => {
        const cuisineOverlap = merchant.cuisineTypes.filter(
          c => targetMerchant.cuisineTypes.includes(c)
        ).length;

        const priceRangeSimilarity = 
          1 - Math.abs(merchant.minOrderAmount - targetMerchant.minOrderAmount) / 50;

        const score = (cuisineOverlap * 0.5) + (priceRangeSimilarity * 0.3) + (merchant.rating / 5 * 0.2);

        return { merchant, score };
      });

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.merchant);
    } catch (error) {
      logger.error('Failed to get similar merchants', error);
      return [];
    }
  }

  async getRecommendedForTime(
    latitude: number,
    longitude: number,
    dateTime: Date = new Date()
  ): Promise<any[]> {
    try {
      const hour = dateTime.getHours();
      const dayOfWeek = dateTime.getDay();

      // Determine meal type based on time
      let mealType: string;
      if (hour >= 6 && hour < 11) {
        mealType = 'breakfast';
      } else if (hour >= 11 && hour < 15) {
        mealType = 'lunch';
      } else if (hour >= 15 && hour < 17) {
        mealType = 'snack';
      } else if (hour >= 17 && hour < 22) {
        mealType = 'dinner';
      } else {
        mealType = 'late-night';
      }

      // Get merchants suitable for the time
      const merchants = await prisma.merchant.findMany({
        where: {
          status: MerchantStatus.ACTIVE,
          operatingHours: {
            some: {
              dayOfWeek,
              isOpen: true,
            },
          },
        },
        include: {
          locations: true,
          operatingHours: {
            where: { dayOfWeek },
          },
          menuItems: {
            where: {
              status: 'AVAILABLE',
              OR: [
                { name: { contains: mealType, mode: 'insensitive' } },
                { description: { contains: mealType, mode: 'insensitive' } },
              ],
            },
            take: 5,
          },
        },
      });

      // Filter by operating hours and location
      const available = merchants.filter(merchant => {
        const hours = merchant.operatingHours[0];
        if (!hours || !hours.isOpen) return false;

        const currentTime = `${hour.toString().padStart(2, '0')}:00`;
        if (currentTime < hours.openTime || currentTime > hours.closeTime) {
          return false;
        }

        const primaryLocation = merchant.locations[0];
        if (!primaryLocation) return false;

        const distance = geolib.getDistance(
          { latitude, longitude },
          {
            latitude: primaryLocation.latitude,
            longitude: primaryLocation.longitude,
          }
        ) / 1000;

        return distance <= merchant.reskflowRadius;
      });

      // Sort by relevance (has meal-specific items)
      return available.sort((a, b) => b.menuItems.length - a.menuItems.length);
    } catch (error) {
      logger.error('Failed to get time-based recommendations', error);
      return [];
    }
  }

  private extractUserPreferences(orders: any[]): any {
    const cuisineCounts: Record<string, number> = {};
    const dietaryCounts: Record<string, number> = {};
    const pricePoints: number[] = [];
    const itemPreferences: Record<string, number> = {};

    orders.forEach(order => {
      // Count cuisine types
      order.merchant.cuisineTypes?.forEach((cuisine: string) => {
        cuisineCounts[cuisine] = (cuisineCounts[cuisine] || 0) + 1;
      });

      // Count dietary preferences
      order.merchant.dietaryOptions?.forEach((diet: string) => {
        dietaryCounts[diet] = (dietaryCounts[diet] || 0) + 1;
      });

      // Track price points
      pricePoints.push(order.total);

      // Track item preferences
      order.items.forEach((item: any) => {
        const key = `${item.menuItem.isVegetarian ? 'veg' : 'non-veg'}_${item.menuItem.isSpicy ? 'spicy' : 'mild'}`;
        itemPreferences[key] = (itemPreferences[key] || 0) + 1;
      });
    });

    const avgOrderValue = pricePoints.length > 0
      ? pricePoints.reduce((a, b) => a + b, 0) / pricePoints.length
      : 20;

    return {
      favoriteCuisines: Object.entries(cuisineCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cuisine]) => cuisine),
      dietaryPreferences: Object.keys(dietaryCounts),
      averageOrderValue: avgOrderValue,
      itemPreferences,
      orderCount: orders.length,
    };
  }

  private async getCandidateMerchants(
    latitude?: number,
    longitude?: number
  ): Promise<any[]> {
    const where: any = { status: MerchantStatus.ACTIVE };

    const merchants = await prisma.merchant.findMany({
      where,
      include: {
        locations: true,
        menuItems: {
          where: { status: 'AVAILABLE' },
          take: 10,
        },
        _count: {
          select: { orders: true },
        },
      },
      take: 100,
    });

    // Filter by location if provided
    if (latitude && longitude) {
      return merchants.filter(merchant => {
        const primaryLocation = merchant.locations[0];
        if (!primaryLocation) return false;

        const distance = geolib.getDistance(
          { latitude, longitude },
          {
            latitude: primaryLocation.latitude,
            longitude: primaryLocation.longitude,
          }
        ) / 1000;

        return distance <= merchant.reskflowRadius;
      });
    }

    return merchants;
  }

  private scoreMerchant(
    merchant: any,
    preferences: any,
    userOrders: any[]
  ): Recommendation {
    let score = 0;
    let reason = '';

    // Cuisine match (30% weight)
    const cuisineMatch = merchant.cuisineTypes.filter(
      (c: string) => preferences.favoriteCuisines.includes(c)
    ).length;
    score += (cuisineMatch / preferences.favoriteCuisines.length) * 0.3;

    if (cuisineMatch > 0) {
      reason = `Serves your favorite ${merchant.cuisineTypes[0]} cuisine`;
    }

    // Dietary compatibility (20% weight)
    const dietaryMatch = preferences.dietaryPreferences.every(
      (d: string) => merchant.dietaryOptions?.includes(d)
    );
    if (dietaryMatch) {
      score += 0.2;
    }

    // Price range match (20% weight)
    const priceDiff = Math.abs(merchant.minOrderAmount - preferences.averageOrderValue);
    const priceScore = Math.max(0, 1 - priceDiff / 50);
    score += priceScore * 0.2;

    // Rating (15% weight)
    score += (merchant.rating / 5) * 0.15;

    // Popularity (10% weight)
    const popularityScore = Math.min(merchant._count.orders / 1000, 1);
    score += popularityScore * 0.1;

    // New to user (5% weight)
    const hasOrderedBefore = userOrders.some(o => o.merchantId === merchant.id);
    if (!hasOrderedBefore && merchant.rating >= 4) {
      score += 0.05;
      if (!reason) {
        reason = 'Highly rated place you haven\'t tried';
      }
    }

    // Default reason
    if (!reason) {
      reason = merchant.rating >= 4.5 ? 'Highly rated' : 'Popular choice';
    }

    return {
      merchant,
      score,
      reason,
    };
  }
}