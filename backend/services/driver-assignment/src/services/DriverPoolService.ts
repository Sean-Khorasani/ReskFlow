import { prisma, logger, redis } from '@reskflow/shared';
import { Server as SocketServer } from 'socket.io';
import * as geolib from 'geolib';
import dayjs from 'dayjs';

interface DriverStatus {
  driverId: string;
  status: 'online' | 'offline' | 'busy' | 'break';
  location: {
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
  };
  zoneId?: string;
  lastUpdate: Date;
  activeDeliveries: number;
  completedToday: number;
  earnings: number;
  rating: number;
  battery?: number;
  vehicleType: string;
}

interface DriverPerformance {
  driverId: string;
  period: string;
  deliveriesCompleted: number;
  averageDeliveryTime: number;
  averageRating: number;
  totalEarnings: number;
  totalDistance: number;
  acceptanceRate: number;
  onTimeRate: number;
  customerSatisfaction: number;
}

export class DriverPoolService {
  private io: SocketServer;
  private driverPool: Map<string, DriverStatus> = new Map();
  private socketToDriver: Map<string, string> = new Map();

  constructor(io: SocketServer) {
    this.io = io;
    this.initializeDriverPool();
  }

  async initializeDriverPool() {
    // Load online drivers from database
    const onlineDrivers = await prisma.driver.findMany({
      where: { status: 'online' },
      include: {
        vehicle: true,
        _count: {
          select: {
            activeDeliveries: {
              where: {
                status: { in: ['assigned', 'picked_up', 'in_transit'] },
              },
            },
          },
        },
      },
    });

    for (const driver of onlineDrivers) {
      this.driverPool.set(driver.id, {
        driverId: driver.id,
        status: driver.status as any,
        location: {
          latitude: driver.current_location?.coordinates[1] || 0,
          longitude: driver.current_location?.coordinates[0] || 0,
        },
        zoneId: driver.current_zone_id || undefined,
        lastUpdate: driver.last_location_update || new Date(),
        activeDeliveries: driver._count.activeDeliveries,
        completedToday: await this.getCompletedToday(driver.id),
        earnings: await this.getTodayEarnings(driver.id),
        rating: driver.rating,
        vehicleType: driver.vehicle?.type || 'car',
      });
    }

    logger.info(`Initialized driver pool with ${this.driverPool.size} drivers`);
  }

  async authenticateDriver(driverId: string, token: string): Promise<boolean> {
    // Verify driver token
    const driver = await prisma.driver.findFirst({
      where: {
        id: driverId,
        auth_token: token,
      },
    });

    return !!driver;
  }

