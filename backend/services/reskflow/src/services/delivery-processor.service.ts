import { Channel } from 'amqplib';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { rabbitmq, publishDeliveryEvent, publishNotification } from '../config/rabbitmq';
import {
  Delivery,
  DeliveryStatus,
  DeliveryQueueMessage,
  DriverQueueMessage,
  TrackingEventType,
  VehicleType,
  Coordinates,
} from '../types/reskflow.types';
import {
  DeliveryNotFoundError,
  DriverNotFoundError,
  DeliveryAssignmentError,
  ProcessingError,
} from '../utils/errors';
import {
  calculateDistance,
  delay,
  exponentialBackoff,
} from '../utils/helpers';
import { reskflowProcessorLogger, loggerHelpers } from '../utils/logger';
import { config } from '../config';
import { DeliveryService } from './reskflow.service';
import { DriverService } from './driver.service';
import { TrackingService } from './tracking.service';
import { RouteService } from './route.service';

export class DeliveryProcessorService {
  private channel: Channel | null = null;
  private isProcessing = false;
  private readonly QUEUE_NAMES = {
    DELIVERY_CREATED: 'reskflow.created',
    DELIVERY_ASSIGNMENT: 'reskflow.assignment',
    DELIVERY_STATUS_UPDATE: 'reskflow.status.update',
    DRIVER_LOCATION_UPDATE: 'driver.location.update',
    DELIVERY_RETRY: 'reskflow.retry',
    NOTIFICATION_QUEUE: 'notifications',
  };
  
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 5000; // 5 seconds
  private readonly ASSIGNMENT_TIMEOUT = 300000; // 5 minutes
  private readonly BATCH_SIZE = 10;

  constructor(
    private reskflowService: DeliveryService,
    private driverService: DriverService,
    private trackingService: TrackingService,
    private routeService: RouteService
  ) {}

