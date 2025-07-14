import { prisma, logger, redis } from '@reskflow/shared';
import { BatchGroupingService } from './BatchGroupingService';
import { RouteGenerationService } from './RouteGenerationService';
import Bull from 'bull';
import { v4 as uuidv4 } from 'uuid';

interface BatchJob {
  type: 'create' | 'optimize' | 'auto_batch';
  orderIds?: string[];
  batchId?: string;
  strategy?: string;
  metadata?: any;
}

interface Batch {
  id: string;
  orders: any[];
  status: 'pending' | 'assigned' | 'in_progress' | 'completed';
  driverId?: string;
  totalDistance: number;
  estimatedDuration: number;
  savings: number;
  createdAt: Date;
  assignedAt?: Date;
}

interface BatchSuggestion {
  orderIds: string[];
  score: number;
  estimatedSavings: number;
  estimatedDuration: number;
  reason: string;
}

export class BatchOptimizationService {
  private batchGrouping: BatchGroupingService;
  private routeGeneration: RouteGenerationService;
  private batchQueue: Bull.Queue;
  private batchSettings = {
    maxBatchSize: 5,
    maxDeliveryTime: 60, // minutes
    maxPickupRadius: 2000, // meters
    minBatchSize: 2,
    batchingEnabled: true,
  };

  constructor(
    batchGrouping: BatchGroupingService,
    routeGeneration: RouteGenerationService,
    batchQueue: Bull.Queue
  ) {
    this.batchGrouping = batchGrouping;
    this.routeGeneration = routeGeneration;
    this.batchQueue = batchQueue;
  }

  async processBatchJob(job: BatchJob) {
    logger.info(`Processing batch job: ${job.type}`);

    try {
      switch (job.type) {
        case 'create':
          return await this.executeBatchCreation(job.orderIds!, job.strategy!);
        case 'optimize':
          return await this.executeBatchOptimization(job.batchId!);
        case 'auto_batch':
          return await this.executeAutoBatching(job.metadata);
        default:
          throw new Error(`Unknown batch job type: ${job.type}`);
      }
    } catch (error) {
      logger.error(`Batch job failed: ${job.type}`, error);
      throw error;
    }
  }

