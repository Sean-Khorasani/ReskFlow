import { PrismaClient } from '@prisma/client';
import { 
  GeofenceZoneData, 
  GeofenceEventData, 
  Location, 
  ZoneType, 
  GeofenceEventType 
} from '../types/tracking.types';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

export class GeofenceService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async createGeofenceZone(data: GeofenceZoneData): Promise<any> {
    try {
      logger.info('Creating geofence zone', { name: data.name, zoneType: data.zoneType });

      const zone = await this.prisma.geofenceZone.create({
        data: {
          name: data.name,
          description: data.description,
          zoneType: data.zoneType,
          coordinates: data.coordinates,
          radius: data.radius,
          isActive: data.isActive,
          triggerEvents: data.triggerEvents,
          merchantId: data.merchantId,
          areaId: data.areaId,
          metadata: data.metadata || {},
        },
      });

      // Cache zone data for quick lookup
      await redisClient.cache(`geofence:zone:${zone.id}`, zone, 7200); // 2 hours TTL

      logger.info('Geofence zone created successfully', { zoneId: zone.id });
      return zone;
    } catch (error) {
      logger.error('Failed to create geofence zone', { error: error.message, data });
      throw new Error(`Failed to create geofence zone: ${error.message}`);
    }
  }

  async updateGeofenceZone(zoneId: string, updates: Partial<GeofenceZoneData>): Promise<any> {
    try {
      logger.info('Updating geofence zone', { zoneId, updates });

      const zone = await this.prisma.geofenceZone.update({
        where: { id: zoneId },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
      });

      // Update cache
      await redisClient.cache(`geofence:zone:${zoneId}`, zone, 7200);

      logger.info('Geofence zone updated successfully', { zoneId });
      return zone;
    } catch (error) {
      logger.error('Failed to update geofence zone', { error: error.message, zoneId, updates });
      throw new Error(`Failed to update geofence zone: ${error.message}`);
    }
  }

  async deleteGeofenceZone(zoneId: string): Promise<void> {
    try {
      logger.info('Deleting geofence zone', { zoneId });

      await this.prisma.geofenceZone.delete({
        where: { id: zoneId },
      });

      // Remove from cache
      await redisClient.deleteCached(`geofence:zone:${zoneId}`);

      logger.info('Geofence zone deleted successfully', { zoneId });
    } catch (error) {
      logger.error('Failed to delete geofence zone', { error: error.message, zoneId });
      throw new Error(`Failed to delete geofence zone: ${error.message}`);
    }
  }

  async getGeofenceZone(zoneId: string): Promise<any> {
    try {
      // Try cache first
      let zone = await redisClient.getCached(`geofence:zone:${zoneId}`);
      
      if (!zone) {
        zone = await this.prisma.geofenceZone.findUnique({
          where: { id: zoneId },
          include: {
            geofenceEvents: {
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        });

        if (zone) {
          await redisClient.cache(`geofence:zone:${zoneId}`, zone, 7200);
        }
      }

      if (!zone) {
        throw new Error('Geofence zone not found');
      }

      return zone;
    } catch (error) {
      logger.error('Failed to get geofence zone', { error: error.message, zoneId });
      throw error;
    }
  }

  async getGeofenceZonesByMerchant(merchantId: string): Promise<any[]> {
    try {
      const zones = await this.prisma.geofenceZone.findMany({
        where: { 
          merchantId,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return zones;
    } catch (error) {
      logger.error('Failed to get geofence zones by merchant', { error: error.message, merchantId });
      throw new Error(`Failed to get geofence zones: ${error.message}`);
    }
  }

  async getActiveGeofenceZones(): Promise<any[]> {
    try {
      // Try to get from cache first
      let zones = await redisClient.getCached('geofence:active_zones');
      
      if (!zones) {
        zones = await this.prisma.geofenceZone.findMany({
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
        });

        // Cache for 10 minutes
        await redisClient.cache('geofence:active_zones', zones, 600);
      }

      return zones;
    } catch (error) {
      logger.error('Failed to get active geofence zones', { error: error.message });
      throw new Error(`Failed to get active geofence zones: ${error.message}`);
    }
  }

  async checkLocationAgainstGeofences(
    driverId: string, 
    location: Location, 
    sessionId?: string
  ): Promise<GeofenceEventData[]> {
    try {
      const events: GeofenceEventData[] = [];
      const activeZones = await this.getActiveGeofenceZones();

      for (const zone of activeZones) {
        const isInside = this.isLocationInZone(location, zone);
        const wasInside = await this.wasDriverInZone(driverId, zone.id);

        if (isInside && !wasInside) {
          // Driver entered the zone
          const eventData: GeofenceEventData = {
            zoneId: zone.id,
            sessionId,
            driverId,
            eventType: GeofenceEventType.ENTERED,
            location,
            enteredAt: new Date(),
          };

          await this.createGeofenceEvent(eventData);
          events.push(eventData);

          // Update driver zone status
          await redisClient.cache(`driver:zone:${driverId}:${zone.id}`, true, 3600);

          logger.info('Driver entered geofence zone', { 
            driverId, 
            zoneId: zone.id, 
            zoneName: zone.name 
          });

        } else if (!isInside && wasInside) {
          // Driver exited the zone
          const entryTime = await this.getZoneEntryTime(driverId, zone.id);
          const dwellTime = entryTime ? Date.now() - entryTime.getTime() : 0;

          const eventData: GeofenceEventData = {
            zoneId: zone.id,
            sessionId,
            driverId,
            eventType: GeofenceEventType.EXITED,
            location,
            exitedAt: new Date(),
            dwellTime: Math.floor(dwellTime / 1000), // Convert to seconds
          };

          await this.createGeofenceEvent(eventData);
          events.push(eventData);

          // Remove driver zone status
          await redisClient.deleteCached(`driver:zone:${driverId}:${zone.id}`);

          logger.info('Driver exited geofence zone', { 
            driverId, 
            zoneId: zone.id, 
            zoneName: zone.name,
            dwellTime: eventData.dwellTime 
          });
        }
      }

      return events;
    } catch (error) {
      logger.error('Failed to check location against geofences', { error: error.message, driverId, location });
      throw new Error(`Failed to check geofences: ${error.message}`);
    }
  }

  private isLocationInZone(location: Location, zone: any): boolean {
    try {
      switch (zone.zoneType) {
        case ZoneType.CIRCULAR:
          return this.isLocationInCircle(location, zone);
        case ZoneType.POLYGON:
          return this.isLocationInPolygon(location, zone);
        case ZoneType.RECTANGLE:
          return this.isLocationInRectangle(location, zone);
        default:
          logger.warn('Unknown zone type', { zoneType: zone.zoneType, zoneId: zone.id });
          return false;
      }
    } catch (error) {
      logger.error('Error checking if location is in zone', { error: error.message, zoneId: zone.id });
      return false;
    }
  }

  private isLocationInCircle(location: Location, zone: any): boolean {
    const center = zone.coordinates;
    const radius = zone.radius || 100; // Default 100 meters

    const distance = this.calculateDistance(
      location.latitude,
      location.longitude,
      center.latitude,
      center.longitude
    );

    return distance <= radius;
  }

  private isLocationInPolygon(location: Location, zone: any): boolean {
    const polygon = zone.coordinates.points || zone.coordinates;
    
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return false;
    }

    let inside = false;
    const x = location.longitude;
    const y = location.latitude;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].longitude || polygon[i][0];
      const yi = polygon[i].latitude || polygon[i][1];
      const xj = polygon[j].longitude || polygon[j][0];
      const yj = polygon[j].latitude || polygon[j][1];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  private isLocationInRectangle(location: Location, zone: any): boolean {
    const bounds = zone.coordinates;
    
    return (
      location.latitude >= bounds.south &&
      location.latitude <= bounds.north &&
      location.longitude >= bounds.west &&
      location.longitude <= bounds.east
    );
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

  private async wasDriverInZone(driverId: string, zoneId: string): Promise<boolean> {
    const status = await redisClient.getCached(`driver:zone:${driverId}:${zoneId}`);
    return Boolean(status);
  }

  private async getZoneEntryTime(driverId: string, zoneId: string): Promise<Date | null> {
    try {
      const event = await this.prisma.geofenceEvent.findFirst({
        where: {
          driverId,
          zoneId,
          eventType: GeofenceEventType.ENTERED,
        },
        orderBy: { createdAt: 'desc' },
      });

      return event?.enteredAt || null;
    } catch (error) {
      logger.error('Failed to get zone entry time', { error: error.message, driverId, zoneId });
      return null;
    }
  }

  async createGeofenceEvent(data: GeofenceEventData): Promise<any> {
    try {
      const event = await this.prisma.geofenceEvent.create({
        data: {
          zoneId: data.zoneId,
          sessionId: data.sessionId,
          driverId: data.driverId,
          eventType: data.eventType,
          location: data.location,
          enteredAt: data.enteredAt,
          exitedAt: data.exitedAt,
          dwellTime: data.dwellTime,
          metadata: data.metadata || {},
        },
      });

      logger.info('Geofence event created', { 
        eventId: event.id,
        zoneId: data.zoneId,
        driverId: data.driverId,
        eventType: data.eventType,
      });

      return event;
    } catch (error) {
      logger.error('Failed to create geofence event', { error: error.message, data });
      throw new Error(`Failed to create geofence event: ${error.message}`);
    }
  }

  async getGeofenceEvents(
    filters: {
      zoneId?: string;
      driverId?: string;
      sessionId?: string;
      eventType?: GeofenceEventType;
      startDate?: Date;
      endDate?: Date;
    },
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    try {
      const where: any = {};
      
      if (filters.zoneId) where.zoneId = filters.zoneId;
      if (filters.driverId) where.driverId = filters.driverId;
      if (filters.sessionId) where.sessionId = filters.sessionId;
      if (filters.eventType) where.eventType = filters.eventType;
      
      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }

      const events = await this.prisma.geofenceEvent.findMany({
        where,
        include: {
          zone: {
            select: {
              name: true,
              zoneType: true,
              description: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      return events;
    } catch (error) {
      logger.error('Failed to get geofence events', { error: error.message, filters });
      throw new Error(`Failed to get geofence events: ${error.message}`);
    }
  }

  async getDriversInZone(zoneId: string): Promise<string[]> {
    try {
      const events = await this.prisma.geofenceEvent.findMany({
        where: {
          zoneId,
          eventType: GeofenceEventType.ENTERED,
          exitedAt: null, // Still in the zone
        },
        select: {
          driverId: true,
        },
        distinct: ['driverId'],
      });

      return events.map(event => event.driverId);
    } catch (error) {
      logger.error('Failed to get drivers in zone', { error: error.message, zoneId });
      throw new Error(`Failed to get drivers in zone: ${error.message}`);
    }
  }

  async getZoneStatistics(zoneId: string, startDate?: Date, endDate?: Date): Promise<any> {
    try {
      const where: any = { zoneId };
      
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      const [totalEvents, entryEvents, exitEvents] = await Promise.all([
        this.prisma.geofenceEvent.count({ where }),
        this.prisma.geofenceEvent.count({ 
          where: { ...where, eventType: GeofenceEventType.ENTERED } 
        }),
        this.prisma.geofenceEvent.count({ 
          where: { ...where, eventType: GeofenceEventType.EXITED } 
        }),
      ]);

      const avgDwellTime = await this.prisma.geofenceEvent.aggregate({
        where: { 
          ...where, 
          eventType: GeofenceEventType.EXITED,
          dwellTime: { not: null },
        },
        _avg: { dwellTime: true },
      });

      const uniqueDrivers = await this.prisma.geofenceEvent.findMany({
        where,
        select: { driverId: true },
        distinct: ['driverId'],
      });

      return {
        totalEvents,
        entryEvents,
        exitEvents,
        uniqueDrivers: uniqueDrivers.length,
        averageDwellTime: avgDwellTime._avg.dwellTime || 0,
        currentlyInZone: entryEvents - exitEvents,
      };
    } catch (error) {
      logger.error('Failed to get zone statistics', { error: error.message, zoneId });
      throw new Error(`Failed to get zone statistics: ${error.message}`);
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info('GeofenceService cleanup completed');
    } catch (error) {
      logger.error('Error during GeofenceService cleanup', { error: error.message });
    }
  }
}