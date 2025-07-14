import * as turf from '@turf/turf';
import { Client } from '@googlemaps/google-maps-services-js';
import { GeneticAlgorithm } from '../utils/geneticAlgorithm';
import { prisma, logger } from '@reskflow/shared';

interface Location {
  latitude: number;
  longitude: number;
}

interface RouteConstraints {
  maxDistance?: number;
  maxDuration?: number;
  maxDeliveries?: number;
  vehicleCapacity?: number;
  timeWindows?: Array<{ start: Date; end: Date }>;
}

interface OptimizationResult {
  optimizedRoute: Array<{
    reskflowId: string;
    sequence: number;
    estimatedArrival: Date;
    distance: number;
    duration: number;
  }>;
  totalDistance: number;
  totalDuration: number;
  estimatedCost: number;
  savings: number;
}

export class RouteOptimizer {
  private googleMapsClient: Client;
  private geneticAlgorithm: GeneticAlgorithm;

  constructor() {
    this.googleMapsClient = new Client({});
    this.geneticAlgorithm = new GeneticAlgorithm();
  }

  async optimizeRoute(params: {
    driverId: string;
    reskflowIds: string[];
    startLocation: Location;
    constraints?: RouteConstraints;
  }): Promise<OptimizationResult> {
    const { driverId, reskflowIds, startLocation, constraints = {} } = params;

    // Fetch reskflow details
    const deliveries = await prisma.reskflow.findMany({
      where: {
        id: { in: reskflowIds },
        status: { in: ['ASSIGNED', 'PICKED_UP'] },
      },
      include: {
        pickupAddress: true,
        reskflowAddress: true,
      },
    });

    if (deliveries.length === 0) {
      throw new Error('No valid deliveries found');
    }

    // Build distance matrix
    const locations = this.extractLocations(deliveries, startLocation);
    const distanceMatrix = await this.buildDistanceMatrix(locations);

    // Apply different optimization strategies based on problem size
    let optimizedSequence: number[];
    
    if (deliveries.length <= 10) {
      // Use exact algorithm for small problems
      optimizedSequence = this.bruteForceOptimization(distanceMatrix);
    } else if (deliveries.length <= 25) {
      // Use genetic algorithm for medium problems
      optimizedSequence = await this.geneticOptimization(
        distanceMatrix,
        constraints
      );
    } else {
      // Use heuristics for large problems
      optimizedSequence = this.nearestNeighborOptimization(distanceMatrix);
    }

    // Build optimized route with time windows
    const optimizedRoute = this.buildOptimizedRoute(
      deliveries,
      optimizedSequence,
      distanceMatrix,
      startLocation
    );

    // Calculate metrics
    const totalDistance = optimizedRoute.reduce((sum, stop) => sum + stop.distance, 0);
    const totalDuration = optimizedRoute.reduce((sum, stop) => sum + stop.duration, 0);
    const estimatedCost = this.calculateCost(totalDistance, totalDuration);

    // Calculate savings compared to naive route
    const naiveDistance = this.calculateNaiveDistance(distanceMatrix);
    const savings = ((naiveDistance - totalDistance) / naiveDistance) * 100;

    // Store optimization result
    await this.storeOptimizationResult({
      driverId,
      reskflowIds,
      optimizedRoute,
      totalDistance,
      totalDuration,
      savings,
    });

    return {
      optimizedRoute,
      totalDistance,
      totalDuration,
      estimatedCost,
      savings,
    };
  }

  private extractLocations(deliveries: any[], startLocation: Location): Location[] {
    const locations: Location[] = [startLocation];

    deliveries.forEach(reskflow => {
      // Add pickup if not already picked up
      if (reskflow.status === 'ASSIGNED') {
        locations.push({
          latitude: reskflow.pickupAddress.latitude,
          longitude: reskflow.pickupAddress.longitude,
        });
      }
      // Add reskflow location
      locations.push({
        latitude: reskflow.reskflowAddress.latitude,
        longitude: reskflow.reskflowAddress.longitude,
      });
    });

    return locations;
  }

