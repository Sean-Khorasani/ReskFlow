import { prisma, logger, redis } from '@reskflow/shared';
import * as turf from '@turf/turf';
import { Feature, Polygon, Point } from '@turf/turf';

interface Zone {
  id: string;
  name: string;
  polygon: Feature<Polygon>;
  active: boolean;
  demandLevel: 'low' | 'medium' | 'high' | 'very_high';
  surgeMultiplier: number;
  driverTargetCount: number;
  averageDeliveryTime: number;
}

interface ZoneStatistics {
  zoneId: string;
  activeDrivers: number;
  availableDrivers: number;
  activeOrders: number;
  pendingOrders: number;
  averageWaitTime: number;
  demandSupplyRatio: number;
  suggestedSurge: number;
}

export class ZoneService {
  private zones: Map<string, Zone> = new Map();

  async initializeZones() {
    logger.info('Initializing reskflow zones');

    // Load zones from database
    const dbZones = await prisma.reskflowZone.findMany({
      where: { is_active: true },
    });

    for (const zone of dbZones) {
      this.zones.set(zone.id, {
        id: zone.id,
        name: zone.name,
        polygon: JSON.parse(zone.boundaries),
        active: zone.is_active,
        demandLevel: zone.demand_level as any,
        surgeMultiplier: zone.surge_multiplier,
        driverTargetCount: zone.driver_target_count,
        averageDeliveryTime: zone.average_reskflow_time,
      });
    }

    logger.info(`Loaded ${this.zones.size} reskflow zones`);

    // Start zone monitoring
    this.startZoneMonitoring();
  }

  async createZone(zoneData: any) {
    // Validate polygon
    if (!turf.booleanValid(zoneData.boundaries)) {
      throw new Error('Invalid zone boundaries');
    }

    const zone = await prisma.reskflowZone.create({
      data: {
        name: zoneData.name,
        boundaries: JSON.stringify(zoneData.boundaries),
        is_active: true,
        demand_level: 'medium',
        surge_multiplier: 1.0,
        driver_target_count: zoneData.driverTargetCount || 10,
        average_reskflow_time: 30,
        metadata: zoneData.metadata || {},
      },
    });

    // Add to memory
    this.zones.set(zone.id, {
      id: zone.id,
      name: zone.name,
      polygon: zoneData.boundaries,
      active: zone.is_active,
      demandLevel: zone.demand_level as any,
      surgeMultiplier: zone.surge_multiplier,
      driverTargetCount: zone.driver_target_count,
      averageDeliveryTime: zone.average_reskflow_time,
    });

    return zone;
  }

  async updateZone(zoneId: string, updates: any) {
    const zone = await prisma.reskflowZone.update({
      where: { id: zoneId },
      data: updates,
    });

    // Update in memory
    if (this.zones.has(zoneId)) {
      const existing = this.zones.get(zoneId)!;
      this.zones.set(zoneId, {
        ...existing,
        ...updates,
      });
    }

    return zone;
  }

  getZoneForLocation(latitude: number, longitude: number): Zone | null {
    const point = turf.point([longitude, latitude]);

    for (const [zoneId, zone] of this.zones) {
      if (turf.booleanPointInPolygon(point, zone.polygon)) {
        return zone;
      }
    }

    return null;
  }

