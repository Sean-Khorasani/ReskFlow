/**
 * Delivery Service
 * Manages reskflow lifecycle, driver assignment, and reskflow tracking
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
  reskflowAddress: {
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
  reskflowId: string;
  driverId: string;
  estimatedPickupTime: Date;
  estimatedDeliveryTime: Date;
  estimatedDistance: number;
  estimatedDuration: number;
}

interface DeliveryUpdate {
  reskflowId: string;
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
   * Create reskflow
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
        throw new Error('Order must be confirmed before creating reskflow');
      }

      // Calculate distance and initial ETA
      const distance = calculateDistance(
        request.pickupAddress.latitude,
        request.pickupAddress.longitude,
        request.reskflowAddress.latitude,
        request.reskflowAddress.longitude
      );

      const estimatedDuration = calculateETA(distance);

      // Create reskflow
      const reskflow = await prisma.reskflow.create({
        data: {
          orderId: request.orderId,
          customerId: order.customerId,
          merchantId: order.merchantId,
          status: DeliveryStatus.CREATED,
          priority: request.priority || 'normal',
          pickupAddress: request.pickupAddress,
          reskflowAddress: request.reskflowAddress,
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
        reskflowId: reskflow.id,
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
      this.assignDriver(reskflow.id).catch(error => {
        logger.error('Error assigning driver:', error);
      });

      // Emit reskflow created event
      this.emit('reskflow:created', {
        reskflowId: reskflow.id,
        orderId: order.id,
        customerId: order.customerId,
        merchantId: order.merchantId
      });

      // Send notifications
      await this.sendDeliveryNotifications(reskflow, order, 'created');

      return reskflow;
    } catch (error) {
      logger.error('Error creating reskflow:', error);
      throw error;
    }
  }

  /**
   * Assign driver to reskflow
   */
  async assignDriver(reskflowId: string, specificDriverId?: string): Promise<DriverAssignment> {
    try {
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
        include: { order: true }
      });

      if (!reskflow) {
        throw new Error('Delivery not found');
      }

      if (reskflow.status !== DeliveryStatus.CREATED) {
        throw new Error('Delivery has already been assigned');
      }

      let assignedDriver;

      if (specificDriverId) {
        // Assign specific driver
        assignedDriver = await this.assignSpecificDriver(reskflow, specificDriverId);
      } else {
        // Find best available driver
        assignedDriver = await this.findBestDriver(reskflow);
      }

      if (!assignedDriver) {
        // No driver available, retry later
        setTimeout(() => {
          this.assignDriver(reskflowId).catch(error => {
            logger.error('Retry driver assignment failed:', error);
          });
        }, 30000); // Retry in 30 seconds

        throw new Error('No drivers available');
      }

      // Calculate ETAs
      const pickupETA = new Date(Date.now() + assignedDriver.timeToPickup * 1000);
      const reskflowETA = new Date(pickupETA.getTime() + reskflow.estimatedDuration * 1000);

      // Create assignment
      const assignment = await prisma.driverAssignment.create({
        data: {
          reskflowId: reskflow.id,
          driverId: assignedDriver.driverId,
          assignedAt: new Date(),
          estimatedPickupTime: pickupETA,
          estimatedDeliveryTime: reskflowETA,
          status: 'PENDING'
        }
      });

      // Update reskflow
      await prisma.reskflow.update({
        where: { id: reskflowId },
        data: {
          driverId: assignedDriver.driverId,
          status: DeliveryStatus.ASSIGNED,
          estimatedPickupTime: pickupETA,
          estimatedDeliveryTime: reskflowETA
        }
      });

      // Update driver status
      await driverService.updateDriverStatus(assignedDriver.driverId, 'assigned');

      // Send assignment notification to driver
      await notificationService.sendNotification({
        userId: assignedDriver.driverId,
        type: 'DELIVERY_ASSIGNMENT',
        title: 'New Delivery Assignment',
        message: `You have a new reskflow pickup at ${reskflow.pickupAddress.street}`,
        data: {
          reskflowId: reskflow.id,
          assignmentId: assignment.id,
          pickupAddress: reskflow.pickupAddress,
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
          await this.assignDriver(reskflowId);
        }
      }, this.ASSIGNMENT_TIMEOUT);

      // Emit assignment event
      this.emit('reskflow:assigned', {
        reskflowId: reskflow.id,
        driverId: assignedDriver.driverId,
        assignmentId: assignment.id
      });

      return {
        reskflowId: reskflow.id,
        driverId: assignedDriver.driverId,
        estimatedPickupTime: pickupETA,
        estimatedDeliveryTime: reskflowETA,
        estimatedDistance: reskflow.estimatedDistance,
        estimatedDuration: reskflow.estimatedDuration
      };
    } catch (error) {
      logger.error('Error assigning driver:', error);
      throw error;
    }
  }

  /**
   * Update reskflow status
   */
  async updateDeliveryStatus(update: DeliveryUpdate): Promise<any> {
    try {
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: update.reskflowId },
        include: {
          order: true,
          driver: true
        }
      });

      if (!reskflow) {
        throw new Error('Delivery not found');
      }

      // Validate status transition
      if (!this.isValidStatusTransition(reskflow.status, update.status)) {
        throw new Error(`Invalid status transition from ${reskflow.status} to ${update.status}`);
      }

      // Update reskflow
      const updatedDelivery = await prisma.reskflow.update({
        where: { id: update.reskflowId },
        data: {
          status: update.status,
          currentLocation: update.location,
          notes: update.notes,
          ...(update.status === DeliveryStatus.PICKED_UP && {
            actualPickupTime: new Date()
          }),
          ...(update.status === DeliveryStatus.DELIVERED && {
            actualDeliveryTime: new Date(),
            reskflowPhoto: update.photo,
            signature: update.signature
          })
        }
      });

      // Create tracking event
      await trackingService.createTracking({
        reskflowId: reskflow.id,
        status: update.status,
        location: update.location || reskflow.currentLocation,
        notes: update.notes,
        timestamp: new Date()
      });

      // Update order status based on reskflow status
      if (update.status === DeliveryStatus.PICKED_UP) {
        await prisma.order.update({
          where: { id: reskflow.orderId },
          data: { status: OrderStatus.OUT_FOR_DELIVERY }
        });
      } else if (update.status === DeliveryStatus.DELIVERED) {
        await prisma.order.update({
          where: { id: reskflow.orderId },
          data: { 
            status: OrderStatus.DELIVERED,
            deliveredAt: new Date()
          }
        });

        // Update driver availability
        if (reskflow.driverId) {
          await driverService.updateDriverStatus(reskflow.driverId, 'available');
        }
      }

      // Send real-time updates
      await this.broadcastDeliveryUpdate(updatedDelivery);

      // Send notifications
      await this.sendDeliveryNotifications(updatedDelivery, reskflow.order, update.status);

      // Emit status update event
      this.emit('reskflow:status_updated', {
        reskflowId: reskflow.id,
        status: update.status,
        previousStatus: reskflow.status
      });

      return updatedDelivery;
    } catch (error) {
      logger.error('Error updating reskflow status:', error);
      throw error;
    }
  }

  /**
   * Get reskflow by ID
   */
  async getDelivery(reskflowId: string): Promise<any> {
    try {
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
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

      if (!reskflow) {
        throw new Error('Delivery not found');
      }

      return reskflow;
    } catch (error) {
      logger.error('Error getting reskflow:', error);
      throw error;
    }
  }

  /**
   * Get reskflow by tracking number
   */
  async getDeliveryByTrackingNumber(trackingNumber: string): Promise<any> {
    try {
      const reskflow = await prisma.reskflow.findUnique({
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

      if (!reskflow) {
        throw new Error('Delivery not found');
      }

      // Mask sensitive information for public tracking
      return {
        trackingNumber: reskflow.trackingNumber,
        status: reskflow.status,
        estimatedDeliveryTime: reskflow.estimatedDeliveryTime,
        actualDeliveryTime: reskflow.actualDeliveryTime,
        currentLocation: reskflow.currentLocation,
        trackingEvents: reskflow.trackingEvents.map(event => ({
          status: event.status,
          location: event.location,
          timestamp: event.timestamp,
          description: this.getStatusDescription(event.status)
        }))
      };
    } catch (error) {
      logger.error('Error getting reskflow by tracking number:', error);
      throw error;
    }
  }

  /**
   * Cancel reskflow
   */
  async cancelDelivery(reskflowId: string, reason: string, cancelledBy: string): Promise<any> {
    try {
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
        include: {
          order: true,
          driver: true
        }
      });

      if (!reskflow) {
        throw new Error('Delivery not found');
      }

      if ([DeliveryStatus.DELIVERED, DeliveryStatus.CANCELLED].includes(reskflow.status)) {
        throw new Error('Cannot cancel reskflow in current status');
      }

      // Update reskflow
      const cancelledDelivery = await prisma.reskflow.update({
        where: { id: reskflowId },
        data: {
          status: DeliveryStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy,
          cancellationReason: reason
        }
      });

      // Update order status
      await prisma.order.update({
        where: { id: reskflow.orderId },
        data: { status: OrderStatus.CANCELLED }
      });

      // Release driver if assigned
      if (reskflow.driverId) {
        await driverService.updateDriverStatus(reskflow.driverId, 'available');
        
        // Cancel active assignment
        const activeAssignment = await prisma.driverAssignment.findFirst({
          where: {
            reskflowId: reskflowId,
            status: { in: ['PENDING', 'ACCEPTED'] }
          }
        });

        if (activeAssignment) {
          await this.cancelAssignment(activeAssignment.id);
        }
      }

      // Send notifications
      await this.sendCancellationNotifications(reskflow, reason);

      // Emit cancellation event
      this.emit('reskflow:cancelled', {
        reskflowId: reskflow.id,
        reason,
        cancelledBy
      });

      return cancelledDelivery;
    } catch (error) {
      logger.error('Error cancelling reskflow:', error);
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
        prisma.reskflow.findMany({
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
        prisma.reskflow.count({ where })
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
   * Get reskflow metrics
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
        reskflowTimes,
        distances,
        onTimeDeliveries,
        ratings
      ] = await Promise.all([
        prisma.reskflow.count({ where }),
        prisma.reskflow.count({
          where: {
            ...where,
            status: DeliveryStatus.DELIVERED
          }
        }),
        prisma.reskflow.aggregate({
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
        prisma.reskflow.aggregate({
          where: {
            ...where,
            status: DeliveryStatus.DELIVERED
          },
          _avg: {
            actualDistance: true
          }
        }),
        prisma.reskflow.count({
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
            reskflowId: { in: await this.getDeliveryIds(where) },
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
        averageDeliveryTime: reskflowTimes._avg.actualDuration || 0,
        averageDistance: distances._avg.actualDistance || 0,
        onTimeRate,
        customerSatisfaction: ratings._avg.rating || 0
      };
    } catch (error) {
      logger.error('Error getting reskflow metrics:', error);
      throw error;
    }
  }

  /**
   * Optimize reskflow routes
   */
  async optimizeRoutes(driverId: string): Promise<any> {
    try {
      // Get driver's pending deliveries
      const deliveries = await prisma.reskflow.findMany({
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

      // Update reskflow order
      for (let i = 0; i < optimizedRoute.length; i++) {
        await prisma.reskflow.update({
          where: { id: optimizedRoute[i].reskflowId },
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
  private async findBestDriver(reskflow: any): Promise<any> {
    try {
      // Get available drivers near pickup location
      const availableDrivers = await driverService.findNearbyDrivers({
        latitude: reskflow.pickupAddress.latitude,
        longitude: reskflow.pickupAddress.longitude,
        radius: this.DRIVER_SEARCH_RADIUS,
        status: 'available'
      });

      if (availableDrivers.length === 0) {
        return null;
      }

      // Score drivers based on various factors
      const scoredDrivers = await Promise.all(
        availableDrivers.map(async (driver) => {
          const score = await this.calculateDriverScore(driver, reskflow);
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

  private async assignSpecificDriver(reskflow: any, driverId: string): Promise<any> {
    const driver = await driverService.getDriver(driverId);
    
    if (!driver || driver.status !== 'available') {
      throw new Error('Driver not available');
    }

    const distance = calculateDistance(
      driver.currentLocation.latitude,
      driver.currentLocation.longitude,
      reskflow.pickupAddress.latitude,
      reskflow.pickupAddress.longitude
    );

    const timeToPickup = calculateETA(distance);

    return {
      driverId: driver.id,
      distance,
      timeToPickup
    };
  }

  private async calculateDriverScore(driver: any, reskflow: any): Promise<number> {
    let score = 100;

    // Distance factor (closer is better)
    const distance = calculateDistance(
      driver.currentLocation.latitude,
      driver.currentLocation.longitude,
      reskflow.pickupAddress.latitude,
      reskflow.pickupAddress.longitude
    );
    score -= (distance / 100); // Deduct 1 point per 100 meters

    // Rating factor
    score += (driver.rating - 3) * 10; // Add/subtract based on rating

    // Completion rate factor
    score += driver.completionRate * 20;

    // Vehicle type factor
    if (reskflow.packageDetails.weight > 20 && driver.vehicle.type === 'MOTORCYCLE') {
      score -= 50; // Not suitable for heavy packages
    }

    // Priority factor
    if (reskflow.priority === 'urgent' && driver.rating >= 4.5) {
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

      // Find nearest unvisited reskflow
      for (let i = 0; i < unvisited.length; i++) {
        const reskflow = unvisited[i];
        const targetLocation = reskflow.status === DeliveryStatus.ASSIGNED
          ? reskflow.pickupAddress
          : reskflow.reskflowAddress;

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
        : nextDelivery.reskflowAddress;

      route.push({
        reskflowId: nextDelivery.id,
        type: nextDelivery.status === DeliveryStatus.ASSIGNED ? 'pickup' : 'reskflow',
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
      [DeliveryStatus.CREATED]: 'Order received and reskflow created',
      [DeliveryStatus.ASSIGNED]: 'Driver assigned to your reskflow',
      [DeliveryStatus.IN_TRANSIT]: 'Driver is on the way to pickup',
      [DeliveryStatus.PICKED_UP]: 'Package picked up and out for reskflow',
      [DeliveryStatus.DELIVERED]: 'Package delivered successfully',
      [DeliveryStatus.CANCELLED]: 'Delivery cancelled',
      [DeliveryStatus.FAILED]: 'Delivery attempt failed'
    };

    return descriptions[status] || status;
  }

  private async sendDeliveryNotifications(reskflow: any, order: any, event: string): Promise<void> {
    const notifications = [];

    // Customer notification
    notifications.push(
      notificationService.sendNotification({
        userId: order.customerId,
        type: `DELIVERY_${event.toUpperCase()}`,
        title: this.getNotificationTitle(event),
        message: this.getNotificationMessage(event, reskflow),
        data: {
          reskflowId: reskflow.id,
          orderId: order.id,
          trackingNumber: reskflow.trackingNumber
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
          message: this.getNotificationMessage(event, reskflow, 'merchant'),
          data: {
            reskflowId: reskflow.id,
            orderId: order.id
          }
        })
      );
    }

    await Promise.all(notifications);
  }

  private async sendCancellationNotifications(reskflow: any, reason: string): Promise<void> {
    const notifications = [];

    // Notify customer
    if (reskflow.order.customerId) {
      notifications.push(
        notificationService.sendNotification({
          userId: reskflow.order.customerId,
          type: 'DELIVERY_CANCELLED',
          title: 'Delivery Cancelled',
          message: `Your reskflow has been cancelled. Reason: ${reason}`,
          data: {
            reskflowId: reskflow.id,
            orderId: reskflow.orderId,
            reason
          }
        })
      );
    }

    // Notify driver if assigned
    if (reskflow.driverId) {
      notifications.push(
        notificationService.sendNotification({
          userId: reskflow.driverId,
          type: 'DELIVERY_CANCELLED',
          title: 'Delivery Cancelled',
          message: `Delivery ${reskflow.trackingNumber} has been cancelled`,
          data: {
            reskflowId: reskflow.id,
            reason
          }
        })
      );
    }

    // Notify merchant
    notifications.push(
      notificationService.sendNotification({
        userId: reskflow.order.merchantId,
        type: 'DELIVERY_CANCELLED',
        title: 'Delivery Cancelled',
        message: `Delivery for order ${reskflow.order.orderNumber} has been cancelled`,
        data: {
          reskflowId: reskflow.id,
          orderId: reskflow.orderId,
          reason
        }
      })
    );

    await Promise.all(notifications);
  }

  private async broadcastDeliveryUpdate(reskflow: any): Promise<void> {
    // Broadcast to customer
    socketService.emitToUser(reskflow.order.customerId, 'reskflow:update', {
      reskflowId: reskflow.id,
      status: reskflow.status,
      currentLocation: reskflow.currentLocation,
      estimatedDeliveryTime: reskflow.estimatedDeliveryTime
    });

    // Broadcast to merchant
    socketService.emitToUser(reskflow.order.merchantId, 'reskflow:update', {
      reskflowId: reskflow.id,
      orderId: reskflow.orderId,
      status: reskflow.status
    });

    // Broadcast to driver if assigned
    if (reskflow.driverId) {
      socketService.emitToUser(reskflow.driverId, 'reskflow:update', {
        reskflowId: reskflow.id,
        status: reskflow.status
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

  private getNotificationMessage(event: string, reskflow: any, recipient: string = 'customer'): string {
    const messages: Record<string, Record<string, string>> = {
      created: {
        customer: `Your reskflow has been created. Track with: ${reskflow.trackingNumber}`,
        merchant: `Delivery created for order ${reskflow.order?.orderNumber}`
      },
      assigned: {
        customer: `A driver has been assigned and will pick up your order soon`,
        merchant: `Driver assigned for order ${reskflow.order?.orderNumber}`
      },
      picked_up: {
        customer: `Your order is on the way! ETA: ${reskflow.estimatedDeliveryTime}`,
        merchant: `Order ${reskflow.order?.orderNumber} picked up by driver`
      },
      delivered: {
        customer: `Your order has been delivered. Thank you!`,
        merchant: `Order ${reskflow.order?.orderNumber} delivered successfully`
      }
    };

    return messages[event]?.[recipient] || 'Delivery status updated';
  }

  private async getDeliveryIds(where: any): Promise<string[]> {
    const deliveries = await prisma.reskflow.findMany({
      where,
      select: { id: true }
    });
    return deliveries.map(d => d.id);
  }
}

export const reskflowService = new DeliveryService();