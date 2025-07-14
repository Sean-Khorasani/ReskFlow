import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { publishDeliveryEvent, publishNotification } from '../config/rabbitmq';
import {
  Delivery,
  CreateDeliveryInput,
  UpdateDeliveryInput,
  DeliveryFilters,
  DeliveryStatus,
  DeliveryPriority,
  PaginatedResult,
} from '../types/reskflow.types';
import {
  DeliveryNotFoundError,
  DeliveryAlreadyAssignedError,
  DeliveryNotAssignedError,
  DeliveryStatusError,
  DeliveryTimeoutError,
  ValidationError,
  BusinessLogicError,
} from '../utils/errors';
import { 
  generateDeliveryNumber, 
  calculateDistance, 
  calculateEstimatedDeliveryTime,
  calculateDeliveryFee,
  isWithinServiceArea,
  calculatePagination,
} from '../utils/helpers';
import { reskflowLogger, loggerHelpers } from '../utils/logger';
import { config } from '../config';

export class DeliveryService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly ASSIGNMENT_TIMEOUT = config.reskflow.assignmentTimeout * 60 * 1000; // Convert to ms

  /**
   * Create a new reskflow
   */
  async createDelivery(input: CreateDeliveryInput): Promise<Delivery> {
    try {
      // Validate reskflow addresses are within service area
      await this.validateServiceArea(input.pickupAddress, input.reskflowAddress);

      // Calculate reskflow fee and estimated time
      const distance = calculateDistance(
        input.pickupAddress.coordinates?.lat || 0,
        input.pickupAddress.coordinates?.lng || 0,
        input.reskflowAddress.coordinates?.lat || 0,
        input.reskflowAddress.coordinates?.lng || 0
      );

      const estimatedDeliveryTime = calculateEstimatedDeliveryTime(distance);
      const reskflowFee = input.reskflowFee || calculateDeliveryFee(distance);

      // Generate unique reskflow number
      const reskflowNumber = generateDeliveryNumber();

      // Create reskflow in database
      const reskflow = await prisma.reskflow.create({
        data: {
          reskflowNumber,
          orderId: input.orderId,
          customerId: input.customerId,
          merchantId: input.merchantId,
          
          // Addresses
          pickupAddress: JSON.stringify(input.pickupAddress),
          reskflowAddress: JSON.stringify(input.reskflowAddress),
          
          // Contact info
          customerPhone: input.customerPhone,
          customerName: input.customerName,
          merchantPhone: input.merchantPhone,
          merchantName: input.merchantName,
          
          // Delivery details
          status: DeliveryStatus.PENDING,
          priority: input.priority || DeliveryPriority.NORMAL,
          specialInstructions: input.specialInstructions,
          reskflowFee,
          
          // Timing
          estimatedPickupTime: input.estimatedPickupTime,
          estimatedDeliveryTime: input.estimatedDeliveryTime,
        },
      });

      const formattedDelivery = this.formatDelivery(reskflow);

      // Cache the reskflow
      await this.cacheDelivery(formattedDelivery);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_created', {
        reskflowId: reskflow.id,
        orderId: input.orderId,
        customerId: input.customerId,
        merchantId: input.merchantId,
        priority: input.priority,
        estimatedDeliveryTime,
        distance,
        reskflowFee,
      });

      // Publish reskflow created event
      await publishDeliveryEvent('created', {
        reskflowId: reskflow.id,
        orderId: input.orderId,
        customerId: input.customerId,
        merchantId: input.merchantId,
        priority: input.priority,
        pickupAddress: input.pickupAddress,
        reskflowAddress: input.reskflowAddress,
        estimatedDeliveryTime: input.estimatedDeliveryTime,
      });

      // Send notification to customer
      await publishNotification('reskflow_created', {
        userId: input.customerId,
        reskflowId: reskflow.id,
        reskflowNumber,
        estimatedDeliveryTime: input.estimatedDeliveryTime,
      });

      reskflowLogger.info('Delivery created successfully', {
        reskflowId: reskflow.id,
        orderId: input.orderId,
        customerId: input.customerId,
      });

      return formattedDelivery;
    } catch (error) {
      reskflowLogger.error('Failed to create reskflow', {
        error: error instanceof Error ? error.message : 'Unknown error',
        input,
      });
      throw error;
    }
  }

  /**
   * Get reskflow by ID
   */
  async getDeliveryById(reskflowId: string): Promise<Delivery> {
    try {
      // Try to get from cache first
      const cached = await this.getCachedDelivery(reskflowId);
      if (cached) {
        return cached;
      }

      // Get from database
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
      });

      if (!reskflow) {
        throw new DeliveryNotFoundError(reskflowId);
      }

      const formattedDelivery = this.formatDelivery(reskflow);

      // Cache the result
      await this.cacheDelivery(formattedDelivery);

      return formattedDelivery;
    } catch (error) {
      if (error instanceof DeliveryNotFoundError) {
        throw error;
      }

      reskflowLogger.error('Failed to get reskflow by ID', {
        reskflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get deliveries with filters and pagination
   */
  async getDeliveries(filters: DeliveryFilters): Promise<PaginatedResult<Delivery>> {
    try {
      const {
        status,
        customerId,
        driverId,
        merchantId,
        startDate,
        endDate,
        priority,
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = filters;

      // Build where clause
      const where: any = {};

      if (status) where.status = status;
      if (customerId) where.customerId = customerId;
      if (driverId) where.driverId = driverId;
      if (merchantId) where.merchantId = merchantId;
      if (priority) where.priority = priority;

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Get total count
      const total = await prisma.reskflow.count({ where });

      // Get deliveries
      const deliveries = await prisma.reskflow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      });

      const formattedDeliveries = deliveries.map(reskflow => this.formatDelivery(reskflow));

      const pagination = calculatePagination(page, limit, total);

      return {
        data: formattedDeliveries,
        pagination,
      };
    } catch (error) {
      reskflowLogger.error('Failed to get deliveries', {
        filters,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update reskflow
   */
  async updateDelivery(reskflowId: string, input: UpdateDeliveryInput): Promise<Delivery> {
    try {
      // Get current reskflow
      const currentDelivery = await this.getDeliveryById(reskflowId);

      // Validate status transition
      if (input.status) {
        this.validateStatusTransition(currentDelivery.status, input.status);
      }

      // Update reskflow in database
      const updatedDelivery = await prisma.reskflow.update({
        where: { id: reskflowId },
        data: {
          ...input,
          updatedAt: new Date(),
        },
      });

      const formattedDelivery = this.formatDelivery(updatedDelivery);

      // Update cache
      await this.cacheDelivery(formattedDelivery);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_updated', {
        reskflowId,
        previousStatus: currentDelivery.status,
        newStatus: input.status,
        updates: input,
      });

      // Publish reskflow updated event
      if (input.status && input.status !== currentDelivery.status) {
        await publishDeliveryEvent('status_updated', {
          reskflowId,
          previousStatus: currentDelivery.status,
          newStatus: input.status,
          timestamp: new Date(),
        });

        // Send notification based on status
        await this.sendStatusUpdateNotification(formattedDelivery, currentDelivery.status);
      }

      reskflowLogger.info('Delivery updated successfully', {
        reskflowId,
        updates: input,
      });

      return formattedDelivery;
    } catch (error) {
      reskflowLogger.error('Failed to update reskflow', {
        reskflowId,
        input,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Assign reskflow to driver
   */
  async assignDelivery(reskflowId: string, driverId: string): Promise<Delivery> {
    try {
      // Get current reskflow
      const reskflow = await this.getDeliveryById(reskflowId);

      // Validate reskflow can be assigned
      if (reskflow.status !== DeliveryStatus.PENDING) {
        throw new DeliveryStatusError(reskflow.status, DeliveryStatus.PENDING);
      }

      if (reskflow.driverId) {
        throw new DeliveryAlreadyAssignedError(reskflowId);
      }

      // Validate driver availability (would need to check with driver service)
      // For now, we'll assume driver is available

      // Update reskflow with driver assignment
      const updatedDelivery = await prisma.reskflow.update({
        where: { id: reskflowId },
        data: {
          driverId,
          status: DeliveryStatus.ASSIGNED,
          updatedAt: new Date(),
        },
      });

      const formattedDelivery = this.formatDelivery(updatedDelivery);

      // Update cache
      await this.cacheDelivery(formattedDelivery);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_assigned', {
        reskflowId,
        driverId,
        orderId: reskflow.orderId,
        customerId: reskflow.customerId,
      });

      // Publish reskflow assigned event
      await publishDeliveryEvent('assigned', {
        reskflowId,
        driverId,
        orderId: reskflow.orderId,
        customerId: reskflow.customerId,
        merchantId: reskflow.merchantId,
        pickupAddress: reskflow.pickupAddress,
        reskflowAddress: reskflow.reskflowAddress,
        estimatedDeliveryTime: reskflow.estimatedDeliveryTime,
      });

      // Send notifications
      await Promise.all([
        publishNotification('reskflow_assigned_customer', {
          userId: reskflow.customerId,
          reskflowId,
          driverId,
        }),
        publishNotification('reskflow_assigned_driver', {
          userId: driverId,
          reskflowId,
          orderId: reskflow.orderId,
          pickupAddress: reskflow.pickupAddress,
          reskflowAddress: reskflow.reskflowAddress,
          estimatedDeliveryTime: reskflow.estimatedDeliveryTime,
        }),
      ]);

      reskflowLogger.info('Delivery assigned successfully', {
        reskflowId,
        driverId,
        orderId: reskflow.orderId,
      });

      return formattedDelivery;
    } catch (error) {
      reskflowLogger.error('Failed to assign reskflow', {
        reskflowId,
        driverId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Unassign reskflow from driver
   */
  async unassignDelivery(reskflowId: string): Promise<Delivery> {
    try {
      // Get current reskflow
      const reskflow = await this.getDeliveryById(reskflowId);

      // Validate reskflow is assigned
      if (!reskflow.driverId) {
        throw new DeliveryNotAssignedError(reskflowId);
      }

      if (reskflow.status === DeliveryStatus.DELIVERED) {
        throw new DeliveryStatusError(reskflow.status, 'not DELIVERED');
      }

      const previousDriverId = reskflow.driverId;

      // Update reskflow to remove driver assignment
      const updatedDelivery = await prisma.reskflow.update({
        where: { id: reskflowId },
        data: {
          driverId: null,
          status: DeliveryStatus.PENDING,
          updatedAt: new Date(),
        },
      });

      const formattedDelivery = this.formatDelivery(updatedDelivery);

      // Update cache
      await this.cacheDelivery(formattedDelivery);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_unassigned', {
        reskflowId,
        previousDriverId,
        reason: 'manual_unassignment',
      });

      // Publish reskflow unassigned event
      await publishDeliveryEvent('unassigned', {
        reskflowId,
        previousDriverId,
        orderId: reskflow.orderId,
      });

      // Send notifications
      await Promise.all([
        publishNotification('reskflow_unassigned_customer', {
          userId: reskflow.customerId,
          reskflowId,
        }),
        publishNotification('reskflow_unassigned_driver', {
          userId: previousDriverId,
          reskflowId,
        }),
      ]);

      reskflowLogger.info('Delivery unassigned successfully', {
        reskflowId,
        previousDriverId,
      });

      return formattedDelivery;
    } catch (error) {
      reskflowLogger.error('Failed to unassign reskflow', {
        reskflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Cancel reskflow
   */
  async cancelDelivery(reskflowId: string, reason: string, cancelledBy: string): Promise<Delivery> {
    try {
      // Get current reskflow
      const reskflow = await this.getDeliveryById(reskflowId);

      // Validate reskflow can be cancelled
      if ([DeliveryStatus.DELIVERED, DeliveryStatus.CANCELLED].includes(reskflow.status)) {
        throw new DeliveryStatusError(reskflow.status, 'cancellable status');
      }

      // Update reskflow status to cancelled
      const updatedDelivery = await prisma.reskflow.update({
        where: { id: reskflowId },
        data: {
          status: DeliveryStatus.CANCELLED,
          cancelReason: reason,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const formattedDelivery = this.formatDelivery(updatedDelivery);

      // Update cache
      await this.cacheDelivery(formattedDelivery);

      // Log business event
      loggerHelpers.logBusinessEvent('reskflow_cancelled', {
        reskflowId,
        orderId: reskflow.orderId,
        reason,
        cancelledBy,
        previousStatus: reskflow.status,
      });

      // Publish reskflow cancelled event
      await publishDeliveryEvent('cancelled', {
        reskflowId,
        orderId: reskflow.orderId,
        reason,
        cancelledBy,
        previousStatus: reskflow.status,
      });

      // Send notifications
      const notifications = [
        publishNotification('reskflow_cancelled_customer', {
          userId: reskflow.customerId,
          reskflowId,
          reason,
        }),
      ];

      if (reskflow.driverId) {
        notifications.push(
          publishNotification('reskflow_cancelled_driver', {
            userId: reskflow.driverId,
            reskflowId,
            reason,
          })
        );
      }

      await Promise.all(notifications);

      reskflowLogger.info('Delivery cancelled successfully', {
        reskflowId,
        reason,
        cancelledBy,
      });

      return formattedDelivery;
    } catch (error) {
      reskflowLogger.error('Failed to cancel reskflow', {
        reskflowId,
        reason,
        cancelledBy,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get reskflow analytics
   */
  async getDeliveryAnalytics(filters: {
    startDate?: Date;
    endDate?: Date;
    merchantId?: string;
    driverId?: string;
  }) {
    try {
      const { startDate, endDate, merchantId, driverId } = filters;

      // Build where clause
      const where: any = {};
      if (merchantId) where.merchantId = merchantId;
      if (driverId) where.driverId = driverId;

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      // Get aggregated data
      const [
        totalDeliveries,
        completedDeliveries,
        cancelledDeliveries,
        failedDeliveries,
        averageRating,
        totalRevenue,
      ] = await Promise.all([
        prisma.reskflow.count({ where }),
        prisma.reskflow.count({ where: { ...where, status: DeliveryStatus.DELIVERED } }),
        prisma.reskflow.count({ where: { ...where, status: DeliveryStatus.CANCELLED } }),
        prisma.reskflow.count({ where: { ...where, status: DeliveryStatus.FAILED } }),
        prisma.reskflow.aggregate({
          where: { ...where, reskflowRating: { not: null } },
          _avg: { reskflowRating: true },
        }),
        prisma.reskflow.aggregate({
          where: { ...where, status: DeliveryStatus.DELIVERED },
          _sum: { reskflowFee: true },
        }),
      ]);

      return {
        totalDeliveries,
        completedDeliveries,
        cancelledDeliveries,
        failedDeliveries,
        completionRate: totalDeliveries > 0 ? (completedDeliveries / totalDeliveries) * 100 : 0,
        averageRating: averageRating._avg.reskflowRating || 0,
        totalRevenue: totalRevenue._sum.reskflowFee || 0,
        period: {
          startDate,
          endDate,
        },
      };
    } catch (error) {
      reskflowLogger.error('Failed to get reskflow analytics', {
        filters,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private formatDelivery(reskflow: any): Delivery {
    return {
      ...reskflow,
      pickupAddress: JSON.parse(reskflow.pickupAddress),
      reskflowAddress: JSON.parse(reskflow.reskflowAddress),
    };
  }

  private async cacheDelivery(reskflow: Delivery): Promise<void> {
    const key = `reskflow:${reskflow.id}`;
    await redis.setJson(key, reskflow, this.CACHE_TTL);
  }

  private async getCachedDelivery(reskflowId: string): Promise<Delivery | null> {
    const key = `reskflow:${reskflowId}`;
    return redis.getJson<Delivery>(key);
  }

  private validateStatusTransition(currentStatus: DeliveryStatus, newStatus: DeliveryStatus): void {
    const validTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
      [DeliveryStatus.PENDING]: [DeliveryStatus.ASSIGNED, DeliveryStatus.CANCELLED],
      [DeliveryStatus.ASSIGNED]: [DeliveryStatus.PICKED_UP, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
      [DeliveryStatus.PICKED_UP]: [DeliveryStatus.IN_TRANSIT, DeliveryStatus.CANCELLED, DeliveryStatus.FAILED],
      [DeliveryStatus.IN_TRANSIT]: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
      [DeliveryStatus.DELIVERED]: [], // Final state
      [DeliveryStatus.CANCELLED]: [], // Final state
      [DeliveryStatus.FAILED]: [DeliveryStatus.PENDING], // Can retry
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new DeliveryStatusError(currentStatus, newStatus);
    }
  }

  private async validateServiceArea(pickupAddress: any, reskflowAddress: any): Promise<void> {
    // This would check against configured service areas
    // For now, we'll do a basic validation
    const config = await this.getServiceConfig();
    
    if (pickupAddress.coordinates && reskflowAddress.coordinates) {
      // Check if both addresses are within service area
      const pickupInArea = isWithinServiceArea(
        pickupAddress.coordinates.lat,
        pickupAddress.coordinates.lng,
        config.centerLat,
        config.centerLng,
        config.serviceRadius
      );

      const reskflowInArea = isWithinServiceArea(
        reskflowAddress.coordinates.lat,
        reskflowAddress.coordinates.lng,
        config.centerLat,
        config.centerLng,
        config.serviceRadius
      );

      if (!pickupInArea || !reskflowInArea) {
        throw new BusinessLogicError('One or both addresses are outside service area');
      }
    }
  }

  private async getServiceConfig() {
    // This would come from configuration or database
    return {
      centerLat: 40.7128, // NYC center
      centerLng: -74.0060,
      serviceRadius: 50, // 50km radius
    };
  }

  private async sendStatusUpdateNotification(reskflow: Delivery, previousStatus: DeliveryStatus): Promise<void> {
    const notificationType = `reskflow_status_${reskflow.status.toLowerCase()}`;
    
    const notifications = [
      publishNotification(notificationType, {
        userId: reskflow.customerId,
        reskflowId: reskflow.id,
        status: reskflow.status,
        previousStatus,
      }),
    ];

    if (reskflow.driverId) {
      notifications.push(
        publishNotification(`${notificationType}_driver`, {
          userId: reskflow.driverId,
          reskflowId: reskflow.id,
          status: reskflow.status,
          previousStatus,
        })
      );
    }

    await Promise.all(notifications);
  }
}