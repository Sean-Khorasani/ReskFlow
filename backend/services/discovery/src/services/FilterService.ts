import { prisma, logger, redis } from '@reskflow/shared';
import { MerchantStatus, MerchantType } from '@prisma/client';
import * as geolib from 'geolib';

interface FilterOptions {
  cuisineTypes: string[];
  dietaryOptions: string[];
  priceRanges: { label: string; min: number; max: number }[];
  ratings: number[];
  reskflowTimes: { label: string; max: number }[];
  features: string[];
  merchantTypes: MerchantType[];
}

interface CategoryWithCount {
  name: string;
  type: string;
  count: number;
  icon?: string;
}

export class FilterService {
  async getAvailableFilters(): Promise<FilterOptions> {
    try {
      // Check cache first
      const cacheKey = 'filters:available';
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get all active merchants to extract filter options
      const merchants = await prisma.merchant.findMany({
        where: { status: MerchantStatus.ACTIVE },
        select: {
          cuisineTypes: true,
          dietaryOptions: true,
          minOrderAmount: true,
          rating: true,
          preparationTime: true,
          type: true,
          acceptsScheduledOrders: true,
          acceptsCashPayment: true,
          providesUtensils: true,
          reskflowFee: true,
        },
      });

      // Extract unique values
      const cuisineTypes = new Set<string>();
      const dietaryOptions = new Set<string>();
      const merchantTypes = new Set<MerchantType>();

      merchants.forEach(merchant => {
        merchant.cuisineTypes?.forEach(c => cuisineTypes.add(c));
        merchant.dietaryOptions?.forEach(d => dietaryOptions.add(d));
        merchantTypes.add(merchant.type);
      });

      const filters: FilterOptions = {
        cuisineTypes: Array.from(cuisineTypes).sort(),
        dietaryOptions: Array.from(dietaryOptions).sort(),
        priceRanges: [
          { label: 'Under $10', min: 0, max: 10 },
          { label: '$10-$20', min: 10, max: 20 },
          { label: '$20-$30', min: 20, max: 30 },
          { label: 'Over $30', min: 30, max: 999 },
        ],
        ratings: [4.5, 4.0, 3.5, 3.0],
        reskflowTimes: [
          { label: 'Under 30 min', max: 30 },
          { label: '30-45 min', max: 45 },
          { label: '45-60 min', max: 60 },
        ],
        features: [
          'Free Delivery',
          'Accepts Cash',
          'Scheduled Orders',
          'New',
          'Promotions',
        ],
        merchantTypes: Array.from(merchantTypes),
      };

      // Cache for 1 hour
      await redis.set(cacheKey, JSON.stringify(filters), 'EX', 3600);

      return filters;
    } catch (error) {
      logger.error('Failed to get available filters', error);
      throw error;
    }
  }

