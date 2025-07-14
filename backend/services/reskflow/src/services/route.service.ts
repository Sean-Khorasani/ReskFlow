import axios from 'axios';
import { redis } from '../config/redis';
import {
  Coordinates,
  RouteInfo,
  RouteStep,
  OptimizedRoute,
  RouteCalculationRequest,
  RouteOptimizationRequest,
  VehicleType,
} from '../types/reskflow.types';
import {
  RouteCalculationError,
  ValidationError,
  ExternalServiceError,
} from '../utils/errors';
import {
  validateCoordinates,
  calculateDistance,
} from '../utils/helpers';
import { routeLogger, loggerHelpers } from '../utils/logger';
import { config } from '../config';

interface GoogleMapsDirectionsResponse {
  status: string;
  routes: Array<{
    summary: string;
    legs: Array<{
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      steps: Array<{
        html_instructions: string;
        distance: { text: string; value: number };
        duration: { text: string; value: number };
        start_location: { lat: number; lng: number };
        end_location: { lat: number; lng: number };
      }>;
    }>;
    overview_polyline: { points: string };
    bounds: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
  }>;
  geocoded_waypoints?: Array<{
    geocoder_status: string;
    place_id: string;
  }>;
}

interface GoogleMapsDistanceMatrixResponse {
  status: string;
  rows: Array<{
    elements: Array<{
      status: string;
      distance: { text: string; value: number };
      duration: { text: string; value: number };
    }>;
  }>;
}

export class RouteService {
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly MAPS_API_KEY = config.googleMaps.apiKey;
  private readonly BASE_URL = 'https://maps.googleapis.com/maps/api';
  private readonly MAX_WAYPOINTS = 23; // Google Maps API limit
  private readonly REQUEST_TIMEOUT = 10000; // 10 seconds

