import { prisma, logger, redis } from '@reskflow/shared';
import * as geolib from 'geolib';
import * as turf from '@turf/turf';
import NodeGeocoder from 'node-geocoder';
import { MerchantStatus } from '@prisma/client';

interface Location {
  latitude: number;
  longitude: number;
}

interface Address {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  formatted: string;
}

export class GeolocationService {
  private geocoder: NodeGeocoder.Geocoder;

  constructor() {
    this.geocoder = NodeGeocoder({
      provider: 'google',
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      formatter: null,
    });
  }

  async getNearbyMerchants(
    latitude: number,
    longitude: number,
    radius: number,
    limit: number = 20
  ): Promise<any[]> {
    try {
      // Get all active merchants with locations
      const merchants = await prisma.merchant.findMany({
        where: { status: MerchantStatus.ACTIVE },
        include: {
          locations: true,
          operatingHours: {
            where: {
              dayOfWeek: new Date().getDay(),
            },
          },
        },
      });

      // Filter by distance and sort
      const nearbyMerchants = merchants
        .map(merchant => {
          const primaryLocation = merchant.locations.find(l => l.isPrimary) || merchant.locations[0];
          
          if (!primaryLocation) return null;

          const distance = geolib.getDistance(
            { latitude, longitude },
            {
              latitude: primaryLocation.latitude,
              longitude: primaryLocation.longitude,
            }
          ) / 1000; // Convert to km

          // Check if within radius and reskflow zone
          if (distance > radius || distance > merchant.reskflowRadius) {
            return null;
          }

          // Check if open
          const todayHours = merchant.operatingHours[0];
          let isCurrentlyOpen = merchant.isOpen;
          
          if (todayHours && todayHours.isOpen) {
            const now = new Date();
            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            isCurrentlyOpen = currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime;
          }

          return {
            ...merchant,
            distance,
            reskflowTime: Math.round(15 + distance * 3), // Estimate
            isCurrentlyOpen,
            primaryLocation,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a!.distance - b!.distance)
        .slice(0, limit);

      return nearbyMerchants;
    } catch (error) {
      logger.error('Failed to get nearby merchants', error);
      throw error;
    }
  }

  async geocodeAddress(address: string): Promise<Location | null> {
    try {
      // Check cache first
      const cacheKey = `geocode:${address.toLowerCase()}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const results = await this.geocoder.geocode(address);
      
      if (results.length === 0) {
        return null;
      }

      const location: Location = {
        latitude: results[0].latitude!,
        longitude: results[0].longitude!,
      };

      // Cache for 7 days
      await redis.set(cacheKey, JSON.stringify(location), 'EX', 7 * 24 * 60 * 60);

      return location;
    } catch (error) {
      logger.error('Geocoding failed', error);
      return null;
    }
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<Address | null> {
    try {
      // Check cache first
      const cacheKey = `reverse-geocode:${latitude}:${longitude}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const results = await this.geocoder.reverse({ lat: latitude, lon: longitude });
      
      if (results.length === 0) {
        return null;
      }

      const result = results[0];
      const address: Address = {
        street: result.streetName || '',
        city: result.city || '',
        state: result.state || '',
        country: result.country || '',
        postalCode: result.zipcode || '',
        formatted: result.formattedAddress || '',
      };

      // Cache for 7 days
      await redis.set(cacheKey, JSON.stringify(address), 'EX', 7 * 24 * 60 * 60);

      return address;
    } catch (error) {
      logger.error('Reverse geocoding failed', error);
      return null;
    }
  }

  async checkDeliveryZone(
    merchantId: string,
    latitude: number,
    longitude: number
  ): Promise<boolean> {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: { locations: true },
      });

      if (!merchant) {
        return false;
      }

      const primaryLocation = merchant.locations.find(l => l.isPrimary) || merchant.locations[0];
      
      if (!primaryLocation) {
        return false;
      }

      const distance = geolib.getDistance(
        { latitude, longitude },
        {
          latitude: primaryLocation.latitude,
          longitude: primaryLocation.longitude,
        }
      ) / 1000; // Convert to km

      return distance <= (primaryLocation.reskflowRadius || merchant.reskflowRadius);
    } catch (error) {
      logger.error('Delivery zone check failed', error);
      return false;
    }
  }

  async calculateDeliveryRoute(
    origin: Location,
    destination: Location,
    waypoints?: Location[]
  ): Promise<{
    distance: number;
    duration: number;
    polyline: string;
    bounds: any;
  }> {
    try {
      // In a real implementation, this would call Google Maps Directions API
      // For now, we'll calculate straight-line distance and estimate
      
      let totalDistance = 0;
      const points = [origin, ...(waypoints || []), destination];

      for (let i = 0; i < points.length - 1; i++) {
        totalDistance += geolib.getDistance(points[i], points[i + 1]) / 1000;
      }

      // Estimate duration (average 30 km/h in urban areas)
      const duration = Math.round((totalDistance / 30) * 60); // minutes

      // Create a simple polyline
      const line = turf.lineString(points.map(p => [p.longitude, p.latitude]));
      const polyline = this.encodePolyline(points);

      // Calculate bounds
      const bounds = turf.bbox(line);

      return {
        distance: totalDistance,
        duration,
        polyline,
        bounds: {
          southwest: { lat: bounds[1], lng: bounds[0] },
          northeast: { lat: bounds[3], lng: bounds[2] },
        },
      };
    } catch (error) {
      logger.error('Route calculation failed', error);
      throw error;
    }
  }

  async getDeliveryZones(): Promise<any[]> {
    try {
      // Get all active merchants with their reskflow zones
      const merchants = await prisma.merchant.findMany({
        where: { status: MerchantStatus.ACTIVE },
        include: { locations: true },
      });

      const zones = merchants.map(merchant => {
        const primaryLocation = merchant.locations.find(l => l.isPrimary) || merchant.locations[0];
        
        if (!primaryLocation) return null;

        // Create a circular zone
        const center = [primaryLocation.longitude, primaryLocation.latitude];
        const radius = primaryLocation.reskflowRadius || merchant.reskflowRadius;
        const circle = turf.circle(center, radius, { units: 'kilometers' });

        return {
          merchantId: merchant.id,
          merchantName: merchant.name,
          center: {
            latitude: primaryLocation.latitude,
            longitude: primaryLocation.longitude,
          },
          radius,
          polygon: circle.geometry.coordinates[0],
        };
      }).filter(Boolean);

      return zones;
    } catch (error) {
      logger.error('Failed to get reskflow zones', error);
      throw error;
    }
  }

  async findOptimalMerchantLocation(
    customerLocation: Location,
    merchantIds: string[]
  ): Promise<{
    merchantId: string;
    location: Location;
    distance: number;
  } | null> {
    try {
      const merchants = await prisma.merchant.findMany({
        where: {
          id: { in: merchantIds },
          status: MerchantStatus.ACTIVE,
        },
        include: { locations: true },
      });

      let optimal: any = null;
      let minDistance = Infinity;

      for (const merchant of merchants) {
        for (const location of merchant.locations) {
          if (!location.isActive) continue;

          const distance = geolib.getDistance(
            customerLocation,
            {
              latitude: location.latitude,
              longitude: location.longitude,
            }
          ) / 1000;

          if (distance < minDistance && distance <= location.reskflowRadius!) {
            minDistance = distance;
            optimal = {
              merchantId: merchant.id,
              location: {
                latitude: location.latitude,
                longitude: location.longitude,
              },
              distance,
            };
          }
        }
      }

      return optimal;
    } catch (error) {
      logger.error('Failed to find optimal merchant location', error);
      return null;
    }
  }

  private encodePolyline(points: Location[]): string {
    // Simple polyline encoding (in production, use Google's polyline algorithm)
    return points.map(p => `${p.latitude},${p.longitude}`).join('|');
  }

  async getServiceableCities(): Promise<string[]> {
    try {
      const locations = await prisma.merchantLocation.findMany({
        where: {
          isActive: true,
          merchant: {
            status: MerchantStatus.ACTIVE,
          },
        },
        select: {
          city: true,
        },
        distinct: ['city'],
      });

      return locations.map(l => l.city).filter(Boolean).sort();
    } catch (error) {
      logger.error('Failed to get serviceable cities', error);
      return [];
    }
  }

  async getHeatmapData(
    bounds: {
      northeast: Location;
      southwest: Location;
    }
  ): Promise<any[]> {
    try {
      // Get order density data for heatmap visualization
      const recentOrders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
          status: 'DELIVERED',
        },
        include: {
          location: true,
        },
      });

      // Filter by bounds
      const heatmapData = recentOrders
        .filter(order => {
          if (!order.location) return false;
          
          return (
            order.location.latitude >= bounds.southwest.latitude &&
            order.location.latitude <= bounds.northeast.latitude &&
            order.location.longitude >= bounds.southwest.longitude &&
            order.location.longitude <= bounds.northeast.longitude
          );
        })
        .map(order => ({
          latitude: order.location.latitude,
          longitude: order.location.longitude,
          weight: 1,
        }));

      return heatmapData;
    } catch (error) {
      logger.error('Failed to get heatmap data', error);
      return [];
    }
  }
}