import { prisma, logger, redis, EventEmitter } from '@reskflow/shared';
import { MenuItem, MenuItemStatus } from '@prisma/client';
import { NotificationService } from '@reskflow/shared';
import { CronJob } from 'cron';

interface InventoryUpdate {
  itemId: string;
  quantity: number;
  reason: string;
  timestamp: Date;
}

interface InventoryAlert {
  itemId: string;
  itemName: string;
  currentQuantity: number;
  threshold: number;
  merchantId: string;
}

export class InventoryService {
  private eventEmitter: EventEmitter;
  private notificationService: NotificationService;
  private inventorySyncJob?: CronJob;
  private inventorySyncInterval?: NodeJS.Timeout;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.notificationService = new NotificationService();
  }

  async updateItemAvailability(
    itemId: string,
    available: boolean,
    quantity?: number
  ): Promise<MenuItem> {
    try {
      const updateData: any = {
        status: available ? MenuItemStatus.AVAILABLE : MenuItemStatus.OUT_OF_STOCK,
      };

      if (quantity !== undefined) {
        updateData.quantity = quantity;
      }

      const menuItem = await prisma.menuItem.update({
        where: { id: itemId },
        data: updateData,
      });

      // Log inventory change
      await this.logInventoryChange({
        itemId,
        quantity: quantity || menuItem.quantity,
        reason: available ? 'Manual availability update' : 'Marked out of stock',
        timestamp: new Date(),
      });

      // Update cache
      await this.updateInventoryCache(menuItem);

      // Check thresholds
      if (menuItem.trackInventory && menuItem.quantity <= menuItem.lowStockThreshold) {
        await this.handleLowStock(menuItem);
      }

      logger.info(`Inventory updated for item ${itemId}: available=${available}, quantity=${quantity}`);
      return menuItem;
    } catch (error) {
      logger.error('Failed to update item availability', error);
      throw error;
    }
  }

  async bulkUpdateInventory(
    merchantId: string,
    updates: Array<{ itemId: string; quantity: number }>
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Process in batches
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (update) => {
          try {
            await this.updateItemAvailability(update.itemId, true, update.quantity);
            success++;
          } catch (error) {
            failed++;
            logger.error(`Failed to update inventory for item ${update.itemId}`, error);
          }
        })
      );
    }

    logger.info(`Bulk inventory update for merchant ${merchantId}: ${success} success, ${failed} failed`);
    return { success, failed };
  }

  async getInventoryStatus(merchantId: string): Promise<{
    totalItems: number;
    availableItems: number;
    outOfStockItems: number;
    lowStockItems: number;
    items: MenuItem[];
  }> {
    const items = await prisma.menuItem.findMany({
      where: {
        merchantId,
        trackInventory: true,
      },
      orderBy: { quantity: 'asc' },
    });

    const availableItems = items.filter(item => item.status === MenuItemStatus.AVAILABLE);
    const outOfStockItems = items.filter(item => item.status === MenuItemStatus.OUT_OF_STOCK);
    const lowStockItems = items.filter(
      item => item.quantity <= item.lowStockThreshold && item.status === MenuItemStatus.AVAILABLE
    );

    return {
      totalItems: items.length,
      availableItems: availableItems.length,
      outOfStockItems: outOfStockItems.length,
      lowStockItems: lowStockItems.length,
      items: lowStockItems, // Return low stock items for quick review
    };
  }

  async getInventoryHistory(
    itemId: string,
    days: number = 30
  ): Promise<InventoryUpdate[]> {
    const key = `inventory:history:${itemId}`;
    const history = await redis.lrange(key, 0, -1);
    
    const updates = history
      .map(h => JSON.parse(h))
      .filter(u => {
        const updateDate = new Date(u.timestamp);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        return updateDate >= cutoffDate;
      });

    return updates;
  }

  async predictStockout(merchantId: string): Promise<Array<{
    item: MenuItem;
    daysUntilStockout: number;
    averageDailyUsage: number;
  }>> {
    // Get items with inventory tracking
    const items = await prisma.menuItem.findMany({
      where: {
        merchantId,
        trackInventory: true,
        status: MenuItemStatus.AVAILABLE,
        quantity: { gt: 0 },
      },
    });

    const predictions = [];

    for (const item of items) {
      // Get order history for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const orderItems = await prisma.orderItem.findMany({
        where: {
          menuItemId: item.id,
          order: {
            createdAt: { gte: thirtyDaysAgo },
            status: 'DELIVERED',
          },
        },
        include: { order: true },
      });

      if (orderItems.length > 0) {
        // Calculate average daily usage
        const totalQuantity = orderItems.reduce((sum, oi) => sum + oi.quantity, 0);
        const averageDailyUsage = totalQuantity / 30;

        if (averageDailyUsage > 0) {
          const daysUntilStockout = Math.floor(item.quantity / averageDailyUsage);

          if (daysUntilStockout <= 7) { // Alert if stockout predicted within a week
            predictions.push({
              item,
              daysUntilStockout,
              averageDailyUsage: Math.round(averageDailyUsage * 10) / 10,
            });
          }
        }
      }
    }

    return predictions.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
  }

  startInventorySync(): void {
    // Run inventory sync every hour
    this.inventorySyncInterval = setInterval(async () => {
      try {
        await this.syncInventoryLevels();
      } catch (error) {
        logger.error('Inventory sync error', error);
      }
    }, 3600000); // 1 hour

    // Schedule daily inventory report at 6 AM
    this.inventorySyncJob = new CronJob('0 6 * * *', async () => {
      try {
        await this.generateDailyInventoryReport();
      } catch (error) {
        logger.error('Daily inventory report error', error);
      }
    });

    this.inventorySyncJob.start();
    logger.info('Inventory sync started');
  }

  stopInventorySync(): void {
    if (this.inventorySyncInterval) {
      clearInterval(this.inventorySyncInterval);
    }

    if (this.inventorySyncJob) {
      this.inventorySyncJob.stop();
    }

    logger.info('Inventory sync stopped');
  }

  private async syncInventoryLevels(): Promise<void> {
    // Get all merchants with inventory tracking
    const merchants = await prisma.merchant.findMany({
      where: { status: 'ACTIVE' },
    });

    for (const merchant of merchants) {
      // Check for items that should be marked out of stock
      await prisma.menuItem.updateMany({
        where: {
          merchantId: merchant.id,
          trackInventory: true,
          quantity: { lte: 0 },
          status: MenuItemStatus.AVAILABLE,
        },
        data: {
          status: MenuItemStatus.OUT_OF_STOCK,
        },
      });

      // Check for items that can be marked available again
      await prisma.menuItem.updateMany({
        where: {
          merchantId: merchant.id,
          trackInventory: true,
          quantity: { gt: 0 },
          status: MenuItemStatus.OUT_OF_STOCK,
        },
        data: {
          status: MenuItemStatus.AVAILABLE,
        },
      });

      // Get low stock alerts
      const lowStockItems = await prisma.menuItem.findMany({
        where: {
          merchantId: merchant.id,
          trackInventory: true,
          status: MenuItemStatus.AVAILABLE,
          quantity: { lte: prisma.menuItem.fields.lowStockThreshold },
        },
      });

      for (const item of lowStockItems) {
        await this.handleLowStock(item);
      }
    }
  }

  private async generateDailyInventoryReport(): Promise<void> {
    const merchants = await prisma.merchant.findMany({
      where: { status: 'ACTIVE' },
    });

    for (const merchant of merchants) {
      const status = await this.getInventoryStatus(merchant.id);
      const predictions = await this.predictStockout(merchant.id);

      if (status.lowStockItems > 0 || predictions.length > 0) {
        await this.notificationService.sendMerchantNotification(
          merchant.id,
          'Daily Inventory Report',
          `You have ${status.lowStockItems} low stock items and ${predictions.length} items predicted to stock out within a week.`
        );
      }
    }
  }

  private async logInventoryChange(update: InventoryUpdate): Promise<void> {
    const key = `inventory:history:${update.itemId}`;
    
    // Add to Redis list (keep last 1000 entries)
    await redis.lpush(key, JSON.stringify(update));
    await redis.ltrim(key, 0, 999);
    await redis.expire(key, 90 * 24 * 60 * 60); // 90 days
  }

  private async updateInventoryCache(menuItem: MenuItem): Promise<void> {
    const key = `inventory:${menuItem.id}`;
    
    await redis.set(
      key,
      JSON.stringify({
        id: menuItem.id,
        merchantId: menuItem.merchantId,
        name: menuItem.name,
        quantity: menuItem.quantity,
        status: menuItem.status,
        trackInventory: menuItem.trackInventory,
        lowStockThreshold: menuItem.lowStockThreshold,
        updatedAt: menuItem.updatedAt,
      }),
      'EX',
      3600 // 1 hour
    );
  }

  private async handleLowStock(menuItem: MenuItem): Promise<void> {
    // Check if we've already sent an alert recently
    const alertKey = `low-stock-alert:${menuItem.id}`;
    const recentAlert = await redis.get(alertKey);
    
    if (!recentAlert) {
      const alert: InventoryAlert = {
        itemId: menuItem.id,
        itemName: menuItem.name,
        currentQuantity: menuItem.quantity,
        threshold: menuItem.lowStockThreshold,
        merchantId: menuItem.merchantId,
      };

      // Send notification
      await this.notificationService.sendMerchantNotification(
        menuItem.merchantId,
        'Low Stock Alert',
        `${menuItem.name} is running low (${menuItem.quantity} remaining)`
      );

      // Emit event for real-time updates
      this.eventEmitter.emit('low-stock', alert);

      // Mark as alerted (prevent spam for 4 hours)
      await redis.set(alertKey, '1', 'EX', 14400);
    }
  }
}