  /**
   * Start the reskflow processor
   */
  async start(): Promise<void> {
    try {
      if (this.isProcessing) {
        reskflowProcessorLogger.warn('Delivery processor is already running');
        return;
      }

      // Get RabbitMQ channel
      this.channel = await rabbitmq.createChannel();
      
      if (!this.channel) {
        throw new ProcessingError('Failed to create RabbitMQ channel');
      }

      // Declare queues
      await this.declareQueues();

      // Set up consumers
      await this.setupConsumers();

      this.isProcessing = true;

      // Start periodic tasks
      this.startPeriodicTasks();

      reskflowProcessorLogger.info('Delivery processor started successfully');
    } catch (error) {
      reskflowProcessorLogger.error('Failed to start reskflow processor', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Stop the reskflow processor
   */
  async stop(): Promise<void> {
    try {
      this.isProcessing = false;

      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      reskflowProcessorLogger.info('Delivery processor stopped');
    } catch (error) {
      reskflowProcessorLogger.error('Failed to stop reskflow processor', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Process new reskflow creation
   */
  private async processDeliveryCreated(message: DeliveryQueueMessage): Promise<void> {
    try {
      const { reskflowId } = message.data;

      // Get reskflow details
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);

      // Log tracking event
      await this.trackingService.logTrackingEvent({
        reskflowId,
        eventType: TrackingEventType.DELIVERY_CREATED,
        status: DeliveryStatus.PENDING,
        notes: 'Delivery created and queued for driver assignment',
      });

      // Queue for driver assignment
      await this.queueDeliveryAssignment(reskflow);

      reskflowProcessorLogger.info('Delivery creation processed', {
        reskflowId,
        orderId: reskflow.orderId,
      });
    } catch (error) {
      reskflowProcessorLogger.error('Failed to process reskflow creation', {
        message,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Process reskflow assignment
   */
  private async processDeliveryAssignment(message: DeliveryQueueMessage): Promise<void> {
    try {
      const { reskflowId } = message.data;

      // Get reskflow details
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);

      if (reskflow.status !== DeliveryStatus.PENDING) {
        reskflowProcessorLogger.info('Delivery no longer pending assignment', {
          reskflowId,
          currentStatus: reskflow.status,
        });
        return;
      }

      // Find available drivers
      const pickupAddress = reskflow.pickupAddress;
      if (!pickupAddress.coordinates) {
        throw new DeliveryAssignmentError('Pickup address missing coordinates');
      }

      const nearbyDrivers = await this.driverService.getNearbyDrivers({
        lat: pickupAddress.coordinates.lat,
        lng: pickupAddress.coordinates.lng,
        radius: config.reskflow.searchRadius || 10,
        limit: 10,
      });

      if (nearbyDrivers.length === 0) {
        // No drivers available, retry later
        await this.retryDeliveryAssignment(reskflowId, message.retryCount + 1);
        return;
      }

      // Find best driver using scoring algorithm
      const bestDriver = await this.findBestDriver(reskflow, nearbyDrivers);

      if (!bestDriver) {
        await this.retryDeliveryAssignment(reskflowId, message.retryCount + 1);
        return;
      }

      // Check if driver can take reskflow
      const canTakeDelivery = await this.driverService.canTakeDelivery(bestDriver.driverId);
      if (!canTakeDelivery) {
        // Remove this driver from consideration and try again
        const filteredDrivers = nearbyDrivers.filter(d => d.driverId !== bestDriver.driverId);
        if (filteredDrivers.length > 0) {
          const nextBest = await this.findBestDriver(reskflow, filteredDrivers);
          if (nextBest) {
            await this.assignDeliveryToDriver(reskflowId, nextBest.driverId);
            return;
          }
        }
        
        await this.retryDeliveryAssignment(reskflowId, message.retryCount + 1);
        return;
      }

      // Assign reskflow to driver
      await this.assignDeliveryToDriver(reskflowId, bestDriver.driverId);

      reskflowProcessorLogger.info('Delivery assigned successfully', {
        reskflowId,
        driverId: bestDriver.driverId,
        distance: bestDriver.distance,
        rating: bestDriver.rating,
      });
    } catch (error) {
      reskflowProcessorLogger.error('Failed to process reskflow assignment', {
        message,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Retry assignment if possible
      if (message.retryCount < this.MAX_RETRIES) {
        await this.retryDeliveryAssignment(message.data.reskflowId, message.retryCount + 1);
      } else {
        // Mark reskflow as failed after max retries
        await this.handleDeliveryAssignmentFailure(message.data.reskflowId);
      }
    }
  }

  /**
   * Process reskflow status update
   */
  private async processDeliveryStatusUpdate(message: DeliveryQueueMessage): Promise<void> {
    try {
      const { reskflowId, status, driverId } = message.data;

      // Get current reskflow
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);

      // Validate status transition
      if (reskflow.status === status) {
        reskflowProcessorLogger.debug('No status change needed', {
          reskflowId,
          currentStatus: reskflow.status,
          requestedStatus: status,
        });
        return;
      }

      // Update reskflow status
      await this.reskflowService.updateDelivery(reskflowId, { status });

      // Log tracking event
      await this.trackingService.logTrackingEvent({
        reskflowId,
        eventType: TrackingEventType.STATUS_UPDATE,
        status,
        notes: `Status updated to ${status}`,
        createdBy: driverId,
      });

      // Handle specific status changes
      switch (status) {
        case DeliveryStatus.PICKED_UP:
          await this.handlePickupCompleted(reskflow);
          break;
        case DeliveryStatus.IN_TRANSIT:
          await this.handleDeliveryStarted(reskflow);
          break;
        case DeliveryStatus.DELIVERED:
          await this.handleDeliveryCompleted(reskflow);
          break;
        case DeliveryStatus.FAILED:
          await this.handleDeliveryFailed(reskflow);
          break;
        case DeliveryStatus.CANCELLED:
          await this.handleDeliveryCancelled(reskflow);
          break;
      }

      reskflowProcessorLogger.info('Delivery status update processed', {
        reskflowId,
        previousStatus: reskflow.status,
        newStatus: status,
      });
    } catch (error) {
      reskflowProcessorLogger.error('Failed to process reskflow status update', {
        message,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Process driver location update
   */
  private async processDriverLocationUpdate(message: DriverQueueMessage): Promise<void> {
    try {
      const { driverId, location } = message.data;

      if (!location) {
        reskflowProcessorLogger.warn('Location update missing coordinates', {
          driverId,
        });
        return;
      }

      // Update driver location
      await this.driverService.updateDriverLocation(driverId, {
        location,
        accuracy: message.data.accuracy,
        heading: message.data.heading,
        speed: message.data.speed,
      });

      // Get active deliveries for this driver
      const activeDeliveries = await prisma.reskflow.findMany({
        where: {
          driverId,
          status: {
            in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.IN_TRANSIT],
          },
        },
      });

      // Update location for each active reskflow
      for (const reskflow of activeDeliveries) {
        await this.trackingService.updateLocation({
          reskflowId: reskflow.id,
          driverId,
          location,
          accuracy: message.data.accuracy,
          heading: message.data.heading,
          speed: message.data.speed,
          timestamp: new Date(),
          status: reskflow.status,
        });

        // Check for geofence events
        await this.trackingService.checkGeofenceEvents({
          reskflowId: reskflow.id,
          driverId,
          location,
          timestamp: new Date(),
        });
      }

      reskflowProcessorLogger.debug('Driver location update processed', {
        driverId,
        location,
        activeDeliveriesCount: activeDeliveries.length,
      });
    } catch (error) {
      reskflowProcessorLogger.error('Failed to process driver location update', {
        message,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Set up queue consumers
   */
  private async setupConsumers(): Promise<void> {
    if (!this.channel) return;

    // Delivery created consumer
    await this.channel.consume(this.QUEUE_NAMES.DELIVERY_CREATED, async (msg) => {
      if (msg) {
        try {
          const message: DeliveryQueueMessage = JSON.parse(msg.content.toString());
          await this.processDeliveryCreated(message);
          this.channel!.ack(msg);
        } catch (error) {
          reskflowProcessorLogger.error('Error processing reskflow created message', { error });
          this.channel!.nack(msg, false, false); // Don't requeue
        }
      }
    });

    // Delivery assignment consumer
    await this.channel.consume(this.QUEUE_NAMES.DELIVERY_ASSIGNMENT, async (msg) => {
      if (msg) {
        try {
          const message: DeliveryQueueMessage = JSON.parse(msg.content.toString());
          await this.processDeliveryAssignment(message);
          this.channel!.ack(msg);
        } catch (error) {
          reskflowProcessorLogger.error('Error processing reskflow assignment message', { error });
          this.channel!.nack(msg, false, true); // Requeue for retry
        }
      }
    });

    // Delivery status update consumer
    await this.channel.consume(this.QUEUE_NAMES.DELIVERY_STATUS_UPDATE, async (msg) => {
      if (msg) {
        try {
          const message: DeliveryQueueMessage = JSON.parse(msg.content.toString());
          await this.processDeliveryStatusUpdate(message);
          this.channel!.ack(msg);
        } catch (error) {
          reskflowProcessorLogger.error('Error processing reskflow status update message', { error });
          this.channel!.nack(msg, false, false); // Don't requeue
        }
      }
    });

    // Driver location update consumer
    await this.channel.consume(this.QUEUE_NAMES.DRIVER_LOCATION_UPDATE, async (msg) => {
      if (msg) {
        try {
          const message: DriverQueueMessage = JSON.parse(msg.content.toString());
          await this.processDriverLocationUpdate(message);
          this.channel!.ack(msg);
        } catch (error) {
          reskflowProcessorLogger.error('Error processing driver location update message', { error });
          this.channel!.nack(msg, false, false); // Don't requeue
        }
      }
    });

    reskflowProcessorLogger.info('Queue consumers set up successfully');
  }

  /**
   * Declare queues
   */
  private async declareQueues(): Promise<void> {
    if (!this.channel) return;

    const queueOptions = { durable: true };

    await Promise.all([
      this.channel.assertQueue(this.QUEUE_NAMES.DELIVERY_CREATED, queueOptions),
      this.channel.assertQueue(this.QUEUE_NAMES.DELIVERY_ASSIGNMENT, queueOptions),
      this.channel.assertQueue(this.QUEUE_NAMES.DELIVERY_STATUS_UPDATE, queueOptions),
      this.channel.assertQueue(this.QUEUE_NAMES.DRIVER_LOCATION_UPDATE, queueOptions),
      this.channel.assertQueue(this.QUEUE_NAMES.DELIVERY_RETRY, queueOptions),
      this.channel.assertQueue(this.QUEUE_NAMES.NOTIFICATION_QUEUE, queueOptions),
    ]);

    reskflowProcessorLogger.info('Queues declared successfully');
  }

  /**
   * Start periodic background tasks
   */
  private startPeriodicTasks(): void {
    // Check for stale assignments every 5 minutes
    setInterval(async () => {
      if (this.isProcessing) {
        await this.checkStaleAssignments();
      }
    }, 300000); // 5 minutes

    // Cleanup expired cache entries every hour
    setInterval(async () => {
      if (this.isProcessing) {
        await this.cleanupExpiredCache();
      }
    }, 3600000); // 1 hour

    // Generate reskflow analytics every 30 minutes
    setInterval(async () => {
      if (this.isProcessing) {
        await this.generatePeriodicAnalytics();
      }
    }, 1800000); // 30 minutes

    reskflowProcessorLogger.info('Periodic tasks started');
  }

  /**
   * Private helper methods
   */
  private async queueDeliveryAssignment(reskflow: Delivery): Promise<void> {
    if (!this.channel) return;

    const message: DeliveryQueueMessage = {
      id: `assignment_${reskflow.id}_${Date.now()}`,
      type: 'DELIVERY_ASSIGNMENT',
      data: {
        reskflowId: reskflow.id,
        orderId: reskflow.orderId,
        customerId: reskflow.customerId,
        merchantId: reskflow.merchantId,
        priority: reskflow.priority,
      },
      timestamp: new Date(),
      retryCount: 0,
      maxRetries: this.MAX_RETRIES,
    };

    await this.channel.sendToQueue(
      this.QUEUE_NAMES.DELIVERY_ASSIGNMENT,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }
    );
  }

  private async findBestDriver(reskflow: Delivery, availableDrivers: any[]): Promise<any | null> {
    if (availableDrivers.length === 0) return null;

    // Calculate driver scores based on multiple factors
    const scoredDrivers = availableDrivers.map(driver => {
      let score = 0;

      // Distance factor (closer is better, max 40 points)
      const maxDistance = 10; // km
      const distanceScore = Math.max(0, (maxDistance - driver.distance) / maxDistance * 40);
      score += distanceScore;

      // Rating factor (higher rating is better, max 30 points)
      const ratingScore = (driver.rating / 5) * 30;
      score += ratingScore;

      // Vehicle type preference (exact match gets bonus, max 20 points)
      const preferredVehicles = this.getPreferredVehicles(reskflow);
      if (preferredVehicles.includes(driver.vehicleType)) {
        score += 20;
      }

      // Availability factor (always available gets bonus, max 10 points)
      if (driver.isAvailable) {
        score += 10;
      }

      return { ...driver, score };
    });

    // Sort by score (highest first) and return the best driver
    scoredDrivers.sort((a, b) => b.score - a.score);
    
    reskflowProcessorLogger.debug('Driver scoring completed', {
      reskflowId: reskflow.id,
      driversConsidered: scoredDrivers.length,
      bestDriverScore: scoredDrivers[0]?.score,
      worstDriverScore: scoredDrivers[scoredDrivers.length - 1]?.score,
    });

    return scoredDrivers[0];
  }

  private getPreferredVehicles(reskflow: Delivery): VehicleType[] {
    // Logic to determine preferred vehicle types based on reskflow characteristics
    // For example, heavy orders might prefer cars/trucks, small orders can use bikes
    
    const preferences: VehicleType[] = [];
    
    // Default preferences
    preferences.push(VehicleType.CAR, VehicleType.MOTORCYCLE);
    
    // Add bicycle for short distances in urban areas
    if (reskflow.priority === 'LOW' || reskflow.priority === 'NORMAL') {
      preferences.push(VehicleType.BICYCLE);
    }
    
    // Add truck for larger orders (if we had order details)
    // This would be determined by order value, weight, or item count
    
    return preferences;
  }

  private async assignDeliveryToDriver(reskflowId: string, driverId: string): Promise<void> {
    await this.reskflowService.assignDelivery(reskflowId, driverId);

    // Log tracking event
    await this.trackingService.logTrackingEvent({
      reskflowId,
      eventType: TrackingEventType.DRIVER_ASSIGNED,
      status: DeliveryStatus.ASSIGNED,
      notes: `Driver ${driverId} assigned to reskflow`,
      createdBy: 'system',
    });
  }

  private async retryDeliveryAssignment(reskflowId: string, retryCount: number): Promise<void> {
    if (retryCount > this.MAX_RETRIES) {
      await this.handleDeliveryAssignmentFailure(reskflowId);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = exponentialBackoff(retryCount, this.RETRY_DELAY);

    setTimeout(async () => {
      if (!this.channel) return;

      const message: DeliveryQueueMessage = {
        id: `retry_${reskflowId}_${Date.now()}`,
        type: 'DELIVERY_ASSIGNMENT',
        data: { reskflowId },
        timestamp: new Date(),
        retryCount,
        maxRetries: this.MAX_RETRIES,
      };

      await this.channel.sendToQueue(
        this.QUEUE_NAMES.DELIVERY_ASSIGNMENT,
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
      );
    }, delay);

    reskflowProcessorLogger.info('Delivery assignment retry scheduled', {
      reskflowId,
      retryCount,
      delay,
    });
  }

  private async handleDeliveryAssignmentFailure(reskflowId: string): Promise<void> {
    try {
      await this.reskflowService.updateDelivery(reskflowId, {
        status: DeliveryStatus.FAILED,
        failureReason: 'No available drivers found after maximum retries',
      });

      // Log tracking event
      await this.trackingService.logTrackingEvent({
        reskflowId,
        eventType: TrackingEventType.DELIVERY_FAILED,
        status: DeliveryStatus.FAILED,
        notes: 'Failed to assign driver after maximum retries',
        createdBy: 'system',
      });

      reskflowProcessorLogger.error('Delivery assignment failed permanently', {
        reskflowId,
        reason: 'No available drivers',
      });
    } catch (error) {
      reskflowProcessorLogger.error('Failed to handle reskflow assignment failure', {
        reskflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handlePickupCompleted(reskflow: Delivery): Promise<void> {
    // Calculate route to reskflow location
    if (reskflow.pickupAddress.coordinates && reskflow.reskflowAddress.coordinates) {
      try {
        const route = await this.routeService.calculateRoute({
          origin: reskflow.pickupAddress.coordinates,
          destination: reskflow.reskflowAddress.coordinates,
        });

        // Store route information
        await redis.setJson(`route:${reskflow.id}`, route, 3600); // 1 hour TTL

        reskflowProcessorLogger.info('Route calculated for pickup completion', {
          reskflowId: reskflow.id,
          distance: route.distance.text,
          duration: route.duration.text,
        });
      } catch (error) {
        reskflowProcessorLogger.warn('Failed to calculate route after pickup', {
          reskflowId: reskflow.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async handleDeliveryStarted(reskflow: Delivery): Promise<void> {
    // Send notification to customer that reskflow is in transit
    await publishNotification('reskflow_in_transit', {
      userId: reskflow.customerId,
      reskflowId: reskflow.id,
      estimatedArrival: reskflow.estimatedDeliveryTime,
    });
  }

  private async handleDeliveryCompleted(reskflow: Delivery): Promise<void> {
    // Update driver statistics
    if (reskflow.driverId) {
      await prisma.driver.update({
        where: { id: reskflow.driverId },
        data: {
          completedDeliveries: { increment: 1 },
          totalDeliveries: { increment: 1 },
        },
      });
    }

    // Log completion analytics
    loggerHelpers.logBusinessEvent('reskflow_completed', {
      reskflowId: reskflow.id,
      orderId: reskflow.orderId,
      driverId: reskflow.driverId,
      completionTime: new Date(),
    });
  }

  private async handleDeliveryFailed(reskflow: Delivery): Promise<void> {
    // Handle reskflow failure logic
    if (reskflow.driverId) {
      await prisma.driver.update({
        where: { id: reskflow.driverId },
        data: {
          totalDeliveries: { increment: 1 },
        },
      });
    }
  }

  private async handleDeliveryCancelled(reskflow: Delivery): Promise<void> {
    // Handle reskflow cancellation logic
    if (reskflow.driverId) {
      await prisma.driver.update({
        where: { id: reskflow.driverId },
        data: {
          cancelledDeliveries: { increment: 1 },
          totalDeliveries: { increment: 1 },
        },
      });
    }
  }

  private async checkStaleAssignments(): Promise<void> {
    try {
      const staleTime = new Date(Date.now() - this.ASSIGNMENT_TIMEOUT);
      
      const staleDeliveries = await prisma.reskflow.findMany({
        where: {
          status: DeliveryStatus.PENDING,
          createdAt: { lt: staleTime },
        },
      });

      for (const reskflow of staleDeliveries) {
        reskflowProcessorLogger.warn('Found stale reskflow assignment', {
          reskflowId: reskflow.id,
          createdAt: reskflow.createdAt,
        });

        // Retry assignment
        await this.queueDeliveryAssignment(reskflow);
      }
    } catch (error) {
      reskflowProcessorLogger.error('Failed to check stale assignments', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async cleanupExpiredCache(): Promise<void> {
    try {
      // This would implement cache cleanup logic
      reskflowProcessorLogger.debug('Cache cleanup completed');
    } catch (error) {
      reskflowProcessorLogger.error('Failed to cleanup expired cache', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async generatePeriodicAnalytics(): Promise<void> {
    try {
      // Generate and cache analytics data
      const analytics = await this.reskflowService.getDeliveryAnalytics({
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      });

      await redis.setJson('analytics:daily', analytics, 3600); // 1 hour TTL
      
      reskflowProcessorLogger.debug('Periodic analytics generated', {
        totalDeliveries: analytics.totalDeliveries,
        completionRate: analytics.completionRate,
      });
    } catch (error) {
      reskflowProcessorLogger.error('Failed to generate periodic analytics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// Factory function to start the reskflow processor
export async function startDeliveryProcessor(): Promise<DeliveryProcessorService> {
  const reskflowService = new DeliveryService();
  const driverService = new DriverService();
  const trackingService = new TrackingService();
  const routeService = new RouteService();

  const processor = new DeliveryProcessorService(
    reskflowService,
    driverService,
    trackingService,
    routeService
  );

  await processor.start();
  return processor;
}