  async onDriverConnect(driverId: string, socketId: string) {
    this.socketToDriver.set(socketId, driverId);

    // Update driver status
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        status: 'online',
        last_seen: new Date(),
      },
    });

    // Get driver info
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { vehicle: true },
    });

    if (driver) {
      const driverStatus: DriverStatus = {
        driverId,
        status: 'online',
        location: {
          latitude: driver.current_location?.coordinates[1] || 0,
          longitude: driver.current_location?.coordinates[0] || 0,
        },
        zoneId: driver.current_zone_id || undefined,
        lastUpdate: new Date(),
        activeDeliveries: 0,
        completedToday: await this.getCompletedToday(driverId),
        earnings: await this.getTodayEarnings(driverId),
        rating: driver.rating,
        vehicleType: driver.vehicle?.type || 'car',
      };

      this.driverPool.set(driverId, driverStatus);

      // Notify zone about new driver
      if (driverStatus.zoneId) {
        this.io.to(`zone:${driverStatus.zoneId}`).emit('driver:online', {
          driverId,
          location: driverStatus.location,
        });
      }
    }

    logger.info(`Driver ${driverId} connected`);
  }

  async onDriverDisconnect(socketId: string) {
    const driverId = this.socketToDriver.get(socketId);
    if (!driverId) return;

    this.socketToDriver.delete(socketId);

    // Update driver status
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        status: 'offline',
        last_seen: new Date(),
      },
    });

    const driverStatus = this.driverPool.get(driverId);
    if (driverStatus) {
      driverStatus.status = 'offline';

      // Notify zone
      if (driverStatus.zoneId) {
        this.io.to(`zone:${driverStatus.zoneId}`).emit('driver:offline', {
          driverId,
        });
      }
    }

    logger.info(`Driver ${driverId} disconnected`);
  }

  async updateDriverStatus(driverId: string, status: string) {
    const driverStatus = this.driverPool.get(driverId);
    if (!driverStatus) return;

    driverStatus.status = status as any;
    driverStatus.lastUpdate = new Date();

    // Update database
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        status,
        is_available: status === 'online',
      },
    });

    // Notify relevant parties
    this.io.to(`driver:${driverId}`).emit('status:updated', { status });

    if (driverStatus.zoneId) {
      this.io.to(`zone:${driverStatus.zoneId}`).emit('driver:status', {
        driverId,
        status,
      });
    }
  }

  async updateDriverLocation(data: {
    driverId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
    accuracy?: number;
  }) {
    const driverStatus = this.driverPool.get(data.driverId);
    if (!driverStatus) return;

    // Update location
    driverStatus.location = {
      latitude: data.latitude,
      longitude: data.longitude,
      heading: data.heading,
      speed: data.speed,
    };
    driverStatus.lastUpdate = new Date();

    // Update database
    await prisma.driver.update({
      where: { id: data.driverId },
      data: {
        current_location: {
          type: 'Point',
          coordinates: [data.longitude, data.latitude],
        },
        last_location_update: new Date(),
      },
    });

    // Check if driver changed zones
    const newZoneId = await this.checkZoneChange(data.driverId, data.latitude, data.longitude);
    if (newZoneId !== driverStatus.zoneId) {
      await this.handleZoneChange(data.driverId, driverStatus.zoneId, newZoneId);
    }

    // Store location history
    await this.storeLocationHistory(data);
  }

  async updateDriverAvailability(driverId: string, available: boolean, shiftEnd?: Date) {
    const driverStatus = this.driverPool.get(driverId);
    if (!driverStatus) return;

    await prisma.driver.update({
      where: { id: driverId },
      data: {
        is_available: available,
        shift_end: shiftEnd,
      },
    });

    // Notify about availability change
    if (driverStatus.zoneId) {
      this.io.to(`zone:${driverStatus.zoneId}`).emit('driver:availability', {
        driverId,
        available,
      });
    }
  }

  async getDriversInZone(zoneId: string, status?: string): Promise<DriverStatus[]> {
    const drivers: DriverStatus[] = [];

    for (const [driverId, driverStatus] of this.driverPool) {
      if (driverStatus.zoneId === zoneId) {
        if (!status || driverStatus.status === status) {
          drivers.push(driverStatus);
        }
      }
    }

    return drivers;
  }

  async getNearbyDrivers(
    location: { latitude: number; longitude: number },
    radiusMeters: number,
    filters?: {
      status?: string;
      vehicleType?: string;
      maxActiveDeliveries?: number;
    }
  ): Promise<Array<DriverStatus & { distance: number }>> {
    const nearbyDrivers: Array<DriverStatus & { distance: number }> = [];

    for (const [driverId, driverStatus] of this.driverPool) {
      // Apply filters
      if (filters?.status && driverStatus.status !== filters.status) continue;
      if (filters?.vehicleType && driverStatus.vehicleType !== filters.vehicleType) continue;
      if (filters?.maxActiveDeliveries && driverStatus.activeDeliveries > filters.maxActiveDeliveries) continue;

      // Calculate distance
      const distance = geolib.getDistance(
        { latitude: location.latitude, longitude: location.longitude },
        { latitude: driverStatus.location.latitude, longitude: driverStatus.location.longitude }
      );

      if (distance <= radiusMeters) {
        nearbyDrivers.push({
          ...driverStatus,
          distance,
        });
      }
    }

    // Sort by distance
    return nearbyDrivers.sort((a, b) => a.distance - b.distance);
  }

  async getDriverPerformance(driverId: string, period: string): Promise<DriverPerformance> {
    const startDate = this.getStartDateForPeriod(period);

    // Get completed deliveries
    const deliveries = await prisma.reskflow.findMany({
      where: {
        driver_id: driverId,
        status: 'delivered',
        delivered_at: { gte: startDate },
      },
      include: {
        order: true,
        reviews: true,
      },
    });

    // Calculate metrics
    const deliveriesCompleted = deliveries.length;
    
    const reskflowTimes = deliveries
      .filter(d => d.picked_up_at && d.delivered_at)
      .map(d => d.delivered_at!.getTime() - d.picked_up_at!.getTime());
    
    const averageDeliveryTime = reskflowTimes.length > 0
      ? reskflowTimes.reduce((a, b) => a + b, 0) / reskflowTimes.length / 1000 / 60 // in minutes
      : 0;

    const ratings = deliveries
      .flatMap(d => d.reviews)
      .filter(r => r.rating_type === 'driver')
      .map(r => r.rating);
    
    const averageRating = ratings.length > 0
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : 0;

    const totalEarnings = deliveries.reduce((sum, d) => sum + d.driver_earnings, 0);

    // Calculate distance
    const totalDistance = deliveries.reduce((sum, d) => sum + (d.distance || 0), 0);

    // Get assignment stats
    const assignmentStats = await prisma.driverAssignment.groupBy({
      by: ['status'],
      where: {
        driver_id: driverId,
        created_at: { gte: startDate },
      },
      _count: true,
    });

    const totalAssignments = assignmentStats.reduce((sum, s) => sum + s._count, 0);
    const acceptedAssignments = assignmentStats.find(s => s.status === 'accepted')?._count || 0;
    const acceptanceRate = totalAssignments > 0
      ? (acceptedAssignments / totalAssignments) * 100
      : 0;

    // Calculate on-time rate
    const onTimeDeliveries = deliveries.filter(d => {
      if (!d.estimated_reskflow_time || !d.delivered_at) return false;
      return d.delivered_at <= d.estimated_reskflow_time;
    }).length;

    const onTimeRate = deliveriesCompleted > 0
      ? (onTimeDeliveries / deliveriesCompleted) * 100
      : 0;

    // Customer satisfaction (based on positive reviews)
    const positiveReviews = deliveries
      .flatMap(d => d.reviews)
      .filter(r => r.rating >= 4).length;
    
    const totalReviews = deliveries.flatMap(d => d.reviews).length;
    const customerSatisfaction = totalReviews > 0
      ? (positiveReviews / totalReviews) * 100
      : 0;

    return {
      driverId,
      period,
      deliveriesCompleted,
      averageDeliveryTime,
      averageRating,
      totalEarnings,
      totalDistance,
      acceptanceRate,
      onTimeRate,
      customerSatisfaction,
    };
  }

  async getAvailableDriversCount(zoneId?: string): Promise<number> {
    let count = 0;
    
    for (const [driverId, driverStatus] of this.driverPool) {
      if (driverStatus.status === 'online' && driverStatus.activeDeliveries === 0) {
        if (!zoneId || driverStatus.zoneId === zoneId) {
          count++;
        }
      }
    }

    return count;
  }

  getDriverStatus(driverId: string): DriverStatus | null {
    return this.driverPool.get(driverId) || null;
  }

  async incrementActiveDeliveries(driverId: string) {
    const driverStatus = this.driverPool.get(driverId);
    if (driverStatus) {
      driverStatus.activeDeliveries++;
      if (driverStatus.activeDeliveries >= 3) {
        driverStatus.status = 'busy';
      }
    }
  }

  async decrementActiveDeliveries(driverId: string) {
    const driverStatus = this.driverPool.get(driverId);
    if (driverStatus) {
      driverStatus.activeDeliveries = Math.max(0, driverStatus.activeDeliveries - 1);
      if (driverStatus.activeDeliveries === 0 && driverStatus.status === 'busy') {
        driverStatus.status = 'online';
      }
      
      // Update completed count and earnings
      driverStatus.completedToday = await this.getCompletedToday(driverId);
      driverStatus.earnings = await this.getTodayEarnings(driverId);
    }
  }

  private async getCompletedToday(driverId: string): Promise<number> {
    const today = dayjs().startOf('day').toDate();
    
    return prisma.reskflow.count({
      where: {
        driver_id: driverId,
        status: 'delivered',
        delivered_at: { gte: today },
      },
    });
  }

  private async getTodayEarnings(driverId: string): Promise<number> {
    const today = dayjs().startOf('day').toDate();
    
    const result = await prisma.reskflow.aggregate({
      where: {
        driver_id: driverId,
        status: 'delivered',
        delivered_at: { gte: today },
      },
      _sum: {
        driver_earnings: true,
      },
    });

    return result._sum.driver_earnings || 0;
  }

  private async checkZoneChange(
    driverId: string,
    latitude: number,
    longitude: number
  ): Promise<string | undefined> {
    // This would call ZoneService to determine current zone
    // Simplified for now
    return undefined;
  }

  private async handleZoneChange(
    driverId: string,
    oldZoneId?: string,
    newZoneId?: string
  ) {
    const driverStatus = this.driverPool.get(driverId);
    if (!driverStatus) return;

    // Leave old zone room
    if (oldZoneId) {
      this.io.sockets.sockets.get(driverId)?.leave(`zone:${oldZoneId}`);
      this.io.to(`zone:${oldZoneId}`).emit('driver:left', { driverId });
    }

    // Join new zone room
    if (newZoneId) {
      this.io.sockets.sockets.get(driverId)?.join(`zone:${newZoneId}`);
      this.io.to(`zone:${newZoneId}`).emit('driver:entered', {
        driverId,
        location: driverStatus.location,
      });
    }

    // Update driver status
    driverStatus.zoneId = newZoneId;

    // Update database
    await prisma.driver.update({
      where: { id: driverId },
      data: { current_zone_id: newZoneId },
    });
  }

  private async storeLocationHistory(data: any) {
    // Store in Redis with TTL
    const key = `driver:${data.driverId}:locations`;
    const locationData = {
      lat: data.latitude,
      lng: data.longitude,
      ts: Date.now(),
      h: data.heading,
      s: data.speed,
    };

    await redis.lpush(key, JSON.stringify(locationData));
    await redis.ltrim(key, 0, 999); // Keep last 1000 locations
    await redis.expire(key, 86400); // 24 hours
  }

  private getStartDateForPeriod(period: string): Date {
    const now = dayjs();
    switch (period) {
      case '1d':
        return now.subtract(1, 'day').toDate();
      case '7d':
        return now.subtract(7, 'day').toDate();
      case '30d':
        return now.subtract(30, 'day').toDate();
      default:
        return now.subtract(7, 'day').toDate();
    }
  }
}