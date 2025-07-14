/**
 * Favorites & Reorder Service
 * Manages customer favorite restaurants, items, and quick reordering
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { orderService } from '../order/order.service';

const prisma = new PrismaClient();

interface FavoriteRestaurant {
  id: string;
  customerId: string;
  merchantId: string;
  addedAt: Date;
  lastOrderedAt?: Date;
  orderCount: number;
  notes?: string;
}

interface FavoriteItem {
  id: string;
  customerId: string;
  productId: string;
  merchantId: string;
  customizations?: any;
  nickname?: string;
  addedAt: Date;
  lastOrderedAt?: Date;
  orderCount: number;
}

interface SavedOrder {
  id: string;
  customerId: string;
  merchantId: string;
  name: string;
  items: Array<{
    productId: string;
    quantity: number;
    customizations?: any;
    specialInstructions?: string;
  }>;
  totalAmount: number;
  createdAt: Date;
  lastUsedAt?: Date;
  useCount: number;
}

interface ReorderSuggestion {
  type: 'recent' | 'frequent' | 'favorite';
  merchantId: string;
  merchantName: string;
  items: any[];
  lastOrderDate: Date;
  orderCount?: number;
  estimatedTotal: number;
  reason: string;
}

export class FavoritesService extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Add restaurant to favorites
   */
  async addFavoriteRestaurant(customerId: string, merchantId: string, notes?: string): Promise<FavoriteRestaurant> {
    try {
      // Check if already favorited
      const existing = await prisma.favoriteRestaurant.findUnique({
        where: {
          customerId_merchantId: {
            customerId,
            merchantId,
          },
        },
      });

      if (existing) {
        return existing;
      }

      // Add to favorites
      const favorite = await prisma.favoriteRestaurant.create({
        data: {
          customerId,
          merchantId,
          notes,
        },
      });

      // Get merchant details
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
      });

      // Emit event
      this.emit('restaurant:favorited', {
        customerId,
        merchantId,
        merchant,
      });

      logger.info(`Restaurant favorited: ${merchantId} by customer ${customerId}`);

      return favorite;

    } catch (error) {
      logger.error('Failed to add favorite restaurant', error);
      throw error;
    }
  }

  /**
   * Remove restaurant from favorites
   */
  async removeFavoriteRestaurant(customerId: string, merchantId: string): Promise<void> {
    try {
      await prisma.favoriteRestaurant.delete({
        where: {
          customerId_merchantId: {
            customerId,
            merchantId,
          },
        },
      });

      this.emit('restaurant:unfavorited', {
        customerId,
        merchantId,
      });

    } catch (error) {
      logger.error('Failed to remove favorite restaurant', error);
      throw error;
    }
  }

  /**
   * Add item to favorites
   */
  async addFavoriteItem(customerId: string, data: {
    productId: string;
    merchantId: string;
    customizations?: any;
    nickname?: string;
  }): Promise<FavoriteItem> {
    try {
      // Check if similar item already favorited
      const existing = await prisma.favoriteItem.findFirst({
        where: {
          customerId,
          productId: data.productId,
          customizations: data.customizations || {},
        },
      });

      if (existing) {
        // Update nickname if provided
        if (data.nickname && data.nickname !== existing.nickname) {
          return await prisma.favoriteItem.update({
            where: { id: existing.id },
            data: { nickname: data.nickname },
          });
        }
        return existing;
      }

      // Add to favorites
      const favorite = await prisma.favoriteItem.create({
        data: {
          customerId,
          ...data,
        },
      });

      // Get product details
      const product = await prisma.product.findUnique({
        where: { id: data.productId },
        include: { merchant: true },
      });

      // Emit event
      this.emit('item:favorited', {
        customerId,
        favorite,
        product,
      });

      return favorite;

    } catch (error) {
      logger.error('Failed to add favorite item', error);
      throw error;
    }
  }

  /**
   * Remove item from favorites
   */
  async removeFavoriteItem(customerId: string, favoriteItemId: string): Promise<void> {
    try {
      const item = await prisma.favoriteItem.findUnique({
        where: { id: favoriteItemId },
      });

      if (!item || item.customerId !== customerId) {
        throw new Error('Favorite item not found');
      }

      await prisma.favoriteItem.delete({
        where: { id: favoriteItemId },
      });

      this.emit('item:unfavorited', {
        customerId,
        favoriteItemId,
      });

    } catch (error) {
      logger.error('Failed to remove favorite item', error);
      throw error;
    }
  }

  /**
   * Save order for reordering
   */
  async saveOrder(customerId: string, orderId: string, name: string): Promise<SavedOrder> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!order || order.customerId !== customerId) {
        throw new Error('Order not found');
      }

      // Create saved order
      const savedOrder = await prisma.savedOrder.create({
        data: {
          customerId,
          merchantId: order.merchantId,
          name,
          items: order.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            customizations: item.customizations,
            specialInstructions: item.specialInstructions,
          })),
          totalAmount: order.total,
        },
      });

      // Auto-favorite items in the order
      for (const item of order.items) {
        await this.addFavoriteItem(customerId, {
          productId: item.productId,
          merchantId: order.merchantId,
          customizations: item.customizations,
        });
      }

      return savedOrder;

    } catch (error) {
      logger.error('Failed to save order', error);
      throw error;
    }
  }

  /**
   * Quick reorder
   */
  async reorder(customerId: string, orderId: string, updates?: {
    reskflowAddress?: string;
    reskflowInstructions?: string;
    paymentMethodId?: string;
  }): Promise<any> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          merchant: true,
        },
      });

      if (!order || order.customerId !== customerId) {
        throw new Error('Order not found');
      }

      // Check if merchant is open
      if (!order.merchant.isOpen) {
        throw new Error('Restaurant is currently closed');
      }

      // Check if all products are still available
      const unavailableItems = order.items.filter(item => !item.product.isAvailable);
      if (unavailableItems.length > 0) {
        throw new Error(`Some items are no longer available: ${unavailableItems.map(i => i.product.name).join(', ')}`);
      }

      // Create new order
      const newOrder = await orderService.createOrder({
        customerId,
        merchantId: order.merchantId,
        items: order.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          customizations: item.customizations,
          specialInstructions: item.specialInstructions,
        })),
        reskflowAddress: updates?.reskflowAddress || order.reskflowAddress,
        reskflowInstructions: updates?.reskflowInstructions || order.reskflowInstructions,
        paymentMethod: order.paymentMethod,
        paymentMethodId: updates?.paymentMethodId || order.paymentMethodId,
        isReorder: true,
        originalOrderId: orderId,
      });

      // Update stats
      await this.updateReorderStats(customerId, order.merchantId, order.items);

      // Emit event
      this.emit('order:reordered', {
        customerId,
        originalOrderId: orderId,
        newOrderId: newOrder.id,
        merchantId: order.merchantId,
      });

      return newOrder;

    } catch (error) {
      logger.error('Failed to reorder', error);
      throw error;
    }
  }

  /**
   * Reorder from saved order
   */
  async reorderFromSaved(customerId: string, savedOrderId: string, updates?: any): Promise<any> {
    try {
      const savedOrder = await prisma.savedOrder.findUnique({
        where: { id: savedOrderId },
        include: {
          merchant: true,
        },
      });

      if (!savedOrder || savedOrder.customerId !== customerId) {
        throw new Error('Saved order not found');
      }

      // Check merchant availability
      if (!savedOrder.merchant.isOpen) {
        throw new Error('Restaurant is currently closed');
      }

      // Validate products
      const productIds = savedOrder.items.map(item => item.productId);
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          isAvailable: true,
        },
      });

      if (products.length !== productIds.length) {
        throw new Error('Some items are no longer available');
      }

      // Get customer's default address and payment
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          addresses: {
            where: { isDefault: true },
            take: 1,
          },
          paymentMethods: {
            where: { isDefault: true },
            take: 1,
          },
        },
      });

      // Create order
      const newOrder = await orderService.createOrder({
        customerId,
        merchantId: savedOrder.merchantId,
        items: savedOrder.items,
        reskflowAddress: updates?.reskflowAddress || customer?.addresses[0]?.formatted || '',
        reskflowInstructions: updates?.reskflowInstructions,
        paymentMethod: customer?.paymentMethods[0]?.type || 'card',
        paymentMethodId: updates?.paymentMethodId || customer?.paymentMethods[0]?.id,
        isReorder: true,
        savedOrderId,
      });

      // Update saved order usage
      await prisma.savedOrder.update({
        where: { id: savedOrderId },
        data: {
          lastUsedAt: new Date(),
          useCount: {
            increment: 1,
          },
        },
      });

      return newOrder;

    } catch (error) {
      logger.error('Failed to reorder from saved', error);
      throw error;
    }
  }

  /**
   * Get customer's favorite restaurants
   */
  async getFavoriteRestaurants(customerId: string): Promise<any[]> {
    const favorites = await prisma.favoriteRestaurant.findMany({
      where: { customerId },
      include: {
        merchant: {
          include: {
            cuisine: true,
            ratings: {
              select: {
                rating: true,
              },
            },
          },
        },
      },
      orderBy: { lastOrderedAt: 'desc' },
    });

    // Calculate average ratings and format response
    return favorites.map(fav => ({
      ...fav,
      merchant: {
        ...fav.merchant,
        averageRating: fav.merchant.ratings.length > 0
          ? fav.merchant.ratings.reduce((sum, r) => sum + r.rating, 0) / fav.merchant.ratings.length
          : 0,
        isFavorite: true,
      },
    }));
  }

  /**
   * Get customer's favorite items
   */
  async getFavoriteItems(customerId: string, merchantId?: string): Promise<any[]> {
    const where: any = { customerId };
    if (merchantId) {
      where.merchantId = merchantId;
    }

    const favorites = await prisma.favoriteItem.findMany({
      where,
      include: {
        product: {
          include: {
            category: true,
            merchant: true,
          },
        },
      },
      orderBy: { lastOrderedAt: 'desc' },
    });

    return favorites.map(fav => ({
      ...fav,
      product: {
        ...fav.product,
        isFavorite: true,
        favoriteId: fav.id,
        nickname: fav.nickname,
      },
    }));
  }

  /**
   * Get saved orders
   */
  async getSavedOrders(customerId: string): Promise<SavedOrder[]> {
    const savedOrders = await prisma.savedOrder.findMany({
      where: { customerId },
      include: {
        merchant: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    return savedOrders;
  }

  /**
   * Get reorder suggestions
   */
  async getReorderSuggestions(customerId: string): Promise<ReorderSuggestion[]> {
    const suggestions: ReorderSuggestion[] = [];

    // Get recent orders
    const recentOrders = await prisma.order.findMany({
      where: {
        customerId,
        status: 'delivered',
      },
      include: {
        merchant: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Get order frequency by merchant
    const merchantOrderCounts = await prisma.order.groupBy({
      by: ['merchantId'],
      where: {
        customerId,
        status: 'delivered',
      },
      _count: true,
      orderBy: {
        _count: {
          merchantId: 'desc',
        },
      },
      take: 5,
    });

    // Add recent order suggestions
    if (recentOrders.length > 0) {
      const recentOrder = recentOrders[0];
      suggestions.push({
        type: 'recent',
        merchantId: recentOrder.merchantId,
        merchantName: recentOrder.merchant.name,
        items: recentOrder.items,
        lastOrderDate: recentOrder.createdAt,
        estimatedTotal: recentOrder.total,
        reason: 'You ordered from here recently',
      });
    }

    // Add frequent order suggestions
    for (const freq of merchantOrderCounts) {
      if (freq._count > 3) {
        const merchant = await prisma.merchant.findUnique({
          where: { id: freq.merchantId },
        });

        const lastOrder = recentOrders.find(o => o.merchantId === freq.merchantId);
        
        if (merchant && lastOrder) {
          suggestions.push({
            type: 'frequent',
            merchantId: freq.merchantId,
            merchantName: merchant.name,
            items: lastOrder.items,
            lastOrderDate: lastOrder.createdAt,
            orderCount: freq._count,
            estimatedTotal: lastOrder.total,
            reason: `You've ordered from here ${freq._count} times`,
          });
        }
      }
    }

    // Add favorite restaurant suggestions
    const favoriteRestaurants = await prisma.favoriteRestaurant.findMany({
      where: { customerId },
      include: {
        merchant: true,
      },
      orderBy: { lastOrderedAt: 'desc' },
      take: 3,
    });

    for (const fav of favoriteRestaurants) {
      const lastOrder = recentOrders.find(o => o.merchantId === fav.merchantId);
      
      if (lastOrder) {
        suggestions.push({
          type: 'favorite',
          merchantId: fav.merchantId,
          merchantName: fav.merchant.name,
          items: lastOrder.items,
          lastOrderDate: lastOrder.createdAt,
          orderCount: fav.orderCount,
          estimatedTotal: lastOrder.total,
          reason: 'From your favorites',
        });
      }
    }

    // Remove duplicates and sort by relevance
    const uniqueSuggestions = this.deduplicateSuggestions(suggestions);
    return this.rankSuggestions(uniqueSuggestions, customerId);
  }

  /**
   * Update reorder statistics
   */
  private async updateReorderStats(customerId: string, merchantId: string, items: any[]): Promise<void> {
    // Update favorite restaurant stats
    await prisma.favoriteRestaurant.updateMany({
      where: {
        customerId,
        merchantId,
      },
      data: {
        lastOrderedAt: new Date(),
        orderCount: {
          increment: 1,
        },
      },
    });

    // Update favorite item stats
    const productIds = items.map(item => item.productId);
    await prisma.favoriteItem.updateMany({
      where: {
        customerId,
        productId: { in: productIds },
      },
      data: {
        lastOrderedAt: new Date(),
        orderCount: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Deduplicate suggestions
   */
  private deduplicateSuggestions(suggestions: ReorderSuggestion[]): ReorderSuggestion[] {
    const seen = new Set<string>();
    return suggestions.filter(s => {
      if (seen.has(s.merchantId)) {
        return false;
      }
      seen.add(s.merchantId);
      return true;
    });
  }

  /**
   * Rank suggestions by relevance
   */
  private async rankSuggestions(suggestions: ReorderSuggestion[], customerId: string): Promise<ReorderSuggestion[]> {
    // Simple ranking based on recency and frequency
    return suggestions.sort((a, b) => {
      // Prioritize favorites
      if (a.type === 'favorite' && b.type !== 'favorite') return -1;
      if (b.type === 'favorite' && a.type !== 'favorite') return 1;

      // Then by recency
      return b.lastOrderDate.getTime() - a.lastOrderDate.getTime();
    });
  }

  /**
   * Get order history for reordering
   */
  async getReorderableHistory(customerId: string, limit: number = 20): Promise<any[]> {
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        status: 'delivered',
      },
      include: {
        merchant: true,
        items: {
          include: {
            product: true,
          },
        },
        rating: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Check current availability
    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        const merchant = await prisma.merchant.findUnique({
          where: { id: order.merchantId },
        });

        const availableItems = await Promise.all(
          order.items.map(async (item) => {
            const product = await prisma.product.findUnique({
              where: { id: item.productId },
            });
            return {
              ...item,
              isAvailable: product?.isAvailable || false,
            };
          })
        );

        const allItemsAvailable = availableItems.every(item => item.isAvailable);

        return {
          ...order,
          canReorder: merchant?.isOpen && allItemsAvailable,
          unavailableItems: availableItems.filter(item => !item.isAvailable),
          items: availableItems,
        };
      })
    );

    return enrichedOrders;
  }

  /**
   * Search favorites
   */
  async searchFavorites(customerId: string, query: string): Promise<any> {
    const [restaurants, items] = await Promise.all([
      // Search favorite restaurants
      prisma.favoriteRestaurant.findMany({
        where: {
          customerId,
          merchant: {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
        },
        include: {
          merchant: true,
        },
        take: 5,
      }),

      // Search favorite items
      prisma.favoriteItem.findMany({
        where: {
          customerId,
          OR: [
            {
              product: {
                name: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            },
            {
              nickname: {
                contains: query,
                mode: 'insensitive',
              },
            },
          ],
        },
        include: {
          product: {
            include: {
              merchant: true,
            },
          },
        },
        take: 10,
      }),
    ]);

    return {
      restaurants,
      items,
    };
  }

  /**
   * Auto-favorite frequently ordered items
   */
  async autoFavoriteFrequentItems(customerId: string): Promise<void> {
    // Get frequently ordered items (ordered 3+ times)
    const frequentItems = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          customerId,
          status: 'delivered',
        },
      },
      _count: true,
      having: {
        productId: {
          _count: {
            gte: 3,
          },
        },
      },
    });

    // Auto-favorite them
    for (const item of frequentItems) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (product) {
        await this.addFavoriteItem(customerId, {
          productId: item.productId,
          merchantId: product.merchantId,
        });
      }
    }
  }
}

// Export singleton instance
export const favoritesService = new FavoritesService();