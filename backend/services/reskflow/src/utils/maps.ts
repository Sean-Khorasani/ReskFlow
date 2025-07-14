import axios from 'axios';
import { config } from '../config';
import { 
  GoogleMapsApiError, 
  RouteCalculationError, 
  InvalidLocationError,
  RouteOptimizationError 
} from './errors';
import { logger } from './logger';
import { validateCoordinates, calculateDistance, retry } from './helpers';

export interface Location {
  lat: number;
  lng: number;
  address?: string;
}

export interface RouteStep {
  instruction: string;
  distance: {
    text: string;
    value: number; // in meters
  };
  duration: {
    text: string;
    value: number; // in seconds
  };
  startLocation: Location;
  endLocation: Location;
}

export interface RouteInfo {
  distance: {
    text: string;
    value: number; // in meters
  };
  duration: {
    text: string;
    value: number; // in seconds
  };
  steps: RouteStep[];
  overview_polyline: string;
  bounds: {
    northeast: Location;
    southwest: Location;
  };
}

export interface OptimizedRoute {
  orderedWaypoints: number[];
  routes: RouteInfo[];
  totalDistance: number; // in meters
  totalDuration: number; // in seconds
}

export interface DistanceMatrixResult {
  origins: string[];
  destinations: string[];
  distances: number[][]; // in meters
  durations: number[][]; // in seconds
}

class GoogleMapsService {
  private apiKey: string;
  private baseUrl = 'https://maps.googleapis.com/maps/api';

  constructor() {
    this.apiKey = config.maps.googleApiKey;
    if (!this.apiKey) {
      throw new GoogleMapsApiError('Google Maps API key not configured');
    }
  }

