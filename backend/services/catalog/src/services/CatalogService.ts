import { prisma, logger, redis } from '@reskflow/shared';
import { MenuItem, MenuItemStatus, MerchantStatus } from '@prisma/client';
import * as geolib from 'geolib';

interface CatalogItem extends MenuItem {
  category?: any;
  modifierGroups?: any[];
  availability?: {
    isAvailable: boolean;
    reason?: string;
    nextAvailableTime?: Date;
  };
  pricing?: {
    originalPrice: number;
    currentPrice: number;
    discount?: number;
    surge?: number;
  };
}

interface MerchantCatalog {
  merchant: any;
  menus: any[];
  categories: any[];
  items: CatalogItem[];
  totalItems: number;
  availableItems: number;
}

export class CatalogService {
  async getMerchantCatalog(
    merchantId: string,
    includeOutOfStock: boolean = false
  ): Promise<MerchantCatalog> {
    try {
      // Check cache first
      const cacheKey = `catalog:${merchantId}:${includeOutOfStock}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: {
          locations: { where: { isActive: true } },
          operatingHours: true,
          menus: {
            where: { isActive: true },
            include: {
              categories: {
                where: { isActive: true },
                include: {
                  items: {
                    where: includeOutOfStock
                      ? {}
                      : { status: MenuItemStatus.AVAILABLE },
                    include: {
                      modifierGroups: {
                        include: { modifiers: true },
                      },
                    },
                  },
                },
                orderBy: { sortOrder: 'asc' },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      if (!merchant || merchant.status !== MerchantStatus.ACTIVE) {
        throw new Error('Merchant not found or inactive');
      }

      // Flatten catalog structure
      const categories: any[] = [];
      const items: CatalogItem[] = [];

      merchant.menus.forEach(menu => {
        menu.categories.forEach(category => {
          categories.push({
            ...category,
            menuId: menu.id,
            menuName: menu.name,
          });

          category.items.forEach(item => {
            items.push({
              ...item,
              category: {
                id: category.id,
                name: category.name,
              },
              availability: this.checkItemAvailability(item),
            });
          });
        });
      });

      const catalog: MerchantCatalog = {
        merchant: {
          ...merchant,
          isCurrentlyOpen: this.checkIfOpen(merchant),
        },
        menus: merchant.menus,
        categories,
        items,
        totalItems: items.length,
        availableItems: items.filter(item => item.availability?.isAvailable).length,
      };

      // Cache for 5 minutes
      await redis.set(cacheKey, JSON.stringify(catalog), 'EX', 300);

      return catalog;
    } catch (error) {
      logger.error('Failed to get merchant catalog', error);
      throw error;
    }
  }

  async getCategories(merchantId: string): Promise<any[]> {
    try {
      const categories = await prisma.menuCategory.findMany({
        where: {
          menu: {
            merchantId,
            isActive: true,
          },
          isActive: true,
        },
        include: {
          _count: {
            select: {
              items: {
                where: { status: MenuItemStatus.AVAILABLE },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });

      return categories.map(cat => ({
        ...cat,
        itemCount: cat._count.items,
      }));
    } catch (error) {
      logger.error('Failed to get categories', error);
      throw error;
    }
  }

  async getItemDetails(
    itemId: string,
    latitude?: number,
    longitude?: number
  ): Promise<CatalogItem | null> {
    try {
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
        include: {
          merchant: {
            include: {
              locations: true,
              operatingHours: true,
            },
          },
          category: {
            include: { menu: true },
          },
          modifierGroups: {
            include: { modifiers: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      if (!item) {
        return null;
      }

      // Check availability
      const availability = this.checkItemAvailability(item);

      // Calculate reskflow info if location provided
      let reskflowInfo;
      if (latitude && longitude && item.merchant.locations[0]) {
        const distance = geolib.getDistance(
          { latitude, longitude },
          {
            latitude: item.merchant.locations[0].latitude,
            longitude: item.merchant.locations[0].longitude,
          }
        ) / 1000;

        reskflowInfo = {
          distance,
          estimatedTime: Math.round(15 + distance * 3),
          isInDeliveryZone: distance <= item.merchant.reskflowRadius,
        };
      }

      // Get related items
      const relatedItems = await this.getRelatedItems(item);

      return {
        ...item,
        availability,
        reskflowInfo,
        relatedItems,
      };
    } catch (error) {
      logger.error('Failed to get item details', error);
      throw error;
    }
  }

  async searchCatalog(
    merchantId: string,
    query: string,
    filters?: {
      categoryId?: string;
      minPrice?: number;
      maxPrice?: number;
      dietary?: string[];
    }
  ): Promise<CatalogItem[]> {
    try {
      const where: any = {
        merchantId,
        status: MenuItemStatus.AVAILABLE,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      };

      if (filters?.categoryId) {
        where.categoryId = filters.categoryId;
      }

      if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
        where.price = {};
        if (filters.minPrice !== undefined) {
          where.price.gte = filters.minPrice;
        }
        if (filters.maxPrice !== undefined) {
          where.price.lte = filters.maxPrice;
        }
      }

      if (filters?.dietary && filters.dietary.length > 0) {
        where.AND = filters.dietary.map(diet => {
          switch (diet) {
            case 'vegetarian':
              return { isVegetarian: true };
            case 'vegan':
              return { isVegan: true };
            case 'gluten-free':
              return { isGlutenFree: true };
            default:
              return {};
          }
        }).filter(condition => Object.keys(condition).length > 0);
      }

      const items = await prisma.menuItem.findMany({
        where,
        include: {
          category: true,
          modifierGroups: {
            include: { modifiers: true },
          },
        },
      });

      return items.map(item => ({
        ...item,
        availability: this.checkItemAvailability(item),
      }));
    } catch (error) {
      logger.error('Catalog search failed', error);
      throw error;
    }
  }

  async getPopularItems(merchantId: string, limit: number = 10): Promise<CatalogItem[]> {
    try {
      const items = await prisma.menuItem.findMany({
        where: {
          merchantId,
          status: MenuItemStatus.AVAILABLE,
          isPopular: true,
        },
        include: {
          category: true,
          modifierGroups: {
            include: { modifiers: true },
          },
        },
        orderBy: { totalOrdered: 'desc' },
        take: limit,
      });

      return items.map(item => ({
        ...item,
        availability: this.checkItemAvailability(item),
      }));
    } catch (error) {
      logger.error('Failed to get popular items', error);
      throw error;
    }
  }

  async getNewItems(merchantId: string, days: number = 30): Promise<CatalogItem[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const items = await prisma.menuItem.findMany({
        where: {
          merchantId,
          status: MenuItemStatus.AVAILABLE,
          createdAt: { gte: cutoffDate },
        },
        include: {
          category: true,
          modifierGroups: {
            include: { modifiers: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return items.map(item => ({
        ...item,
        availability: this.checkItemAvailability(item),
        isNew: true,
      }));
    } catch (error) {
      logger.error('Failed to get new items', error);
      throw error;
    }
  }

  async validateModifiers(
    itemId: string,
    selectedModifiers: Array<{ groupId: string; modifierIds: string[] }>
  ): Promise<{ valid: boolean; errors: string[] }> {
    try {
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
        include: {
          modifierGroups: {
            include: { modifiers: true },
          },
        },
      });

      if (!item) {
        return { valid: false, errors: ['Item not found'] };
      }

      const errors: string[] = [];

      // Validate each modifier group
      for (const group of item.modifierGroups) {
        const selection = selectedModifiers.find(s => s.groupId === group.id);

        if (group.isRequired && !selection) {
          errors.push(`${group.name} is required`);
          continue;
        }

        if (selection) {
          if (selection.modifierIds.length < group.minSelections) {
            errors.push(`${group.name} requires at least ${group.minSelections} selections`);
          }

          if (selection.modifierIds.length > group.maxSelections) {
            errors.push(`${group.name} allows maximum ${group.maxSelections} selections`);
          }

          // Validate modifier IDs
          const validIds = group.modifiers.map(m => m.id);
          const invalidIds = selection.modifierIds.filter(id => !validIds.includes(id));
          if (invalidIds.length > 0) {
            errors.push(`Invalid modifiers selected for ${group.name}`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logger.error('Failed to validate modifiers', error);
      throw error;
    }
  }

  private checkItemAvailability(item: any): {
    isAvailable: boolean;
    reason?: string;
    nextAvailableTime?: Date;
  } {
    // Check stock if tracking inventory
    if (item.trackInventory && item.quantity <= 0) {
      return {
        isAvailable: false,
        reason: 'Out of stock',
      };
    }

    // Check item status
    if (item.status !== MenuItemStatus.AVAILABLE) {
      return {
        isAvailable: false,
        reason: this.getStatusReason(item.status),
      };
    }

    return { isAvailable: true };
  }

  private getStatusReason(status: MenuItemStatus): string {
    switch (status) {
      case MenuItemStatus.OUT_OF_STOCK:
        return 'Out of stock';
      case MenuItemStatus.HIDDEN:
        return 'Currently unavailable';
      case MenuItemStatus.COMING_SOON:
        return 'Coming soon';
      default:
        return 'Unavailable';
    }
  }

  private checkIfOpen(merchant: any): boolean {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const todayHours = merchant.operatingHours.find(
      (h: any) => h.dayOfWeek === dayOfWeek
    );

    if (!todayHours || !todayHours.isOpen) {
      return false;
    }

    return currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime;
  }

  private async getRelatedItems(item: any): Promise<any[]> {
    // Get items from the same category
    const relatedItems = await prisma.menuItem.findMany({
      where: {
        categoryId: item.categoryId,
        id: { not: item.id },
        status: MenuItemStatus.AVAILABLE,
      },
      take: 5,
      orderBy: { totalOrdered: 'desc' },
    });

    return relatedItems;
  }
}