import { logger } from '@reskflow/shared';
import * as geolib from 'geolib';
import * as turf from '@turf/turf';
import { kmeans } from 'ml-kmeans';

interface Order {
  id: string;
  merchant: {
    id: string;
    latitude: number;
    longitude: number;
  };
  reskflow_address: {
    latitude: number;
    longitude: number;
  };
  created_at: Date;
  reskflow_time_window?: {
    start: Date;
    end: Date;
  };
  items_count: number;
  total_weight?: number;
}

interface BatchFeasibility {
  feasible: boolean;
  reason?: string;
  totalDistance: number;
  estimatedDuration: number;
  savingsPercentage: number;
  customerProximityScore?: number;
}

export class BatchGroupingService {
  private readonly MAX_PICKUP_RADIUS = 2000; // meters
  private readonly MAX_DELIVERY_RADIUS = 3000; // meters
  private readonly MAX_DELIVERY_TIME = 60; // minutes
  private readonly MIN_SAVINGS_THRESHOLD = 15; // percentage

  async findOptimalGroups(
    orders: Order[],
    maxBatchSize: number
  ): Promise<Order[][]> {
    if (orders.length < 2) {
      return orders.map(o => [o]);
    }

    // Try multiple grouping strategies and pick the best
    const strategies = [
      () => this.groupByProximity(orders, maxBatchSize),
      () => this.groupByMerchant(orders, maxBatchSize),
      () => this.groupByClustering(orders, maxBatchSize),
      () => this.groupByTimeWindow(orders, maxBatchSize),
    ];

    const allGroups = await Promise.all(strategies.map(s => s()));
    
    // Score each grouping and pick the best
    let bestGroups: Order[][] = [];
    let bestScore = -Infinity;

    for (const groups of allGroups) {
      const score = await this.scoreGrouping(groups);
      if (score > bestScore) {
        bestScore = score;
        bestGroups = groups;
      }
    }

    return bestGroups;
  }

  async checkBatchFeasibility(orders: Order[]): Promise<BatchFeasibility> {
    if (orders.length < 2) {
      return {
        feasible: false,
        reason: 'Batch requires at least 2 orders',
        totalDistance: 0,
        estimatedDuration: 0,
        savingsPercentage: 0,
      };
    }

    // Check pickup proximity
    const pickupCentroid = this.calculateCentroid(
      orders.map(o => ({
        latitude: o.merchant.latitude,
        longitude: o.merchant.longitude,
      }))
    );

    const maxPickupDistance = Math.max(
      ...orders.map(o =>
        geolib.getDistance(pickupCentroid, {
          latitude: o.merchant.latitude,
          longitude: o.merchant.longitude,
        })
      )
    );

    if (maxPickupDistance > this.MAX_PICKUP_RADIUS) {
      return {
        feasible: false,
        reason: 'Pickup locations too spread out',
        totalDistance: 0,
        estimatedDuration: 0,
        savingsPercentage: 0,
      };
    }

    // Check reskflow proximity
    const reskflowCentroid = this.calculateCentroid(
      orders.map(o => ({
        latitude: o.reskflow_address.latitude,
        longitude: o.reskflow_address.longitude,
      }))
    );

    const maxDeliveryDistance = Math.max(
      ...orders.map(o =>
        geolib.getDistance(reskflowCentroid, {
          latitude: o.reskflow_address.latitude,
          longitude: o.reskflow_address.longitude,
        })
      )
    );

    if (maxDeliveryDistance > this.MAX_DELIVERY_RADIUS) {
      return {
        feasible: false,
        reason: 'Delivery locations too spread out',
        totalDistance: 0,
        estimatedDuration: 0,
        savingsPercentage: 0,
      };
    }

    // Check time windows compatibility
    const timeWindowsCompatible = this.checkTimeWindowsCompatibility(orders);
    if (!timeWindowsCompatible) {
      return {
        feasible: false,
        reason: 'Delivery time windows not compatible',
        totalDistance: 0,
        estimatedDuration: 0,
        savingsPercentage: 0,
      };
    }

    // Calculate route metrics
    const { batchDistance, individualDistance } = await this.calculateRouteDistances(orders);
    const estimatedDuration = this.estimateDeliveryDuration(orders, batchDistance);
    const savingsPercentage = ((individualDistance - batchDistance) / individualDistance) * 100;

    if (estimatedDuration > this.MAX_DELIVERY_TIME) {
      return {
        feasible: false,
        reason: 'Estimated reskflow time too long',
        totalDistance: batchDistance,
        estimatedDuration,
        savingsPercentage,
      };
    }

    if (savingsPercentage < this.MIN_SAVINGS_THRESHOLD) {
      return {
        feasible: false,
        reason: 'Insufficient savings from batching',
        totalDistance: batchDistance,
        estimatedDuration,
        savingsPercentage,
      };
    }

    // Calculate customer proximity score
    const customerProximityScore = this.calculateCustomerProximityScore(orders);

    return {
      feasible: true,
      totalDistance: batchDistance,
      estimatedDuration,
      savingsPercentage,
      customerProximityScore,
    };
  }

