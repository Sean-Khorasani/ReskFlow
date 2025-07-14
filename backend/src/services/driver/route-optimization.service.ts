/**
 * Route Optimization Service
 * Optimizes reskflow routes for drivers using various algorithms
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import axios from 'axios';
import { logger } from '../../utils/logger';
import { redisClient } from '../../utils/redis';

const prisma = new PrismaClient();

interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

interface RoutePoint {
  id: string;
  type: 'pickup' | 'reskflow' | 'waypoint';
  location: Location;
  orderId: string;
  merchantName?: string;
  customerName?: string;
  estimatedTime?: number;
  priority?: number;
  timeWindow?: {
    start: Date;
    end: Date;
  };
}

interface OptimizedRoute {
  id: string;
  driverId: string;
  points: RoutePoint[];
  totalDistance: number;
  totalTime: number;
  estimatedFuel: number;
  savingsPercentage: number;
  polyline?: string;
  alternativeRoutes?: AlternativeRoute[];
}

interface AlternativeRoute {
  id: string;
  reason: string;
  points: RoutePoint[];
  totalDistance: number;
  totalTime: number;
  comparison: {
    distanceDiff: number;
    timeDiff: number;
  };
}

interface TrafficData {
  segmentId: string;
  currentSpeed: number;
  normalSpeed: number;
  congestionLevel: 'low' | 'medium' | 'high' | 'severe';
  incidents?: string[];
}

interface RouteMetrics {
  distance: number;
  duration: number;
  fuelCost: number;
  co2Emissions: number;
}

export class RouteOptimizationService extends EventEmitter {
  private readonly GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  private readonly MAPBOX_API_KEY = process.env.MAPBOX_API_KEY;
  private readonly FUEL_EFFICIENCY_MPG = 25; // Average reskflow vehicle
  private readonly FUEL_PRICE_PER_GALLON = 3.50;
  private readonly CO2_PER_GALLON = 8.887; // kg of CO2

  constructor() {
    super();
    this.initializeRouteCache();
  }

  /**
   * Initialize route cache
   */
  private async initializeRouteCache(): Promise<void> {
    // Set up Redis cache for frequently used routes
    await redisClient.set('route_cache_initialized', '1', 'EX', 86400);
  }

  /**
   * Optimize route for multiple deliveries
   */
  async optimizeRoute(driverId: string, deliveries: any[]): Promise<OptimizedRoute> {
    try {
      // Get driver's current location
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        include: { vehicle: true },
      });

      if (!driver || !driver.currentLocation) {
        throw new Error('Driver location not available');
      }

      // Build route points
      const routePoints = await this.buildRoutePoints(deliveries, driver.currentLocation);

      // Check cache for similar route
      const cachedRoute = await this.getCachedRoute(routePoints);
      if (cachedRoute) {
        logger.info('Using cached route', { driverId });
        return cachedRoute;
      }

      // Apply optimization algorithm
      const optimizedPoints = await this.applyOptimizationAlgorithm(routePoints, driver);

      // Calculate route metrics
      const metrics = await this.calculateRouteMetrics(optimizedPoints);

      // Generate polyline for visualization
      const polyline = await this.generatePolyline(optimizedPoints);

      // Find alternative routes
      const alternativeRoutes = await this.findAlternativeRoutes(optimizedPoints, driver);

      // Calculate savings
      const originalMetrics = await this.calculateRouteMetrics(routePoints);
      const savingsPercentage = ((originalMetrics.distance - metrics.distance) / originalMetrics.distance) * 100;

      const optimizedRoute: OptimizedRoute = {
        id: `route_${Date.now()}`,
        driverId,
        points: optimizedPoints,
        totalDistance: metrics.distance,
        totalTime: metrics.duration,
        estimatedFuel: metrics.fuelCost,
        savingsPercentage: Math.max(0, savingsPercentage),
        polyline,
        alternativeRoutes,
      };

      // Cache the route
      await this.cacheRoute(routePoints, optimizedRoute);

      // Emit optimization event
      this.emit('route:optimized', {
        driverId,
        originalDistance: originalMetrics.distance,
        optimizedDistance: metrics.distance,
        savings: savingsPercentage,
      });

      return optimizedRoute;

    } catch (error) {
      logger.error('Failed to optimize route', error);
      throw error;
    }
  }

  /**
   * Build route points from deliveries
   */
  private async buildRoutePoints(deliveries: any[], driverLocation: Location): Promise<RoutePoint[]> {
    const points: RoutePoint[] = [];

    // Add driver's current location as starting point
    points.push({
      id: 'start',
      type: 'waypoint',
      location: driverLocation,
      orderId: '',
    });

    // Add pickup and reskflow points
    for (const reskflow of deliveries) {
      // Pickup point
      points.push({
        id: `pickup_${reskflow.id}`,
        type: 'pickup',
        location: {
          latitude: reskflow.order.merchant.latitude,
          longitude: reskflow.order.merchant.longitude,
          address: reskflow.order.merchant.address,
        },
        orderId: reskflow.orderId,
        merchantName: reskflow.order.merchant.name,
        priority: reskflow.priority || 1,
        timeWindow: reskflow.pickupTimeWindow,
      });

      // Delivery point
      points.push({
        id: `reskflow_${reskflow.id}`,
        type: 'reskflow',
        location: {
          latitude: reskflow.order.reskflowLatitude,
          longitude: reskflow.order.reskflowLongitude,
          address: reskflow.order.reskflowAddress,
        },
        orderId: reskflow.orderId,
        customerName: reskflow.order.customer.name,
        priority: reskflow.priority || 1,
        timeWindow: reskflow.reskflowTimeWindow,
      });
    }

    return points;
  }

  /**
   * Apply optimization algorithm
   */
  private async applyOptimizationAlgorithm(points: RoutePoint[], driver: any): Promise<RoutePoint[]> {
    // Use different algorithms based on number of points
    if (points.length <= 10) {
      // Use exact algorithm for small sets
      return this.bruteForceOptimization(points);
    } else if (points.length <= 25) {
      // Use genetic algorithm for medium sets
      return this.geneticAlgorithmOptimization(points);
    } else {
      // Use nearest neighbor with 2-opt for large sets
      return this.nearestNeighborWith2Opt(points);
    }
  }

  /**
   * Brute force optimization for small route sets
   */
  private async bruteForceOptimization(points: RoutePoint[]): Promise<RoutePoint[]> {
    const start = points[0];
    const reskflowPoints = points.slice(1);
    
    // Generate all permutations
    const permutations = this.generatePermutations(reskflowPoints);
    
    let bestRoute: RoutePoint[] = [];
    let bestDistance = Infinity;

    for (const perm of permutations) {
      // Validate pickup before reskflow constraint
      if (!this.validatePickupBeforeDelivery(perm)) continue;

      const route = [start, ...perm];
      const distance = await this.calculateTotalDistance(route);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRoute = route;
      }
    }

    return bestRoute;
  }

  /**
   * Genetic algorithm optimization
   */
  private async geneticAlgorithmOptimization(points: RoutePoint[]): Promise<RoutePoint[]> {
    const POPULATION_SIZE = 50;
    const GENERATIONS = 100;
    const MUTATION_RATE = 0.02;
    const ELITE_SIZE = 10;

    const start = points[0];
    const reskflowPoints = points.slice(1);

    // Initialize population
    let population = this.initializePopulation(reskflowPoints, POPULATION_SIZE);

    for (let gen = 0; gen < GENERATIONS; gen++) {
      // Evaluate fitness
      const fitness = await this.evaluatePopulation(population, start);
      
      // Selection
      const selected = this.tournamentSelection(population, fitness, ELITE_SIZE);
      
      // Crossover
      const offspring = this.crossover(selected, POPULATION_SIZE - ELITE_SIZE);
      
      // Mutation
      this.mutate(offspring, MUTATION_RATE);
      
      // New generation
      population = [...selected.slice(0, ELITE_SIZE), ...offspring];
    }

    // Return best route
    const finalFitness = await this.evaluatePopulation(population, start);
    const bestIndex = finalFitness.indexOf(Math.min(...finalFitness));
    
    return [start, ...population[bestIndex]];
  }

  /**
   * Nearest neighbor with 2-opt improvement
   */
  private async nearestNeighborWith2Opt(points: RoutePoint[]): Promise<RoutePoint[]> {
    // Start with nearest neighbor
    let route = await this.nearestNeighborRoute(points);
    
    // Apply 2-opt improvements
    let improved = true;
    while (improved) {
      improved = false;
      
      for (let i = 1; i < route.length - 2; i++) {
        for (let j = i + 1; j < route.length - 1; j++) {
          // Check if swapping improves route
          const newRoute = this.swap2Opt(route, i, j);
          
          if (this.validatePickupBeforeDelivery(newRoute)) {
            const currentDistance = await this.calculateTotalDistance(route);
            const newDistance = await this.calculateTotalDistance(newRoute);
            
            if (newDistance < currentDistance) {
              route = newRoute;
              improved = true;
            }
          }
        }
      }
    }
    
    return route;
  }

  /**
   * Nearest neighbor route construction
   */
  private async nearestNeighborRoute(points: RoutePoint[]): Promise<RoutePoint[]> {
    const route: RoutePoint[] = [points[0]];
    const unvisited = new Set(points.slice(1));
    let current = points[0];

    while (unvisited.size > 0) {
      let nearest: RoutePoint | null = null;
      let minDistance = Infinity;

      for (const point of unvisited) {
        // Check constraints
        if (!this.canVisitPoint(point, route)) continue;

        const distance = this.calculateDistance(current.location, point.location);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = point;
        }
      }

      if (nearest) {
        route.push(nearest);
        unvisited.delete(nearest);
        current = nearest;
      } else {
        // No valid point found, add any remaining
        const remaining = Array.from(unvisited);
        route.push(...remaining);
        break;
      }
    }

    return route;
  }

  /**
   * Check if point can be visited based on constraints
   */
  private canVisitPoint(point: RoutePoint, currentRoute: RoutePoint[]): boolean {
    // Check pickup before reskflow constraint
    if (point.type === 'reskflow') {
      const pickupId = `pickup_${point.id.replace('reskflow_', '')}`;
      const pickupVisited = currentRoute.some(p => p.id === pickupId);
      if (!pickupVisited) return false;
    }

    // Check time window constraints
    if (point.timeWindow) {
      const estimatedArrival = this.estimateArrivalTime(currentRoute, point);
      if (estimatedArrival < point.timeWindow.start || estimatedArrival > point.timeWindow.end) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate route metrics
   */
  private async calculateRouteMetrics(points: RoutePoint[]): Promise<RouteMetrics> {
    let totalDistance = 0;
    let totalDuration = 0;

    // Get real-time traffic data
    const trafficData = await this.getTrafficData(points);

    for (let i = 0; i < points.length - 1; i++) {
      const segment = await this.getRouteSegment(points[i].location, points[i + 1].location);
      
      // Apply traffic adjustments
      const trafficMultiplier = this.getTrafficMultiplier(segment.id, trafficData);
      
      totalDistance += segment.distance;
      totalDuration += segment.duration * trafficMultiplier;
    }

    const fuelGallons = totalDistance / this.FUEL_EFFICIENCY_MPG;
    const fuelCost = fuelGallons * this.FUEL_PRICE_PER_GALLON;
    const co2Emissions = fuelGallons * this.CO2_PER_GALLON;

    return {
      distance: totalDistance,
      duration: totalDuration,
      fuelCost,
      co2Emissions,
    };
  }

  /**
   * Get route segment details
   */
  private async getRouteSegment(from: Location, to: Location): Promise<any> {
    // Try cache first
    const cacheKey = `segment:${from.latitude},${from.longitude}:${to.latitude},${to.longitude}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Use mapping service
    const segment = await this.fetchRouteSegment(from, to);
    
    // Cache for 1 hour
    await redisClient.set(cacheKey, JSON.stringify(segment), 'EX', 3600);
    
    return segment;
  }

  /**
   * Fetch route segment from mapping service
   */
  private async fetchRouteSegment(from: Location, to: Location): Promise<any> {
    if (this.GOOGLE_MAPS_API_KEY) {
      // Use Google Maps
      const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
        params: {
          origin: `${from.latitude},${from.longitude}`,
          destination: `${to.latitude},${to.longitude}`,
          key: this.GOOGLE_MAPS_API_KEY,
          mode: 'driving',
          departure_time: 'now',
        },
      });

      const route = response.data.routes[0];
      return {
        id: `${from.latitude}_${to.latitude}`,
        distance: route.legs[0].distance.value / 1609.34, // Convert to miles
        duration: route.legs[0].duration.value / 60, // Convert to minutes
        polyline: route.overview_polyline.points,
      };
    } else if (this.MAPBOX_API_KEY) {
      // Use Mapbox as fallback
      const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
      const response = await axios.get(
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}`,
        {
          params: {
            access_token: this.MAPBOX_API_KEY,
            geometries: 'polyline',
          },
        }
      );

      const route = response.data.routes[0];
      return {
        id: `${from.latitude}_${to.latitude}`,
        distance: route.distance / 1609.34,
        duration: route.duration / 60,
        polyline: route.geometry,
      };
    } else {
      // Fallback to straight-line calculation
      return {
        id: `${from.latitude}_${to.latitude}`,
        distance: this.calculateDistance(from, to),
        duration: this.calculateDistance(from, to) * 2, // Rough estimate
        polyline: null,
      };
    }
  }

  /**
   * Get real-time traffic data
   */
  private async getTrafficData(points: RoutePoint[]): Promise<Map<string, TrafficData>> {
    const trafficMap = new Map<string, TrafficData>();

    // This would integrate with traffic APIs
    // For now, return simulated data
    for (let i = 0; i < points.length - 1; i++) {
      const segmentId = `${points[i].location.latitude}_${points[i + 1].location.latitude}`;
      trafficMap.set(segmentId, {
        segmentId,
        currentSpeed: 30 + Math.random() * 30,
        normalSpeed: 45,
        congestionLevel: Math.random() > 0.7 ? 'high' : 'low',
      });
    }

    return trafficMap;
  }

  /**
   * Get traffic multiplier for segment
   */
  private getTrafficMultiplier(segmentId: string, trafficData: Map<string, TrafficData>): number {
    const traffic = trafficData.get(segmentId);
    if (!traffic) return 1;

    const speedRatio = traffic.normalSpeed / traffic.currentSpeed;
    return Math.max(1, Math.min(3, speedRatio)); // Cap between 1x and 3x
  }

  /**
   * Generate polyline for entire route
   */
  private async generatePolyline(points: RoutePoint[]): Promise<string> {
    const segments = [];
    
    for (let i = 0; i < points.length - 1; i++) {
      const segment = await this.getRouteSegment(points[i].location, points[i + 1].location);
      if (segment.polyline) {
        segments.push(segment.polyline);
      }
    }

    // Combine polylines (simplified - actual implementation would decode and merge)
    return segments.join('');
  }

  /**
   * Find alternative routes
   */
  private async findAlternativeRoutes(
    mainRoute: RoutePoint[],
    driver: any
  ): Promise<AlternativeRoute[]> {
    const alternatives: AlternativeRoute[] = [];

    // Alternative 1: Fastest route (prioritize time)
    const fastestRoute = await this.optimizeForTime(mainRoute);
    const fastestMetrics = await this.calculateRouteMetrics(fastestRoute);
    const mainMetrics = await this.calculateRouteMetrics(mainRoute);

    alternatives.push({
      id: 'fastest',
      reason: 'Fastest route',
      points: fastestRoute,
      totalDistance: fastestMetrics.distance,
      totalTime: fastestMetrics.duration,
      comparison: {
        distanceDiff: fastestMetrics.distance - mainMetrics.distance,
        timeDiff: fastestMetrics.duration - mainMetrics.duration,
      },
    });

    // Alternative 2: Eco-friendly route (minimize fuel/emissions)
    const ecoRoute = await this.optimizeForFuelEfficiency(mainRoute);
    const ecoMetrics = await this.calculateRouteMetrics(ecoRoute);

    alternatives.push({
      id: 'eco',
      reason: 'Most fuel efficient',
      points: ecoRoute,
      totalDistance: ecoMetrics.distance,
      totalTime: ecoMetrics.duration,
      comparison: {
        distanceDiff: ecoMetrics.distance - mainMetrics.distance,
        timeDiff: ecoMetrics.duration - mainMetrics.duration,
      },
    });

    return alternatives;
  }

  /**
   * Optimize route for minimum time
   */
  private async optimizeForTime(points: RoutePoint[]): Promise<RoutePoint[]> {
    // Similar to main optimization but prioritize duration over distance
    // Implementation would adjust weights in the optimization algorithm
    return points; // Simplified
  }

  /**
   * Optimize route for fuel efficiency
   */
  private async optimizeForFuelEfficiency(points: RoutePoint[]): Promise<RoutePoint[]> {
    // Avoid highways, prefer steady speeds, minimize stops
    // Implementation would consider elevation, traffic patterns, etc.
    return points; // Simplified
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(from: Location, to: Location): number {
    const R = 3959; // Earth's radius in miles
    const lat1Rad = from.latitude * (Math.PI / 180);
    const lat2Rad = to.latitude * (Math.PI / 180);
    const deltaLat = (to.latitude - from.latitude) * (Math.PI / 180);
    const deltaLon = (to.longitude - from.longitude) * (Math.PI / 180);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) *
      Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate total distance for route
   */
  private async calculateTotalDistance(route: RoutePoint[]): Promise<number> {
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      total += this.calculateDistance(route[i].location, route[i + 1].location);
    }
    return total;
  }

  /**
   * Validate pickup before reskflow constraint
   */
  private validatePickupBeforeDelivery(route: RoutePoint[]): boolean {
    const visitedPickups = new Set<string>();
    
    for (const point of route) {
      if (point.type === 'pickup') {
        visitedPickups.add(point.orderId);
      } else if (point.type === 'reskflow') {
        if (!visitedPickups.has(point.orderId)) {
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * Generate permutations for brute force
   */
  private generatePermutations(points: RoutePoint[]): RoutePoint[][] {
    if (points.length <= 1) return [points];
    
    const result: RoutePoint[][] = [];
    
    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const remaining = [...points.slice(0, i), ...points.slice(i + 1)];
      const perms = this.generatePermutations(remaining);
      
      for (const perm of perms) {
        result.push([current, ...perm]);
      }
    }
    
    return result;
  }

  /**
   * Initialize population for genetic algorithm
   */
  private initializePopulation(points: RoutePoint[], size: number): RoutePoint[][] {
    const population: RoutePoint[][] = [];
    
    for (let i = 0; i < size; i++) {
      const individual = [...points];
      // Shuffle with constraints
      for (let j = individual.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [individual[j], individual[k]] = [individual[k], individual[j]];
      }
      
      // Fix constraint violations
      this.fixConstraintViolations(individual);
      population.push(individual);
    }
    
    return population;
  }

  /**
   * Fix constraint violations in route
   */
  private fixConstraintViolations(route: RoutePoint[]): void {
    const pickupIndices = new Map<string, number>();
    const reskflowIndices = new Map<string, number>();
    
    // Record positions
    route.forEach((point, index) => {
      if (point.type === 'pickup') {
        pickupIndices.set(point.orderId, index);
      } else if (point.type === 'reskflow') {
        reskflowIndices.set(point.orderId, index);
      }
    });
    
    // Fix violations
    for (const [orderId, reskflowIndex] of reskflowIndices) {
      const pickupIndex = pickupIndices.get(orderId);
      if (pickupIndex && pickupIndex > reskflowIndex) {
        // Swap to fix
        [route[pickupIndex], route[reskflowIndex]] = [route[reskflowIndex], route[pickupIndex]];
      }
    }
  }

  /**
   * Evaluate population fitness
   */
  private async evaluatePopulation(population: RoutePoint[][], start: RoutePoint): Promise<number[]> {
    const fitness: number[] = [];
    
    for (const individual of population) {
      const route = [start, ...individual];
      const distance = await this.calculateTotalDistance(route);
      fitness.push(1 / distance); // Inverse distance as fitness
    }
    
    return fitness;
  }

  /**
   * Tournament selection
   */
  private tournamentSelection(
    population: RoutePoint[][],
    fitness: number[],
    eliteSize: number
  ): RoutePoint[][] {
    const selected: RoutePoint[][] = [];
    const indices = Array.from({ length: population.length }, (_, i) => i);
    
    // Sort by fitness
    indices.sort((a, b) => fitness[b] - fitness[a]);
    
    // Select elite
    for (let i = 0; i < eliteSize && i < population.length; i++) {
      selected.push([...population[indices[i]]]);
    }
    
    return selected;
  }

  /**
   * Crossover operation
   */
  private crossover(parents: RoutePoint[][], offspringSize: number): RoutePoint[][] {
    const offspring: RoutePoint[][] = [];
    
    while (offspring.length < offspringSize) {
      const parent1 = parents[Math.floor(Math.random() * parents.length)];
      const parent2 = parents[Math.floor(Math.random() * parents.length)];
      
      const child = this.orderCrossover(parent1, parent2);
      this.fixConstraintViolations(child);
      
      offspring.push(child);
    }
    
    return offspring;
  }

  /**
   * Order crossover (OX)
   */
  private orderCrossover(parent1: RoutePoint[], parent2: RoutePoint[]): RoutePoint[] {
    const size = parent1.length;
    const start = Math.floor(Math.random() * size);
    const end = Math.floor(Math.random() * (size - start)) + start;
    
    const child: RoutePoint[] = new Array(size);
    const used = new Set<string>();
    
    // Copy segment from parent1
    for (let i = start; i <= end; i++) {
      child[i] = parent1[i];
      used.add(parent1[i].id);
    }
    
    // Fill remaining from parent2
    let currentPos = 0;
    for (const point of parent2) {
      if (!used.has(point.id)) {
        // Find next empty position
        while (child[currentPos] !== undefined) {
          currentPos = (currentPos + 1) % size;
        }
        child[currentPos] = point;
      }
    }
    
    return child;
  }

  /**
   * Mutation operation
   */
  private mutate(population: RoutePoint[][], mutationRate: number): void {
    for (const individual of population) {
      if (Math.random() < mutationRate) {
        const i = Math.floor(Math.random() * individual.length);
        const j = Math.floor(Math.random() * individual.length);
        
        // Swap mutation
        [individual[i], individual[j]] = [individual[j], individual[i]];
        
        // Fix violations
        this.fixConstraintViolations(individual);
      }
    }
  }

  /**
   * 2-opt swap
   */
  private swap2Opt(route: RoutePoint[], i: number, j: number): RoutePoint[] {
    const newRoute = [...route];
    
    // Reverse segment between i and j
    while (i < j) {
      [newRoute[i], newRoute[j]] = [newRoute[j], newRoute[i]];
      i++;
      j--;
    }
    
    return newRoute;
  }

  /**
   * Estimate arrival time at point
   */
  private estimateArrivalTime(currentRoute: RoutePoint[], nextPoint: RoutePoint): Date {
    // Simplified - would calculate based on current time and route progress
    const estimatedMinutes = currentRoute.length * 10; // 10 minutes per stop average
    return new Date(Date.now() + estimatedMinutes * 60 * 1000);
  }

  /**
   * Get cached route
   */
  private async getCachedRoute(points: RoutePoint[]): Promise<OptimizedRoute | null> {
    const cacheKey = this.generateRouteCacheKey(points);
    const cached = await redisClient.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    return null;
  }

  /**
   * Cache optimized route
   */
  private async cacheRoute(points: RoutePoint[], route: OptimizedRoute): Promise<void> {
    const cacheKey = this.generateRouteCacheKey(points);
    await redisClient.set(cacheKey, JSON.stringify(route), 'EX', 3600); // 1 hour cache
  }

  /**
   * Generate cache key for route
   */
  private generateRouteCacheKey(points: RoutePoint[]): string {
    const coords = points.map(p => `${p.location.latitude.toFixed(4)},${p.location.longitude.toFixed(4)}`);
    return `route:${coords.join(':')}`;
  }

  /**
   * Update route in real-time
   */
  async updateRouteRealtime(driverId: string, currentLocation: Location): Promise<OptimizedRoute | null> {
    // Get driver's active deliveries
    const activeDeliveries = await prisma.reskflow.findMany({
      where: {
        driverId,
        status: { in: ['assigned', 'picked_up'] },
      },
      include: {
        order: {
          include: {
            merchant: true,
            customer: true,
          },
        },
      },
    });

    if (activeDeliveries.length === 0) {
      return null;
    }

    // Re-optimize based on current location
    const updatedRoute = await this.optimizeRoute(driverId, activeDeliveries);

    // Check if route has significantly changed
    const previousRoute = await this.getDriverCurrentRoute(driverId);
    if (previousRoute && this.hasSignificantChange(previousRoute, updatedRoute)) {
      // Notify driver of route change
      await this.notifyRouteChange(driverId, updatedRoute);
    }

    // Save updated route
    await this.saveDriverRoute(driverId, updatedRoute);

    return updatedRoute;
  }

  /**
   * Check if route has significant changes
   */
  private hasSignificantChange(oldRoute: OptimizedRoute, newRoute: OptimizedRoute): boolean {
    // Check if order changed
    if (oldRoute.points.length !== newRoute.points.length) return true;
    
    for (let i = 0; i < oldRoute.points.length; i++) {
      if (oldRoute.points[i].id !== newRoute.points[i].id) return true;
    }

    // Check if distance/time changed significantly (>10%)
    const distanceChange = Math.abs(oldRoute.totalDistance - newRoute.totalDistance) / oldRoute.totalDistance;
    const timeChange = Math.abs(oldRoute.totalTime - newRoute.totalTime) / oldRoute.totalTime;

    return distanceChange > 0.1 || timeChange > 0.1;
  }

  /**
   * Get driver's current route
   */
  private async getDriverCurrentRoute(driverId: string): Promise<OptimizedRoute | null> {
    const cached = await redisClient.get(`driver_route:${driverId}`);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Save driver's route
   */
  private async saveDriverRoute(driverId: string, route: OptimizedRoute): Promise<void> {
    await redisClient.set(`driver_route:${driverId}`, JSON.stringify(route), 'EX', 7200);
  }

  /**
   * Notify driver of route change
   */
  private async notifyRouteChange(driverId: string, newRoute: OptimizedRoute): Promise<void> {
    await notificationService.sendDriverNotification(
      driverId,
      'Route Updated',
      `Your route has been optimized. You'll save ${newRoute.savingsPercentage.toFixed(1)}% on distance.`,
      {
        type: 'route_updated',
        routeId: newRoute.id,
      }
    );
  }

  /**
   * Get route suggestions for driver
   */
  async getRouteSuggestions(driverId: string): Promise<any> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        currentLocation: true,
        preferences: true,
      },
    });

    if (!driver) {
      throw new Error('Driver not found');
    }

    // Get available deliveries in area
    const availableDeliveries = await this.getAvailableDeliveriesNearby(
      driver.currentLocation,
      driver.preferences?.maxDistance || 10
    );

    // Group deliveries by optimization potential
    const suggestions = {
      highValue: [],
      efficient: [],
      timeSensitive: [],
    };

    for (const reskflow of availableDeliveries) {
      const score = await this.scoreDelivery(reskflow, driver);
      
      if (score.value > 20) {
        suggestions.highValue.push({ reskflow, score });
      }
      if (score.efficiency > 0.8) {
        suggestions.efficient.push({ reskflow, score });
      }
      if (score.urgency > 0.7) {
        suggestions.timeSensitive.push({ reskflow, score });
      }
    }

    return suggestions;
  }

  /**
   * Get available deliveries nearby
   */
  private async getAvailableDeliveriesNearby(location: Location, maxDistance: number): Promise<any[]> {
    // This would use geospatial queries
    const deliveries = await prisma.reskflow.findMany({
      where: {
        status: 'pending',
        driverId: null,
      },
      include: {
        order: {
          include: {
            merchant: true,
          },
        },
      },
    });

    // Filter by distance
    return deliveries.filter(reskflow => {
      const distance = this.calculateDistance(
        location,
        {
          latitude: reskflow.order.merchant.latitude,
          longitude: reskflow.order.merchant.longitude,
        }
      );
      return distance <= maxDistance;
    });
  }

  /**
   * Score reskflow for driver
   */
  private async scoreDelivery(reskflow: any, driver: any): Promise<any> {
    const pickupDistance = this.calculateDistance(
      driver.currentLocation,
      {
        latitude: reskflow.order.merchant.latitude,
        longitude: reskflow.order.merchant.longitude,
      }
    );

    const reskflowDistance = this.calculateDistance(
      {
        latitude: reskflow.order.merchant.latitude,
        longitude: reskflow.order.merchant.longitude,
      },
      {
        latitude: reskflow.order.reskflowLatitude,
        longitude: reskflow.order.reskflowLongitude,
      }
    );

    const totalDistance = pickupDistance + reskflowDistance;
    const estimatedEarnings = this.estimateDeliveryEarnings(totalDistance, reskflow);
    const efficiency = estimatedEarnings / totalDistance;

    const now = new Date();
    const orderAge = (now.getTime() - reskflow.order.createdAt.getTime()) / 60000; // minutes
    const urgency = Math.min(1, orderAge / 30); // Max urgency at 30 minutes

    return {
      value: estimatedEarnings,
      efficiency,
      urgency,
      distance: totalDistance,
    };
  }

  /**
   * Estimate reskflow earnings
   */
  private estimateDeliveryEarnings(distance: number, reskflow: any): number {
    const base = 3.50;
    const perMile = 1.25;
    const tip = reskflow.order.tipAmount || 0;
    
    return base + (distance * perMile) + tip;
  }
}

// Export singleton instance
export const routeOptimizationService = new RouteOptimizationService();