  async getZoneStatistics(zoneId: string): Promise<ZoneStatistics> {
    const cacheKey = `zone_stats:${zoneId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const zone = this.zones.get(zoneId);
    if (!zone) {
      throw new Error('Zone not found');
    }

    // Get active drivers in zone
    const activeDrivers = await prisma.driver.count({
      where: {
        current_zone_id: zoneId,
        status: 'online',
        is_available: true,
      },
    });

    const availableDrivers = await prisma.driver.count({
      where: {
        current_zone_id: zoneId,
        status: 'online',
        is_available: true,
        activeDeliveries: {
          none: {},
        },
      },
    });

    // Get order statistics
    const activeOrders = await prisma.reskflow.count({
      where: {
        zone_id: zoneId,
        status: { in: ['assigned', 'picked_up', 'in_transit'] },
      },
    });

    const pendingOrders = await prisma.reskflow.count({
      where: {
        zone_id: zoneId,
        status: 'pending',
      },
    });

    // Calculate average wait time
    const recentOrders = await prisma.reskflow.findMany({
      where: {
        zone_id: zoneId,
        assigned_at: { not: null },
        created_at: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        },
      },
      select: {
        created_at: true,
        assigned_at: true,
      },
    });

    const waitTimes = recentOrders
      .filter(o => o.assigned_at)
      .map(o => o.assigned_at!.getTime() - o.created_at.getTime());

    const averageWaitTime = waitTimes.length > 0
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length / 1000 / 60 // in minutes
      : 0;

    // Calculate demand-supply ratio
    const totalDemand = activeOrders + pendingOrders;
    const demandSupplyRatio = availableDrivers > 0
      ? totalDemand / availableDrivers
      : totalDemand > 0 ? 10 : 1; // Max ratio of 10

    // Suggest surge pricing
    const suggestedSurge = this.calculateSuggestedSurge(
      demandSupplyRatio,
      averageWaitTime,
      zone.demandLevel
    );

    const stats: ZoneStatistics = {
      zoneId,
      activeDrivers,
      availableDrivers,
      activeOrders,
      pendingOrders,
      averageWaitTime,
      demandSupplyRatio,
      suggestedSurge,
    };

    // Cache for 1 minute
    await redis.setex(cacheKey, 60, JSON.stringify(stats));
    return stats;
  }

  async updateZoneDemand(zoneId: string) {
    const stats = await this.getZoneStatistics(zoneId);
    
    let demandLevel: 'low' | 'medium' | 'high' | 'very_high';
    if (stats.demandSupplyRatio < 0.5) {
      demandLevel = 'low';
    } else if (stats.demandSupplyRatio < 1.5) {
      demandLevel = 'medium';
    } else if (stats.demandSupplyRatio < 3) {
      demandLevel = 'high';
    } else {
      demandLevel = 'very_high';
    }

    // Update zone
    await this.updateZone(zoneId, {
      demand_level: demandLevel,
      surge_multiplier: stats.suggestedSurge,
    });

    // Notify drivers if surge is active
    if (stats.suggestedSurge > 1.2) {
      await this.notifyDriversOfSurge(zoneId, stats.suggestedSurge);
    }
  }

  async getNeighboringZones(zoneId: string): Promise<Zone[]> {
    const zone = this.zones.get(zoneId);
    if (!zone) return [];

    const neighbors: Zone[] = [];

    for (const [id, otherZone] of this.zones) {
      if (id === zoneId) continue;

      // Check if zones share a boundary
      if (turf.booleanOverlap(zone.polygon, otherZone.polygon) ||
          turf.booleanTouches(zone.polygon, otherZone.polygon)) {
        neighbors.push(otherZone);
      }
    }

    return neighbors;
  }

  async findOptimalZoneForDriver(
    driverLocation: { latitude: number; longitude: number },
    maxDistance: number = 5000 // meters
  ): Promise<Zone | null> {
    const point = turf.point([driverLocation.longitude, driverLocation.latitude]);
    let bestZone: Zone | null = null;
    let bestScore = -Infinity;

    for (const [zoneId, zone] of this.zones) {
      // Check if driver is within reasonable distance to zone
      const centroid = turf.centroid(zone.polygon);
      const distance = turf.distance(point, centroid, { units: 'meters' });

      if (distance > maxDistance) continue;

      // Calculate zone score based on demand and driver shortage
      const stats = await this.getZoneStatistics(zoneId);
      const driverShortage = zone.driverTargetCount - stats.activeDrivers;
      const score = (stats.demandSupplyRatio * 2) + 
                   (driverShortage * 1.5) + 
                   (zone.surgeMultiplier * 1) -
                   (distance / 1000); // Penalize distance

      if (score > bestScore) {
        bestScore = score;
        bestZone = zone;
      }
    }

    return bestZone;
  }

  private calculateSuggestedSurge(
    demandSupplyRatio: number,
    averageWaitTime: number,
    demandLevel: string
  ): number {
    let surge = 1.0;

    // Based on demand-supply ratio
    if (demandSupplyRatio > 3) {
      surge = Math.min(1.5 + (demandSupplyRatio - 3) * 0.1, 2.5);
    } else if (demandSupplyRatio > 2) {
      surge = 1.2 + (demandSupplyRatio - 2) * 0.3;
    } else if (demandSupplyRatio > 1.5) {
      surge = 1.1 + (demandSupplyRatio - 1.5) * 0.2;
    }

    // Adjust based on wait time (in minutes)
    if (averageWaitTime > 15) {
      surge *= 1.2;
    } else if (averageWaitTime > 10) {
      surge *= 1.1;
    }

    // Adjust based on demand level
    switch (demandLevel) {
      case 'very_high':
        surge *= 1.1;
        break;
      case 'high':
        surge *= 1.05;
        break;
    }

    // Cap surge pricing
    return Math.min(Math.round(surge * 10) / 10, 3.0);
  }

  private async notifyDriversOfSurge(zoneId: string, surgeMultiplier: number) {
    // Get nearby drivers who might be interested
    const nearbyDrivers = await prisma.driver.findMany({
      where: {
        OR: [
          { current_zone_id: zoneId },
          // Include drivers in neighboring zones
          {
            current_location: {
              // Within 5km of zone
            },
          },
        ],
        status: 'online',
      },
    });

    // Send surge notifications
    for (const driver of nearbyDrivers) {
      await redis.publish(`driver:${driver.id}:notifications`, JSON.stringify({
        type: 'surge_pricing',
        zoneId,
        surgeMultiplier,
        message: `Surge pricing ${surgeMultiplier}x is now active in ${this.zones.get(zoneId)?.name}`,
      }));
    }
  }

  private startZoneMonitoring() {
    // Monitor zones every 2 minutes
    setInterval(async () => {
      for (const [zoneId, zone] of this.zones) {
        if (zone.active) {
          await this.updateZoneDemand(zoneId);
        }
      }
    }, 2 * 60 * 1000);
  }

  getAllZones(): Zone[] {
    return Array.from(this.zones.values());
  }

  getZoneById(zoneId: string): Zone | null {
    return this.zones.get(zoneId) || null;
  }
}