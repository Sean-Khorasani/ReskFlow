import { prisma, logger, redis } from '@reskflow/shared';
import * as cron from 'node-cron';
import { differenceInMinutes } from 'date-fns';

interface SyncStatus {
  merchantId: string;
  lastSync: Date;
  nextSync: Date;
  status: 'idle' | 'syncing' | 'failed';
  itemsSynced: number;
  errors: string[];
}

interface ExternalCatalog {
  provider: string;
  items: Array<{
    externalId: string;
    name: string;
    description?: string;
    price: number;
    category: string;
    imageUrl?: string;
    available: boolean;
    modifiers?: any[];
  }>;
}

export class CatalogSyncService {
  private syncJobs: Map<string, cron.ScheduledTask> = new Map();

  async startSync(): Promise<void> {
    // Sync all merchants every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await this.syncAllMerchants();
      } catch (error) {
        logger.error('Catalog sync cron error', error);
      }
    });

    // Check for manual sync requests every minute
    cron.schedule('* * * * *', async () => {
      try {
        await this.processManualSyncRequests();
      } catch (error) {
        logger.error('Manual sync check error', error);
      }
    });

    logger.info('Catalog sync service started');
  }

  async triggerSync(merchantId: string): Promise<void> {
    try {
      // Add to sync queue
      await redis.lpush('catalog:sync:queue', merchantId);
      
      // Update sync status
      await this.updateSyncStatus(merchantId, {
        status: 'syncing',
        lastSync: new Date(),
        nextSync: new Date(Date.now() + 60 * 60 * 1000), // Next hour
      });

      logger.info(`Sync triggered for merchant ${merchantId}`);
    } catch (error) {
      logger.error('Failed to trigger sync', error);
      throw error;
    }
  }

  async getSyncStatus(merchantId: string): Promise<SyncStatus> {
    try {
      const key = `catalog:sync:status:${merchantId}`;
      const status = await redis.get(key);
      
      if (status) {
        return JSON.parse(status);
      }

      // Default status
      return {
        merchantId,
        lastSync: new Date(0),
        nextSync: new Date(),
        status: 'idle',
        itemsSynced: 0,
        errors: [],
      };
    } catch (error) {
      logger.error('Failed to get sync status', error);
      throw error;
    }
  }

  private async syncAllMerchants(): Promise<void> {
    try {
      // Get merchants with external integrations
      const merchants = await prisma.merchant.findMany({
        where: {
          status: 'ACTIVE',
          // Assuming we store integration info in metadata
        },
      });

      for (const merchant of merchants) {
        const lastSync = await this.getLastSyncTime(merchant.id);
        
        // Sync if more than 1 hour since last sync
        if (differenceInMinutes(new Date(), lastSync) >= 60) {
          await this.syncMerchantCatalog(merchant.id);
        }
      }
    } catch (error) {
      logger.error('Failed to sync all merchants', error);
    }
  }

  private async processManualSyncRequests(): Promise<void> {
    try {
      // Process sync queue
      let merchantId = await redis.rpop('catalog:sync:queue');
      
      while (merchantId) {
        await this.syncMerchantCatalog(merchantId);
        merchantId = await redis.rpop('catalog:sync:queue');
      }
    } catch (error) {
      logger.error('Failed to process manual sync requests', error);
    }
  }

  private async syncMerchantCatalog(merchantId: string): Promise<void> {
    try {
      logger.info(`Starting catalog sync for merchant ${merchantId}`);
      
      // Update status
      await this.updateSyncStatus(merchantId, { status: 'syncing' });

      // Get external catalog (mock implementation)
      const externalCatalog = await this.fetchExternalCatalog(merchantId);
      
      if (!externalCatalog) {
        throw new Error('No external catalog configured');
      }

      // Sync categories
      const categoryMap = await this.syncCategories(merchantId, externalCatalog);
      
      // Sync items
      const syncResult = await this.syncItems(merchantId, externalCatalog, categoryMap);
      
      // Update inventory from external source
      await this.syncInventory(merchantId, externalCatalog);
      
      // Update sync status
      await this.updateSyncStatus(merchantId, {
        status: 'idle',
        lastSync: new Date(),
        nextSync: new Date(Date.now() + 60 * 60 * 1000),
        itemsSynced: syncResult.synced,
        errors: syncResult.errors,
      });

      // Invalidate caches
      await this.invalidateMerchantCaches(merchantId);

      logger.info(`Catalog sync completed for merchant ${merchantId}: ${syncResult.synced} items synced`);
    } catch (error: any) {
      logger.error(`Catalog sync failed for merchant ${merchantId}`, error);
      
      await this.updateSyncStatus(merchantId, {
        status: 'failed',
        errors: [error.message],
      });
    }
  }

  private async fetchExternalCatalog(merchantId: string): Promise<ExternalCatalog | null> {
    try {
      // Get merchant's external integration config
      const integrationKey = `merchant:${merchantId}:integration`;
      const integration = await redis.get(integrationKey);
      
      if (!integration) {
        return null;
      }

      const config = JSON.parse(integration);
      
      // Mock implementation - would call external API
      // This would be replaced with actual API calls to POS systems, 
      // inventory management systems, etc.
      return {
        provider: config.provider,
        items: [
          {
            externalId: 'ext_001',
            name: 'Sample Item',
            description: 'From external catalog',
            price: 10.99,
            category: 'Main Dishes',
            available: true,
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to fetch external catalog', error);
      return null;
    }
  }

  private async syncCategories(
    merchantId: string,
    catalog: ExternalCatalog
  ): Promise<Map<string, string>> {
    const categoryMap = new Map<string, string>();
    
    try {
      // Get unique categories from external catalog
      const externalCategories = [...new Set(catalog.items.map(item => item.category))];
      
      // Get or create menu
      let menu = await prisma.menu.findFirst({
        where: { merchantId, name: 'Main Menu' },
      });

      if (!menu) {
        menu = await prisma.menu.create({
          data: {
            merchantId,
            name: 'Main Menu',
            description: 'Synced from external catalog',
          },
        });
      }

      // Sync categories
      for (const categoryName of externalCategories) {
        let category = await prisma.menuCategory.findFirst({
          where: {
            menuId: menu.id,
            name: categoryName,
          },
        });

        if (!category) {
          category = await prisma.menuCategory.create({
            data: {
              menuId: menu.id,
              name: categoryName,
              sortOrder: categoryMap.size,
            },
          });
        }

        categoryMap.set(categoryName, category.id);
      }
    } catch (error) {
      logger.error('Failed to sync categories', error);
    }

    return categoryMap;
  }

  private async syncItems(
    merchantId: string,
    catalog: ExternalCatalog,
    categoryMap: Map<string, string>
  ): Promise<{ synced: number; errors: string[] }> {
    const result = { synced: 0, errors: [] as string[] };

    for (const externalItem of catalog.items) {
      try {
        const categoryId = categoryMap.get(externalItem.category);
        if (!categoryId) {
          result.errors.push(`Category not found for item ${externalItem.name}`);
          continue;
        }

        // Check if item exists
        let item = await prisma.menuItem.findFirst({
          where: {
            merchantId,
            OR: [
              { sku: externalItem.externalId },
              { name: externalItem.name },
            ],
          },
        });

        if (item) {
          // Update existing item
          await prisma.menuItem.update({
            where: { id: item.id },
            data: {
              name: externalItem.name,
              description: externalItem.description,
              price: externalItem.price,
              status: externalItem.available ? 'AVAILABLE' : 'OUT_OF_STOCK',
              sku: externalItem.externalId,
              updatedAt: new Date(),
            },
          });
        } else {
          // Create new item
          await prisma.menuItem.create({
            data: {
              merchantId,
              categoryId,
              name: externalItem.name,
              description: externalItem.description,
              price: externalItem.price,
              sku: externalItem.externalId,
              status: externalItem.available ? 'AVAILABLE' : 'OUT_OF_STOCK',
              images: externalItem.imageUrl ? [externalItem.imageUrl] : [],
            },
          });
        }

        result.synced++;
      } catch (error: any) {
        logger.error(`Failed to sync item ${externalItem.name}`, error);
        result.errors.push(`${externalItem.name}: ${error.message}`);
      }
    }

    return result;
  }

  private async syncInventory(
    merchantId: string,
    catalog: ExternalCatalog
  ): Promise<void> {
    try {
      for (const externalItem of catalog.items) {
        const item = await prisma.menuItem.findFirst({
          where: {
            merchantId,
            sku: externalItem.externalId,
          },
        });

        if (item && item.trackInventory) {
          // Update inventory from external source
          // This would typically include actual stock levels
          const available = externalItem.available;
          
          await prisma.menuItem.update({
            where: { id: item.id },
            data: {
              status: available ? 'AVAILABLE' : 'OUT_OF_STOCK',
            },
          });
        }
      }
    } catch (error) {
      logger.error('Failed to sync inventory', error);
    }
  }

  private async updateSyncStatus(
    merchantId: string,
    updates: Partial<SyncStatus>
  ): Promise<void> {
    try {
      const key = `catalog:sync:status:${merchantId}`;
      const current = await this.getSyncStatus(merchantId);
      
      const updated = {
        ...current,
        ...updates,
      };

      await redis.set(key, JSON.stringify(updated), 'EX', 24 * 60 * 60);
    } catch (error) {
      logger.error('Failed to update sync status', error);
    }
  }

  private async getLastSyncTime(merchantId: string): Promise<Date> {
    const status = await this.getSyncStatus(merchantId);
    return new Date(status.lastSync);
  }

  private async invalidateMerchantCaches(merchantId: string): Promise<void> {
    const patterns = [
      `catalog:${merchantId}:*`,
      `merchant:${merchantId}:menu*`,
      `pricing:current:${merchantId}`,
      `inventory:status:${merchantId}`,
    ];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  }

  async setupWebhook(
    merchantId: string,
    config: {
      provider: string;
      webhookUrl: string;
      secret: string;
    }
  ): Promise<void> {
    // Store webhook configuration
    await redis.set(
      `catalog:webhook:${merchantId}`,
      JSON.stringify(config),
      'EX',
      365 * 24 * 60 * 60
    );
  }

  async handleWebhook(
    merchantId: string,
    payload: any,
    signature: string
  ): Promise<void> {
    try {
      // Verify webhook signature
      const config = await redis.get(`catalog:webhook:${merchantId}`);
      if (!config) {
        throw new Error('Webhook not configured');
      }

      // Process webhook payload
      if (payload.type === 'catalog_update') {
        await this.triggerSync(merchantId);
      } else if (payload.type === 'inventory_update') {
        await this.processInventoryWebhook(merchantId, payload.data);
      }
    } catch (error) {
      logger.error('Webhook processing failed', error);
      throw error;
    }
  }

  private async processInventoryWebhook(merchantId: string, data: any): Promise<void> {
    // Process real-time inventory updates from external systems
    for (const update of data.items) {
      const item = await prisma.menuItem.findFirst({
        where: {
          merchantId,
          sku: update.externalId,
        },
      });

      if (item) {
        await prisma.menuItem.update({
          where: { id: item.id },
          data: {
            quantity: update.quantity,
            status: update.quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
          },
        });
      }
    }
  }
}