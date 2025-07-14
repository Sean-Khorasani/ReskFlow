import { prisma, logger, redis } from '@reskflow/shared';
import * as geolib from 'geolib';
import * as turf from '@turf/turf';

interface RouteNode {
  id: string;
  type: 'start' | 'pickup' | 'reskflow';
  orderId?: string;
  merchantId?: string;
  location: {
    latitude: number;
    longitude: number;
  };
  address: string;
  estimatedArrival: Date;
  estimatedDeparture: Date;
  serviceDuration: number;
  instructions?: string;
}

interface BatchRoute {
  batchId: string;
  driverId?: string;
  nodes: RouteNode[];
  totalDistance: number;
  totalDuration: number;
  polyline?: string;
  turnByTurnDirections?: any[];
}

interface RouteOptimizationResult {
  route: RouteNode[];
  distance: number;
  duration: number;
  feasible: boolean;
  violations?: string[];
}

export class RouteGenerationService {
  private readonly AVERAGE_SPEED_MPS = 8.33; // 30 km/h in m/s
  private readonly PICKUP_SERVICE_TIME = 300; // 5 minutes
  private readonly DELIVERY_SERVICE_TIME = 180; // 3 minutes

  async generateBatchRoutes(
    batchId: string,
    driverId?: string
  ): Promise<BatchRoute> {
    // Get batch details
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

    // Get driver location if provided
    let startLocation;
    if (driverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      });
      
