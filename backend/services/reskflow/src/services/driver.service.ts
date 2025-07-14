import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { publishDriverEvent, publishNotification } from '../config/rabbitmq';
import {
  Driver,
  CreateDriverInput,
  UpdateDriverInput,
  DriverLocation,
  DriverAvailability,
  NearbyDriver,
  DriverStatus,
  VehicleType,
  Coordinates,
  PaginatedResult,
} from '../types/reskflow.types';
import {
  DriverNotFoundError,
  DriverNotAvailableError,
  DriverAlreadyAssignedError,
  DriverOutOfRangeError,
  DriverCapacityExceededError,
  ValidationError,
} from '../utils/errors';
import {
  generateDriverCode,
  calculateDistance,
  validateCoordinates,
  calculatePagination,
} from '../utils/helpers';
import { driverLogger, loggerHelpers } from '../utils/logger';
import { config } from '../config';

export class DriverService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly LOCATION_CACHE_TTL = 60; // 1 minute for location updates
  private readonly MAX_DELIVERY_CAPACITY = 5; // Maximum concurrent deliveries per driver

  /**
   * Create a new driver
   */
  async createDriver(input: CreateDriverInput): Promise<Driver> {
    try {
      // Generate unique driver code
      const driverCode = generateDriverCode();

      // Check if user already has a driver profile
      const existingDriver = await prisma.driver.findUnique({
        where: { userId: input.userId },
      });

      if (existingDriver) {
        throw new ValidationError('User already has a driver profile');
      }

      // Create driver in database
      const driver = await prisma.driver.create({
        data: {
          userId: input.userId,
          driverCode,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          dateOfBirth: input.dateOfBirth,
          licenseNumber: input.licenseNumber,
          licenseExpiry: input.licenseExpiry,
          vehicleType: input.vehicleType,
          vehicleModel: input.vehicleModel,
          vehiclePlate: input.vehiclePlate,
          vehicleColor: input.vehicleColor,
          status: DriverStatus.ACTIVE,
          isAvailable: false,
          emergencyContact: JSON.stringify(input.emergencyContact),
          totalDeliveries: 0,
          completedDeliveries: 0,
          cancelledDeliveries: 0,
          averageRating: 0,
          totalRatings: 0,
        },
      });

      const formattedDriver = this.formatDriver(driver);

      // Cache the driver
      await this.cacheDriver(formattedDriver);

      // Log business event
      loggerHelpers.logBusinessEvent('driver_created', {
        driverId: driver.id,
        userId: input.userId,
        driverCode,
        vehicleType: input.vehicleType,
      });

      // Publish driver created event
      await publishDriverEvent('created', {
        driverId: driver.id,
        userId: input.userId,
        driverCode,
        vehicleType: input.vehicleType,
        status: DriverStatus.ACTIVE,
      });

      driverLogger.info('Driver created successfully', {
        driverId: driver.id,
        userId: input.userId,
        driverCode,
      });

      return formattedDriver;
    } catch (error) {
      driverLogger.error('Failed to create driver', {
        error: error instanceof Error ? error.message : 'Unknown error',
        input,
      });
      throw error;
    }
  }

  /**
   * Get driver by ID
   */
  async getDriverById(driverId: string): Promise<Driver> {
    try {
      // Try to get from cache first
      const cached = await this.getCachedDriver(driverId);
      if (cached) {
        return cached;
      }

      // Get from database
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      });

      if (!driver) {
        throw new DriverNotFoundError(driverId);
      }

      const formattedDriver = this.formatDriver(driver);

      // Cache the result
      await this.cacheDriver(formattedDriver);

      return formattedDriver;
    } catch (error) {
      if (error instanceof DriverNotFoundError) {
        throw error;
      }

      driverLogger.error('Failed to get driver by ID', {
        driverId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get driver by user ID
   */
  async getDriverByUserId(userId: string): Promise<Driver> {
    try {
      const driver = await prisma.driver.findUnique({
        where: { userId },
      });

      if (!driver) {
        throw new DriverNotFoundError(`driver with userId ${userId}`);
      }

      return this.formatDriver(driver);
    } catch (error) {
      driverLogger.error('Failed to get driver by user ID', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update driver
   */
  async updateDriver(driverId: string, input: UpdateDriverInput): Promise<Driver> {
    try {
      // Get current driver
      const currentDriver = await this.getDriverById(driverId);

      // Update driver in database
      const updatedDriver = await prisma.driver.update({
        where: { id: driverId },
        data: {
          ...input,
          emergencyContact: input.emergencyContact ? JSON.stringify(input.emergencyContact) : undefined,
          updatedAt: new Date(),
          suspendedAt: input.status === DriverStatus.SUSPENDED ? new Date() : undefined,
        },
      });

      const formattedDriver = this.formatDriver(updatedDriver);

      // Update cache
      await this.cacheDriver(formattedDriver);

      // Log business event
      loggerHelpers.logBusinessEvent('driver_updated', {
        driverId,
        updates: input,
        previousStatus: currentDriver.status,
      });

      // Publish driver updated event if status changed
      if (input.status && input.status !== currentDriver.status) {
        await publishDriverEvent('status_updated', {
          driverId,
          previousStatus: currentDriver.status,
          newStatus: input.status,
          suspensionReason: input.suspensionReason,
        });
      }

      driverLogger.info('Driver updated successfully', {
        driverId,
        updates: input,
      });

      return formattedDriver;
    } catch (error) {
      driverLogger.error('Failed to update driver', {
        driverId,
        input,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update driver location
   */
  async updateDriverLocation(driverId: string, locationData: {
    location: Coordinates;
    heading?: number;
    speed?: number;
    accuracy?: number;
  }): Promise<void> {
    try {
      const { location, heading, speed, accuracy } = locationData;

      // Validate coordinates
      if (!validateCoordinates(location.lat, location.lng)) {
        throw new ValidationError('Invalid coordinates provided');
      }

      // Update driver location in database
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          currentLocation: JSON.stringify(location),
          lastLocationUpdate: new Date(),
        },
      });

      // Store detailed location data in Redis for real-time tracking
      const locationInfo: DriverLocation = {
        driverId,
        location,
        heading,
        speed,
        accuracy,
        timestamp: new Date(),
      };

      await redis.setJson(`driver_location:${driverId}`, locationInfo, this.LOCATION_CACHE_TTL);

      // Update driver availability cache if needed
      await this.updateDriverInAvailabilityCache(driverId, location);

      // Log tracking event
      loggerHelpers.logTrackingEvent('driver_location_update', driverId, location, {
        heading,
        speed,
        accuracy,
      });

      // Publish location update event
      await publishDriverEvent('location_updated', {
        driverId,
        location,
        heading,
        speed,
        accuracy,
        timestamp: new Date(),
      });

      driverLogger.debug('Driver location updated', {
        driverId,
        location,
        heading,
        speed,
      });
    } catch (error) {
      driverLogger.error('Failed to update driver location', {
        driverId,
        locationData,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update driver availability
   */
  async updateDriverAvailability(driverId: string, availabilityData: {
    available: boolean;
    location?: Coordinates;
  }): Promise<Driver> {
    try {
      const { available, location } = availabilityData;

      // Get current driver
      const driver = await this.getDriverById(driverId);

      // Validate driver can change availability
      if (driver.status !== DriverStatus.ACTIVE) {
        throw new DriverNotAvailableError(driverId);
      }

      // Update driver availability
      const updateData: any = {
        isAvailable: available,
        lastActiveAt: new Date(),
      };

      if (location) {
        if (!validateCoordinates(location.lat, location.lng)) {
          throw new ValidationError('Invalid coordinates provided');
        }
        updateData.currentLocation = JSON.stringify(location);
        updateData.lastLocationUpdate = new Date();
      }

      const updatedDriver = await prisma.driver.update({
        where: { id: driverId },
        data: updateData,
      });

      const formattedDriver = this.formatDriver(updatedDriver);

      // Update cache
      await this.cacheDriver(formattedDriver);

      // Update availability cache
      if (available && location) {
        await this.addToAvailabilityCache(driverId, location);
      } else {
        await this.removeFromAvailabilityCache(driverId);
      }

      // Log business event
      loggerHelpers.logBusinessEvent('driver_availability_updated', {
        driverId,
        available,
        location,
      });

      // Publish availability event
      await publishDriverEvent(available ? 'available' : 'unavailable', {
        driverId,
        userId: driver.userId,
        location,
        timestamp: new Date(),
      });

      driverLogger.info('Driver availability updated', {
        driverId,
        available,
        location,
      });

      return formattedDriver;
    } catch (error) {
      driverLogger.error('Failed to update driver availability', {
        driverId,
        availabilityData,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get nearby available drivers
   */
  async getNearbyDrivers(searchParams: {
    lat: number;
    lng: number;
    radius?: number;
    vehicleType?: VehicleType;
    limit?: number;
  }): Promise<NearbyDriver[]> {
    try {
      const { lat, lng, radius = 10, vehicleType, limit = 20 } = searchParams;

      // Validate coordinates
      if (!validateCoordinates(lat, lng)) {
        throw new ValidationError('Invalid coordinates provided');
      }

      // Build where clause
      const where: any = {
        status: DriverStatus.ACTIVE,
        isAvailable: true,
        currentLocation: { not: null },
      };

      if (vehicleType) {
        where.vehicleType = vehicleType;
      }

      // Get available drivers from database
      const drivers = await prisma.driver.findMany({
        where,
        take: limit * 2, // Get more than needed to filter by distance
      });

      // Calculate distances and filter by radius
      const nearbyDrivers: NearbyDriver[] = drivers
        .map(driver => {
          const driverLocation = JSON.parse(driver.currentLocation as string);
          const distance = calculateDistance(lat, lng, driverLocation.lat, driverLocation.lng);

          return {
            id: driver.id,
            driverId: driver.id,
            location: driverLocation,
            distance,
            vehicleType: driver.vehicleType as VehicleType,
            rating: driver.averageRating,
            isAvailable: driver.isAvailable,
          };
        })
        .filter(driver => driver.distance <= radius)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);

      driverLogger.debug('Found nearby drivers', {
        searchLocation: { lat, lng },
        radius,
        vehicleType,
        count: nearbyDrivers.length,
      });

      return nearbyDrivers;
    } catch (error) {
      driverLogger.error('Failed to get nearby drivers', {
        searchParams,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check if driver can take more deliveries
   */
  async canTakeDelivery(driverId: string): Promise<boolean> {
    try {
      // Get current driver
      const driver = await this.getDriverById(driverId);

      // Check if driver is active and available
      if (driver.status !== DriverStatus.ACTIVE || !driver.isAvailable) {
        return false;
      }

      // Check current reskflow count
      const activeDeliveries = await prisma.reskflow.count({
        where: {
          driverId,
          status: {
            in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'],
          },
        },
      });

      return activeDeliveries < this.MAX_DELIVERY_CAPACITY;
    } catch (error) {
      driverLogger.error('Failed to check driver capacity', {
        driverId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get driver performance metrics
   */
  async getDriverPerformance(driverId: string, period?: {
    startDate: Date;
    endDate: Date;
  }) {
    try {
      const driver = await this.getDriverById(driverId);

      const where: any = { driverId };
      if (period) {
        where.createdAt = {
          gte: period.startDate,
          lte: period.endDate,
        };
      }

      const [
        totalDeliveries,
        completedDeliveries,
        averageDeliveryTime,
        averageRating,
      ] = await Promise.all([
        prisma.reskflow.count({ where }),
        prisma.reskflow.count({ where: { ...where, status: 'DELIVERED' } }),
        prisma.reskflow.aggregate({
          where: { ...where, status: 'DELIVERED', actualDeliveryTime: { not: null } },
          _avg: {
            // This would need a calculated field or additional logic
            // For now, return a placeholder
          },
        }),
        prisma.reskflow.aggregate({
          where: { ...where, reskflowRating: { not: null } },
          _avg: { reskflowRating: true },
        }),
      ]);

      const completionRate = totalDeliveries > 0 ? (completedDeliveries / totalDeliveries) * 100 : 0;

      return {
        driverId,
        period,
        totalDeliveries,
        completedDeliveries,
        completionRate,
        averageRating: averageRating._avg.reskflowRating || 0,
        // averageDeliveryTime would need proper calculation
        overallMetrics: {
          totalDeliveries: driver.totalDeliveries,
          completedDeliveries: driver.completedDeliveries,
          averageRating: driver.averageRating,
          totalRatings: driver.totalRatings,
        },
      };
    } catch (error) {
      driverLogger.error('Failed to get driver performance', {
        driverId,
        period,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private formatDriver(driver: any): Driver {
    return {
      ...driver,
      currentLocation: driver.currentLocation ? JSON.parse(driver.currentLocation) : undefined,
      emergencyContact: JSON.parse(driver.emergencyContact),
    };
  }

  private async cacheDriver(driver: Driver): Promise<void> {
    const key = `driver:${driver.id}`;
    await redis.setJson(key, driver, this.CACHE_TTL);
  }

  private async getCachedDriver(driverId: string): Promise<Driver | null> {
    const key = `driver:${driverId}`;
    return redis.getJson<Driver>(key);
  }

  private async addToAvailabilityCache(driverId: string, location: Coordinates): Promise<void> {
    const availabilityInfo: DriverAvailability = {
      driverId,
      available: true,
      location,
      timestamp: new Date(),
    };

    // Add to sorted set by latitude for geo-spatial queries
    await redis.zadd('available_drivers', location.lat, JSON.stringify(availabilityInfo));
  }

  private async removeFromAvailabilityCache(driverId: string): Promise<void> {
    // Remove from availability cache
    const members = await redis.zrange('available_drivers', 0, -1);
    for (const member of members) {
      const data = JSON.parse(member);
      if (data.driverId === driverId) {
        await redis.zrem('available_drivers', member);
        break;
      }
    }
  }

  private async updateDriverInAvailabilityCache(driverId: string, location: Coordinates): Promise<void> {
    // Check if driver is in availability cache and update location
    const members = await redis.zrange('available_drivers', 0, -1);
    for (const member of members) {
      const data = JSON.parse(member);
      if (data.driverId === driverId) {
        // Remove old entry
        await redis.zrem('available_drivers', member);
        
        // Add updated entry
        const updatedInfo: DriverAvailability = {
          ...data,
          location,
          timestamp: new Date(),
        };
        await redis.zadd('available_drivers', location.lat, JSON.stringify(updatedInfo));
        break;
      }
    }
  }
}