import { prisma, logger, redis } from '@reskflow/shared';
import * as geolib from 'geolib';
import * as turf from '@turf/turf';

interface RouteNode {
  id: string;
  type: 'pickup' | 'reskflow';
  orderId: string;
  location: {
    latitude: number;
    longitude: number;
  };
  timeWindow?: {
    start: Date;
    end: Date;
  };
  serviceDuration: number; // in seconds
}

interface OptimizedRoute {
  driverId: string;
  nodes: RouteNode[];
  totalDistance: number;
  totalDuration: number;
  estimatedCompletionTime: Date;
  savings: number; // compared to individual routes
}

interface BatchAssignment {
  orderId: string;
  driverId: string;
  sequence: number;
  estimatedPickupTime: Date;
  estimatedDeliveryTime: Date;
}

export class OptimizationService {
  async processOptimizationJob(job: any) {
    logger.info(`Processing optimization job: ${job.type}`);

    try {
      switch (job.type) {
        case 'optimize_driver_route':
          return await this.optimizeDriverRoute(job.driverId);
        case 'optimize_zone':
          return await this.optimizeZoneAssignments(job.zoneId);
        case 'rebalance_drivers':
          return await this.rebalanceDrivers(job.zones);
        default:
          throw new Error(`Unknown optimization job type: ${job.type}`);
      }
    } catch (error) {
      logger.error(`Optimization job failed: ${job.type}`, error);
      throw error;
    }
  }

