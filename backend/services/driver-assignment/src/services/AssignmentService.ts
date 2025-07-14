import { prisma, logger, redis } from '@reskflow/shared';
import { ZoneService } from './ZoneService';
import { DriverPoolService } from './DriverPoolService';
import { OptimizationService } from './OptimizationService';
import Bull from 'bull';
import * as geolib from 'geolib';

interface AssignmentJob {
  type: 'assign' | 'reassign' | 'batch_assign';
  orderId?: string;
  orderIds?: string[];
  strategy: string;
  metadata?: any;
}

interface AssignmentResult {
  success: boolean;
  orderId: string;
  driverId?: string;
  estimatedPickupTime?: Date;
  estimatedDeliveryTime?: Date;
  distance?: number;
  reason?: string;
}

interface AssignmentMetrics {
  totalAssignments: number;
  successfulAssignments: number;
  failedAssignments: number;
  averageAssignmentTime: number;
  averagePickupDistance: number;
  reassignmentRate: number;
  driverUtilization: number;
}

export class AssignmentService {
  private zoneService: ZoneService;
  private driverPoolService: DriverPoolService;
  private optimizationService: OptimizationService;
  private assignmentQueue: Bull.Queue;

  constructor(
    zoneService: ZoneService,
    driverPoolService: DriverPoolService,
    optimizationService: OptimizationService,
    assignmentQueue: Bull.Queue
  ) {
    this.zoneService = zoneService;
    this.driverPoolService = driverPoolService;
    this.optimizationService = optimizationService;
    this.assignmentQueue = assignmentQueue;
  }

  async processAssignmentJob(job: AssignmentJob) {
    logger.info(`Processing assignment job: ${job.type}`);

    try {
      switch (job.type) {
        case 'assign':
          return await this.executeAssignment(job.orderId!, job.strategy);
        case 'reassign':
          return await this.executeReassignment(job.orderId!, job.metadata?.reason);
        case 'batch_assign':
          return await this.executeBatchAssignment(job.orderIds!, job.strategy);
        default:
          throw new Error(`Unknown assignment job type: ${job.type}`);
      }
    } catch (error) {
      logger.error(`Assignment job failed: ${job.type}`, error);
      throw error;
    }
  }

  async assignDriver(orderId: string, strategy: string = 'proximity'): Promise<AssignmentResult> {
    // Add to queue for processing
    const job = await this.assignmentQueue.add('assignment', {
      type: 'assign',
      orderId,
      strategy,
    });

    // Wait for result
    const result = await job.finished();
    return result;
  }