  async createBatch(orderIds: string[], strategy: string = 'proximity'): Promise<Batch> {
    // Validate orders
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        status: 'confirmed',
      },
      include: {
        merchant: true,
        reskflow_address: true,
      },
    });

    if (orders.length !== orderIds.length) {
      throw new Error('Some orders are not available for batching');
    }

    // Check batch feasibility
    const feasibility = await this.batchGrouping.checkBatchFeasibility(orders);
    if (!feasibility.feasible) {
      throw new Error(`Batch not feasible: ${feasibility.reason}`);
    }

    // Create batch
    const batchId = uuidv4();
    const batch = await prisma.reskflowBatch.create({
      data: {
        id: batchId,
        status: 'pending',
        order_count: orders.length,
        total_distance: feasibility.totalDistance,
        estimated_duration: feasibility.estimatedDuration,
        savings_percentage: feasibility.savingsPercentage,
        created_at: new Date(),
      },
    });

    // Link orders to batch
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: { batch_id: batchId },
    });

    // Generate optimized route
    const route = await this.routeGeneration.generateOptimalRoute(orders);

    // Store route
    await redis.setex(
      `batch:${batchId}:route`,
      3600,
      JSON.stringify(route)
    );

    return {
      id: batchId,
      orders,
      status: 'pending',
      totalDistance: feasibility.totalDistance,
      estimatedDuration: feasibility.estimatedDuration,
      savings: feasibility.savingsPercentage,
      createdAt: new Date(),
    };
  }

  async getBatchSuggestions(
    zoneId?: string,
    maxBatchSize: number = 5
  ): Promise<BatchSuggestion[]> {
    // Get pending orders
    const pendingOrders = await prisma.order.findMany({
      where: {
        status: 'confirmed',
        batch_id: null,
        ...(zoneId && {
          merchant: {
            zone_id: zoneId,
          },
        }),
      },
      include: {
        merchant: true,
        reskflow_address: true,
      },
      orderBy: {
        created_at: 'asc',
      },
      take: 50, // Analyze up to 50 orders
    });

    if (pendingOrders.length < 2) {
      return [];
    }

    // Group orders into potential batches
    const potentialBatches = await this.batchGrouping.findOptimalGroups(
      pendingOrders,
      maxBatchSize
    );

    // Score and rank batches
    const suggestions: BatchSuggestion[] = [];

    for (const group of potentialBatches) {
      const feasibility = await this.batchGrouping.checkBatchFeasibility(group);
      
      if (feasibility.feasible) {
        const score = this.calculateBatchScore(group, feasibility);
        
        suggestions.push({
          orderIds: group.map(o => o.id),
          score,
          estimatedSavings: feasibility.savingsPercentage,
          estimatedDuration: feasibility.estimatedDuration,
          reason: this.generateBatchReason(group, feasibility),
        });
      }
    }

    // Sort by score
    suggestions.sort((a, b) => b.score - a.score);

    return suggestions.slice(0, 10); // Return top 10 suggestions
  }

  async optimizeBatch(
    batchId: string,
    addOrderIds?: string[],
    removeOrderIds?: string[]
  ): Promise<Batch> {
    const batch = await prisma.reskflowBatch.findUnique({
      where: { id: batchId },
      include: {
        orders: {
          include: {
            merchant: true,
            reskflow_address: true,
          },
        },
      },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    if (batch.status !== 'pending') {
      throw new Error('Can only optimize pending batches');
    }

    let orders = [...batch.orders];

    // Remove orders
    if (removeOrderIds && removeOrderIds.length > 0) {
      orders = orders.filter(o => !removeOrderIds.includes(o.id));
      
      // Unbatch removed orders
      await prisma.order.updateMany({
        where: { id: { in: removeOrderIds } },
        data: { batch_id: null },
      });
    }

    // Add orders
    if (addOrderIds && addOrderIds.length > 0) {
      const newOrders = await prisma.order.findMany({
        where: {
          id: { in: addOrderIds },
          status: 'confirmed',
          batch_id: null,
        },
        include: {
          merchant: true,
          reskflow_address: true,
        },
      });

      orders = [...orders, ...newOrders];
    }

    // Check if batch is still valid
    if (orders.length < this.batchSettings.minBatchSize) {
      // Dissolve batch
      await this.dissolveBatch(batchId);
      throw new Error('Batch size below minimum after optimization');
    }

    // Check feasibility
    const feasibility = await this.batchGrouping.checkBatchFeasibility(orders);
    if (!feasibility.feasible) {
      throw new Error(`Optimized batch not feasible: ${feasibility.reason}`);
    }

    // Update batch
    await prisma.reskflowBatch.update({
      where: { id: batchId },
      data: {
        order_count: orders.length,
        total_distance: feasibility.totalDistance,
        estimated_duration: feasibility.estimatedDuration,
        savings_percentage: feasibility.savingsPercentage,
        updated_at: new Date(),
      },
    });

    // Update order associations
    await prisma.order.updateMany({
      where: { id: { in: orders.map(o => o.id) } },
      data: { batch_id: batchId },
    });

    // Regenerate route
    const route = await this.routeGeneration.generateOptimalRoute(orders);
    await redis.setex(
      `batch:${batchId}:route`,
      3600,
      JSON.stringify(route)
    );

    return {
      id: batchId,
      orders,
      status: batch.status,
      totalDistance: feasibility.totalDistance,
      estimatedDuration: feasibility.estimatedDuration,
      savings: feasibility.savingsPercentage,
      createdAt: batch.created_at,
    };
  }

  async splitBatch(batchId: string, strategy: string = 'equal'): Promise<Batch[]> {
    const batch = await prisma.reskflowBatch.findUnique({
      where: { id: batchId },
      include: {
        orders: {
          include: {
            merchant: true,
            reskflow_address: true,
          },
        },
      },
    });

    if (!batch || batch.status !== 'pending') {
      throw new Error('Batch not found or not pending');
    }

    let groups: any[][];

    switch (strategy) {
      case 'equal':
        groups = this.splitEqual(batch.orders);
        break;
      case 'geographic':
        groups = await this.batchGrouping.splitByGeography(batch.orders);
        break;
      case 'time_window':
        groups = this.splitByTimeWindow(batch.orders);
        break;
      default:
        groups = this.splitEqual(batch.orders);
    }

    // Create new batches
    const newBatches: Batch[] = [];

    for (const group of groups) {
      if (group.length >= this.batchSettings.minBatchSize) {
        const newBatch = await this.createBatch(
          group.map(o => o.id),
          'proximity'
        );
        newBatches.push(newBatch);
      }
    }

    // Delete original batch
    await this.dissolveBatch(batchId);

    return newBatches;
  }

  async mergeBatches(batchIds: string[]): Promise<Batch> {
    const batches = await prisma.reskflowBatch.findMany({
      where: {
        id: { in: batchIds },
        status: 'pending',
      },
      include: {
        orders: true,
      },
    });

    if (batches.length !== batchIds.length) {
      throw new Error('Some batches not found or not pending');
    }

    // Collect all orders
    const allOrders = batches.flatMap(b => b.orders);

    if (allOrders.length > this.batchSettings.maxBatchSize) {
      throw new Error('Merged batch would exceed maximum size');
    }

    // Create merged batch
    const mergedBatch = await this.createBatch(
      allOrders.map(o => o.id),
      'proximity'
    );

    // Delete original batches
    for (const batchId of batchIds) {
      await this.dissolveBatch(batchId);
    }

    return mergedBatch;
  }

  async updateBatchStatus(batchId: string, status: string, driverId?: string) {
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid batch status');
    }

    const updateData: any = {
      status,
      updated_at: new Date(),
    };

    if (status === 'assigned' && driverId) {
      updateData.driver_id = driverId;
      updateData.assigned_at = new Date();
    }

    if (status === 'completed') {
      updateData.completed_at = new Date();
    }

    await prisma.reskflowBatch.update({
      where: { id: batchId },
      data: updateData,
    });

    // Update order statuses
    if (status === 'assigned') {
      await prisma.order.updateMany({
        where: { batch_id: batchId },
        data: {
          status: 'assigned',
          driver_assigned_at: new Date(),
        },
      });
    }
  }

  async getBatchDetails(batchId: string) {
    const batch = await prisma.reskflowBatch.findUnique({
      where: { id: batchId },
      include: {
        orders: {
          include: {
            merchant: true,
            reskflow_address: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
        driver: true,
      },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    // Get route from cache
    const routeData = await redis.get(`batch:${batchId}:route`);
    const route = routeData ? JSON.parse(routeData) : null;

    return {
      ...batch,
      route,
    };
  }

  async getActiveBatches() {
    return prisma.reskflowBatch.findMany({
      where: {
        status: { in: ['pending', 'assigned', 'in_progress'] },
      },
      include: {
        orders: true,
        driver: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  async runScheduledOptimization() {
    if (!this.batchSettings.batchingEnabled) {
      logger.info('Batching is disabled');
      return;
    }

    // Get zones with pending orders
    const zonesWithOrders = await prisma.$queryRaw`
      SELECT DISTINCT m.zone_id, COUNT(o.id) as order_count
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.status = 'confirmed'
        AND o.batch_id IS NULL
      GROUP BY m.zone_id
      HAVING COUNT(o.id) >= ${this.batchSettings.minBatchSize}
    `;

    for (const zone of zonesWithOrders as any[]) {
      await this.batchQueue.add('auto-batch', {
        type: 'auto_batch',
        metadata: {
          zoneId: zone.zone_id,
          orderCount: zone.order_count,
        },
      });
    }
  }

  async updateBatchSettings(settings: any) {
    this.batchSettings = {
      ...this.batchSettings,
      ...settings,
    };

    // Store in Redis
    await redis.set('batch_settings', JSON.stringify(this.batchSettings));

    return this.batchSettings;
  }

  private async executeBatchCreation(orderIds: string[], strategy: string) {
    return this.createBatch(orderIds, strategy);
  }

  private async executeBatchOptimization(batchId: string) {
    return this.optimizeBatch(batchId);
  }

  private async executeAutoBatching(metadata: any) {
    const { zoneId } = metadata;

    // Get batch suggestions for zone
    const suggestions = await this.getBatchSuggestions(
      zoneId,
      this.batchSettings.maxBatchSize
    );

    // Create batches from top suggestions
    const createdBatches = [];
    const usedOrderIds = new Set<string>();

    for (const suggestion of suggestions) {
      // Skip if any order already used
      if (suggestion.orderIds.some(id => usedOrderIds.has(id))) {
        continue;
      }

      // Create batch if score is high enough
      if (suggestion.score > 0.7) {
        const batch = await this.createBatch(suggestion.orderIds, 'proximity');
        createdBatches.push(batch);
        
        suggestion.orderIds.forEach(id => usedOrderIds.add(id));
      }
    }

    logger.info(`Auto-created ${createdBatches.length} batches in zone ${zoneId}`);
    return createdBatches;
  }

  private calculateBatchScore(orders: any[], feasibility: any): number {
    let score = 0;

    // Savings weight (40%)
    score += (feasibility.savingsPercentage / 100) * 0.4;

    // Size efficiency (20%)
    const sizeScore = orders.length / this.batchSettings.maxBatchSize;
    score += sizeScore * 0.2;

    // Time efficiency (20%)
    const timeScore = 1 - (feasibility.estimatedDuration / this.batchSettings.maxDeliveryTime);
    score += Math.max(0, timeScore) * 0.2;

    // Merchant diversity (10%)
    const uniqueMerchants = new Set(orders.map(o => o.merchant_id)).size;
    const diversityScore = 1 - ((uniqueMerchants - 1) / orders.length);
    score += diversityScore * 0.1;

    // Customer proximity (10%)
    const proximityScore = feasibility.customerProximityScore || 0.5;
    score += proximityScore * 0.1;

    return Math.min(1, Math.max(0, score));
  }

  private generateBatchReason(orders: any[], feasibility: any): string {
    const reasons = [];

    if (feasibility.savingsPercentage > 30) {
      reasons.push(`High savings potential (${Math.round(feasibility.savingsPercentage)}%)`);
    }

    const uniqueMerchants = new Set(orders.map(o => o.merchant_id)).size;
    if (uniqueMerchants === 1) {
      reasons.push('Same merchant pickup');
    } else if (uniqueMerchants <= 2) {
      reasons.push('Nearby merchant pickups');
    }

    if (feasibility.estimatedDuration < 30) {
      reasons.push('Quick reskflow route');
    }

    if (orders.length >= 4) {
      reasons.push('Efficient batch size');
    }

    return reasons.join(', ') || 'Good batching opportunity';
  }

  private splitEqual(orders: any[]): any[][] {
    const groupSize = Math.ceil(orders.length / 2);
    return [
      orders.slice(0, groupSize),
      orders.slice(groupSize),
    ];
  }

  private splitByTimeWindow(orders: any[]): any[][] {
    // Group by reskflow time preferences
    const groups: { [key: string]: any[] } = {};

    orders.forEach(order => {
      const timeWindow = order.reskflow_time_window?.start 
        ? new Date(order.reskflow_time_window.start).getHours()
        : 'asap';
      
      if (!groups[timeWindow]) {
        groups[timeWindow] = [];
      }
      groups[timeWindow].push(order);
    });

    return Object.values(groups);
  }

  private async dissolveBatch(batchId: string) {
    // Unbatch all orders
    await prisma.order.updateMany({
      where: { batch_id: batchId },
      data: { batch_id: null },
    });

    // Delete batch
    await prisma.reskflowBatch.delete({
      where: { id: batchId },
    });

    // Clear cache
    await redis.del(`batch:${batchId}:route`);
  }
}