  private async buildDistanceMatrix(locations: Location[]): Promise<number[][]> {
    const n = locations.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    // Use Google Maps Distance Matrix API for accurate distances
    try {
      const origins = locations.map(loc => ({
        lat: loc.latitude,
        lng: loc.longitude,
      }));

      const response = await this.googleMapsClient.distancematrix({
        params: {
          origins: origins,
          destinations: origins,
          mode: 'driving',
          key: process.env.GOOGLE_MAPS_API_KEY!,
        },
      });

      response.data.rows.forEach((row, i) => {
        row.elements.forEach((element, j) => {
          if (element.status === 'OK') {
            matrix[i][j] = element.distance.value / 1000; // Convert to km
          } else {
            // Fallback to Haversine distance
            matrix[i][j] = this.calculateHaversineDistance(
              locations[i],
              locations[j]
            );
          }
        });
      });
    } catch (error) {
      logger.warn('Google Maps API failed, using Haversine distance', error);
      // Fallback to Haversine distance for all pairs
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          matrix[i][j] = this.calculateHaversineDistance(locations[i], locations[j]);
        }
      }
    }

    return matrix;
  }

  private calculateHaversineDistance(loc1: Location, loc2: Location): number {
    const R = 6371; // Earth's radius in km
    const dLat = (loc2.latitude - loc1.latitude) * Math.PI / 180;
    const dLon = (loc2.longitude - loc1.longitude) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(loc1.latitude * Math.PI / 180) * 
      Math.cos(loc2.latitude * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private bruteForceOptimization(distanceMatrix: number[][]): number[] {
    const n = distanceMatrix.length - 1; // Exclude start location
    const indices = Array.from({ length: n }, (_, i) => i + 1);
    
    let minDistance = Infinity;
    let bestRoute: number[] = [];

    // Generate all permutations
    const permute = (arr: number[], l: number = 0): void => {
      if (l === arr.length - 1) {
        const route = [0, ...arr, 0]; // Start and end at origin
        const distance = this.calculateRouteDistance(route, distanceMatrix);
        if (distance < minDistance) {
          minDistance = distance;
          bestRoute = [...arr];
        }
        return;
      }

      for (let i = l; i < arr.length; i++) {
        [arr[l], arr[i]] = [arr[i], arr[l]];
        permute(arr, l + 1);
        [arr[l], arr[i]] = [arr[i], arr[l]];
      }
    };

    permute(indices);
    return bestRoute;
  }

  private async geneticOptimization(
    distanceMatrix: number[][],
    constraints: RouteConstraints
  ): Promise<number[]> {
    const n = distanceMatrix.length - 1;
    const indices = Array.from({ length: n }, (_, i) => i + 1);

    const fitness = (chromosome: number[]): number => {
      const route = [0, ...chromosome, 0];
      const distance = this.calculateRouteDistance(route, distanceMatrix);
      return 1 / (1 + distance); // Higher fitness for shorter routes
    };

    const result = await this.geneticAlgorithm.evolve({
      populationSize: 100,
      chromosomeLength: n,
      genes: indices,
      fitnessFunction: fitness,
      generations: 500,
      mutationRate: 0.01,
      crossoverRate: 0.7,
      elitismRate: 0.1,
    });

    return result.chromosome;
  }

  private nearestNeighborOptimization(distanceMatrix: number[][]): number[] {
    const n = distanceMatrix.length;
    const visited = new Set<number>([0]); // Start from origin
    const route: number[] = [];
    let current = 0;

    while (visited.size < n) {
      let nearest = -1;
      let minDistance = Infinity;

      for (let i = 1; i < n; i++) {
        if (!visited.has(i) && distanceMatrix[current][i] < minDistance) {
          minDistance = distanceMatrix[current][i];
          nearest = i;
        }
      }

      if (nearest !== -1) {
        visited.add(nearest);
        route.push(nearest);
        current = nearest;
      }
    }

    return route;
  }

  private calculateRouteDistance(route: number[], distanceMatrix: number[][]): number {
    let distance = 0;
    for (let i = 0; i < route.length - 1; i++) {
      distance += distanceMatrix[route[i]][route[i + 1]];
    }
    return distance;
  }

  private buildOptimizedRoute(
    deliveries: any[],
    sequence: number[],
    distanceMatrix: number[][],
    startLocation: Location
  ): Array<any> {
    const route = [];
    let currentTime = new Date();
    let currentIndex = 0; // Start location

    for (let i = 0; i < sequence.length; i++) {
      const nextIndex = sequence[i];
      const reskflowIndex = Math.floor((nextIndex - 1) / 2);
      const reskflow = deliveries[reskflowIndex];
      const isPickup = (nextIndex - 1) % 2 === 0;

      const distance = distanceMatrix[currentIndex][nextIndex];
      const duration = distance * 2; // Rough estimate: 2 min/km

      currentTime = new Date(currentTime.getTime() + duration * 60 * 1000);

      route.push({
        reskflowId: reskflow.id,
        sequence: i + 1,
        type: isPickup ? 'PICKUP' : 'DELIVERY',
        estimatedArrival: currentTime,
        distance,
        duration,
        address: isPickup ? reskflow.pickupAddress : reskflow.reskflowAddress,
      });

      currentIndex = nextIndex;
    }

    return route;
  }

  private calculateCost(distance: number, duration: number): number {
    const fuelCostPerKm = 0.15;
    const driverCostPerMin = 0.25;
    const vehicleDepreciation = 0.10;

    return (
      distance * (fuelCostPerKm + vehicleDepreciation) +
      duration * driverCostPerMin
    );
  }

  private calculateNaiveDistance(distanceMatrix: number[][]): number {
    // Calculate distance if visiting locations in order
    let distance = 0;
    for (let i = 0; i < distanceMatrix.length - 1; i++) {
      distance += distanceMatrix[i][i + 1];
    }
    distance += distanceMatrix[distanceMatrix.length - 1][0]; // Return to start
    return distance;
  }

  private async storeOptimizationResult(result: any): Promise<void> {
    // Store in database for analytics and ML training
    try {
      await prisma.$executeRaw`
        INSERT INTO route_optimizations (
          driver_id, reskflow_ids, route_data, 
          total_distance, total_duration, savings, 
          created_at
        ) VALUES (
          ${result.driverId},
          ${JSON.stringify(result.reskflowIds)},
          ${JSON.stringify(result.optimizedRoute)},
          ${result.totalDistance},
          ${result.totalDuration},
          ${result.savings},
          ${new Date()}
        )
      `;
    } catch (error) {
      logger.error('Failed to store optimization result', error);
    }
  }
}