  // Geocode address to coordinates
  async geocode(address: string): Promise<Location> {
    try {
      const response = await retry(
        () =>
          axios.get(`${this.baseUrl}/geocode/json`, {
            params: {
              address,
              key: this.apiKey,
            },
            timeout: 10000,
          }),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          maxDelayMs: 5000,
        }
      );

      if (response.data.status !== 'OK') {
        throw new GoogleMapsApiError(`Geocoding failed: ${response.data.status}`);
      }

      if (!response.data.results || response.data.results.length === 0) {
        throw new InvalidLocationError(`No results found for address: ${address}`);
      }

      const result = response.data.results[0];
      const location = result.geometry.location;

      return {
        lat: location.lat,
        lng: location.lng,
        address: result.formatted_address,
      };
    } catch (error) {
      if (error instanceof GoogleMapsApiError || error instanceof InvalidLocationError) {
        throw error;
      }
      
      logger.error('Geocoding error:', error);
      throw new GoogleMapsApiError(`Failed to geocode address: ${address}`);
    }
  }

  // Reverse geocode coordinates to address
  async reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      if (!validateCoordinates(lat, lng)) {
        throw new InvalidLocationError(`Invalid coordinates: ${lat}, ${lng}`);
      }

      const response = await retry(
        () =>
          axios.get(`${this.baseUrl}/geocode/json`, {
            params: {
              latlng: `${lat},${lng}`,
              key: this.apiKey,
            },
            timeout: 10000,
          }),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          maxDelayMs: 5000,
        }
      );

      if (response.data.status !== 'OK') {
        throw new GoogleMapsApiError(`Reverse geocoding failed: ${response.data.status}`);
      }

      if (!response.data.results || response.data.results.length === 0) {
        throw new InvalidLocationError(`No address found for coordinates: ${lat}, ${lng}`);
      }

      return response.data.results[0].formatted_address;
    } catch (error) {
      if (error instanceof GoogleMapsApiError || error instanceof InvalidLocationError) {
        throw error;
      }
      
      logger.error('Reverse geocoding error:', error);
      throw new GoogleMapsApiError(`Failed to reverse geocode coordinates: ${lat}, ${lng}`);
    }
  }

  // Calculate route between two points
  async calculateRoute(
    origin: Location | string,
    destination: Location | string,
    waypoints?: (Location | string)[],
    optimizeWaypoints: boolean = false
  ): Promise<RouteInfo> {
    try {
      const originParam = this.formatLocationParam(origin);
      const destinationParam = this.formatLocationParam(destination);
      
      const params: any = {
        origin: originParam,
        destination: destinationParam,
        key: this.apiKey,
        mode: 'driving',
        units: 'metric',
        alternatives: false,
      };

      if (waypoints && waypoints.length > 0) {
        const waypointParams = waypoints.map(wp => this.formatLocationParam(wp));
        params.waypoints = (optimizeWaypoints ? 'optimize:true|' : '') + waypointParams.join('|');
      }

      const response = await retry(
        () =>
          axios.get(`${this.baseUrl}/directions/json`, {
            params,
            timeout: 15000,
          }),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          maxDelayMs: 5000,
        }
      );

      if (response.data.status !== 'OK') {
        throw new RouteCalculationError(originParam, destinationParam);
      }

      if (!response.data.routes || response.data.routes.length === 0) {
        throw new RouteCalculationError(originParam, destinationParam);
      }

      const route = response.data.routes[0];
      const leg = route.legs[0];

      return {
        distance: leg.distance,
        duration: leg.duration,
        steps: leg.steps.map((step: any) => ({
          instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
          distance: step.distance,
          duration: step.duration,
          startLocation: step.start_location,
          endLocation: step.end_location,
        })),
        overview_polyline: route.overview_polyline.points,
        bounds: route.bounds,
      };
    } catch (error) {
      if (error instanceof RouteCalculationError || error instanceof GoogleMapsApiError) {
        throw error;
      }
      
      logger.error('Route calculation error:', error);
      throw new RouteCalculationError(
        typeof origin === 'string' ? origin : `${origin.lat},${origin.lng}`,
        typeof destination === 'string' ? destination : `${destination.lat},${destination.lng}`
      );
    }
  }

  // Get distance matrix for multiple origins and destinations
  async getDistanceMatrix(
    origins: (Location | string)[],
    destinations: (Location | string)[]
  ): Promise<DistanceMatrixResult> {
    try {
      if (origins.length === 0 || destinations.length === 0) {
        throw new InvalidLocationError('Origins and destinations cannot be empty');
      }

      const originParams = origins.map(origin => this.formatLocationParam(origin));
      const destinationParams = destinations.map(dest => this.formatLocationParam(dest));

      const response = await retry(
        () =>
          axios.get(`${this.baseUrl}/distancematrix/json`, {
            params: {
              origins: originParams.join('|'),
              destinations: destinationParams.join('|'),
              key: this.apiKey,
              mode: 'driving',
              units: 'metric',
              avoid: 'tolls',
            },
            timeout: 15000,
          }),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          maxDelayMs: 5000,
        }
      );

      if (response.data.status !== 'OK') {
        throw new GoogleMapsApiError(`Distance matrix failed: ${response.data.status}`);
      }

      const distances: number[][] = [];
      const durations: number[][] = [];

      response.data.rows.forEach((row: any, i: number) => {
        distances[i] = [];
        durations[i] = [];
        
        row.elements.forEach((element: any, j: number) => {
          if (element.status === 'OK') {
            distances[i][j] = element.distance.value;
            durations[i][j] = element.duration.value;
          } else {
            distances[i][j] = Infinity;
            durations[i][j] = Infinity;
          }
        });
      });

      return {
        origins: response.data.origin_addresses,
        destinations: response.data.destination_addresses,
        distances,
        durations,
      };
    } catch (error) {
      if (error instanceof GoogleMapsApiError || error instanceof InvalidLocationError) {
        throw error;
      }
      
      logger.error('Distance matrix error:', error);
      throw new GoogleMapsApiError('Failed to calculate distance matrix');
    }
  }

  // Optimize reskflow route for multiple waypoints
  async optimizeDeliveryRoute(
    depot: Location | string,
    reskflowPoints: (Location | string)[]
  ): Promise<OptimizedRoute> {
    try {
      if (reskflowPoints.length === 0) {
        throw new InvalidLocationError('Delivery points cannot be empty');
      }

      if (reskflowPoints.length === 1) {
        // Single reskflow point - no optimization needed
        const route = await this.calculateRoute(depot, reskflowPoints[0]);
        return {
          orderedWaypoints: [0],
          routes: [route],
          totalDistance: route.distance.value,
          totalDuration: route.duration.value,
        };
      }

      // For multiple points, use waypoint optimization
      const route = await this.calculateRoute(
        depot,
        depot, // Return to depot
        reskflowPoints,
        true // optimize waypoints
      );

      // Extract waypoint order from response
      // This would need to be parsed from the Google Maps response
      // For now, we'll return the optimized route info
      return {
        orderedWaypoints: Array.from({ length: reskflowPoints.length }, (_, i) => i),
        routes: [route],
        totalDistance: route.distance.value,
        totalDuration: route.duration.value,
      };
    } catch (error) {
      if (error instanceof InvalidLocationError || error instanceof RouteCalculationError) {
        throw error;
      }
      
      logger.error('Route optimization error:', error);
      throw new RouteOptimizationError('Failed to optimize reskflow route');
    }
  }

  // Find nearby drivers within radius
  async findNearbyDrivers(
    center: Location,
    radiusKm: number,
    driverLocations: { id: string; location: Location }[]
  ): Promise<{ id: string; location: Location; distance: number }[]> {
    try {
      if (!validateCoordinates(center.lat, center.lng)) {
        throw new InvalidLocationError(`Invalid center coordinates: ${center.lat}, ${center.lng}`);
      }

      const nearbyDrivers = driverLocations
        .map(driver => {
          if (!validateCoordinates(driver.location.lat, driver.location.lng)) {
            logger.warn(`Invalid driver coordinates: ${driver.id}`, driver.location);
            return null;
          }

          const distance = calculateDistance(
            center.lat,
            center.lng,
            driver.location.lat,
            driver.location.lng
          );

          return {
            id: driver.id,
            location: driver.location,
            distance,
          };
        })
        .filter((driver): driver is NonNullable<typeof driver> => driver !== null)
        .filter(driver => driver.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance);

      return nearbyDrivers;
    } catch (error) {
      if (error instanceof InvalidLocationError) {
        throw error;
      }
      
      logger.error('Error finding nearby drivers:', error);
      throw new GoogleMapsApiError('Failed to find nearby drivers');
    }
  }

  // Estimate arrival time considering traffic
  async estimateArrivalTime(
    origin: Location | string,
    destination: Location | string,
    departureTime?: Date
  ): Promise<{ duration: number; durationInTraffic: number }> {
    try {
      const originParam = this.formatLocationParam(origin);
      const destinationParam = this.formatLocationParam(destination);
      
      const params: any = {
        origin: originParam,
        destination: destinationParam,
        key: this.apiKey,
        mode: 'driving',
        units: 'metric',
        departure_time: departureTime ? Math.floor(departureTime.getTime() / 1000) : 'now',
        traffic_model: 'best_guess',
      };

      const response = await retry(
        () =>
          axios.get(`${this.baseUrl}/directions/json`, {
            params,
            timeout: 10000,
          }),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          maxDelayMs: 5000,
        }
      );

      if (response.data.status !== 'OK') {
        throw new RouteCalculationError(originParam, destinationParam);
      }

      const route = response.data.routes[0];
      const leg = route.legs[0];

      return {
        duration: leg.duration.value,
        durationInTraffic: leg.duration_in_traffic?.value || leg.duration.value,
      };
    } catch (error) {
      if (error instanceof RouteCalculationError || error instanceof GoogleMapsApiError) {
        throw error;
      }
      
      logger.error('Error estimating arrival time:', error);
      throw new GoogleMapsApiError('Failed to estimate arrival time');
    }
  }

  // Format location parameter for API calls
  private formatLocationParam(location: Location | string): string {
    if (typeof location === 'string') {
      return location;
    }
    
    if (!validateCoordinates(location.lat, location.lng)) {
      throw new InvalidLocationError(`Invalid coordinates: ${location.lat}, ${location.lng}`);
    }
    
    return `${location.lat},${location.lng}`;
  }

  // Validate Google Maps API response
  private validateApiResponse(response: any, operation: string): void {
    if (!response.data) {
      throw new GoogleMapsApiError(`Invalid response from ${operation}`);
    }

    if (response.data.status === 'REQUEST_DENIED') {
      throw new GoogleMapsApiError(`API request denied for ${operation}: ${response.data.error_message}`);
    }

    if (response.data.status === 'OVER_QUERY_LIMIT') {
      throw new GoogleMapsApiError(`Query limit exceeded for ${operation}`);
    }

    if (response.data.status === 'INVALID_REQUEST') {
      throw new GoogleMapsApiError(`Invalid request for ${operation}: ${response.data.error_message}`);
    }
  }
}

// Export singleton instance
export const googleMapsService = new GoogleMapsService();

// Export utility functions
export {
  GoogleMapsService,
};