  async splitByGeography(orders: Order[]): Promise<Order[][]> {
    if (orders.length <= 2) {
      return [orders];
    }

    // Use k-means clustering on reskflow locations
    const points = orders.map(o => [
      o.reskflow_address.latitude,
      o.reskflow_address.longitude,
    ]);

    const k = Math.min(Math.ceil(orders.length / 3), 3);
    const clusters = kmeans(points, k);

    const groups: Order[][] = Array(k).fill(null).map(() => []);
    
    orders.forEach((order, index) => {
      groups[clusters.clusters[index]].push(order);
    });

    return groups.filter(g => g.length > 0);
  }

  private async groupByProximity(
    orders: Order[],
    maxBatchSize: number
  ): Promise<Order[][]> {
    const groups: Order[][] = [];
    const used = new Set<string>();

    for (const order of orders) {
      if (used.has(order.id)) continue;

      const group = [order];
      used.add(order.id);

      // Find nearby orders
      for (const other of orders) {
        if (used.has(other.id) || group.length >= maxBatchSize) continue;

        const pickupDistance = geolib.getDistance(
          {
            latitude: order.merchant.latitude,
            longitude: order.merchant.longitude,
          },
          {
            latitude: other.merchant.latitude,
            longitude: other.merchant.longitude,
          }
        );

        const reskflowDistance = geolib.getDistance(
          {
            latitude: order.reskflow_address.latitude,
            longitude: order.reskflow_address.longitude,
          },
          {
            latitude: other.reskflow_address.latitude,
            longitude: other.reskflow_address.longitude,
          }
        );

        if (
          pickupDistance < this.MAX_PICKUP_RADIUS / 2 &&
          reskflowDistance < this.MAX_DELIVERY_RADIUS / 2
        ) {
          group.push(other);
          used.add(other.id);
        }
      }

      if (group.length >= 2) {
        groups.push(group);
      } else {
        // Return single order to pool
        used.delete(order.id);
      }
    }

    return groups;
  }

  private groupByMerchant(
    orders: Order[],
    maxBatchSize: number
  ): Promise<Order[][]> {
    const merchantGroups: { [key: string]: Order[] } = {};

    // Group by merchant
    orders.forEach(order => {
      if (!merchantGroups[order.merchant.id]) {
        merchantGroups[order.merchant.id] = [];
      }
      merchantGroups[order.merchant.id].push(order);
    });

    const groups: Order[][] = [];

    // Split large merchant groups
    Object.values(merchantGroups).forEach(merchantOrders => {
      if (merchantOrders.length <= maxBatchSize) {
        if (merchantOrders.length >= 2) {
          groups.push(merchantOrders);
        }
      } else {
        // Split into smaller groups
        for (let i = 0; i < merchantOrders.length; i += maxBatchSize) {
          const subgroup = merchantOrders.slice(i, i + maxBatchSize);
          if (subgroup.length >= 2) {
            groups.push(subgroup);
          }
        }
      }
    });

    return Promise.resolve(groups);
  }

  private async groupByClustering(
    orders: Order[],
    maxBatchSize: number
  ): Promise<Order[][]> {
    if (orders.length < 4) {
      return [orders];
    }

    // Create feature vectors for clustering
    const features = orders.map(o => [
      o.merchant.latitude,
      o.merchant.longitude,
      o.reskflow_address.latitude,
      o.reskflow_address.longitude,
    ]);

    // Determine optimal number of clusters
    const k = Math.ceil(orders.length / maxBatchSize);
    const clusters = kmeans(features, k, {
      initialization: 'kmeans++',
    });

    const groups: Order[][] = Array(k).fill(null).map(() => []);
    
    orders.forEach((order, index) => {
      const clusterIndex = clusters.clusters[index];
      if (groups[clusterIndex].length < maxBatchSize) {
        groups[clusterIndex].push(order);
      }
    });

    return groups.filter(g => g.length >= 2);
  }

  private groupByTimeWindow(
    orders: Order[],
    maxBatchSize: number
  ): Promise<Order[][]> {
    const timeGroups: { [key: string]: Order[] } = {};

    orders.forEach(order => {
      const timeKey = order.reskflow_time_window
        ? `${order.reskflow_time_window.start.getHours()}-${order.reskflow_time_window.end.getHours()}`
        : 'asap';
      
      if (!timeGroups[timeKey]) {
        timeGroups[timeKey] = [];
      }
      timeGroups[timeKey].push(order);
    });

    const groups: Order[][] = [];

    Object.values(timeGroups).forEach(timeOrders => {
      // Further group by proximity within time window
      const proximityGroups = this.groupByProximity(timeOrders, maxBatchSize);
      groups.push(...proximityGroups);
    });

    return Promise.resolve(groups);
  }