  async optimizeRoute(driverId: string, orderIds: string[]): Promise<OptimizedRoute> {
    // Get driver's current location
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    });

    if (!driver || !driver.current_location) {
      throw new Error('Driver not found or location unavailable');
    }

    // Get order details
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        merchant: true,
        reskflow_address: true,
      },
    });

    // Create route nodes
    const nodes: RouteNode[] = [];
    
    // Add current driver location as starting point
    const startNode: RouteNode = {
      id: 'start',
      type: 'pickup',
      orderId: '',
      location: {
        latitude: driver.current_location.coordinates[1],
        longitude: driver.current_location.coordinates[0],
      },
      serviceDuration: 0,
    };

    // Add pickup and reskflow nodes for each order
    orders.forEach(order => {
      nodes.push({
        id: `pickup-${order.id}`,
        type: 'pickup',
        orderId: order.id,
        location: {
          latitude: order.merchant.latitude,
          longitude: order.merchant.longitude,
        },
        timeWindow: order.pickup_time_window ? {
          start: order.pickup_time_window.start,
          end: order.pickup_time_window.end,
        } : undefined,
        serviceDuration: 300, // 5 minutes
      });

      nodes.push({
        id: `reskflow-${order.id}`,
        type: 'reskflow',
        orderId: order.id,
        location: {
          latitude: order.reskflow_address.latitude,
          longitude: order.reskflow_address.longitude,
        },
        timeWindow: order.reskflow_time_window ? {
          start: order.reskflow_time_window.start,
          end: order.reskflow_time_window.end,
        } : undefined,
        serviceDuration: 180, // 3 minutes
      });
    });

    // Optimize route using nearest neighbor with constraints
    const optimizedNodes = await this.optimizeWithConstraints(startNode, nodes);

    // Calculate metrics
    const { distance, duration } = this.calculateRouteMetrics(optimizedNodes);

    // Calculate savings compared to individual routes
    const individualDistance = await this.calculateIndividualRoutesDistance(
      startNode.location,
      orders
    );
    const savings = ((individualDistance - distance) / individualDistance) * 100;

    return {
      driverId,
      nodes: optimizedNodes.slice(1), // Remove start node
      totalDistance: distance,
      totalDuration: duration,
      estimatedCompletionTime: new Date(Date.now() + duration * 1000),
      savings,
    };
  }

  async canBatchOrder(
    driverId: string,
    currentAssignments: any[],
    newOrder: any
  ): Promise<boolean> {
    // Check if adding this order to driver's route is efficient
    
    // Get current route distance
    const currentDistance = await this.calculateCurrentRouteDistance(
      driverId,
      currentAssignments
    );

    // Calculate distance with new order
    const orderIds = currentAssignments.map(a => a.orderId);
    orderIds.push(newOrder.id);
    
    const optimizedRoute = await this.optimizeRoute(driverId, orderIds);

    // Check if the increase is acceptable (less than 20% increase)
    const distanceIncrease = optimizedRoute.totalDistance - currentDistance;
    const percentageIncrease = (distanceIncrease / currentDistance) * 100;

    // Also check time constraints
    const canMeetTimeWindows = await this.checkTimeWindows(optimizedRoute);

    return percentageIncrease < 20 && canMeetTimeWindows;
  }

  async optimizeBatchAssignment(orderIds: string[]): Promise<BatchAssignment[]> {
    // Get all available drivers and their locations
    const availableDrivers = await prisma.driver.findMany({
      where: {
        status: 'online',
        is_available: true,
      },
    });

    // Get all orders
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        merchant: true,
        reskflow_address: true,
      },
    });

    // Use a simple greedy algorithm for now
    const assignments: BatchAssignment[] = [];
    const assignedOrders = new Set<string>();
    
    // Group orders by proximity
    const orderClusters = this.clusterOrdersByLocation(orders);

    // Assign clusters to nearest available drivers
    for (const cluster of orderClusters) {
      if (cluster.length === 0) continue;

      // Find best driver for this cluster
      const bestDriver = await this.findBestDriverForCluster(
        cluster,
        availableDrivers,
        assignedOrders
      );

      if (bestDriver) {
        // Optimize route for this driver and cluster
        const clusterOrderIds = cluster.map(o => o.id);
        const optimizedRoute = await this.optimizeRoute(
          bestDriver.id,
          clusterOrderIds
        );

        // Create assignments
        let sequence = 0;
        let currentTime = Date.now();
        
        for (const node of optimizedRoute.nodes) {
          if (node.type === 'reskflow') {
            assignments.push({
              orderId: node.orderId,
              driverId: bestDriver.id,
              sequence: sequence++,
              estimatedPickupTime: new Date(currentTime + 600000), // +10 min
              estimatedDeliveryTime: new Date(currentTime + 1800000), // +30 min
            });
            assignedOrders.add(node.orderId);
          }
        }
      }
    }

    return assignments;
  }

  async runPeriodicOptimization() {
    logger.info('Running periodic route optimization');

    // Get all active drivers with multiple deliveries
    const busyDrivers = await prisma.driver.findMany({
      where: {
        status: 'online',
        activeDeliveries: {
          some: {
            status: { in: ['assigned', 'picked_up'] },
          },
        },
      },
      include: {
        activeDeliveries: {
          include: {
            order: {
              include: {
                merchant: true,
                reskflow_address: true,
              },
            },
          },
        },
      },
    });

    // Optimize routes for drivers with 2+ deliveries
    for (const driver of busyDrivers) {
      if (driver.activeDeliveries.length >= 2) {
        const orderIds = driver.activeDeliveries.map(d => d.order_id);
        
        try {
          const optimizedRoute = await this.optimizeRoute(driver.id, orderIds);
          
          // Update reskflow sequence if significant improvement
          if (optimizedRoute.savings > 10) {
            await this.updateDeliverySequence(driver.id, optimizedRoute);
          }
        } catch (error) {
          logger.error(`Failed to optimize route for driver ${driver.id}`, error);
        }
      }
    }
  }

  private async optimizeWithConstraints(
    start: RouteNode,
    nodes: RouteNode[]
  ): Promise<RouteNode[]> {
    const route: RouteNode[] = [start];
    const unvisited = new Set(nodes);
    let current = start;

    // Track which orders have been picked up
    const pickedUpOrders = new Set<string>();

    while (unvisited.size > 0) {
      let nearest: RouteNode | null = null;
      let nearestDistance = Infinity;

      for (const node of unvisited) {
        // Check constraints
        if (node.type === 'reskflow' && !pickedUpOrders.has(node.orderId)) {
          continue; // Can't deliver before pickup
        }

        const distance = geolib.getDistance(
          current.location,
          node.location
        );

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = node;
        }
      }

      if (!nearest) {
        // No valid next node, might need to pick up an order first
        for (const node of unvisited) {
          if (node.type === 'pickup') {
            const distance = geolib.getDistance(
              current.location,
              node.location
            );
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearest = node;
            }
          }
        }
      }

      if (nearest) {
        route.push(nearest);
        unvisited.delete(nearest);
        current = nearest;

        if (nearest.type === 'pickup') {
          pickedUpOrders.add(nearest.orderId);
        }
      } else {
        break; // No more nodes can be added
      }
    }

    return route;
  }

  private calculateRouteMetrics(nodes: RouteNode[]): { distance: number; duration: number } {
    let totalDistance = 0;
    let totalDuration = 0;

    for (let i = 0; i < nodes.length - 1; i++) {
      const distance = geolib.getDistance(
        nodes[i].location,
        nodes[i + 1].location
      );
      totalDistance += distance;
      
      // Estimate travel time (30 km/h average)
      totalDuration += (distance / 8.33) + nodes[i + 1].serviceDuration;
    }

    return { distance: totalDistance, duration: totalDuration };
  }

  private async calculateIndividualRoutesDistance(
    startLocation: any,
    orders: any[]
  ): Promise<number> {
    let totalDistance = 0;

    for (const order of orders) {
      // Distance to pickup
      totalDistance += geolib.getDistance(
        startLocation,
        {
          latitude: order.merchant.latitude,
          longitude: order.merchant.longitude,
        }
      );

      // Distance to reskflow
      totalDistance += geolib.getDistance(
        {
          latitude: order.merchant.latitude,
          longitude: order.merchant.longitude,
        },
        {
          latitude: order.reskflow_address.latitude,
          longitude: order.reskflow_address.longitude,
        }
      );

      // Return to start for next order
      totalDistance += geolib.getDistance(
        {
          latitude: order.reskflow_address.latitude,
          longitude: order.reskflow_address.longitude,
        },
        startLocation
      );
    }

    return totalDistance;
  }

  private async calculateCurrentRouteDistance(
    driverId: string,
    assignments: any[]
  ): Promise<number> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    });

    if (!driver || !driver.current_location) return 0;

    let totalDistance = 0;
    let currentLocation = {
      latitude: driver.current_location.coordinates[1],
      longitude: driver.current_location.coordinates[0],
    };

    for (const assignment of assignments) {
      // Distance to pickup
      totalDistance += geolib.getDistance(
        currentLocation,
        assignment.pickupLocation
      );

      // Distance to reskflow
      totalDistance += geolib.getDistance(
        assignment.pickupLocation,
        assignment.reskflowLocation
      );

      currentLocation = assignment.reskflowLocation;
    }

    return totalDistance;
  }

  private async checkTimeWindows(route: OptimizedRoute): boolean {
    let currentTime = Date.now();

    for (const node of route.nodes) {
      currentTime += node.serviceDuration * 1000;

      if (node.timeWindow) {
        const arrivalTime = new Date(currentTime);
        if (arrivalTime > node.timeWindow.end) {
          return false; // Would miss time window
        }
      }
    }

    return true;
  }

  private clusterOrdersByLocation(orders: any[]): any[][] {
    // Simple clustering by proximity
    const clusters: any[][] = [];
    const assigned = new Set<string>();

    for (const order of orders) {
      if (assigned.has(order.id)) continue;

      const cluster = [order];
      assigned.add(order.id);

      // Find nearby orders
      for (const otherOrder of orders) {
        if (assigned.has(otherOrder.id)) continue;

        const distance = geolib.getDistance(
          {
            latitude: order.merchant.latitude,
            longitude: order.merchant.longitude,
          },
          {
            latitude: otherOrder.merchant.latitude,
            longitude: otherOrder.merchant.longitude,
          }
        );

        if (distance < 2000) { // Within 2km
          cluster.push(otherOrder);
          assigned.add(otherOrder.id);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  private async findBestDriverForCluster(
    cluster: any[],
    drivers: any[],
    assignedOrders: Set<string>
  ): Promise<any> {
    // Calculate cluster centroid
    const centroid = turf.centroid(
      turf.featureCollection(
        cluster.map(order => 
          turf.point([order.merchant.longitude, order.merchant.latitude])
        )
      )
    );

    let bestDriver = null;
    let bestScore = -Infinity;

    for (const driver of drivers) {
      if (!driver.current_location) continue;

      // Calculate distance to cluster
      const distance = geolib.getDistance(
        {
          latitude: driver.current_location.coordinates[1],
          longitude: driver.current_location.coordinates[0],
        },
        {
          latitude: centroid.geometry.coordinates[1],
          longitude: centroid.geometry.coordinates[0],
        }
      );

      // Calculate driver capacity
      const activeDeliveries = await prisma.reskflow.count({
        where: {
          driver_id: driver.id,
          status: { in: ['assigned', 'picked_up'] },
        },
      });

      const capacity = 3 - activeDeliveries; // Max 3 concurrent deliveries

      if (capacity >= cluster.length) {
        const score = (10000 - distance) / 1000 + capacity * 10;
        
        if (score > bestScore) {
          bestScore = score;
          bestDriver = driver;
        }
      }
    }

    return bestDriver;
  }

  private async updateDeliverySequence(driverId: string, route: OptimizedRoute) {
    // Update reskflow sequence based on optimized route
    let sequence = 1;
    
    for (const node of route.nodes) {
      if (node.type === 'reskflow') {
        await prisma.reskflow.updateMany({
          where: {
            driver_id: driverId,
            order_id: node.orderId,
          },
          data: {
            sequence,
          },
        });
        sequence++;
      }
    }

    // Notify driver of updated route
    await redis.publish(`driver:${driverId}:route`, JSON.stringify({
      type: 'route_updated',
      route: route.nodes,
      totalDistance: route.totalDistance,
      estimatedTime: route.estimatedCompletionTime,
    }));
  }

  private async optimizeZoneAssignments(zoneId: string) {
    // Redistribute assignments within a zone for better efficiency
    logger.info(`Optimizing assignments in zone ${zoneId}`);
    
    // Implementation would involve reassigning orders between drivers
    // in the same zone to minimize total travel distance
  }

  private async rebalanceDrivers(zones: string[]) {
    // Move drivers between zones to balance supply and demand
    logger.info(`Rebalancing drivers across zones: ${zones.join(', ')}`);
    
    // Implementation would involve suggesting driver relocations
    // based on demand patterns
  }
}