import { prisma, logger, redis } from '@reskflow/shared';
import dayjs from 'dayjs';

interface BatchMetrics {
  batchId: string;
  orderCount: number;
  completedOrders: number;
  currentStatus: string;
  assignedDriver?: {
    id: string;
    name: string;
    currentLocation?: {
      latitude: number;
      longitude: number;
    };
  };
  progress: {
    pickupsCompleted: number;
    deliveriesCompleted: number;
    totalStops: number;
    percentageComplete: number;
  };
  timing: {
    createdAt: Date;
    assignedAt?: Date;
    firstPickupAt?: Date;
    lastDeliveryAt?: Date;
    estimatedCompletionTime?: Date;
    actualDuration?: number;
  };
  performance: {
    plannedDistance: number;
    actualDistance?: number;
    plannedDuration: number;
    actualDuration?: number;
    onTimeDeliveries: number;
    lateDeliveries: number;
  };
}

interface BatchingEfficiency {
  period: string;
  totalBatches: number;
  totalOrders: number;
  averageOrdersPerBatch: number;
  batchingRate: number;
  successRate: number;
  averageSavings: number;
  totalDistanceSaved: number;
  totalTimeSaved: number;
}

interface BatchTracking {
  batchId: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    timestamp: Date;
  };
  completedStops: Array<{
    nodeId: string;
    type: 'pickup' | 'reskflow';
    orderId: string;
    completedAt: Date;
    location: {
      latitude: number;
      longitude: number;
    };
  }>;
  upcomingStops: Array<{
    nodeId: string;
    type: 'pickup' | 'reskflow';
    orderId: string;
    estimatedArrival: Date;
    location: {
      latitude: number;
      longitude: number;
    };
    address: string;
  }>;
  currentStop?: {
    nodeId: string;
    type: 'pickup' | 'reskflow';
    orderId: string;
    arrivedAt?: Date;
  };
}

