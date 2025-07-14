import { prisma, logger, redis } from '@reskflow/shared';
import { Server } from 'socket.io';
import Bull from 'bull';
import { MenuItemStatus } from '@prisma/client';

interface InventoryUpdate {
  itemId: string;
  previousQuantity: number;
  newQuantity: number;
  changeAmount: number;
  reason: string;
  userId: string;
  timestamp: Date;
}

interface InventoryStatus {
  merchantId: string;
  totalItems: number;
  inStockItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  items: any[];
  lastUpdated: Date;
}

interface BatchUpdate {
  itemId: string;
  quantity: number;
  reason?: string;
}

export class InventoryRealtimeService {
  private io: Server;
  private queue: Bull.Queue;
  private updateInterval?: NodeJS.Timeout;

  constructor(io: Server, queue: Bull.Queue) {
    this.io = io;
    this.queue = queue;
  }

  async startRealtimeSync(): Promise<void> {
    // Process inventory changes every 5 seconds
    this.updateInterval = setInterval(async () => {
      try {
        await this.processRealtimeUpdates();
      } catch (error) {
        logger.error('Realtime sync error', error);
      }
    }, 5000);

    // Subscribe to Redis pub/sub for immediate updates
    const subscriber = redis.duplicate();
    await subscriber.subscribe('inventory:updates');
    
    subscriber.on('message', async (channel, message) => {
      try {
        const update = JSON.parse(message);
        await this.broadcastInventoryUpdate(update);
      } catch (error) {
        logger.error('Failed to process inventory message', error);
      }
    });

    logger.info('Inventory realtime sync started');
  }

  async stopRealtimeSync(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }

