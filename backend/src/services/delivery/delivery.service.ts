/**
 * Delivery Service
 * Manages delivery lifecycle, driver assignment, and delivery tracking
 */

import { PrismaClient, DeliveryStatus, OrderStatus } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { redisClient } from '../../config/redis';
import { calculateDistance, calculateETA } from '../../utils/geo';
import { notificationService } from '../notification/notification.service';
import { trackingService } from '../tracking/tracking.service';
import { driverService } from '../driver/driver.service';
import { socketService } from '../socket/socket.service';

const prisma = new PrismaClient();

interface DeliveryRequest {
  orderId: string;
  pickupAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    latitude: number;
    longitude: number;
  };
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    latitude: number;
    longitude: number;
  };
  packageDetails: {
    weight?: number;
    dimensions?: {
      length: number;
      width: number;
      height: number;
    };
    fragile?: boolean;
    keepUpright?: boolean;
    specialInstructions?: string;
  };
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  scheduledPickupTime?: Date;
  scheduledDeliveryTime?: Date;
  requiresSignature?: boolean;
  requiresIDVerification?: boolean;
  insuranceAmount?: number;
}

interface DriverAssignment {
  deliveryId: string;
  driverId: string;
  estimatedPickupTime: Date;
  estimatedDeliveryTime: Date;
  estimatedDistance: number;
  estimatedDuration: number;
}

interface DeliveryUpdate {
  deliveryId: string;
  status: DeliveryStatus;
  location?: {
    latitude: number;
    longitude: number;
  };
  notes?: string;
  photo?: string;
  signature?: string;
}

interface DeliveryMetrics {
  totalDeliveries: number;
  completedDeliveries: number;
  averageDeliveryTime: number;
  averageDistance: number;
  onTimeRate: number;
  customerSatisfaction: number;
}

class DeliveryService extends EventEmitter {
  private readonly MAX_ASSIGNMENT_ATTEMPTS = 3;
  private readonly DRIVER_SEARCH_RADIUS = 5000; // 5km in meters
  private readonly ASSIGNMENT_TIMEOUT = 60000; // 1 minute