  private async executeAssignment(orderId: string, strategy: string): Promise<AssignmentResult> {
    const startTime = Date.now();

    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        merchant: true,
        reskflow_address: true,
      },
    });

    if (!order) {
      return {
        success: false,
        orderId,
        reason: 'Order not found',
      };
    }

    // Determine pickup location
    const pickupLocation = {
      latitude: order.merchant.latitude,
      longitude: order.merchant.longitude,
    };

    // Find suitable drivers based on strategy
    let selectedDriver: any = null;

    switch (strategy) {
      case 'proximity':
        selectedDriver = await this.findProximityBasedDriver(pickupLocation, order);
        break;
      case 'zone_balanced':
        selectedDriver = await this.findZoneBalancedDriver(pickupLocation, order);
        break;
      case 'performance':
        selectedDriver = await this.findPerformanceBasedDriver(pickupLocation, order);
        break;
      case 'batched':
        selectedDriver = await this.findBatchOptimalDriver(pickupLocation, order);
        break;
      default:
        selectedDriver = await this.findProximityBasedDriver(pickupLocation, order);
    }

    if (!selectedDriver) {
      // No driver available, add to waiting queue
      await this.addToWaitingQueue(orderId);
      
      return {
        success: false,
        orderId,
        reason: 'No available drivers',
      };
    }

    // Create assignment
    const assignment = await this.createAssignment(order, selectedDriver);

    // Calculate estimates
    const estimates = await this.calculateDeliveryEstimates(
      selectedDriver,
      pickupLocation,
      {
        latitude: order.reskflow_address.latitude,
        longitude: order.reskflow_address.longitude,
      }
    );

    // Update order status
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'assigned',
        driver_assigned_at: new Date(),
      },
    });

    // Notify driver
    await this.notifyDriverOfAssignment(selectedDriver.driverId, assignment);

    // Update driver pool
    await this.driverPoolService.incrementActiveDeliveries(selectedDriver.driverId);

    // Track metrics
    await this.trackAssignmentMetrics(orderId, selectedDriver.driverId, Date.now() - startTime);

    return {
      success: true,
      orderId,
      driverId: selectedDriver.driverId,
      estimatedPickupTime: estimates.pickupTime,
      estimatedDeliveryTime: estimates.reskflowTime,
      distance: estimates.totalDistance,
    };
  }

  async reassignOrder(orderId: string, reason: string): Promise<AssignmentResult> {
    // Get current assignment
    const currentAssignment = await prisma.driverAssignment.findFirst({
      where: {
        order_id: orderId,
        status: { in: ['pending', 'accepted'] },
      },
    });

    if (!currentAssignment) {
      return {
        success: false,
        orderId,
        reason: 'No active assignment found',
      };
    }

    // Cancel current assignment
    await prisma.driverAssignment.update({
      where: { id: currentAssignment.id },
      data: {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancellation_reason: reason,
      },
    });

    // Decrement driver's active deliveries
    await this.driverPoolService.decrementActiveDeliveries(currentAssignment.driver_id);

    // Find new driver (excluding current)
    const job = await this.assignmentQueue.add('reassignment', {
      type: 'reassign',
      orderId,
      strategy: 'proximity',
      metadata: {
        reason,
        excludeDrivers: [currentAssignment.driver_id],
      },
    });

    const result = await job.finished();
    return result;
  }

  private async executeReassignment(orderId: string, reason: string): Promise<AssignmentResult> {
    // Similar to executeAssignment but with exclusions
    return this.executeAssignment(orderId, 'proximity');
  }

  private async executeBatchAssignment(orderIds: string[], strategy: string): Promise<any> {
    // Optimize assignment of multiple orders
    const results = await this.optimizationService.optimizeBatchAssignment(orderIds);
    
    // Execute assignments
    const assignmentResults = [];
    for (const assignment of results) {
      const result = await this.createAssignment(
        await prisma.order.findUnique({ where: { id: assignment.orderId } }),
        { driverId: assignment.driverId }
      );
      assignmentResults.push(result);
    }

    return assignmentResults;
  }

  async getDriverAssignments(driverId: string) {
    const assignments = await prisma.driverAssignment.findMany({
      where: {
        driver_id: driverId,
        status: { in: ['pending', 'accepted'] },
      },
      include: {
        reskflow: {
          include: {
            order: {
              include: {
                merchant: true,
                reskflow_address: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return assignments.map(assignment => ({
      id: assignment.id,
      orderId: assignment.order_id,
      status: assignment.status,
      pickupLocation: {
        latitude: assignment.reskflow.order.merchant.latitude,
        longitude: assignment.reskflow.order.merchant.longitude,
        address: assignment.reskflow.order.merchant.address,
      },
      reskflowLocation: {
        latitude: assignment.reskflow.order.reskflow_address.latitude,
        longitude: assignment.reskflow.order.reskflow_address.longitude,
        address: assignment.reskflow.order.reskflow_address.formatted_address,
      },
      estimatedPickupTime: assignment.estimated_pickup_time,
      estimatedDeliveryTime: assignment.estimated_reskflow_time,
      priority: assignment.priority,
    }));
  }

  private async findProximityBasedDriver(pickupLocation: any, order: any) {
    // Get nearby available drivers
    const nearbyDrivers = await this.driverPoolService.getNearbyDrivers(
      pickupLocation,
      5000, // 5km radius
      {
        status: 'online',
        maxActiveDeliveries: 2,
      }
    );

    if (nearbyDrivers.length === 0) return null;

    // Score drivers based on multiple factors
    const scoredDrivers = nearbyDrivers.map(driver => {
      let score = 1000; // Base score

      // Distance factor (most important)
      score -= driver.distance * 0.5;

      // Active deliveries penalty
      score -= driver.activeDeliveries * 100;

      // Rating bonus
      score += driver.rating * 20;

      // Vehicle type match
      if (order.requires_vehicle_type && driver.vehicleType === order.requires_vehicle_type) {
        score += 50;
      }

      return { ...driver, score };
    });

    // Sort by score and return best driver
    scoredDrivers.sort((a, b) => b.score - a.score);
    return scoredDrivers[0];
  }

  private async findZoneBalancedDriver(pickupLocation: any, order: any) {
    // Get zone for pickup location
    const zone = this.zoneService.getZoneForLocation(
      pickupLocation.latitude,
      pickupLocation.longitude
    );

    if (!zone) {
      return this.findProximityBasedDriver(pickupLocation, order);
    }

    // Get zone statistics
    const zoneStats = await this.zoneService.getZoneStatistics(zone.id);

    // If zone is under-served, prioritize drivers from neighboring zones
    if (zoneStats.demandSupplyRatio > 2) {
      const neighboringZones = await this.zoneService.getNeighboringZones(zone.id);
      
      for (const neighborZone of neighboringZones) {
        const neighborStats = await this.zoneService.getZoneStatistics(neighborZone.id);
        if (neighborStats.demandSupplyRatio < 1) {
          // Get drivers from this zone
          const drivers = await this.driverPoolService.getDriversInZone(
            neighborZone.id,
            'online'
          );
          
          if (drivers.length > 0) {
            // Find closest driver
            const driversWithDistance = drivers.map(d => ({
              ...d,
              distance: geolib.getDistance(
                pickupLocation,
                { latitude: d.location.latitude, longitude: d.location.longitude }
              ),
            }));
            
            driversWithDistance.sort((a, b) => a.distance - b.distance);
            return driversWithDistance[0];
          }
        }
      }
    }

    // Fall back to proximity search within zone
    return this.findProximityBasedDriver(pickupLocation, order);
  }

  private async findPerformanceBasedDriver(pickupLocation: any, order: any) {
    const nearbyDrivers = await this.driverPoolService.getNearbyDrivers(
      pickupLocation,
      5000,
      { status: 'online', maxActiveDeliveries: 2 }
    );

    if (nearbyDrivers.length === 0) return null;

    // Get performance metrics for each driver
    const driversWithPerformance = await Promise.all(
      nearbyDrivers.map(async driver => {
        const performance = await this.driverPoolService.getDriverPerformance(
          driver.driverId,
          '7d'
        );
        return { ...driver, performance };
      })
    );

    // Score based on performance
    const scoredDrivers = driversWithPerformance.map(driver => {
      let score = 1000;

      // Distance factor
      score -= driver.distance * 0.3;

      // Performance factors
      score += driver.performance.averageRating * 50;
      score += driver.performance.onTimeRate * 2;
      score += driver.performance.acceptanceRate * 1;
      score -= driver.performance.averageDeliveryTime * 0.5;

      // Active deliveries
      score -= driver.activeDeliveries * 80;

      return { ...driver, score };
    });

    scoredDrivers.sort((a, b) => b.score - a.score);
    return scoredDrivers[0];
  }

  private async findBatchOptimalDriver(pickupLocation: any, order: any) {
    // Check if order can be batched with existing routes
    const nearbyDrivers = await this.driverPoolService.getNearbyDrivers(
      pickupLocation,
      3000,
      { status: 'online', maxActiveDeliveries: 1 }
    );

    for (const driver of nearbyDrivers) {
      if (driver.activeDeliveries > 0) {
        // Check if this order can be efficiently added to driver's route
        const currentAssignments = await this.getDriverAssignments(driver.driverId);
        
        if (currentAssignments.length > 0) {
          const canBatch = await this.optimizationService.canBatchOrder(
            driver.driverId,
            currentAssignments,
            order
          );

          if (canBatch) {
            return driver;
          }
        }
      }
    }

    // No batching opportunity, use proximity
    return this.findProximityBasedDriver(pickupLocation, order);
  }

  private async createAssignment(order: any, driver: any) {
    const reskflow = await prisma.reskflow.create({
      data: {
        order_id: order.id,
        driver_id: driver.driverId,
        status: 'assigned',
        assigned_at: new Date(),
        pickup_location: {
          type: 'Point',
          coordinates: [order.merchant.longitude, order.merchant.latitude],
        },
        reskflow_location: {
          type: 'Point',
          coordinates: [order.reskflow_address.longitude, order.reskflow_address.latitude],
        },
        zone_id: driver.zoneId,
      },
    });

    const assignment = await prisma.driverAssignment.create({
      data: {
        reskflow_id: reskflow.id,
        driver_id: driver.driverId,
        order_id: order.id,
        status: 'pending',
        estimated_pickup_time: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        estimated_reskflow_time: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        priority: order.priority || 'normal',
        created_at: new Date(),
      },
    });

    return assignment;
  }

  private async calculateDeliveryEstimates(driver: any, pickup: any, reskflow: any) {
    // Calculate distances
    const toPickup = geolib.getDistance(
      { latitude: driver.location.latitude, longitude: driver.location.longitude },
      pickup
    );

    const toDelivery = geolib.getDistance(pickup, reskflow);
    const totalDistance = toPickup + toDelivery;

    // Estimate times (assuming average speed of 30 km/h in city)
    const avgSpeedMps = 8.33; // 30 km/h in m/s
    const pickupTimeSeconds = toPickup / avgSpeedMps + 300; // +5 min for pickup
    const reskflowTimeSeconds = toDelivery / avgSpeedMps + 180; // +3 min for reskflow

    return {
      pickupTime: new Date(Date.now() + pickupTimeSeconds * 1000),
      reskflowTime: new Date(Date.now() + (pickupTimeSeconds + reskflowTimeSeconds) * 1000),
      totalDistance,
    };
  }

  private async notifyDriverOfAssignment(driverId: string, assignment: any) {
    // Send push notification
    await redis.publish(`driver:${driverId}:notifications`, JSON.stringify({
      type: 'new_assignment',
      assignmentId: assignment.id,
      orderId: assignment.order_id,
      message: 'You have a new reskflow assignment',
      requiresAction: true,
    }));
  }

  private async addToWaitingQueue(orderId: string) {
    await redis.lpush('orders:waiting_assignment', orderId);
    await redis.expire('orders:waiting_assignment', 3600); // 1 hour
  }

  private async trackAssignmentMetrics(orderId: string, driverId: string, assignmentTime: number) {
    // Track in Redis for real-time metrics
    const metricsKey = `assignment_metrics:${new Date().toISOString().split('T')[0]}`;
    
    await redis.hincrby(metricsKey, 'total_assignments', 1);
    await redis.hincrby(metricsKey, 'successful_assignments', 1);
    await redis.hincrbyfloat(metricsKey, 'total_assignment_time', assignmentTime);
    
    await redis.expire(metricsKey, 7 * 24 * 60 * 60); // 7 days
  }

  async getAssignmentMetrics(startDate?: string, endDate?: string): Promise<AssignmentMetrics> {
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    // Aggregate metrics from Redis
    // This is simplified - in production would aggregate from multiple days
    const metricsKey = `assignment_metrics:${end}`;
    const metrics = await redis.hgetall(metricsKey);

    const totalAssignments = parseInt(metrics.total_assignments || '0');
    const successfulAssignments = parseInt(metrics.successful_assignments || '0');
    const failedAssignments = parseInt(metrics.failed_assignments || '0');
    const totalAssignmentTime = parseFloat(metrics.total_assignment_time || '0');
    
    return {
      totalAssignments,
      successfulAssignments,
      failedAssignments,
      averageAssignmentTime: totalAssignments > 0 ? totalAssignmentTime / totalAssignments : 0,
      averagePickupDistance: 1.2, // km - placeholder
      reassignmentRate: 0.05, // 5% - placeholder
      driverUtilization: 0.75, // 75% - placeholder
    };
  }
}