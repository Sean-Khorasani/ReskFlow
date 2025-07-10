import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface SyncOptions {
  syncPrices: boolean;
  syncAvailability: boolean;
  syncDescriptions: boolean;
  syncImages: boolean;
  priceAdjustment?: {
    type: 'percentage' | 'fixed';
    value: number;
  };
  categoryMapping?: { [sourceCategory: string]: string };
}

interface SyncRule {
  id: string;
  virtualRestaurantId: string;
  ruleType: string;
  conditions: any;
  actions: any;
  enabled: boolean;
}

interface SyncResult {
  success: boolean;
  itemsSynced: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsRemoved: number;
  errors: string[];
}

interface SyncStatus {
  lastSync?: Date;
  nextSync?: Date;
  status: 'idle' | 'syncing' | 'scheduled' | 'error';
  syncFrequency: string;
  autoSync: boolean;
}

export class MenuSyncService {
  constructor(private syncQueue: Bull.Queue) {}

  async syncMenu(params: {
    virtualRestaurantId: string;
    sourceMenuId: string;
    syncOptions: SyncOptions;
  }): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      itemsSynced: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
    };

    try {
      // Validate virtual restaurant
      const virtualRestaurant = await prisma.virtualRestaurant.findUnique({
        where: { id: params.virtualRestaurantId },
        include: { menu: true },
      });

      if (!virtualRestaurant) {
        throw new Error('Virtual restaurant not found');
      }

      // Get source menu
      const sourceMenu = await prisma.menu.findUnique({
        where: { id: params.sourceMenuId },
        include: {
          items: {
            where: { is_deleted: false },
          },
        },
      });

      if (!sourceMenu) {
        throw new Error('Source menu not found');
      }

      // Create or get virtual restaurant menu
      let targetMenu = virtualRestaurant.menu;
      if (!targetMenu) {
        targetMenu = await prisma.menu.create({
          data: {
            id: uuidv4(),
            virtual_restaurant_id: params.virtualRestaurantId,
            name: `${virtualRestaurant.name} Menu`,
            created_at: new Date(),
          },
        });
      }

      // Apply sync rules
      const syncRules = await this.getSyncRules(params.virtualRestaurantId);
      const processedItems = await this.applyRules(sourceMenu.items, syncRules);

      // Sync menu items
      const syncResult = await this.syncMenuItems({
        sourceItems: processedItems,
        targetMenuId: targetMenu.id,
        syncOptions: params.syncOptions,
      });

      result.success = true;
      result.itemsSynced = syncResult.synced;
      result.itemsAdded = syncResult.added;
      result.itemsUpdated = syncResult.updated;
      result.itemsRemoved = syncResult.removed;

      // Update sync status
      await this.updateSyncStatus(params.virtualRestaurantId, 'completed');

      // Queue next sync if auto-sync enabled
      const settings = await this.getSyncSettings(params.virtualRestaurantId);
      if (settings.autoSync) {
        await this.scheduleNextSync(params.virtualRestaurantId, settings.syncFrequency);
      }

    } catch (error) {
      logger.error('Menu sync failed:', error);
      result.errors.push(error.message);
      await this.updateSyncStatus(params.virtualRestaurantId, 'error', error.message);
    }

    return result;
  }

  async syncMenuItems(params: {
    sourceItems: any[];
    targetMenuId: string;
    syncOptions: SyncOptions;
  }): Promise<{
    synced: number;
    added: number;
    updated: number;
    removed: number;
  }> {
    const stats = {
      synced: 0,
      added: 0,
      updated: 0,
      removed: 0,
    };

    // Get existing items in target menu
    const existingItems = await prisma.menuItem.findMany({
      where: {
        menu_id: params.targetMenuId,
        is_deleted: false,
      },
    });

    const existingItemsMap = new Map(
      existingItems.map(item => [item.source_item_id || item.sku, item])
    );

    // Sync each source item
    for (const sourceItem of params.sourceItems) {
      try {
        const existingItem = existingItemsMap.get(sourceItem.id) || 
                            existingItemsMap.get(sourceItem.sku);

        if (existingItem) {
          // Update existing item
          const updated = await this.updateMenuItem(
            existingItem,
            sourceItem,
            params.syncOptions
          );
          if (updated) stats.updated++;
        } else {
          // Add new item
          await this.createMenuItem(
            params.targetMenuId,
            sourceItem,
            params.syncOptions
          );
          stats.added++;
        }
        stats.synced++;
      } catch (error) {
        logger.error(`Failed to sync item ${sourceItem.name}:`, error);
      }
    }

    // Remove items not in source
    const sourceItemIds = new Set(params.sourceItems.map(i => i.id));
    for (const existingItem of existingItems) {
      if (existingItem.source_item_id && !sourceItemIds.has(existingItem.source_item_id)) {
        await prisma.menuItem.update({
          where: { id: existingItem.id },
          data: {
            is_deleted: true,
            deleted_at: new Date(),
          },
        });
        stats.removed++;
      }
    }

    return stats;
  }

  async configureSyncRules(
    virtualRestaurantId: string,
    rules: Array<{
      ruleType: string;
      conditions: any;
      actions: any;
    }>
  ): Promise<{ success: boolean; rulesCreated: number }> {
    let rulesCreated = 0;

    // Validate virtual restaurant
    const virtualRestaurant = await prisma.virtualRestaurant.findUnique({
      where: { id: virtualRestaurantId },
    });

    if (!virtualRestaurant) {
      throw new Error('Virtual restaurant not found');
    }

    // Create sync rules
    for (const rule of rules) {
      await prisma.menuSyncRule.create({
        data: {
          id: uuidv4(),
          virtual_restaurant_id: virtualRestaurantId,
          rule_type: rule.ruleType,
          conditions: rule.conditions,
          actions: rule.actions,
          enabled: true,
          created_at: new Date(),
        },
      });
      rulesCreated++;
    }

    return {
      success: true,
      rulesCreated,
    };
  }

  async getSyncStatus(virtualRestaurantId: string): Promise<SyncStatus> {
    const syncRecord = await prisma.menuSync.findFirst({
      where: { virtual_restaurant_id: virtualRestaurantId },
      orderBy: { created_at: 'desc' },
    });

    const settings = await this.getSyncSettings(virtualRestaurantId);

    let status: SyncStatus['status'] = 'idle';
    if (syncRecord) {
      if (syncRecord.status === 'in_progress') {
        status = 'syncing';
      } else if (syncRecord.status === 'scheduled') {
        status = 'scheduled';
      } else if (syncRecord.status === 'error') {
        status = 'error';
      }
    }

    return {
      lastSync: syncRecord?.completed_at,
      nextSync: await this.getNextSyncTime(virtualRestaurantId),
      status,
      syncFrequency: settings.syncFrequency,
      autoSync: settings.autoSync,
    };
  }

  async processSyncJob(data: {
    virtualRestaurantId: string;
    sourceMenuId: string;
  }): Promise<void> {
    logger.info('Processing sync job:', data);

    const settings = await this.getSyncSettings(data.virtualRestaurantId);
    
    await this.syncMenu({
      virtualRestaurantId: data.virtualRestaurantId,
      sourceMenuId: data.sourceMenuId,
      syncOptions: settings.syncOptions,
    });
  }

  async updatePrices(data: {
    virtualRestaurantId: string;
    priceUpdates: Array<{
      itemId: string;
      newPrice: number;
    }>;
  }): Promise<void> {
    for (const update of data.priceUpdates) {
      await prisma.menuItem.update({
        where: { id: update.itemId },
        data: {
          price: update.newPrice,
          price_updated_at: new Date(),
        },
      });
    }

    logger.info(`Updated ${data.priceUpdates.length} prices for virtual restaurant ${data.virtualRestaurantId}`);
  }

  async syncAvailability(data: {
    virtualRestaurantId: string;
    sourceMenuId: string;
  }): Promise<void> {
    // Get source menu items availability
    const sourceItems = await prisma.menuItem.findMany({
      where: {
        menu_id: data.sourceMenuId,
        is_deleted: false,
      },
      select: {
        id: true,
        is_available: true,
        sku: true,
      },
    });

    // Update virtual restaurant menu items
    const virtualMenu = await prisma.menu.findFirst({
      where: { virtual_restaurant_id: data.virtualRestaurantId },
    });

    if (!virtualMenu) return;

    for (const sourceItem of sourceItems) {
      await prisma.menuItem.updateMany({
        where: {
          menu_id: virtualMenu.id,
          source_item_id: sourceItem.id,
        },
        data: {
          is_available: sourceItem.is_available,
          availability_updated_at: new Date(),
        },
      });
    }
  }

  async createBulkSyncSchedule(params: {
    kitchenId: string;
    virtualRestaurantIds: string[];
    schedule: {
      frequency: 'hourly' | 'daily' | 'weekly';
      time?: string;
      dayOfWeek?: number;
    };
  }): Promise<{ success: boolean; scheduled: number }> {
    let scheduled = 0;

    for (const vrId of params.virtualRestaurantIds) {
      // Verify virtual restaurant belongs to kitchen
      const vr = await prisma.virtualRestaurant.findFirst({
        where: {
          id: vrId,
          parent_kitchen_id: params.kitchenId,
        },
      });

      if (!vr) continue;

      // Create schedule
      await prisma.menuSyncSchedule.create({
        data: {
          virtual_restaurant_id: vrId,
          frequency: params.schedule.frequency,
          time: params.schedule.time,
          day_of_week: params.schedule.dayOfWeek,
          enabled: true,
          created_at: new Date(),
        },
      });

      scheduled++;

      // Queue first sync
      await this.scheduleNextSync(vrId, params.schedule.frequency);
    }

    return {
      success: true,
      scheduled,
    };
  }

  async getMenuDifferences(
    sourceMenuId: string,
    targetMenuId: string
  ): Promise<{
    added: any[];
    modified: any[];
    removed: any[];
    priceChanges: any[];
  }> {
    const [sourceItems, targetItems] = await Promise.all([
      prisma.menuItem.findMany({
        where: { menu_id: sourceMenuId, is_deleted: false },
      }),
      prisma.menuItem.findMany({
        where: { menu_id: targetMenuId, is_deleted: false },
      }),
    ]);

    const targetMap = new Map(
      targetItems.map(item => [item.source_item_id || item.sku, item])
    );

    const differences = {
      added: [] as any[],
      modified: [] as any[],
      removed: [] as any[],
      priceChanges: [] as any[],
    };

    // Find added and modified items
    for (const sourceItem of sourceItems) {
      const targetItem = targetMap.get(sourceItem.id) || targetMap.get(sourceItem.sku);
      
      if (!targetItem) {
        differences.added.push(sourceItem);
      } else {
        // Check for modifications
        if (sourceItem.name !== targetItem.name ||
            sourceItem.description !== targetItem.description ||
            sourceItem.price !== targetItem.price) {
          differences.modified.push({
            source: sourceItem,
            target: targetItem,
          });

          if (sourceItem.price !== targetItem.price) {
            differences.priceChanges.push({
              itemName: sourceItem.name,
              oldPrice: targetItem.price,
              newPrice: sourceItem.price,
              change: sourceItem.price - targetItem.price,
              changePercent: ((sourceItem.price - targetItem.price) / targetItem.price) * 100,
            });
          }
        }
      }
      targetMap.delete(sourceItem.id);
      targetMap.delete(sourceItem.sku);
    }

    // Remaining items in target are removed
    differences.removed = Array.from(targetMap.values());

    return differences;
  }

  private async getSyncRules(virtualRestaurantId: string): Promise<SyncRule[]> {
    const rules = await prisma.menuSyncRule.findMany({
      where: {
        virtual_restaurant_id: virtualRestaurantId,
        enabled: true,
      },
    });

    return rules.map(r => ({
      id: r.id,
      virtualRestaurantId: r.virtual_restaurant_id,
      ruleType: r.rule_type,
      conditions: r.conditions,
      actions: r.actions,
      enabled: r.enabled,
    }));
  }

  private async applyRules(items: any[], rules: SyncRule[]): Promise<any[]> {
    let processedItems = [...items];

    for (const rule of rules) {
      processedItems = await this.applyRule(processedItems, rule);
    }

    return processedItems;
  }

  private async applyRule(items: any[], rule: SyncRule): Promise<any[]> {
    switch (rule.ruleType) {
      case 'filter_category':
        return this.filterByCategory(items, rule.conditions);
      
      case 'price_adjustment':
        return this.adjustPrices(items, rule.actions);
      
      case 'availability_schedule':
        return this.applyAvailabilitySchedule(items, rule.conditions);
      
      case 'dietary_filter':
        return this.filterByDietary(items, rule.conditions);
      
      case 'rename_category':
        return this.renameCategories(items, rule.actions);
      
      default:
        return items;
    }
  }

  private filterByCategory(items: any[], conditions: any): any[] {
    const { categories, action } = conditions;
    
    if (action === 'include') {
      return items.filter(item => categories.includes(item.category));
    } else {
      return items.filter(item => !categories.includes(item.category));
    }
  }

  private adjustPrices(items: any[], actions: any): any[] {
    const { adjustment } = actions;
    
    return items.map(item => ({
      ...item,
      price: adjustment.type === 'percentage'
        ? item.price * (1 + adjustment.value / 100)
        : item.price + adjustment.value,
    }));
  }

  private applyAvailabilitySchedule(items: any[], conditions: any): any[] {
    const { schedule } = conditions;
    const currentHour = dayjs().hour();
    const currentDay = dayjs().day();

    return items.map(item => {
      let isAvailable = item.is_available;

      if (schedule.hours) {
        isAvailable = currentHour >= schedule.hours.start && 
                     currentHour < schedule.hours.end;
      }

      if (schedule.days && isAvailable) {
        isAvailable = schedule.days.includes(currentDay);
      }

      return { ...item, is_available: isAvailable };
    });
  }

  private filterByDietary(items: any[], conditions: any): any[] {
    const { dietary_tags, action } = conditions;
    
    return items.filter(item => {
      const hasTag = dietary_tags.some((tag: string) => 
        item.dietary_tags?.includes(tag)
      );
      return action === 'include' ? hasTag : !hasTag;
    });
  }

  private renameCategories(items: any[], actions: any): any[] {
    const { mapping } = actions;
    
    return items.map(item => ({
      ...item,
      category: mapping[item.category] || item.category,
    }));
  }

  private async updateMenuItem(
    existingItem: any,
    sourceItem: any,
    syncOptions: SyncOptions
  ): Promise<boolean> {
    const updates: any = {};
    let hasUpdates = false;

    if (syncOptions.syncPrices && existingItem.price !== sourceItem.price) {
      updates.price = syncOptions.priceAdjustment
        ? this.applyPriceAdjustment(sourceItem.price, syncOptions.priceAdjustment)
        : sourceItem.price;
      hasUpdates = true;
    }

    if (syncOptions.syncAvailability && existingItem.is_available !== sourceItem.is_available) {
      updates.is_available = sourceItem.is_available;
      hasUpdates = true;
    }

    if (syncOptions.syncDescriptions && existingItem.description !== sourceItem.description) {
      updates.description = sourceItem.description;
      hasUpdates = true;
    }

    if (syncOptions.syncImages && existingItem.image_url !== sourceItem.image_url) {
      updates.image_url = sourceItem.image_url;
      hasUpdates = true;
    }

    if (hasUpdates) {
      updates.updated_at = new Date();
      await prisma.menuItem.update({
        where: { id: existingItem.id },
        data: updates,
      });
    }

    return hasUpdates;
  }

  private async createMenuItem(
    targetMenuId: string,
    sourceItem: any,
    syncOptions: SyncOptions
  ): Promise<void> {
    const price = syncOptions.priceAdjustment
      ? this.applyPriceAdjustment(sourceItem.price, syncOptions.priceAdjustment)
      : sourceItem.price;

    const category = syncOptions.categoryMapping?.[sourceItem.category] || sourceItem.category;

    await prisma.menuItem.create({
      data: {
        id: uuidv4(),
        menu_id: targetMenuId,
        source_item_id: sourceItem.id,
        name: sourceItem.name,
        description: syncOptions.syncDescriptions ? sourceItem.description : '',
        price,
        category,
        image_url: syncOptions.syncImages ? sourceItem.image_url : null,
        is_available: syncOptions.syncAvailability ? sourceItem.is_available : true,
        dietary_tags: sourceItem.dietary_tags,
        preparation_time: sourceItem.preparation_time,
        sku: sourceItem.sku,
        created_at: new Date(),
      },
    });
  }

  private applyPriceAdjustment(
    basePrice: number,
    adjustment: { type: 'percentage' | 'fixed'; value: number }
  ): number {
    if (adjustment.type === 'percentage') {
      return basePrice * (1 + adjustment.value / 100);
    } else {
      return basePrice + adjustment.value;
    }
  }

  private async getSyncSettings(virtualRestaurantId: string): Promise<any> {
    const settings = await prisma.menuSyncSettings.findFirst({
      where: { virtual_restaurant_id: virtualRestaurantId },
    });

    return settings || {
      autoSync: false,
      syncFrequency: 'daily',
      syncOptions: {
        syncPrices: true,
        syncAvailability: true,
        syncDescriptions: true,
        syncImages: true,
      },
    };
  }

  private async updateSyncStatus(
    virtualRestaurantId: string,
    status: 'completed' | 'error',
    errorMessage?: string
  ): Promise<void> {
    await prisma.menuSync.create({
      data: {
        virtual_restaurant_id: virtualRestaurantId,
        status,
        error_message: errorMessage,
        completed_at: status === 'completed' ? new Date() : undefined,
        created_at: new Date(),
      },
    });
  }

  private async scheduleNextSync(
    virtualRestaurantId: string,
    frequency: string
  ): Promise<void> {
    let delay: number;
    
    switch (frequency) {
      case 'hourly':
        delay = 60 * 60 * 1000; // 1 hour
        break;
      case 'daily':
        delay = 24 * 60 * 60 * 1000; // 24 hours
        break;
      case 'weekly':
        delay = 7 * 24 * 60 * 60 * 1000; // 7 days
        break;
      default:
        delay = 24 * 60 * 60 * 1000; // Default to daily
    }

    await this.syncQueue.add(
      'sync-menu',
      { virtualRestaurantId },
      { delay }
    );
  }

  private async getNextSyncTime(virtualRestaurantId: string): Promise<Date | undefined> {
    const jobs = await this.syncQueue.getJobs(['delayed']);
    const syncJob = jobs.find(job => 
      job.data.virtualRestaurantId === virtualRestaurantId
    );

    if (syncJob && syncJob.opts.delay) {
      return new Date(Date.now() + syncJob.opts.delay);
    }

    return undefined;
  }
}