  async updateInventory(
    itemId: string,
    quantity: number,
    reason: string,
    userId: string
  ): Promise<void> {
    try {
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        throw new Error('Item not found');
      }

      const previousQuantity = item.quantity;
      const changeAmount = quantity - previousQuantity;

      // Update database
      const updatedItem = await prisma.menuItem.update({
        where: { id: itemId },
        data: {
          quantity,
          status: quantity <= 0 ? MenuItemStatus.OUT_OF_STOCK : MenuItemStatus.AVAILABLE,
          updatedAt: new Date(),
        },
      });

      // Create inventory log
      const update: InventoryUpdate = {
        itemId,
        previousQuantity,
        newQuantity: quantity,
        changeAmount,
        reason,
        userId,
        timestamp: new Date(),
      };

      // Queue for processing
      await this.queue.add('inventory-update', update);

      // Store in Redis for history
      await this.storeInventoryHistory(update);

      // Publish update
      await redis.publish('inventory:updates', JSON.stringify({
        ...update,
        merchantId: item.merchantId,
        itemName: item.name,
      }));

      // Check thresholds
      if (item.trackInventory) {
        await this.checkInventoryThresholds(updatedItem);
      }

      // Invalidate caches
      await this.invalidateCaches(item.merchantId, itemId);

      logger.info(`Inventory updated for item ${itemId}: ${previousQuantity} -> ${quantity}`);
    } catch (error) {
      logger.error('Failed to update inventory', error);
      throw error;
    }
  }

  async batchUpdateInventory(
    updates: BatchUpdate[],
    userId: string
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (update) => {
          try {
            await this.updateInventory(
              update.itemId,
              update.quantity,
              update.reason || 'Batch update',
              userId
            );
            results.success++;
          } catch (error: any) {
            results.failed++;
            results.errors.push({
              itemId: update.itemId,
              error: error.message,
            });
          }
        })
      );
    }

    return results;
  }

  async getInventoryStatus(merchantId: string): Promise<InventoryStatus> {
    try {
      // Check cache first
      const cacheKey = `inventory:status:${merchantId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const items = await prisma.menuItem.findMany({
        where: {
          merchantId,
          trackInventory: true,
        },
        include: {
          category: {
            select: { name: true },
          },
        },
      });

      const inStockItems = items.filter(i => i.quantity > i.lowStockThreshold);
      const lowStockItems = items.filter(
        i => i.quantity > 0 && i.quantity <= i.lowStockThreshold
      );
      const outOfStockItems = items.filter(i => i.quantity <= 0);

      const status: InventoryStatus = {
        merchantId,
        totalItems: items.length,
        inStockItems: inStockItems.length,
        lowStockItems: lowStockItems.length,
        outOfStockItems: outOfStockItems.length,
        items: [...lowStockItems, ...outOfStockItems].map(item => ({
          id: item.id,
          name: item.name,
          category: item.category?.name,
          quantity: item.quantity,
          lowStockThreshold: item.lowStockThreshold,
          status: item.quantity <= 0 ? 'out_of_stock' : 'low_stock',
          lastUpdated: item.updatedAt,
        })),
        lastUpdated: new Date(),
      };

      // Cache for 1 minute
      await redis.set(cacheKey, JSON.stringify(status), 'EX', 60);

      return status;
    } catch (error) {
      logger.error('Failed to get inventory status', error);
      throw error;
    }
  }

  async getInventoryHistory(itemId: string, days: number = 30): Promise<InventoryUpdate[]> {
    try {
      const key = `inventory:history:${itemId}`;
      const history = await redis.lrange(key, 0, -1);
      
      const updates = history
        .map(h => JSON.parse(h))
        .filter(u => {
          const updateDate = new Date(u.timestamp);
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - days);
          return updateDate >= cutoffDate;
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return updates;
    } catch (error) {
      logger.error('Failed to get inventory history', error);
      return [];
    }
  }

  async processInventoryUpdate(data: InventoryUpdate): Promise<void> {
    try {
      // Broadcast to connected clients
      await this.broadcastInventoryUpdate(data);

      // Update search index
      await this.updateSearchIndex(data.itemId);

      // Check for auto-reorder
      await this.checkAutoReorder(data.itemId);

      logger.info(`Processed inventory update for item ${data.itemId}`);
    } catch (error) {
      logger.error('Failed to process inventory update', error);
      throw error;
    }
  }

  private async processRealtimeUpdates(): Promise<void> {
    // Get recent inventory changes
    const recentChanges = await redis.keys('inventory:changed:*');
    
    for (const key of recentChanges) {
      const itemId = key.split(':')[2];
      const changed = await redis.get(key);
      
      if (changed) {
        const item = await prisma.menuItem.findUnique({
          where: { id: itemId },
          include: { merchant: true },
        });

        if (item) {
          // Broadcast status update
          this.io.to(`merchant:${item.merchantId}:inventory`).emit('inventory:item:update', {
            itemId: item.id,
            name: item.name,
            quantity: item.quantity,
            status: item.status,
            lowStockThreshold: item.lowStockThreshold,
            timestamp: new Date(),
          });

          // Clear the change flag
          await redis.del(key);
        }
      }
    }
  }

  private async broadcastInventoryUpdate(update: any): Promise<void> {
    // Emit to merchant room
    this.io.to(`merchant:${update.merchantId}:inventory`).emit('inventory:update', update);

    // Emit to item room
    this.io.to(`item:${update.itemId}`).emit('item:inventory:update', {
      itemId: update.itemId,
      quantity: update.newQuantity,
      available: update.newQuantity > 0,
      timestamp: update.timestamp,
    });

    // Update merchant inventory status
    const status = await this.getInventoryStatus(update.merchantId);
    this.io.to(`merchant:${update.merchantId}:inventory`).emit('inventory:status', status);
  }

  private async storeInventoryHistory(update: InventoryUpdate): Promise<void> {
    const key = `inventory:history:${update.itemId}`;
    
    // Add to Redis list
    await redis.lpush(key, JSON.stringify(update));
    
    // Keep only last 1000 entries
    await redis.ltrim(key, 0, 999);
    
    // Set expiry to 90 days
    await redis.expire(key, 90 * 24 * 60 * 60);
  }

  private async checkInventoryThresholds(item: any): Promise<void> {
    // Check if low stock alert needed
    if (item.quantity > 0 && item.quantity <= item.lowStockThreshold) {
      const alertKey = `low-stock-alert:${item.id}`;
      const recentAlert = await redis.get(alertKey);
      
      if (!recentAlert) {
        // Send low stock notification
        await this.queue.add('low-stock-alert', {
          itemId: item.id,
          itemName: item.name,
          currentQuantity: item.quantity,
          threshold: item.lowStockThreshold,
          merchantId: item.merchantId,
        });

        // Mark as alerted (prevent spam for 4 hours)
        await redis.set(alertKey, '1', 'EX', 14400);
      }
    }

    // Check if out of stock
    if (item.quantity <= 0) {
      await this.queue.add('out-of-stock-alert', {
        itemId: item.id,
        itemName: item.name,
        merchantId: item.merchantId,
        timestamp: new Date(),
      });
    }
  }

  private async checkAutoReorder(itemId: string): Promise<void> {
    // Check if item has auto-reorder enabled
    const reorderConfig = await redis.get(`inventory:reorder:${itemId}`);
    
    if (reorderConfig) {
      const config = JSON.parse(reorderConfig);
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
      });

      if (item && item.quantity <= config.reorderPoint) {
        await this.queue.add('auto-reorder', {
          itemId,
          itemName: item.name,
          currentQuantity: item.quantity,
          reorderQuantity: config.reorderQuantity,
          supplierId: config.supplierId,
          merchantId: item.merchantId,
        });
      }
    }
  }

  private async updateSearchIndex(itemId: string): Promise<void> {
    // Update item availability in search index
    const item = await prisma.menuItem.findUnique({
      where: { id: itemId },
    });

    if (item) {
      await redis.set(
        `search:item:${itemId}:available`,
        item.quantity > 0 ? '1' : '0',
        'EX',
        3600
      );
    }
  }

  private async invalidateCaches(merchantId: string, itemId: string): Promise<void> {
    // Invalidate related caches
    const patterns = [
      `catalog:${merchantId}:*`,
      `merchant:${merchantId}:menu-items`,
      `item:${itemId}:*`,
      `inventory:status:${merchantId}`,
    ];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  }

  async setReorderConfig(
    itemId: string,
    config: {
      enabled: boolean;
      reorderPoint: number;
      reorderQuantity: number;
      supplierId?: string;
    }
  ): Promise<void> {
    if (config.enabled) {
      await redis.set(
        `inventory:reorder:${itemId}`,
        JSON.stringify(config),
        'EX',
        365 * 24 * 60 * 60 // 1 year
      );
    } else {
      await redis.del(`inventory:reorder:${itemId}`);
    }
  }
}