  /**
   * Create delivery
   */
  async createDelivery(request: DeliveryRequest): Promise<any> {
    try {
      // Validate order
      const order = await prisma.order.findUnique({
        where: { id: request.orderId },
        include: {
          customer: true,
          merchant: true,
          items: true
        }
      });

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status !== OrderStatus.CONFIRMED) {
        throw new Error('Order must be confirmed before creating delivery');
      }

      // Calculate distance and initial ETA
      const distance = calculateDistance(
        request.pickupAddress.latitude,
        request.pickupAddress.longitude,
        request.deliveryAddress.latitude,
        request.deliveryAddress.longitude
      );

      const estimatedDuration = calculateETA(distance);

      // Create delivery
      const delivery = await prisma.delivery.create({
        data: {
          orderId: request.orderId,
          customerId: order.customerId,
          merchantId: order.merchantId,
          status: DeliveryStatus.CREATED,
          priority: request.priority || 'normal',
          pickupAddress: request.pickupAddress,
          deliveryAddress: request.deliveryAddress,
          packageDetails: request.packageDetails,
          scheduledPickupTime: request.scheduledPickupTime,
          scheduledDeliveryTime: request.scheduledDeliveryTime,
          requiresSignature: request.requiresSignature || false,
          requiresIDVerification: request.requiresIDVerification || false,
          insuranceAmount: request.insuranceAmount || 0,
          estimatedDistance: distance,
          estimatedDuration: estimatedDuration,
          trackingNumber: this.generateTrackingNumber()
        }
      });

      // Create tracking record
      await trackingService.createTracking({
        deliveryId: delivery.id,
        status: DeliveryStatus.CREATED,
        location: request.pickupAddress,
        timestamp: new Date()
      });

      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.READY_FOR_PICKUP }
      });

      // Find and assign driver
      this.assignDriver(delivery.id).catch(error => {
        logger.error('Error assigning driver:', error);
      });

      // Emit delivery created event
      this.emit('delivery:created', {
        deliveryId: delivery.id,
        orderId: order.id,
        customerId: order.customerId,
        merchantId: order.merchantId
      });

      // Send notifications
      await this.sendDeliveryNotifications(delivery, order, 'created');

      return delivery;
    } catch (error) {
      logger.error('Error creating delivery:', error);
      throw error;
    }
  }

  /**
   * Assign driver to delivery
   */
  async assignDriver(deliveryId: string, specificDriverId?: string): Promise<DriverAssignment> {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { order: true }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      if (delivery.status !== DeliveryStatus.CREATED) {
        throw new Error('Delivery has already been assigned');
      }

      let assignedDriver;

      if (specificDriverId) {
        // Assign specific driver
        assignedDriver = await this.assignSpecificDriver(delivery, specificDriverId);
      } else {
        // Find best available driver
        assignedDriver = await this.findBestDriver(delivery);
      }

      if (!assignedDriver) {
        // No driver available, retry later
        setTimeout(() => {
          this.assignDriver(deliveryId).catch(error => {
            logger.error('Retry driver assignment failed:', error);
          });
        }, 30000); // Retry in 30 seconds

        throw new Error('No drivers available');
      }

      // Calculate ETAs
      const pickupETA = new Date(Date.now() + assignedDriver.timeToPickup * 1000);
      const deliveryETA = new Date(pickupETA.getTime() + delivery.estimatedDuration * 1000);

      // Create assignment
      const assignment = await prisma.driverAssignment.create({
        data: {
          deliveryId: delivery.id,
          driverId: assignedDriver.driverId,
          assignedAt: new Date(),
          estimatedPickupTime: pickupETA,
          estimatedDeliveryTime: deliveryETA,
          status: 'PENDING'
        }
      });

      // Update delivery
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          driverId: assignedDriver.driverId,
          status: DeliveryStatus.ASSIGNED,
          estimatedPickupTime: pickupETA,
          estimatedDeliveryTime: deliveryETA
        }
      });

      // Update driver status
      await driverService.updateDriverStatus(assignedDriver.driverId, 'assigned');

      // Send assignment notification to driver
      await notificationService.sendNotification({
        userId: assignedDriver.driverId,
        type: 'DELIVERY_ASSIGNMENT',
        title: 'New Delivery Assignment',
        message: `You have a new delivery pickup at ${delivery.pickupAddress.street}`,
        data: {
          deliveryId: delivery.id,
          assignmentId: assignment.id,
          pickupAddress: delivery.pickupAddress,
          estimatedPickupTime: pickupETA
        }
      });

      // Set timeout for driver response
      setTimeout(async () => {
        const currentAssignment = await prisma.driverAssignment.findUnique({
          where: { id: assignment.id }
        });

        if (currentAssignment?.status === 'PENDING') {
          // Driver didn't respond, reassign
          await this.cancelAssignment(assignment.id);
          await this.assignDriver(deliveryId);
        }
      }, this.ASSIGNMENT_TIMEOUT);

      // Emit assignment event
      this.emit('delivery:assigned', {
        deliveryId: delivery.id,
        driverId: assignedDriver.driverId,
        assignmentId: assignment.id
      });

      return {
        deliveryId: delivery.id,
        driverId: assignedDriver.driverId,
        estimatedPickupTime: pickupETA,
        estimatedDeliveryTime: deliveryETA,
        estimatedDistance: delivery.estimatedDistance,
        estimatedDuration: delivery.estimatedDuration
      };
    } catch (error) {
      logger.error('Error assigning driver:', error);
      throw error;
    }
  }

  /**
   * Update delivery status
   */
  async updateDeliveryStatus(update: DeliveryUpdate): Promise<any> {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: update.deliveryId },
        include: {
          order: true,
          driver: true
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      // Validate status transition
      if (!this.isValidStatusTransition(delivery.status, update.status)) {
        throw new Error(`Invalid status transition from ${delivery.status} to ${update.status}`);
      }

      // Update delivery
      const updatedDelivery = await prisma.delivery.update({
        where: { id: update.deliveryId },
        data: {
          status: update.status,
          currentLocation: update.location,
          notes: update.notes,
          ...(update.status === DeliveryStatus.PICKED_UP && {
            actualPickupTime: new Date()
          }),
          ...(update.status === DeliveryStatus.DELIVERED && {
            actualDeliveryTime: new Date(),
            deliveryPhoto: update.photo,
            signature: update.signature
          })
        }
      });

      // Create tracking event
      await trackingService.createTracking({
        deliveryId: delivery.id,
        status: update.status,
        location: update.location || delivery.currentLocation,
        notes: update.notes,
        timestamp: new Date()
      });

      // Update order status based on delivery status
      if (update.status === DeliveryStatus.PICKED_UP) {
        await prisma.order.update({
          where: { id: delivery.orderId },
          data: { status: OrderStatus.OUT_FOR_DELIVERY }
        });
      } else if (update.status === DeliveryStatus.DELIVERED) {
        await prisma.order.update({
          where: { id: delivery.orderId },
          data: { 
            status: OrderStatus.DELIVERED,
            deliveredAt: new Date()
          }
        });

        // Update driver availability
        if (delivery.driverId) {
          await driverService.updateDriverStatus(delivery.driverId, 'available');
        }
      }

      // Send real-time updates
      await this.broadcastDeliveryUpdate(updatedDelivery);

      // Send notifications
      await this.sendDeliveryNotifications(updatedDelivery, delivery.order, update.status);

      // Emit status update event
      this.emit('delivery:status_updated', {
        deliveryId: delivery.id,
        status: update.status,
        previousStatus: delivery.status
      });

      return updatedDelivery;
    } catch (error) {
      logger.error('Error updating delivery status:', error);
      throw error;
    }
  }

  /**
   * Get delivery by ID
   */
  async getDelivery(deliveryId: string): Promise<any> {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: {
            include: {
              customer: true,
              merchant: true,
              items: true
            }
          },
          driver: {
            include: {
              user: true,
              vehicle: true
            }
          },
          trackingEvents: {
            orderBy: { timestamp: 'desc' }
          }
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      return delivery;
    } catch (error) {
      logger.error('Error getting delivery:', error);
      throw error;
    }
  }

  /**
   * Get delivery by tracking number
   */
  async getDeliveryByTrackingNumber(trackingNumber: string): Promise<any> {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { trackingNumber },
        include: {
          order: {
            include: {
              customer: true,
              merchant: true
            }
          },
          driver: {
            include: {
              user: true
            }
          },
          trackingEvents: {
            orderBy: { timestamp: 'desc' }
          }
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      // Mask sensitive information for public tracking
      return {
        trackingNumber: delivery.trackingNumber,
        status: delivery.status,
        estimatedDeliveryTime: delivery.estimatedDeliveryTime,
        actualDeliveryTime: delivery.actualDeliveryTime,
        currentLocation: delivery.currentLocation,
        trackingEvents: delivery.trackingEvents.map(event => ({
          status: event.status,
          location: event.location,
          timestamp: event.timestamp,
          description: this.getStatusDescription(event.status)
        }))
      };
    } catch (error) {
      logger.error('Error getting delivery by tracking number:', error);
      throw error;
    }
  }

  /**
   * Cancel delivery
   */
  async cancelDelivery(deliveryId: string, reason: string, cancelledBy: string): Promise<any> {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: true,
          driver: true
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      if ([DeliveryStatus.DELIVERED, DeliveryStatus.CANCELLED].includes(delivery.status)) {
        throw new Error('Cannot cancel delivery in current status');
      }

      // Update delivery
      const cancelledDelivery = await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy,
          cancellationReason: reason
        }
      });

      // Update order status
      await prisma.order.update({
        where: { id: delivery.orderId },
        data: { status: OrderStatus.CANCELLED }
      });

      // Release driver if assigned
      if (delivery.driverId) {
        await driverService.updateDriverStatus(delivery.driverId, 'available');
        
        // Cancel active assignment
        const activeAssignment = await prisma.driverAssignment.findFirst({
          where: {
            deliveryId: deliveryId,
            status: { in: ['PENDING', 'ACCEPTED'] }
          }
        });

        if (activeAssignment) {
          await this.cancelAssignment(activeAssignment.id);
        }
      }

      // Send notifications
      await this.sendCancellationNotifications(delivery, reason);

      // Emit cancellation event
      this.emit('delivery:cancelled', {
        deliveryId: delivery.id,
        reason,
        cancelledBy
      });

      return cancelledDelivery;
    } catch (error) {
      logger.error('Error cancelling delivery:', error);
      throw error;
    }
  }

  /**
   * Get deliveries for driver
   */
  async getDriverDeliveries(driverId: string, params: {
    status?: DeliveryStatus[];
    date?: Date;
    limit?: number;
    offset?: number;
  }) {
    try {
      const { status, date, limit = 20, offset = 0 } = params;

      const where: any = { driverId };
      
      if (status && status.length > 0) {
        where.status = { in: status };
      }

      if (date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        where.createdAt = {
          gte: startOfDay,
          lte: endOfDay
        };
      }

      const [deliveries, total] = await Promise.all([
        prisma.delivery.findMany({
          where,
          include: {
            order: {
              include: {
                customer: true,
                merchant: true
              }
            }
          },
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.delivery.count({ where })
      ]);

      return {
        deliveries,
        total,
        limit,
        offset
      };
    } catch (error) {
      logger.error('Error getting driver deliveries:', error);
      throw error;
    }
  }

  /**
   * Get delivery metrics
   */
  async getDeliveryMetrics(params: {
    startDate: Date;
    endDate: Date;
    driverId?: string;
    merchantId?: string;
  }): Promise<DeliveryMetrics> {
    try {
      const where: any = {
        createdAt: {
          gte: params.startDate,
          lte: params.endDate
        }
      };

      if (params.driverId) where.driverId = params.driverId;
      if (params.merchantId) where.merchantId = params.merchantId;

      const [
        totalDeliveries,
        completedDeliveries,
        deliveryTimes,
        distances,
        onTimeDeliveries,
        ratings
      ] = await Promise.all([
        prisma.delivery.count({ where }),
        prisma.delivery.count({
          where: {
            ...where,
            status: DeliveryStatus.DELIVERED
          }
        }),
        prisma.delivery.aggregate({
          where: {
            ...where,
            status: DeliveryStatus.DELIVERED,
            actualDeliveryTime: { not: null },
            actualPickupTime: { not: null }
          },
          _avg: {
            actualDuration: true
          }
        }),
        prisma.delivery.aggregate({
          where: {
            ...where,
            status: DeliveryStatus.DELIVERED
          },
          _avg: {
            actualDistance: true
          }
        }),
        prisma.delivery.count({
          where: {
            ...where,
            status: DeliveryStatus.DELIVERED,
            actualDeliveryTime: { not: null },
            estimatedDeliveryTime: { not: null },
            // Count as on-time if delivered within 15 minutes of estimate
            AND: [
              {
                actualDeliveryTime: {
                  lte: new Date('estimatedDeliveryTime + 15 minutes')
                }
              }
            ]
          }
        }),
        prisma.rating.aggregate({
          where: {
            deliveryId: { in: await this.getDeliveryIds(where) },
            type: 'DELIVERY'
          },
          _avg: {
            rating: true
          }
        })
      ]);

      const onTimeRate = totalDeliveries > 0 
        ? (onTimeDeliveries / completedDeliveries) * 100 
        : 0;

      return {
        totalDeliveries,
        completedDeliveries,
        averageDeliveryTime: deliveryTimes._avg.actualDuration || 0,
        averageDistance: distances._avg.actualDistance || 0,
        onTimeRate,
        customerSatisfaction: ratings._avg.rating || 0
      };
    } catch (error) {
      logger.error('Error getting delivery metrics:', error);
      throw error;
    }
  }

  /**
   * Optimize delivery routes
   */
  async optimizeRoutes(driverId: string): Promise<any> {
    try {
      // Get driver's pending deliveries
      const deliveries = await prisma.delivery.findMany({
        where: {
          driverId,
          status: {
            in: [DeliveryStatus.ASSIGNED, DeliveryStatus.IN_TRANSIT]
          }
        },
        include: {
          order: true
        }
      });

      if (deliveries.length === 0) {
        return { optimizedRoute: [], totalDistance: 0, totalTime: 0 };
      }

      // Get driver's current location
      const driverLocation = await driverService.getDriverLocation(driverId);

      // Optimize route using TSP algorithm
      const optimizedRoute = await this.calculateOptimalRoute(
        driverLocation,
        deliveries
      );

      // Update delivery order
      for (let i = 0; i < optimizedRoute.length; i++) {
        await prisma.delivery.update({
          where: { id: optimizedRoute[i].deliveryId },
          data: { routeOrder: i + 1 }
        });
      }

      return optimizedRoute;
    } catch (error) {
      logger.error('Error optimizing routes:', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private async findBestDriver(delivery: any): Promise<any> {
    try {
      // Get available drivers near pickup location
      const availableDrivers = await driverService.findNearbyDrivers({
        latitude: delivery.pickupAddress.latitude,
        longitude: delivery.pickupAddress.longitude,
        radius: this.DRIVER_SEARCH_RADIUS,
        status: 'available'
      });

      if (availableDrivers.length === 0) {
        return null;
      }

      // Score drivers based on various factors
      const scoredDrivers = await Promise.all(
        availableDrivers.map(async (driver) => {
          const score = await this.calculateDriverScore(driver, delivery);
          return { ...driver, score };
        })
      );

      // Sort by score and return best driver
      scoredDrivers.sort((a, b) => b.score - a.score);
      return scoredDrivers[0];
    } catch (error) {
      logger.error('Error finding best driver:', error);
      return null;
    }
  }

  private async assignSpecificDriver(delivery: any, driverId: string): Promise<any> {
    const driver = await driverService.getDriver(driverId);
    
    if (!driver || driver.status !== 'available') {
      throw new Error('Driver not available');
    }

    const distance = calculateDistance(
      driver.currentLocation.latitude,
      driver.currentLocation.longitude,
      delivery.pickupAddress.latitude,
      delivery.pickupAddress.longitude
    );

    const timeToPickup = calculateETA(distance);

    return {
      driverId: driver.id,
      distance,
      timeToPickup
    };
  }

  private async calculateDriverScore(driver: any, delivery: any): Promise<number> {
    let score = 100;

    // Distance factor (closer is better)
    const distance = calculateDistance(
      driver.currentLocation.latitude,
      driver.currentLocation.longitude,
      delivery.pickupAddress.latitude,
      delivery.pickupAddress.longitude
    );
    score -= (distance / 100); // Deduct 1 point per 100 meters

    // Rating factor
    score += (driver.rating - 3) * 10; // Add/subtract based on rating

    // Completion rate factor
    score += driver.completionRate * 20;

    // Vehicle type factor
    if (delivery.packageDetails.weight > 20 && driver.vehicle.type === 'MOTORCYCLE') {
      score -= 50; // Not suitable for heavy packages
    }

    // Priority factor
    if (delivery.priority === 'urgent' && driver.rating >= 4.5) {
      score += 20; // Prefer high-rated drivers for urgent deliveries
    }

    return Math.max(0, score);
  }

  private async calculateOptimalRoute(startLocation: any, deliveries: any[]): Promise<any[]> {
    // Simple nearest neighbor algorithm
    // In production, use more sophisticated algorithms like genetic algorithm or Google OR-Tools
    const unvisited = [...deliveries];
    const route = [];
    let currentLocation = startLocation;

    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      // Find nearest unvisited delivery
      for (let i = 0; i < unvisited.length; i++) {
        const delivery = unvisited[i];
        const targetLocation = delivery.status === DeliveryStatus.ASSIGNED
          ? delivery.pickupAddress
          : delivery.deliveryAddress;

        const distance = calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          targetLocation.latitude,
          targetLocation.longitude
        );

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }

      // Add to route and remove from unvisited
      const nextDelivery = unvisited.splice(nearestIndex, 1)[0];
      const targetLocation = nextDelivery.status === DeliveryStatus.ASSIGNED
        ? nextDelivery.pickupAddress
        : nextDelivery.deliveryAddress;

      route.push({
        deliveryId: nextDelivery.id,
        type: nextDelivery.status === DeliveryStatus.ASSIGNED ? 'pickup' : 'delivery',
        location: targetLocation,
        estimatedArrival: new Date(Date.now() + calculateETA(nearestDistance) * 1000)
      });

      currentLocation = targetLocation;
    }

    return route;
  }

  private async cancelAssignment(assignmentId: string): Promise<void> {
    await prisma.driverAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date()
      }
    });
  }

  private isValidStatusTransition(currentStatus: DeliveryStatus, newStatus: DeliveryStatus): boolean {
    const validTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
      [DeliveryStatus.CREATED]: [DeliveryStatus.ASSIGNED, DeliveryStatus.CANCELLED],
      [DeliveryStatus.ASSIGNED]: [DeliveryStatus.IN_TRANSIT, DeliveryStatus.CANCELLED],
      [DeliveryStatus.IN_TRANSIT]: [DeliveryStatus.PICKED_UP, DeliveryStatus.CANCELLED],
      [DeliveryStatus.PICKED_UP]: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
      [DeliveryStatus.DELIVERED]: [],
      [DeliveryStatus.CANCELLED]: [],
      [DeliveryStatus.FAILED]: []
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  private generateTrackingNumber(): string {
    const prefix = 'RESK';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  private getStatusDescription(status: DeliveryStatus): string {
    const descriptions: Record<DeliveryStatus, string> = {
      [DeliveryStatus.CREATED]: 'Order received and delivery created',
      [DeliveryStatus.ASSIGNED]: 'Driver assigned to your delivery',
      [DeliveryStatus.IN_TRANSIT]: 'Driver is on the way to pickup',
      [DeliveryStatus.PICKED_UP]: 'Package picked up and out for delivery',
      [DeliveryStatus.DELIVERED]: 'Package delivered successfully',
      [DeliveryStatus.CANCELLED]: 'Delivery cancelled',
      [DeliveryStatus.FAILED]: 'Delivery attempt failed'
    };

    return descriptions[status] || status;
  }

  private async sendDeliveryNotifications(delivery: any, order: any, event: string): Promise<void> {
    const notifications = [];

    // Customer notification
    notifications.push(
      notificationService.sendNotification({
        userId: order.customerId,
        type: `DELIVERY_${event.toUpperCase()}`,
        title: this.getNotificationTitle(event),
        message: this.getNotificationMessage(event, delivery),
        data: {
          deliveryId: delivery.id,
          orderId: order.id,
          trackingNumber: delivery.trackingNumber
        }
      })
    );

    // Merchant notification for certain events
    if (['created', 'picked_up', 'delivered'].includes(event)) {
      notifications.push(
        notificationService.sendNotification({
          userId: order.merchantId,
          type: `DELIVERY_${event.toUpperCase()}`,
          title: this.getNotificationTitle(event, 'merchant'),
          message: this.getNotificationMessage(event, delivery, 'merchant'),
          data: {
            deliveryId: delivery.id,
            orderId: order.id
          }
        })
      );
    }

    await Promise.all(notifications);
  }

  private async sendCancellationNotifications(delivery: any, reason: string): Promise<void> {
    const notifications = [];

    // Notify customer
    if (delivery.order.customerId) {
      notifications.push(
        notificationService.sendNotification({
          userId: delivery.order.customerId,
          type: 'DELIVERY_CANCELLED',
          title: 'Delivery Cancelled',
          message: `Your delivery has been cancelled. Reason: ${reason}`,
          data: {
            deliveryId: delivery.id,
            orderId: delivery.orderId,
            reason
          }
        })
      );
    }

    // Notify driver if assigned
    if (delivery.driverId) {
      notifications.push(
        notificationService.sendNotification({
          userId: delivery.driverId,
          type: 'DELIVERY_CANCELLED',
          title: 'Delivery Cancelled',
          message: `Delivery ${delivery.trackingNumber} has been cancelled`,
          data: {
            deliveryId: delivery.id,
            reason
          }
        })
      );
    }

    // Notify merchant
    notifications.push(
      notificationService.sendNotification({
        userId: delivery.order.merchantId,
        type: 'DELIVERY_CANCELLED',
        title: 'Delivery Cancelled',
        message: `Delivery for order ${delivery.order.orderNumber} has been cancelled`,
        data: {
          deliveryId: delivery.id,
          orderId: delivery.orderId,
          reason
        }
      })
    );

    await Promise.all(notifications);
  }

  private async broadcastDeliveryUpdate(delivery: any): Promise<void> {
    // Broadcast to customer
    socketService.emitToUser(delivery.order.customerId, 'delivery:update', {
      deliveryId: delivery.id,
      status: delivery.status,
      currentLocation: delivery.currentLocation,
      estimatedDeliveryTime: delivery.estimatedDeliveryTime
    });

    // Broadcast to merchant
    socketService.emitToUser(delivery.order.merchantId, 'delivery:update', {
      deliveryId: delivery.id,
      orderId: delivery.orderId,
      status: delivery.status
    });

    // Broadcast to driver if assigned
    if (delivery.driverId) {
      socketService.emitToUser(delivery.driverId, 'delivery:update', {
        deliveryId: delivery.id,
        status: delivery.status
      });
    }
  }

  private getNotificationTitle(event: string, recipient: string = 'customer'): string {
    const titles: Record<string, Record<string, string>> = {
      created: {
        customer: 'Delivery Created',
        merchant: 'New Delivery'
      },
      assigned: {
        customer: 'Driver Assigned',
        merchant: 'Driver Assigned'
      },
      picked_up: {
        customer: 'Order Picked Up',
        merchant: 'Order Picked Up'
      },
      delivered: {
        customer: 'Delivered!',
        merchant: 'Delivery Completed'
      }
    };

    return titles[event]?.[recipient] || 'Delivery Update';
  }

  private getNotificationMessage(event: string, delivery: any, recipient: string = 'customer'): string {
    const messages: Record<string, Record<string, string>> = {
      created: {
        customer: `Your delivery has been created. Track with: ${delivery.trackingNumber}`,
        merchant: `Delivery created for order ${delivery.order?.orderNumber}`
      },
      assigned: {
        customer: `A driver has been assigned and will pick up your order soon`,
        merchant: `Driver assigned for order ${delivery.order?.orderNumber}`
      },
      picked_up: {
        customer: `Your order is on the way! ETA: ${delivery.estimatedDeliveryTime}`,
        merchant: `Order ${delivery.order?.orderNumber} picked up by driver`
      },
      delivered: {
        customer: `Your order has been delivered. Thank you!`,
        merchant: `Order ${delivery.order?.orderNumber} delivered successfully`
      }
    };

    return messages[event]?.[recipient] || 'Delivery status updated';
  }

  private async getDeliveryIds(where: any): Promise<string[]> {
    const deliveries = await prisma.delivery.findMany({
      where,
      select: { id: true }
    });
    return deliveries.map(d => d.id);
  }
}

export const deliveryService = new DeliveryService();