  private async scoreGrouping(groups: Order[][]): Promise<number> {
    let totalScore = 0;
    let totalOrders = 0;

    for (const group of groups) {
      if (group.length < 2) continue;

      const feasibility = await this.checkBatchFeasibility(group);
      if (feasibility.feasible) {
        // Score based on savings and group size
        const groupScore = 
          (feasibility.savingsPercentage / 100) * 0.5 +
          (group.length / 5) * 0.3 +
          (feasibility.customerProximityScore || 0.5) * 0.2;
        
        totalScore += groupScore * group.length;
        totalOrders += group.length;
      }
    }

    return totalOrders > 0 ? totalScore / totalOrders : 0;
  }

  private calculateCentroid(points: { latitude: number; longitude: number }[]) {
    const sumLat = points.reduce((sum, p) => sum + p.latitude, 0);
    const sumLng = points.reduce((sum, p) => sum + p.longitude, 0);
    
    return {
      latitude: sumLat / points.length,
      longitude: sumLng / points.length,
    };
  }

  private checkTimeWindowsCompatibility(orders: Order[]): boolean {
    // Get the earliest and latest time windows
    let earliestEnd = Infinity;
    let latestStart = -Infinity;

    for (const order of orders) {
      if (order.reskflow_time_window) {
        const start = order.reskflow_time_window.start.getTime();
        const end = order.reskflow_time_window.end.getTime();
        
        earliestEnd = Math.min(earliestEnd, end);
        latestStart = Math.max(latestStart, start);
      }
    }

    // Check if there's overlap
    return earliestEnd >= latestStart;
  }

  private async calculateRouteDistances(orders: Order[]) {
    // Calculate individual distances
    let individualDistance = 0;
    
    for (const order of orders) {
      // Distance to pickup + reskflow
      individualDistance += geolib.getDistance(
        { latitude: 0, longitude: 0 }, // Depot placeholder
        {
          latitude: order.merchant.latitude,
          longitude: order.merchant.longitude,
        }
      );
      
      individualDistance += geolib.getDistance(
        {
          latitude: order.merchant.latitude,
          longitude: order.merchant.longitude,
        },
        {
          latitude: order.reskflow_address.latitude,
          longitude: order.reskflow_address.longitude,
        }
      );
    }

    // Calculate batched distance using TSP approximation
    const pickupPoints = orders.map(o => ({
      latitude: o.merchant.latitude,
      longitude: o.merchant.longitude,
    }));
    
    const reskflowPoints = orders.map(o => ({
      latitude: o.reskflow_address.latitude,
      longitude: o.reskflow_address.longitude,
    }));

    const batchDistance = this.approximateTSPDistance(
      [...pickupPoints, ...reskflowPoints]
    );

    return { batchDistance, individualDistance };
  }

  private approximateTSPDistance(points: { latitude: number; longitude: number }[]): number {
    // Simple nearest neighbor heuristic
    let totalDistance = 0;
    const visited = new Set<number>();
    let current = 0;

    while (visited.size < points.length - 1) {
      visited.add(current);
      let nearest = -1;
      let nearestDistance = Infinity;

      for (let i = 0; i < points.length; i++) {
        if (!visited.has(i)) {
          const distance = geolib.getDistance(points[current], points[i]);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = i;
          }
        }
      }

      if (nearest !== -1) {
        totalDistance += nearestDistance;
        current = nearest;
      }
    }

    return totalDistance;
  }

  private estimateDeliveryDuration(orders: Order[], distance: number): number {
    // Base travel time (30 km/h average)
    const travelTime = (distance / 1000) / 30 * 60; // minutes

    // Service time per stop
    const pickupTime = 5 * orders.length; // 5 min per pickup
    const reskflowTime = 3 * orders.length; // 3 min per reskflow

    return travelTime + pickupTime + reskflowTime;
  }

  private calculateCustomerProximityScore(orders: Order[]): number {
    // Calculate how close reskflow addresses are to each other
    const reskflowPoints = orders.map(o => ({
      latitude: o.reskflow_address.latitude,
      longitude: o.reskflow_address.longitude,
    }));

    let totalDistance = 0;
    let count = 0;

    for (let i = 0; i < reskflowPoints.length; i++) {
      for (let j = i + 1; j < reskflowPoints.length; j++) {
        totalDistance += geolib.getDistance(reskflowPoints[i], reskflowPoints[j]);
        count++;
      }
    }

    const avgDistance = count > 0 ? totalDistance / count : 0;
    
    // Normalize to 0-1 score (closer is better)
    return Math.max(0, 1 - avgDistance / this.MAX_DELIVERY_RADIUS);
  }
}