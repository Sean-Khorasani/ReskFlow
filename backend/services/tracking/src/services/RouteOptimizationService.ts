import { PrismaClient } from '@prisma/client';
import { 
  RouteOptimizationRequest, 
  OptimizedRoute, 
  Waypoint, 
  OptimizationType, 
  RouteStatus,
  RouteInstruction,
  AlternativeRoute,
  Location,
  ManeuverType
} from '../types/tracking.types';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

export class RouteOptimizationService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async optimizeRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    try {
      logger.info('Starting route optimization', { 
        driverId: request.driverId, 
        waypointCount: request.waypoints.length,
        optimizationType: request.optimizationType 
      });

      // Create optimization record
      const optimization = await this.prisma.routeOptimization.create({
        data: {
          driverId: request.driverId,
          optimizationType: request.optimizationType,
          waypoints: request.waypoints,
          optimizedRoute: [],
          totalDistance: 0,
          estimatedTime: 0,
          status: RouteStatus.PLANNING,
          plannedStartTime: request.plannedStartTime,
          metadata: {
            constraints: request.constraints,
            preferences: request.preferences,
          },
        },
      });

      let optimizedRoute: OptimizedRoute;

      try {
        // Perform optimization based on type
        switch (request.optimizationType) {
          case OptimizationType.SHORTEST_DISTANCE:
            optimizedRoute = await this.optimizeForDistance(request.waypoints, request);
            break;
          case OptimizationType.FASTEST_TIME:
            optimizedRoute = await this.optimizeForTime(request.waypoints, request);
            break;
          case OptimizationType.FUEL_EFFICIENT:
            optimizedRoute = await this.optimizeForFuel(request.waypoints, request);
            break;
          case OptimizationType.TRAFFIC_AWARE:
            optimizedRoute = await this.optimizeForTraffic(request.waypoints, request);
            break;
          case OptimizationType.MULTI_OBJECTIVE:
            optimizedRoute = await this.optimizeMultiObjective(request.waypoints, request);
            break;
          default:
            throw new Error(`Unsupported optimization type: ${request.optimizationType}`);
        }

        // Update optimization record with results
        await this.prisma.routeOptimization.update({
          where: { id: optimization.id },
          data: {
            optimizedRoute: optimizedRoute.waypoints,
            totalDistance: optimizedRoute.totalDistance,
            estimatedTime: optimizedRoute.estimatedTime,
            fuelEstimate: optimizedRoute.fuelEstimate,
            status: RouteStatus.OPTIMIZED,
            metadata: {
              ...optimization.metadata,
              routeInstructions: optimizedRoute.routeInstructions,
              alternativeRoutes: optimizedRoute.alternativeRoutes,
            },
          },
        });

        // Cache the result
        await redisClient.cache(
          `route:optimized:${optimization.id}`, 
          optimizedRoute, 
          3600
        );

        logger.info('Route optimization completed successfully', { 
          optimizationId: optimization.id,
          totalDistance: optimizedRoute.totalDistance,
          estimatedTime: optimizedRoute.estimatedTime,
        });

        return optimizedRoute;

      } catch (optimizationError) {
        // Update status to failed
        await this.prisma.routeOptimization.update({
          where: { id: optimization.id },
          data: {
            status: RouteStatus.FAILED,
            metadata: {
              ...optimization.metadata,
              error: optimizationError.message,
            },
          },
        });

        throw optimizationError;
      }

    } catch (error) {
      logger.error('Failed to optimize route', { error: error.message, request });
      throw new Error(`Route optimization failed: ${error.message}`);
    }
  }

  private async optimizeForDistance(waypoints: Waypoint[], request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    // Traveling Salesman Problem (TSP) solver for shortest distance
    const optimizedWaypoints = await this.solveTSP(waypoints, 'distance');
    
    const routeData = await this.calculateRouteMetrics(optimizedWaypoints);
    const instructions = await this.generateRouteInstructions(optimizedWaypoints);
    const alternatives = await this.generateAlternativeRoutes(waypoints, 'distance');

    return {
      waypoints: optimizedWaypoints,
      totalDistance: routeData.totalDistance,
      estimatedTime: routeData.estimatedTime,
      fuelEstimate: routeData.fuelEstimate,
      routeInstructions: instructions,
      alternativeRoutes: alternatives,
    };
  }

  private async optimizeForTime(waypoints: Waypoint[], request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    // Consider traffic patterns and time windows
    const optimizedWaypoints = await this.solveTSPWithTimeWindows(waypoints, request);
    
    const routeData = await this.calculateRouteMetrics(optimizedWaypoints, true); // Include traffic
    const instructions = await this.generateRouteInstructions(optimizedWaypoints);
    const alternatives = await this.generateAlternativeRoutes(waypoints, 'time');

    return {
      waypoints: optimizedWaypoints,
      totalDistance: routeData.totalDistance,
      estimatedTime: routeData.estimatedTime,
      fuelEstimate: routeData.fuelEstimate,
      routeInstructions: instructions,
      alternativeRoutes: alternatives,
    };
  }

  private async optimizeForFuel(waypoints: Waypoint[], request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    // Optimize for fuel efficiency considering elevation, traffic, and vehicle type
    const optimizedWaypoints = await this.solveTSP(waypoints, 'fuel');
    
    const routeData = await this.calculateRouteMetrics(optimizedWaypoints, true, true); // Include traffic and fuel
    const instructions = await this.generateRouteInstructions(optimizedWaypoints);
    const alternatives = await this.generateAlternativeRoutes(waypoints, 'fuel');

    return {
      waypoints: optimizedWaypoints,
      totalDistance: routeData.totalDistance,
      estimatedTime: routeData.estimatedTime,
      fuelEstimate: routeData.fuelEstimate,
      routeInstructions: instructions,
      alternativeRoutes: alternatives,
    };
  }

  private async optimizeForTraffic(waypoints: Waypoint[], request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    // Real-time traffic-aware optimization
    const trafficData = await this.getTrafficData(waypoints);
    const optimizedWaypoints = await this.solveTSPWithTraffic(waypoints, trafficData);
    
    const routeData = await this.calculateRouteMetrics(optimizedWaypoints, true);
    const instructions = await this.generateRouteInstructions(optimizedWaypoints);
    const alternatives = await this.generateAlternativeRoutes(waypoints, 'traffic');

    return {
      waypoints: optimizedWaypoints,
      totalDistance: routeData.totalDistance,
      estimatedTime: routeData.estimatedTime,
      fuelEstimate: routeData.fuelEstimate,
      routeInstructions: instructions,
      alternativeRoutes: alternatives,
    };
  }

  private async optimizeMultiObjective(waypoints: Waypoint[], request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    // Weighted multi-objective optimization
    const weights = {
      distance: 0.3,
      time: 0.4,
      fuel: 0.2,
      traffic: 0.1,
    };

    const optimizedWaypoints = await this.solveTSPMultiObjective(waypoints, weights, request);
    
    const routeData = await this.calculateRouteMetrics(optimizedWaypoints, true, true);
    const instructions = await this.generateRouteInstructions(optimizedWaypoints);
    const alternatives = await this.generateAlternativeRoutes(waypoints, 'multi');

    return {
      waypoints: optimizedWaypoints,
      totalDistance: routeData.totalDistance,
      estimatedTime: routeData.estimatedTime,
      fuelEstimate: routeData.fuelEstimate,
      routeInstructions: instructions,
      alternativeRoutes: alternatives,
    };
  }

  private async solveTSP(waypoints: Waypoint[], optimizationCriteria: string): Promise<Waypoint[]> {
    // Simplified TSP solver using nearest neighbor heuristic with 2-opt improvement
    if (waypoints.length <= 2) {
      return waypoints;
    }

    // Create distance matrix
    const distanceMatrix = await this.createDistanceMatrix(waypoints, optimizationCriteria);
    
    // Nearest neighbor algorithm
    let route = [0]; // Start with first waypoint
    const unvisited = new Set(Array.from({ length: waypoints.length }, (_, i) => i).slice(1));

    while (unvisited.size > 0) {
      const currentIndex = route[route.length - 1];
      let nearestIndex = -1;
      let nearestDistance = Infinity;

      for (const index of unvisited) {
        const distance = distanceMatrix[currentIndex][index];
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }

      route.push(nearestIndex);
      unvisited.delete(nearestIndex);
    }

    // 2-opt improvement
    route = this.improve2Opt(route, distanceMatrix);

    // Return waypoints in optimized order
    return route.map(index => waypoints[index]);
  }

  private async solveTSPWithTimeWindows(waypoints: Waypoint[], request: RouteOptimizationRequest): Promise<Waypoint[]> {
    // Consider time windows and delivery constraints
    const timeWindows = request.constraints?.timeWindows || [];
    
    // Sort waypoints by time window priority and earliest start time
    const sortedWaypoints = [...waypoints].sort((a, b) => {
      const timeWindowA = timeWindows.find(tw => tw.waypointId === a.id);
      const timeWindowB = timeWindows.find(tw => tw.waypointId === b.id);

      if (timeWindowA && timeWindowB) {
        // Both have time windows - sort by start time
        return timeWindowA.startTime.getTime() - timeWindowB.startTime.getTime();
      } else if (timeWindowA) {
        // Only A has time window - prioritize A
        return -1;
      } else if (timeWindowB) {
        // Only B has time window - prioritize B
        return 1;
      }

      // Neither has time window - maintain original order
      return 0;
    });

    return sortedWaypoints;
  }

  private async solveTSPWithTraffic(waypoints: Waypoint[], trafficData: any): Promise<Waypoint[]> {
    // Use traffic data to adjust route optimization
    // This would integrate with traffic APIs like Google Maps Traffic or similar
    
    // For now, return a simplified optimization that avoids high-traffic areas
    return this.solveTSP(waypoints, 'time');
  }

  private async solveTSPMultiObjective(
    waypoints: Waypoint[], 
    weights: any, 
    request: RouteOptimizationRequest
  ): Promise<Waypoint[]> {
    // Multi-objective optimization using weighted sum approach
    const distanceMatrix = await this.createDistanceMatrix(waypoints, 'distance');
    const timeMatrix = await this.createDistanceMatrix(waypoints, 'time');
    const fuelMatrix = await this.createDistanceMatrix(waypoints, 'fuel');

    // Create combined cost matrix
    const costMatrix: number[][] = [];
    for (let i = 0; i < waypoints.length; i++) {
      costMatrix[i] = [];
      for (let j = 0; j < waypoints.length; j++) {
        costMatrix[i][j] = 
          weights.distance * distanceMatrix[i][j] +
          weights.time * timeMatrix[i][j] +
          weights.fuel * fuelMatrix[i][j];
      }
    }

    // Solve using the combined cost matrix
    let route = [0];
    const unvisited = new Set(Array.from({ length: waypoints.length }, (_, i) => i).slice(1));

    while (unvisited.size > 0) {
      const currentIndex = route[route.length - 1];
      let bestIndex = -1;
      let bestCost = Infinity;

      for (const index of unvisited) {
        const cost = costMatrix[currentIndex][index];
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = index;
        }
      }

      route.push(bestIndex);
      unvisited.delete(bestIndex);
    }

    return route.map(index => waypoints[index]);
  }

  private async createDistanceMatrix(waypoints: Waypoint[], criteria: string): Promise<number[][]> {
    const matrix: number[][] = [];
    
    for (let i = 0; i < waypoints.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < waypoints.length; j++) {
        if (i === j) {
          matrix[i][j] = 0;
        } else {
          matrix[i][j] = await this.calculateCost(waypoints[i], waypoints[j], criteria);
        }
      }
    }

    return matrix;
  }

  private async calculateCost(from: Waypoint, to: Waypoint, criteria: string): Promise<number> {
    const distance = this.calculateDistance(
      from.latitude, from.longitude,
      to.latitude, to.longitude
    );

    switch (criteria) {
      case 'distance':
        return distance;
      case 'time':
        // Estimate time based on distance and average speed
        const averageSpeed = 40; // km/h in urban areas
        return (distance / 1000) / averageSpeed * 60; // minutes
      case 'fuel':
        // Estimate fuel consumption (simplified)
        const fuelEfficiency = 0.08; // L/km
        return distance / 1000 * fuelEfficiency;
      default:
        return distance;
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private improve2Opt(route: number[], distanceMatrix: number[][]): number[] {
    let improved = true;
    let bestRoute = [...route];

    while (improved) {
      improved = false;
      for (let i = 1; i < route.length - 2; i++) {
        for (let j = i + 1; j < route.length; j++) {
          if (j - i === 1) continue;

          const newRoute = [...bestRoute];
          // Reverse the segment between i and j
          newRoute.splice(i, j - i + 1, ...bestRoute.slice(i, j + 1).reverse());

          if (this.calculateTotalDistance(newRoute, distanceMatrix) < 
              this.calculateTotalDistance(bestRoute, distanceMatrix)) {
            bestRoute = newRoute;
            improved = true;
          }
        }
      }
    }

    return bestRoute;
  }

  private calculateTotalDistance(route: number[], distanceMatrix: number[][]): number {
    let totalDistance = 0;
    for (let i = 0; i < route.length - 1; i++) {
      totalDistance += distanceMatrix[route[i]][route[i + 1]];
    }
    return totalDistance;
  }

  private async calculateRouteMetrics(
    waypoints: Waypoint[], 
    includeTraffic: boolean = false,
    includeFuel: boolean = false
  ): Promise<{ totalDistance: number; estimatedTime: number; fuelEstimate?: number }> {
    let totalDistance = 0;
    let estimatedTime = 0;
    let fuelEstimate = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const distance = this.calculateDistance(
        waypoints[i].latitude, waypoints[i].longitude,
        waypoints[i + 1].latitude, waypoints[i + 1].longitude
      );

      totalDistance += distance;

      // Calculate time (with traffic adjustment if needed)
      let speed = 40; // Base speed in km/h
      if (includeTraffic) {
        // Adjust speed based on traffic (simplified)
        speed *= 0.8; // Assume 20% slower due to traffic
      }

      estimatedTime += (distance / 1000) / speed * 60; // minutes

      if (includeFuel) {
        // Calculate fuel consumption (simplified)
        const fuelEfficiency = 0.08; // L/km
        fuelEstimate += distance / 1000 * fuelEfficiency;
      }
    }

    const result: any = {
      totalDistance: totalDistance / 1000, // Convert to km
      estimatedTime: Math.round(estimatedTime),
    };

    if (includeFuel) {
      result.fuelEstimate = Math.round(fuelEstimate * 100) / 100;
    }

    return result;
  }

  private async generateRouteInstructions(waypoints: Waypoint[]): Promise<RouteInstruction[]> {
    const instructions: RouteInstruction[] = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = waypoints[i];
      const to = waypoints[i + 1];

      const distance = this.calculateDistance(
        from.latitude, from.longitude,
        to.latitude, to.longitude
      );

      const bearing = this.calculateBearing(
        from.latitude, from.longitude,
        to.latitude, to.longitude
      );

      instructions.push({
        stepNumber: i + 1,
        instruction: `Head ${this.bearingToDirection(bearing)} towards ${to.address}`,
        distance: distance / 1000, // km
        duration: Math.round((distance / 1000) / 40 * 60), // minutes at 40 km/h
        location: {
          latitude: from.latitude,
          longitude: from.longitude,
        },
        maneuver: this.determineManeuver(bearing, i === 0),
      });
    }

    return instructions;
  }

  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLon = this.toRadians(lon2 - lon1);
    const lat1Rad = this.toRadians(lat1);
    const lat2Rad = this.toRadians(lat2);

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    const bearing = Math.atan2(y, x);
    return (bearing * 180 / Math.PI + 360) % 360;
  }

  private bearingToDirection(bearing: number): string {
    const directions = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  private determineManeuver(bearing: number, isFirst: boolean): ManeuverType {
    if (isFirst) return ManeuverType.STRAIGHT;

    // Simplified maneuver determination based on bearing
    if (bearing >= 315 || bearing < 45) return ManeuverType.STRAIGHT;
    if (bearing >= 45 && bearing < 135) return ManeuverType.RIGHT;
    if (bearing >= 135 && bearing < 225) return ManeuverType.U_TURN;
    if (bearing >= 225 && bearing < 315) return ManeuverType.LEFT;

    return ManeuverType.STRAIGHT;
  }

  private async generateAlternativeRoutes(waypoints: Waypoint[], optimizationType: string): Promise<AlternativeRoute[]> {
    // Generate 1-2 alternative routes with different optimization criteria
    const alternatives: AlternativeRoute[] = [];

    if (optimizationType !== 'distance') {
      try {
        const distanceOptimized = await this.solveTSP(waypoints, 'distance');
        const metrics = await this.calculateRouteMetrics(distanceOptimized);
        alternatives.push({
          name: 'Shortest Distance',
          totalDistance: metrics.totalDistance,
          estimatedTime: metrics.estimatedTime,
          savings: {
            timeSaved: 0, // Calculate compared to main route
            distanceSaved: 0,
            fuelSaved: 0,
          },
          waypoints: distanceOptimized,
        });
      } catch (error) {
        logger.warn('Failed to generate distance-optimized alternative', { error: error.message });
      }
    }

    if (optimizationType !== 'time') {
      try {
        const timeOptimized = await this.solveTSP(waypoints, 'time');
        const metrics = await this.calculateRouteMetrics(timeOptimized, true);
        alternatives.push({
          name: 'Fastest Time',
          totalDistance: metrics.totalDistance,
          estimatedTime: metrics.estimatedTime,
          savings: {
            timeSaved: 0, // Calculate compared to main route
            distanceSaved: 0,
            fuelSaved: 0,
          },
          waypoints: timeOptimized,
        });
      } catch (error) {
        logger.warn('Failed to generate time-optimized alternative', { error: error.message });
      }
    }

    return alternatives;
  }

  private async getTrafficData(waypoints: Waypoint[]): Promise<any> {
    // This would integrate with traffic data providers
    // For now, return mock data
    return {
      congestionLevel: 'moderate',
      averageSpeed: 35, // km/h
      incidents: [],
    };
  }

  async getOptimizationResult(optimizationId: string): Promise<any> {
    try {
      // Try cache first
      let result = await redisClient.getCached(`route:optimized:${optimizationId}`);
      
      if (!result) {
        const optimization = await this.prisma.routeOptimization.findUnique({
          where: { id: optimizationId },
        });

        if (!optimization) {
          throw new Error('Route optimization not found');
        }

        result = {
          id: optimization.id,
          status: optimization.status,
          waypoints: optimization.optimizedRoute,
          totalDistance: optimization.totalDistance,
          estimatedTime: optimization.estimatedTime,
          fuelEstimate: optimization.fuelEstimate,
          metadata: optimization.metadata,
        };

        if (optimization.status === RouteStatus.OPTIMIZED) {
          await redisClient.cache(`route:optimized:${optimizationId}`, result, 3600);
        }
      }

      return result;
    } catch (error) {
      logger.error('Failed to get optimization result', { error: error.message, optimizationId });
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info('RouteOptimizationService cleanup completed');
    } catch (error) {
      logger.error('Error during RouteOptimizationService cleanup', { error: error.message });
    }
  }
}