  async getCategories(
    latitude?: number,
    longitude?: number
  ): Promise<CategoryWithCount[]> {
    try {
      // Predefined categories with icons
      const categoryDefinitions = [
        { name: 'Pizza', type: 'cuisine', icon: '🍕' },
        { name: 'Burgers', type: 'cuisine', icon: '🍔' },
        { name: 'Chinese', type: 'cuisine', icon: '🥡' },
        { name: 'Indian', type: 'cuisine', icon: '🍛' },
        { name: 'Mexican', type: 'cuisine', icon: '🌮' },
        { name: 'Italian', type: 'cuisine', icon: '🍝' },
        { name: 'Japanese', type: 'cuisine', icon: '🍱' },
        { name: 'Thai', type: 'cuisine', icon: '🍜' },
        { name: 'Mediterranean', type: 'cuisine', icon: '🥙' },
        { name: 'American', type: 'cuisine', icon: '🍗' },
        { name: 'Vegetarian', type: 'dietary', icon: '🥗' },
        { name: 'Vegan', type: 'dietary', icon: '🌱' },
        { name: 'Gluten-Free', type: 'dietary', icon: '🌾' },
        { name: 'Halal', type: 'dietary', icon: '✅' },
        { name: 'Grocery', type: 'merchant', icon: '🛒' },
        { name: 'Pharmacy', type: 'merchant', icon: '💊' },
        { name: 'Convenience', type: 'merchant', icon: '🏪' },
        { name: 'Liquor', type: 'merchant', icon: '🍺' },
      ];

      // Get merchant counts
      const merchants = await prisma.merchant.findMany({
        where: { status: MerchantStatus.ACTIVE },
        include: { locations: true },
      });

      // Filter by location if provided
      let filteredMerchants = merchants;
      if (latitude && longitude) {
        filteredMerchants = merchants.filter(merchant => {
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

      // Count categories
      const categories: CategoryWithCount[] = categoryDefinitions.map(cat => {
        let count = 0;

        if (cat.type === 'cuisine') {
          count = filteredMerchants.filter(m => 
            m.cuisineTypes?.includes(cat.name)
          ).length;
        } else if (cat.type === 'dietary') {
          count = filteredMerchants.filter(m => 
            m.dietaryOptions?.includes(cat.name)
          ).length;
        } else if (cat.type === 'merchant') {
          count = filteredMerchants.filter(m => 
            m.type === cat.name.toUpperCase()
          ).length;
        }

        return {
          name: cat.name,
          type: cat.type,
          count,
          icon: cat.icon,
        };
      });

      // Sort by count and filter out empty categories
      return categories
        .filter(cat => cat.count > 0)
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error('Failed to get categories', error);
      return [];
    }
  }

  async searchByDietaryPreferences(
    preferences: string[],
    location: { latitude: number; longitude: number },
    radius: number,
    limit: number
  ): Promise<any[]> {
    try {
      // Get merchants with all specified dietary options
      const merchants = await prisma.merchant.findMany({
        where: {
          status: MerchantStatus.ACTIVE,
          dietaryOptions: {
            hasEvery: preferences,
          },
        },
        include: {
          locations: true,
          menuItems: {
            where: {
              status: 'AVAILABLE',
              OR: preferences.map(pref => {
                const field = this.getDietaryField(pref);
                return field ? { [field]: true } : {};
              }).filter(f => Object.keys(f).length > 0),
            },
            take: 10,
          },
          _count: {
            select: {
              menuItems: {
                where: {
                  status: 'AVAILABLE',
                  OR: preferences.map(pref => {
                    const field = this.getDietaryField(pref);
                    return field ? { [field]: true } : {};
                  }).filter(f => Object.keys(f).length > 0),
                },
              },
            },
          },
        },
      });

      // Filter by location
      const nearbyMerchants = merchants.filter(merchant => {
        const primaryLocation = merchant.locations[0];
        if (!primaryLocation) return false;

        const distance = geolib.getDistance(
          location,
          {
            latitude: primaryLocation.latitude,
            longitude: primaryLocation.longitude,
          }
        ) / 1000;

        return distance <= radius && distance <= merchant.reskflowRadius;
      });

      // Sort by number of matching menu items
      return nearbyMerchants
        .sort((a, b) => b._count.menuItems - a._count.menuItems)
        .slice(0, limit)
        .map(merchant => ({
          ...merchant,
          matchingItemsCount: merchant._count.menuItems,
          dietaryMatch: preferences,
        }));
    } catch (error) {
      logger.error('Failed to search by dietary preferences', error);
      return [];
    }
  }

  async applyFilters(
    merchants: any[],
    filters: {
      priceRange?: { min: number; max: number };
      rating?: number;
      reskflowTime?: number;
      freeDelivery?: boolean;
      hasPromo?: boolean;
      isNew?: boolean;
      acceptsCash?: boolean;
      scheduledOrders?: boolean;
    }
  ): Promise<any[]> {
    let filtered = [...merchants];

    if (filters.priceRange) {
      filtered = filtered.filter(m => 
        m.minOrderAmount >= filters.priceRange!.min &&
        m.minOrderAmount <= filters.priceRange!.max
      );
    }

    if (filters.rating) {
      filtered = filtered.filter(m => m.rating >= filters.rating!);
    }

    if (filters.reskflowTime) {
      filtered = filtered.filter(m => m.preparationTime <= filters.reskflowTime!);
    }

    if (filters.freeDelivery) {
      filtered = filtered.filter(m => m.reskflowFee === 0);
    }

    if (filters.hasPromo) {
      // Would need to include promotions in the query
      filtered = filtered.filter(m => m.promotions?.length > 0);
    }

    if (filters.isNew) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filtered = filtered.filter(m => new Date(m.createdAt) >= thirtyDaysAgo);
    }

    if (filters.acceptsCash) {
      filtered = filtered.filter(m => m.acceptsCashPayment === true);
    }

    if (filters.scheduledOrders) {
      filtered = filtered.filter(m => m.acceptsScheduledOrders === true);
    }

    return filtered;
  }

  async getFilterCounts(
    location: { latitude: number; longitude: number },
    radius: number
  ): Promise<Record<string, number>> {
    try {
      // Get all merchants in the area
      const merchants = await prisma.merchant.findMany({
        where: { status: MerchantStatus.ACTIVE },
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
      });

      // Filter by location
      const nearbyMerchants = merchants.filter(merchant => {
        const primaryLocation = merchant.locations[0];
        if (!primaryLocation) return false;

        const distance = geolib.getDistance(
          location,
          {
            latitude: primaryLocation.latitude,
            longitude: primaryLocation.longitude,
          }
        ) / 1000;

        return distance <= radius && distance <= merchant.reskflowRadius;
      });

      // Count various filters
      const counts: Record<string, number> = {
        total: nearbyMerchants.length,
        freeDelivery: nearbyMerchants.filter(m => m.reskflowFee === 0).length,
        highRated: nearbyMerchants.filter(m => m.rating >= 4.5).length,
        under30min: nearbyMerchants.filter(m => m.preparationTime <= 30).length,
        hasPromo: nearbyMerchants.filter(m => m.promotions.length > 0).length,
        acceptsCash: nearbyMerchants.filter(m => m.acceptsCashPayment).length,
        isNew: nearbyMerchants.filter(m => {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return new Date(m.createdAt) >= thirtyDaysAgo;
        }).length,
      };

      // Count by type
      Object.values(MerchantType).forEach(type => {
        counts[`type_${type.toLowerCase()}`] = nearbyMerchants.filter(
          m => m.type === type
        ).length;
      });

      return counts;
    } catch (error) {
      logger.error('Failed to get filter counts', error);
      return {};
    }
  }

  private getDietaryField(preference: string): string | null {
    const mapping: Record<string, string> = {
      'Vegetarian': 'isVegetarian',
      'Vegan': 'isVegan',
      'Gluten-Free': 'isGlutenFree',
    };

    return mapping[preference] || null;
  }

  async getQuickFilters(
    location?: { latitude: number; longitude: number }
  ): Promise<Array<{
    id: string;
    label: string;
    icon: string;
    filter: any;
  }>> {
    const quickFilters = [
      {
        id: 'top-rated',
        label: 'Top Rated',
        icon: '⭐',
        filter: { rating: 4.5 },
      },
      {
        id: 'fast-reskflow',
        label: 'Fast Delivery',
        icon: '⚡',
        filter: { reskflowTime: 30 },
      },
      {
        id: 'free-reskflow',
        label: 'Free Delivery',
        icon: '🆓',
        filter: { freeDelivery: true },
      },
      {
        id: 'new',
        label: 'New',
        icon: '🆕',
        filter: { isNew: true },
      },
      {
        id: 'budget-friendly',
        label: 'Budget Friendly',
        icon: '💰',
        filter: { priceRange: { min: 0, max: 15 } },
      },
      {
        id: 'open-now',
        label: 'Open Now',
        icon: '🟢',
        filter: { isOpen: true },
      },
    ];

    // If location is provided, add counts
    if (location) {
      const counts = await this.getFilterCounts(location, 10);
      
      return quickFilters.map(qf => ({
        ...qf,
        count: this.getFilterCount(qf.filter, counts),
      }));
    }

    return quickFilters;
  }

  private getFilterCount(filter: any, counts: Record<string, number>): number {
    if (filter.rating === 4.5) return counts.highRated || 0;
    if (filter.reskflowTime === 30) return counts.under30min || 0;
    if (filter.freeDelivery) return counts.freeDelivery || 0;
    if (filter.isNew) return counts.isNew || 0;
    return 0;
  }
}