      if (driver && driver.current_location) {
        startLocation = {
          latitude: driver.current_location.coordinates[1],
          longitude: driver.current_location.coordinates[0],
        };
      }
    }

    // If no driver location, use first merchant as start
    if (!startLocation && batch.orders.length > 0) {
      startLocation = {
        latitude: batch.orders[0].merchant.latitude,
        longitude: batch.orders[0].merchant.longitude,
      };
    }

    // Generate optimal route
    const optimizedRoute = await this.generateOptimalRoute(batch.orders, startLocation);

    // Calculate polyline for visualization
    const polyline = await this.generatePolyline(optimizedRoute.route);

    // Generate turn-by-turn directions (simplified)
    const directions = this.generateDirections(optimizedRoute.route);

    const batchRoute: BatchRoute = {
      batchId,
      driverId,
      nodes: optimizedRoute.route,
      totalDistance: optimizedRoute.distance,
      totalDuration: optimizedRoute.duration,
      polyline,
      turnByTurnDirections: directions,
    };

    // Cache the route
    await redis.setex(
      `batch:${batchId}:route`,
      3600,
      JSON.stringify(batchRoute)
    );

    return batchRoute;
  }

  async generateOptimalRoute(
    orders: any[],
    startLocation?: { latitude: number; longitude: number }
  ): Promise<RouteOptimizationResult> {
    const nodes: RouteNode[] = [];
    
    // Add start node if provided
    if (startLocation) {
      nodes.push({
        id: 'start',
        type: 'start',
        location: startLocation,
        address: 'Current Location',
        estimatedArrival: new Date(),
        estimatedDeparture: new Date(),
        serviceDuration: 0,
      });
    }

    // Create pickup and reskflow nodes
    const pickupNodes: RouteNode[] = [];
    const reskflowNodes: RouteNode[] = [];

    for (const order of orders) {
      pickupNodes.push({
        id: `pickup-${order.id}`,
        type: 'pickup',
        orderId: order.id,
        merchantId: order.merchant_id,
        location: {
          latitude: order.merchant.latitude,
          longitude: order.merchant.longitude,
        },
        address: order.merchant.address,
        estimatedArrival: new Date(),
        estimatedDeparture: new Date(),
        serviceDuration: this.PICKUP_SERVICE_TIME,
        instructions: order.pickup_instructions,
      });

      reskflowNodes.push({
        id: `reskflow-${order.id}`,
        type: 'reskflow',
        orderId: order.id,
        location: {
          latitude: order.reskflow_address.latitude,
          longitude: order.reskflow_address.longitude,
        },
        address: order.reskflow_address.formatted_address,
        estimatedArrival: new Date(),
        estimatedDeparture: new Date(),
        serviceDuration: this.DELIVERY_SERVICE_TIME,
        instructions: order.reskflow_instructions,
      });
    }

    // Optimize route using different strategies
    const strategies = [
      () => this.clusterFirstRouting(pickupNodes, reskflowNodes),
      () => this.nearestNeighborRouting(pickupNodes, reskflowNodes),
      () => this.savingsAlgorithm(pickupNodes, reskflowNodes),
    ];

    let bestRoute: RouteNode[] = [];
    let bestDistance = Infinity;
    let bestDuration = Infinity;

    for (const strategy of strategies) {
      const route = strategy();
      const { distance, duration } = this.calculateRouteMetrics(
        [...nodes, ...route]
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestDuration = duration;
        bestRoute = route;
      }
    }

    // Combine with start node and calculate times
    const finalRoute = [...nodes, ...bestRoute];
    this.calculateEstimatedTimes(finalRoute);

    // Check constraints
    const violations = this.checkRouteConstraints(finalRoute, orders);

    return {
      route: finalRoute,
      distance: bestDistance,
      duration: bestDuration,
      feasible: violations.length === 0,
      violations,
    };
  }

  async processRouteJob(job: any) {
    logger.info(`Processing route job: ${job.type}`);

    switch (job.type) {
      case 'optimize_route':
        return await this.optimizeExistingRoute(job.batchId);
      case 'recalculate_eta':
        return await this.recalculateETAs(job.batchId, job.driverLocation);
      default:
        throw new Error(`Unknown route job type: ${job.type}`);
    }
  }

  private clusterFirstRouting(
    pickupNodes: RouteNode[],
    reskflowNodes: RouteNode[]
  ): RouteNode[] {
    // Cluster pickups by proximity
    const pickupClusters = this.clusterNodes(pickupNodes);
    const route: RouteNode[] = [];

    // Visit each pickup cluster
    for (const cluster of pickupClusters) {
      route.push(...cluster);
    }

    // Then optimize deliveries
    const optimizedDeliveries = this.optimizeDeliverySequence(
      reskflowNodes,
      route[route.length - 1]
    );
    
    route.push(...optimizedDeliveries);
    return route;
  }

  private nearestNeighborRouting(
    pickupNodes: RouteNode[],
    reskflowNodes: RouteNode[]
  ): RouteNode[] {
    const route: RouteNode[] = [];
    const unvisitedPickups = new Set(pickupNodes);
    const unvisitedDeliveries = new Set(reskflowNodes);
    const pickedUpOrders = new Set<string>();

    let current = pickupNodes[0]; // Start with first pickup
    
    // Nearest neighbor with constraints
    while (unvisitedPickups.size > 0 || unvisitedDeliveries.size > 0) {
      let nearest: RouteNode | null = null;
      let nearestDistance = Infinity;

      // Look for nearest pickup
      for (const node of unvisitedPickups) {
        const distance = geolib.getDistance(
          current.location,
          node.location
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = node;
        }
      }

      // Look for nearest reskflow (if order picked up)
      for (const node of unvisitedDeliveries) {
        if (pickedUpOrders.has(node.orderId!)) {
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

      if (nearest) {
        route.push(nearest);
        current = nearest;

        if (nearest.type === 'pickup') {
          unvisitedPickups.delete(nearest);
          pickedUpOrders.add(nearest.orderId!);
        } else {
          unvisitedDeliveries.delete(nearest);
        }
      } else {
        // Force pickup if no valid reskflow
        if (unvisitedPickups.size > 0) {
          nearest = unvisitedPickups.values().next().value;
          route.push(nearest);
          current = nearest;
          unvisitedPickups.delete(nearest);
          pickedUpOrders.add(nearest.orderId!);
        }
      }
    }

    return route;
  }

  private savingsAlgorithm(
    pickupNodes: RouteNode[],
    reskflowNodes: RouteNode[]
  ): RouteNode[] {
    // Clarke-Wright savings algorithm adapted for pickup-reskflow
    const allNodes = [...pickupNodes, ...reskflowNodes];
    const depot = pickupNodes[0]; // Use first pickup as depot
    
    // Calculate savings for combining routes
    const savings: Array<{
      i: number;
      j: number;
      saving: number;
    }> = [];

    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const distanceIDepot = geolib.getDistance(
          allNodes[i].location,
          depot.location
        );
        const distanceJDepot = geolib.getDistance(
          allNodes[j].location,
          depot.location
        );
        const distanceIJ = geolib.getDistance(
          allNodes[i].location,
          allNodes[j].location
        );

        const saving = distanceIDepot + distanceJDepot - distanceIJ;
        savings.push({ i, j, saving });
      }
    }

    // Sort by savings descending
    savings.sort((a, b) => b.saving - a.saving);

    // Build route based on savings
    const route: RouteNode[] = [];
    const visited = new Set<number>();

    // Ensure pickups before deliveries
    const orderConstraints = new Map<string, Set<string>>();
    pickupNodes.forEach(p => {
      orderConstraints.set(p.orderId!, new Set(['pickup']));
    });

    for (const { i, j } of savings) {
      if (!visited.has(i) && !visited.has(j)) {
        // Check constraints
        const nodeI = allNodes[i];
        const nodeJ = allNodes[j];

        if (this.canAddToRoute(nodeI, nodeJ, orderConstraints)) {
          route.push(nodeI, nodeJ);
          visited.add(i);
          visited.add(j);

          // Update constraints
          if (nodeI.type === 'pickup') {
            orderConstraints.get(nodeI.orderId!)!.add('pickup_done');
          }
          if (nodeJ.type === 'pickup') {
            orderConstraints.get(nodeJ.orderId!)!.add('pickup_done');
          }
        }
      }
    }

    // Add remaining nodes
    allNodes.forEach((node, index) => {
      if (!visited.has(index)) {
        route.push(node);
      }
    });

    return this.ensureValidSequence(route);
  }

  private clusterNodes(nodes: RouteNode[]): RouteNode[][] {
    if (nodes.length <= 3) {
      return [nodes];
    }

    // Simple geographic clustering
    const clusters: RouteNode[][] = [];
    const used = new Set<string>();

    for (const node of nodes) {
      if (used.has(node.id)) continue;

      const cluster = [node];
      used.add(node.id);

      // Find nearby nodes
      for (const other of nodes) {
        if (used.has(other.id)) continue;

        const distance = geolib.getDistance(
          node.location,
          other.location
        );

        if (distance < 1000) { // Within 1km
          cluster.push(other);
          used.add(other.id);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  private optimizeDeliverySequence(
    reskflowNodes: RouteNode[],
    lastNode: RouteNode
  ): RouteNode[] {
    // Order deliveries by nearest neighbor from last pickup
    const sequence: RouteNode[] = [];
    const remaining = new Set(reskflowNodes);
    let current = lastNode;

    while (remaining.size > 0) {
      let nearest: RouteNode | null = null;
      let nearestDistance = Infinity;

      for (const node of remaining) {
        const distance = geolib.getDistance(
          current.location,
          node.location
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = node;
        }
      }

      if (nearest) {
        sequence.push(nearest);
        remaining.delete(nearest);
        current = nearest;
      }
    }

    return sequence;
  }

  private canAddToRoute(
    node1: RouteNode,
    node2: RouteNode,
    constraints: Map<string, Set<string>>
  ): boolean {
    // Check if reskflow can be added (pickup must be done)
    if (node1.type === 'reskflow') {
      const pickupDone = constraints.get(node1.orderId!)?.has('pickup_done');
      if (!pickupDone) return false;
    }
    if (node2.type === 'reskflow') {
      const pickupDone = constraints.get(node2.orderId!)?.has('pickup_done');
      if (!pickupDone) return false;
    }
    return true;
  }

  private ensureValidSequence(route: RouteNode[]): RouteNode[] {
    // Ensure all pickups come before their deliveries
    const validRoute: RouteNode[] = [];
    const pickedUp = new Set<string>();
    const added = new Set<string>();

    // First add all pickups
    for (const node of route) {
      if (node.type === 'pickup' && !added.has(node.id)) {
        validRoute.push(node);
        pickedUp.add(node.orderId!);
        added.add(node.id);
      }
    }

    // Then add deliveries in order
    for (const node of route) {
      if (node.type === 'reskflow' && 
          pickedUp.has(node.orderId!) && 
          !added.has(node.id)) {
        validRoute.push(node);
        added.add(node.id);
      }
    }

    return validRoute;
  }

  private calculateRouteMetrics(nodes: RouteNode[]) {
    let totalDistance = 0;
    let totalDuration = 0;

    for (let i = 0; i < nodes.length - 1; i++) {
      const distance = geolib.getDistance(
        nodes[i].location,
        nodes[i + 1].location
      );
      totalDistance += distance;
      
      // Travel time + service time
      totalDuration += (distance / this.AVERAGE_SPEED_MPS) + nodes[i + 1].serviceDuration;
    }

    return { distance: totalDistance, duration: totalDuration };
  }

  private calculateEstimatedTimes(route: RouteNode[]) {
    let currentTime = Date.now();

    for (let i = 0; i < route.length; i++) {
      const node = route[i];
      
      if (i > 0) {
        // Add travel time from previous node
        const distance = geolib.getDistance(
          route[i - 1].location,
          node.location
        );
        currentTime += (distance / this.AVERAGE_SPEED_MPS) * 1000;
      }

      node.estimatedArrival = new Date(currentTime);
      currentTime += node.serviceDuration * 1000;
      node.estimatedDeparture = new Date(currentTime);
    }
  }

  private checkRouteConstraints(route: RouteNode[], orders: any[]): string[] {
    const violations: string[] = [];

    // Check time windows
    for (const node of route) {
      if (node.orderId) {
        const order = orders.find(o => o.id === node.orderId);
        if (order?.reskflow_time_window && node.type === 'reskflow') {
          const arrival = node.estimatedArrival;
          const window = order.reskflow_time_window;
          
          if (arrival < window.start || arrival > window.end) {
            violations.push(`Order ${node.orderId} misses reskflow window`);
          }
        }
      }
    }

    // Check sequence constraints
    const deliveredOrders = new Set<string>();
    for (const node of route) {
      if (node.type === 'reskflow') {
        // Check if pickup was done
        const pickupIndex = route.findIndex(
          n => n.type === 'pickup' && n.orderId === node.orderId
        );
        const reskflowIndex = route.indexOf(node);
        
        if (pickupIndex === -1 || pickupIndex > reskflowIndex) {
          violations.push(`Delivery before pickup for order ${node.orderId}`);
        }
      }
    }

    return violations;
  }

  private async generatePolyline(route: RouteNode[]): Promise<string> {
    // Convert route to polyline for visualization
    const coordinates = route.map(node => [
      node.location.longitude,
      node.location.latitude,
    ]);

    const lineString = turf.lineString(coordinates);
    // In production, this would call a routing API
    return JSON.stringify(lineString);
  }

  private generateDirections(route: RouteNode[]): any[] {
    const directions = [];

    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i];
      const to = route[i + 1];
      const distance = geolib.getDistance(from.location, to.location);
      const bearing = geolib.getCompassDirection(
        from.location,
        to.location
      );

      directions.push({
        from: from.address,
        to: to.address,
        distance,
        direction: bearing,
        instruction: `Head ${bearing} to ${to.address}`,
        type: to.type,
      });
    }

    return directions;
  }

  private async optimizeExistingRoute(batchId: string): Promise<BatchRoute> {
    // Re-optimize an existing route based on current conditions
    const cachedRoute = await redis.get(`batch:${batchId}:route`);
    if (!cachedRoute) {
      throw new Error('Route not found');
    }

    const currentRoute = JSON.parse(cachedRoute);
    
    // Get current driver location if available
    if (currentRoute.driverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: currentRoute.driverId },
      });
      
      if (driver?.current_location) {
        // Update start location and recalculate
        currentRoute.nodes[0] = {
          id: 'start',
          type: 'start',
          location: {
            latitude: driver.current_location.coordinates[1],
            longitude: driver.current_location.coordinates[0],
          },
          address: 'Current Location',
          estimatedArrival: new Date(),
          estimatedDeparture: new Date(),
          serviceDuration: 0,
        };
      }
    }

    // Recalculate times
    this.calculateEstimatedTimes(currentRoute.nodes);

    return currentRoute;
  }

  private async recalculateETAs(
    batchId: string,
    driverLocation: { latitude: number; longitude: number }
  ): Promise<void> {
    const cachedRoute = await redis.get(`batch:${batchId}:route`);
    if (!cachedRoute) return;

    const route = JSON.parse(cachedRoute);
    
    // Find current position in route
    let currentIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < route.nodes.length; i++) {
      const distance = geolib.getDistance(
        driverLocation,
        route.nodes[i].location
      );
      if (distance < minDistance) {
        minDistance = distance;
        currentIndex = i;
      }
    }

    // Recalculate ETAs from current position
    let currentTime = Date.now();
    
    for (let i = currentIndex; i < route.nodes.length; i++) {
      const node = route.nodes[i];
      
      if (i === currentIndex) {
        // Add time to reach current node
        currentTime += (minDistance / this.AVERAGE_SPEED_MPS) * 1000;
      } else {
        // Add travel time from previous node
        const distance = geolib.getDistance(
          route.nodes[i - 1].location,
          node.location
        );
        currentTime += (distance / this.AVERAGE_SPEED_MPS) * 1000;
      }

      node.estimatedArrival = new Date(currentTime);
      currentTime += node.serviceDuration * 1000;
      node.estimatedDeparture = new Date(currentTime);
    }

    // Update cache
    await redis.setex(
      `batch:${batchId}:route`,
      3600,
      JSON.stringify(route)
    );
  }
}