export class BatchMonitoringService {
  async getBatchMetrics(batchId: string): Promise<BatchMetrics> {
    const batch = await prisma.reskflowBatch.findUnique({
      where: { id: batchId },
      include: {
        orders: {
          include: {
            reskflow: true,
          },
        },
        driver: true,
      },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    // Calculate progress
    const pickupsCompleted = batch.orders.filter(
      o => o.reskflow && ['picked_up', 'in_transit', 'delivered'].includes(o.reskflow.status)
    ).length;

    const deliveriesCompleted = batch.orders.filter(
      o => o.reskflow && o.reskflow.status === 'delivered'
    ).length;

    const totalStops = batch.orders.length * 2; // Pickup + reskflow for each order
    const completedStops = pickupsCompleted + deliveriesCompleted;
    const percentageComplete = (completedStops / totalStops) * 100;

    // Get timing information
    const firstPickup = batch.orders
      .filter(o => o.reskflow?.picked_up_at)
      .sort((a, b) => a.reskflow!.picked_up_at!.getTime() - b.reskflow!.picked_up_at!.getTime())[0];

    const lastDelivery = batch.orders
      .filter(o => o.reskflow?.delivered_at)
      .sort((a, b) => b.reskflow!.delivered_at!.getTime() - a.reskflow!.delivered_at!.getTime())[0];

    // Calculate performance
    const onTimeDeliveries = batch.orders.filter(o => {
      if (!o.reskflow?.delivered_at || !o.reskflow.estimated_reskflow_time) return false;
      return o.reskflow.delivered_at <= o.reskflow.estimated_reskflow_time;
    }).length;

    const lateDeliveries = deliveriesCompleted - onTimeDeliveries;

    // Get driver location if available
    let driverLocation;
    if (batch.driver_id) {
      const driverStatus = await redis.get(`driver:${batch.driver_id}:location`);
      if (driverStatus) {
        driverLocation = JSON.parse(driverStatus);
      }
    }

    // Calculate actual distance if in progress
    let actualDistance;
    if (batch.driver_id) {
      const distanceData = await redis.get(`batch:${batchId}:distance`);
      if (distanceData) {
        actualDistance = parseFloat(distanceData);
      }
    }

    return {
      batchId,
      orderCount: batch.order_count,
      completedOrders: deliveriesCompleted,
      currentStatus: batch.status,
      assignedDriver: batch.driver ? {
        id: batch.driver.id,
        name: batch.driver.name,
        currentLocation: driverLocation,
      } : undefined,
      progress: {
        pickupsCompleted,
        deliveriesCompleted,
        totalStops,
        percentageComplete,
      },
      timing: {
        createdAt: batch.created_at,
        assignedAt: batch.assigned_at || undefined,
        firstPickupAt: firstPickup?.reskflow?.picked_up_at || undefined,
        lastDeliveryAt: lastDelivery?.reskflow?.delivered_at || undefined,
        estimatedCompletionTime: this.calculateEstimatedCompletion(batch),
        actualDuration: batch.completed_at 
          ? batch.completed_at.getTime() - batch.created_at.getTime() 
          : undefined,
      },
      performance: {
        plannedDistance: batch.total_distance,
        actualDistance,
        plannedDuration: batch.estimated_duration,
        actualDuration: batch.completed_at && batch.assigned_at
          ? (batch.completed_at.getTime() - batch.assigned_at.getTime()) / 1000 / 60
          : undefined,
        onTimeDeliveries,
        lateDeliveries,
      },
    };
  }

  async getBatchingEfficiency(
    startDate?: string,
    endDate?: string
  ): Promise<BatchingEfficiency> {
    const start = startDate ? new Date(startDate) : dayjs().subtract(7, 'day').toDate();
    const end = endDate ? new Date(endDate) : new Date();

    // Get all batches in period
    const batches = await prisma.reskflowBatch.findMany({
      where: {
        created_at: {
          gte: start,
          lte: end,
        },
      },
      include: {
        orders: true,
      },
    });

    // Get total orders in period
    const totalOrdersInPeriod = await prisma.order.count({
      where: {
        created_at: {
          gte: start,
          lte: end,
        },
      },
    });

    const batchedOrders = batches.reduce((sum, b) => sum + b.order_count, 0);
    const batchingRate = totalOrdersInPeriod > 0 
      ? (batchedOrders / totalOrdersInPeriod) * 100 
      : 0;

    // Calculate success rate
    const completedBatches = batches.filter(b => b.status === 'completed').length;
    const successRate = batches.length > 0 
      ? (completedBatches / batches.length) * 100 
      : 0;

    // Calculate savings
    const totalSavings = batches.reduce((sum, b) => sum + (b.savings_percentage || 0), 0);
    const averageSavings = batches.length > 0 
      ? totalSavings / batches.length 
      : 0;

    // Calculate distance saved
    const totalDistanceSaved = batches.reduce((sum, b) => {
      const individualDistance = b.order_count * b.total_distance * 1.5; // Estimate
      return sum + (individualDistance - b.total_distance);
    }, 0);

    // Calculate time saved
    const totalTimeSaved = batches.reduce((sum, b) => {
      const individualTime = b.order_count * b.estimated_duration * 1.5; // Estimate
      return sum + (individualTime - b.estimated_duration);
    }, 0);

    return {
      period: `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
      totalBatches: batches.length,
      totalOrders: batchedOrders,
      averageOrdersPerBatch: batches.length > 0 
        ? batchedOrders / batches.length 
        : 0,
      batchingRate,
      successRate,
      averageSavings,
      totalDistanceSaved: totalDistanceSaved / 1000, // Convert to km
      totalTimeSaved: totalTimeSaved / 60, // Convert to hours
    };
  }

  async calculateSavings(period: string = '7d'): Promise<any> {
    const days = parseInt(period) || 7;
    const startDate = dayjs().subtract(days, 'day').toDate();

    const batches = await prisma.reskflowBatch.findMany({
      where: {
        created_at: { gte: startDate },
        status: 'completed',
      },
    });

    // Calculate various savings metrics
    const fuelSavings = batches.reduce((sum, b) => {
      const distanceSaved = (b.order_count * b.total_distance * 0.5) / 1000; // km
      const fuelPerKm = 0.08; // liters
      const fuelPrice = 1.5; // $ per liter
      return sum + (distanceSaved * fuelPerKm * fuelPrice);
    }, 0);

    const timeSavings = batches.reduce((sum, b) => {
      return sum + (b.order_count - 1) * 20; // 20 min saved per batched order
    }, 0);

    const emissionsSaved = batches.reduce((sum, b) => {
      const distanceSaved = (b.order_count * b.total_distance * 0.5) / 1000; // km
      const co2PerKm = 0.12; // kg CO2 per km
      return sum + (distanceSaved * co2PerKm);
    }, 0);

    const driverCostSavings = (timeSavings / 60) * 15; // $15/hour driver cost

    return {
      period,
      totalBatches: batches.length,
      financial: {
        fuelSavings: Math.round(fuelSavings * 100) / 100,
        driverCostSavings: Math.round(driverCostSavings * 100) / 100,
        totalSavings: Math.round((fuelSavings + driverCostSavings) * 100) / 100,
      },
      environmental: {
        co2Saved: Math.round(emissionsSaved * 100) / 100, // kg
        equivalentTrees: Math.round(emissionsSaved / 21), // 1 tree absorbs 21kg CO2/year
      },
      operational: {
        timeSaved: Math.round(timeSavings / 60 * 10) / 10, // hours
        deliveriesOptimized: batches.reduce((sum, b) => sum + b.order_count, 0),
        averageEfficiencyGain: batches.length > 0
          ? Math.round(batches.reduce((sum, b) => sum + b.savings_percentage, 0) / batches.length)
          : 0,
      },
    };
  }

  async getBatchTracking(batchId: string): Promise<BatchTracking> {
    const batch = await prisma.reskflowBatch.findUnique({
      where: { id: batchId },
      include: {
        orders: {
          include: {
            reskflow: true,
            merchant: true,
            reskflow_address: true,
          },
        },
      },
    });

    if (!batch) {
      throw new Error('Batch not found');
    }

    // Get route from cache
    const routeData = await redis.get(`batch:${batchId}:route`);
    if (!routeData) {
      throw new Error('Route not found');
    }

    const route = JSON.parse(routeData);
    
    // Get current driver location
    let currentLocation;
    if (batch.driver_id) {
      const locationData = await redis.get(`driver:${batch.driver_id}:location`);
      if (locationData) {
        currentLocation = JSON.parse(locationData);
      }
    }

    // Build tracking data
    const completedStops: any[] = [];
    const upcomingStops: any[] = [];
    let currentStop;

    for (const node of route.nodes) {
      if (node.type === 'start') continue;

      const order = batch.orders.find(o => o.id === node.orderId);
      if (!order) continue;

      const stopData = {
        nodeId: node.id,
        type: node.type,
        orderId: node.orderId,
        location: node.location,
        address: node.address,
      };

      // Determine if stop is completed
      if (node.type === 'pickup' && order.reskflow?.picked_up_at) {
        completedStops.push({
          ...stopData,
          completedAt: order.reskflow.picked_up_at,
        });
      } else if (node.type === 'reskflow' && order.reskflow?.delivered_at) {
        completedStops.push({
          ...stopData,
          completedAt: order.reskflow.delivered_at,
        });
      } else {
        // Check if this is the current stop
        const isCurrentStop = await this.isCurrentStop(
          node,
          order,
          currentLocation
        );

        if (isCurrentStop) {
          currentStop = {
            ...stopData,
            arrivedAt: order.reskflow?.arrived_at_pickup || 
                      order.reskflow?.arrived_at_reskflow,
          };
        } else {
          upcomingStops.push({
            ...stopData,
            estimatedArrival: node.estimatedArrival,
          });
        }
      }
    }

    return {
      batchId,
      currentLocation: currentLocation ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        timestamp: new Date(currentLocation.timestamp),
      } : undefined,
      completedStops,
      upcomingStops,
      currentStop,
    };
  }

  private calculateEstimatedCompletion(batch: any): Date | undefined {
    if (batch.status === 'completed') {
      return batch.completed_at;
    }

    if (!batch.assigned_at) {
      return undefined;
    }

    // Estimate based on planned duration and progress
    const elapsedTime = Date.now() - batch.assigned_at.getTime();
    const remainingDuration = Math.max(
      0,
      batch.estimated_duration * 60 * 1000 - elapsedTime
    );

    return new Date(Date.now() + remainingDuration);
  }

  private async isCurrentStop(
    node: any,
    order: any,
    currentLocation?: any
  ): Promise<boolean> {
    if (!currentLocation) return false;

    // Check if driver is near this stop
    const distance = this.calculateDistance(
      currentLocation,
      node.location
    );

    // Within 200 meters and not completed
    if (distance < 200) {
      if (node.type === 'pickup' && !order.reskflow?.picked_up_at) {
        return true;
      }
      if (node.type === 'reskflow' && 
          order.reskflow?.picked_up_at && 
          !order.reskflow?.delivered_at) {
        return true;
      }
    }

    return false;
  }

  private calculateDistance(
    point1: { latitude: number; longitude: number },
    point2: { latitude: number; longitude: number }
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = point1.latitude * Math.PI / 180;
    const φ2 = point2.latitude * Math.PI / 180;
    const Δφ = (point2.latitude - point1.latitude) * Math.PI / 180;
    const Δλ = (point2.longitude - point1.longitude) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}