  /**
   * Calculate route between two points
   */
  async calculateRoute(request: RouteCalculationRequest): Promise<RouteInfo> {
    try {
      const { origin, destination, waypoints, optimizeWaypoints = false, vehicleType } = request;

      // Validate coordinates
      if (!validateCoordinates(origin.lat, origin.lng)) {
        throw new ValidationError('Invalid origin coordinates');
      }
      if (!validateCoordinates(destination.lat, destination.lng)) {
        throw new ValidationError('Invalid destination coordinates');
      }

      // Validate waypoints if provided
      if (waypoints) {
        if (waypoints.length > this.MAX_WAYPOINTS) {
          throw new ValidationError(`Maximum ${this.MAX_WAYPOINTS} waypoints allowed`);
        }
        
        for (const waypoint of waypoints) {
          if (!validateCoordinates(waypoint.lat, waypoint.lng)) {
            throw new ValidationError('Invalid waypoint coordinates');
          }
        }
      }

      // Check cache first
      const cacheKey = this.generateCacheKey('route', request);
      const cached = await redis.getJson<RouteInfo>(cacheKey);
      if (cached) {
        routeLogger.debug('Route retrieved from cache', { cacheKey });
        return cached;
      }

      // Build request parameters
      const params = this.buildDirectionsParams(request);

      // Make API request
      const response = await axios.get<GoogleMapsDirectionsResponse>(
        `${this.BASE_URL}/directions/json`,
        {
          params,
          timeout: this.REQUEST_TIMEOUT,
        }
      );

      if (response.data.status !== 'OK') {
        throw new RouteCalculationError(`Google Maps API error: ${response.data.status}`);
      }

      if (!response.data.routes || response.data.routes.length === 0) {
        throw new RouteCalculationError('No routes found');
      }

      const route = response.data.routes[0];
      const leg = route.legs[0];

      // Format response
      const routeInfo: RouteInfo = {
        distance: leg.distance,
        duration: leg.duration,
        steps: leg.steps.map(step => this.formatRouteStep(step)),
        overview_polyline: route.overview_polyline.points,
        bounds: {
          northeast: route.bounds.northeast,
          southwest: route.bounds.southwest,
        },
      };

      // Cache the result
      await redis.setJson(cacheKey, routeInfo, this.CACHE_TTL);

      // Log business event
      loggerHelpers.logBusinessEvent('route_calculated', {
        origin,
        destination,
        distance: leg.distance.value,
        duration: leg.duration.value,
        vehicleType,
        waypointsCount: waypoints?.length || 0,
      });

      routeLogger.info('Route calculated successfully', {
        origin,
        destination,
        distance: leg.distance.text,
        duration: leg.duration.text,
        waypointsCount: waypoints?.length || 0,
      });

      return routeInfo;
    } catch (error) {
      routeLogger.error('Failed to calculate route', {
        request,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Optimize route with multiple waypoints
   */
  async optimizeRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    try {
      const { depot, reskflowPoints, vehicleType, maxDuration, maxDistance } = request;

      // Validate depot coordinates
      if (!validateCoordinates(depot.lat, depot.lng)) {
        throw new ValidationError('Invalid depot coordinates');
      }

      // Validate reskflow points
      if (!reskflowPoints || reskflowPoints.length === 0) {
        throw new ValidationError('At least one reskflow point is required');
      }

      if (reskflowPoints.length > this.MAX_WAYPOINTS) {
        throw new ValidationError(`Maximum ${this.MAX_WAYPOINTS} reskflow points allowed`);
      }

      for (const point of reskflowPoints) {
        if (!validateCoordinates(point.lat, point.lng)) {
          throw new ValidationError('Invalid reskflow point coordinates');
        }
      }

      // Check cache first
      const cacheKey = this.generateCacheKey('optimize', request);
      const cached = await redis.getJson<OptimizedRoute>(cacheKey);
      if (cached) {
        routeLogger.debug('Optimized route retrieved from cache', { cacheKey });
        return cached;
      }

      // For large numbers of points, use our own optimization
      if (reskflowPoints.length > 10) {
        return this.optimizeRouteLarge(depot, reskflowPoints, vehicleType);
      }

      // Use Google Maps optimization for smaller sets
      const routeRequest: RouteCalculationRequest = {
        origin: depot,
        destination: depot, // Return to depot
        waypoints: reskflowPoints,
        optimizeWaypoints: true,
        vehicleType,
      };

      const params = this.buildDirectionsParams(routeRequest);

      const response = await axios.get<GoogleMapsDirectionsResponse>(
        `${this.BASE_URL}/directions/json`,
        {
          params,
          timeout: this.REQUEST_TIMEOUT,
        }
      );

      if (response.data.status !== 'OK') {
        throw new RouteCalculationError(`Google Maps API error: ${response.data.status}`);
      }

      if (!response.data.routes || response.data.routes.length === 0) {
        throw new RouteCalculationError('No optimized routes found');
      }

      const route = response.data.routes[0];
      
      // Calculate total distance and duration
      let totalDistance = 0;
      let totalDuration = 0;
      const routes: RouteInfo[] = [];

      for (const leg of route.legs) {
        totalDistance += leg.distance.value;
        totalDuration += leg.duration.value;
        
        routes.push({
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps.map(step => this.formatRouteStep(step)),
          overview_polyline: route.overview_polyline.points,
          bounds: route.bounds,
        });
      }

      // Extract waypoint order from response
      const orderedWaypoints = response.data.geocoded_waypoints
        ?.slice(1, -1) // Remove origin and destination
        .map((_, index) => index) || [];

      const optimizedRoute: OptimizedRoute = {
        orderedWaypoints,
        routes,
        totalDistance,
        totalDuration,
      };

      // Validate constraints
      if (maxDistance && totalDistance > maxDistance) {
        routeLogger.warn('Route exceeds maximum distance constraint', {
          totalDistance,
          maxDistance,
        });
      }

      if (maxDuration && totalDuration > maxDuration) {
        routeLogger.warn('Route exceeds maximum duration constraint', {
          totalDuration,
          maxDuration,
        });
      }

      // Cache the result
      await redis.setJson(cacheKey, optimizedRoute, this.CACHE_TTL);

      // Log business event
      loggerHelpers.logBusinessEvent('route_optimized', {
        depot,
        reskflowPointsCount: reskflowPoints.length,
        totalDistance,
        totalDuration,
        vehicleType,
        savings: this.calculateSavings(depot, reskflowPoints, optimizedRoute),
      });

      routeLogger.info('Route optimized successfully', {
        reskflowPointsCount: reskflowPoints.length,
        totalDistance: `${(totalDistance / 1000).toFixed(2)} km`,
        totalDuration: `${Math.round(totalDuration / 60)} minutes`,
      });

      return optimizedRoute;
    } catch (error) {
      routeLogger.error('Failed to optimize route', {
        request,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Calculate distance matrix between multiple points
   */
  async calculateDistanceMatrix(
    origins: Coordinates[],
    destinations: Coordinates[]
  ): Promise<number[][]> {
    try {
      // Validate coordinates
      for (const origin of origins) {
        if (!validateCoordinates(origin.lat, origin.lng)) {
          throw new ValidationError('Invalid origin coordinates');
        }
      }

      for (const destination of destinations) {
        if (!validateCoordinates(destination.lat, destination.lng)) {
          throw new ValidationError('Invalid destination coordinates');
        }
      }

      // Check cache
      const cacheKey = this.generateMatrixCacheKey(origins, destinations);
      const cached = await redis.getJson<number[][]>(cacheKey);
      if (cached) {
        return cached;
      }

      const params = {
        origins: origins.map(coord => `${coord.lat},${coord.lng}`).join('|'),
        destinations: destinations.map(coord => `${coord.lat},${coord.lng}`).join('|'),
        units: 'metric',
        key: this.MAPS_API_KEY,
      };

      const response = await axios.get<GoogleMapsDistanceMatrixResponse>(
        `${this.BASE_URL}/distancematrix/json`,
        {
          params,
          timeout: this.REQUEST_TIMEOUT,
        }
      );

      if (response.data.status !== 'OK') {
        throw new RouteCalculationError(`Google Maps API error: ${response.data.status}`);
      }

      // Extract distance matrix
      const matrix: number[][] = response.data.rows.map(row =>
        row.elements.map(element => 
          element.status === 'OK' ? element.distance.value : Infinity
        )
      );

      // Cache the result
      await redis.setJson(cacheKey, matrix, this.CACHE_TTL);

      return matrix;
    } catch (error) {
      routeLogger.error('Failed to calculate distance matrix', {
        originsCount: origins.length,
        destinationsCount: destinations.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Estimate reskflow time based on route
   */
  async estimateDeliveryTime(
    origin: Coordinates,
    destination: Coordinates,
    vehicleType?: VehicleType
  ): Promise<{ duration: number; arrivalTime: Date }> {
    try {
      const route = await this.calculateRoute({
        origin,
        destination,
        vehicleType,
      });

      const durationSeconds = route.duration.value;
      const arrivalTime = new Date(Date.now() + durationSeconds * 1000);

      return {
        duration: durationSeconds,
        arrivalTime,
      };
    } catch (error) {
      routeLogger.error('Failed to estimate reskflow time', {
        origin,
        destination,
        vehicleType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get route alternatives
   */
  async getRouteAlternatives(request: RouteCalculationRequest): Promise<RouteInfo[]> {
    try {
      const params = {
        ...this.buildDirectionsParams(request),
        alternatives: true,
      };

      const response = await axios.get<GoogleMapsDirectionsResponse>(
        `${this.BASE_URL}/directions/json`,
        {
          params,
          timeout: this.REQUEST_TIMEOUT,
        }
      );

      if (response.data.status !== 'OK') {
        throw new RouteCalculationError(`Google Maps API error: ${response.data.status}`);
      }

      return response.data.routes.map(route => {
        const leg = route.legs[0];
        return {
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps.map(step => this.formatRouteStep(step)),
          overview_polyline: route.overview_polyline.points,
          bounds: route.bounds,
        };
      });
    } catch (error) {
      routeLogger.error('Failed to get route alternatives', {
        request,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private buildDirectionsParams(request: RouteCalculationRequest) {
    const params: any = {
      origin: `${request.origin.lat},${request.origin.lng}`,
      destination: `${request.destination.lat},${request.destination.lng}`,
      key: this.MAPS_API_KEY,
      units: 'metric',
    };

    if (request.waypoints && request.waypoints.length > 0) {
      const waypointStr = request.waypoints
        .map(wp => `${wp.lat},${wp.lng}`)
        .join('|');
      
      params.waypoints = request.optimizeWaypoints 
        ? `optimize:true|${waypointStr}`
        : waypointStr;
    }

    // Set travel mode based on vehicle type
    if (request.vehicleType) {
      params.mode = this.getTravelMode(request.vehicleType);
    }

    return params;
  }

  private getTravelMode(vehicleType: VehicleType): string {
    const modeMap: Record<VehicleType, string> = {
      [VehicleType.CAR]: 'driving',
      [VehicleType.MOTORCYCLE]: 'driving',
      [VehicleType.BICYCLE]: 'bicycling',
      [VehicleType.TRUCK]: 'driving',
    };

    return modeMap[vehicleType] || 'driving';
  }

  private formatRouteStep(step: any): RouteStep {
    return {
      instruction: step.html_instructions.replace(/<[^>]*>/g, ''), // Remove HTML tags
      distance: step.distance,
      duration: step.duration,
      startLocation: step.start_location,
      endLocation: step.end_location,
    };
  }

  private generateCacheKey(type: string, request: any): string {
    const hash = Buffer.from(JSON.stringify(request)).toString('base64');
    return `route:${type}:${hash}`;
  }

  private generateMatrixCacheKey(origins: Coordinates[], destinations: Coordinates[]): string {
    const data = { origins, destinations };
    const hash = Buffer.from(JSON.stringify(data)).toString('base64');
    return `matrix:${hash}`;
  }

  private async optimizeRouteLarge(
    depot: Coordinates,
    reskflowPoints: Coordinates[],
    vehicleType?: VehicleType
  ): Promise<OptimizedRoute> {
    // For large point sets, use nearest neighbor heuristic
    const points = [depot, ...reskflowPoints];
    const visited = new Set<number>();
    const route: number[] = [];
    
    let currentPoint = 0; // Start at depot
    visited.add(0);

    while (visited.size < points.length) {
      let nearestPoint = -1;
      let nearestDistance = Infinity;

      for (let i = 1; i < points.length; i++) {
        if (!visited.has(i)) {
          const distance = calculateDistance(
            points[currentPoint].lat,
            points[currentPoint].lng,
            points[i].lat,
            points[i].lng
          );

          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPoint = i;
          }
        }
      }

      if (nearestPoint !== -1) {
        visited.add(nearestPoint);
        route.push(nearestPoint - 1); // Subtract 1 to get reskflow point index
        currentPoint = nearestPoint;
      }
    }

    // Calculate routes between consecutive points
    const routes: RouteInfo[] = [];
    let totalDistance = 0;
    let totalDuration = 0;

    // Route from depot to first reskflow
    if (route.length > 0) {
      const firstRoute = await this.calculateRoute({
        origin: depot,
        destination: reskflowPoints[route[0]],
        vehicleType,
      });
      routes.push(firstRoute);
      totalDistance += firstRoute.distance.value;
      totalDuration += firstRoute.duration.value;
    }

    // Routes between deliveries
    for (let i = 0; i < route.length - 1; i++) {
      const segmentRoute = await this.calculateRoute({
        origin: reskflowPoints[route[i]],
        destination: reskflowPoints[route[i + 1]],
        vehicleType,
      });
      routes.push(segmentRoute);
      totalDistance += segmentRoute.distance.value;
      totalDuration += segmentRoute.duration.value;
    }

    // Route back to depot
    if (route.length > 0) {
      const returnRoute = await this.calculateRoute({
        origin: reskflowPoints[route[route.length - 1]],
        destination: depot,
        vehicleType,
      });
      routes.push(returnRoute);
      totalDistance += returnRoute.distance.value;
      totalDuration += returnRoute.duration.value;
    }

    return {
      orderedWaypoints: route,
      routes,
      totalDistance,
      totalDuration,
    };
  }

  private calculateSavings(
    depot: Coordinates,
    reskflowPoints: Coordinates[],
    optimizedRoute: OptimizedRoute
  ): number {
    // Calculate savings compared to visiting each point individually
    let unoptimizedDistance = 0;
    
    for (const point of reskflowPoints) {
      const distance = calculateDistance(
        depot.lat,
        depot.lng,
        point.lat,
        point.lng
      );
      unoptimizedDistance += distance * 2 * 1000; // Round trip in meters
    }

    const savings = unoptimizedDistance - optimizedRoute.totalDistance;
    return Math.max(0, savings);
  }
}