import { Server as SocketServer } from 'socket.io';
import { prisma, logger, redis } from '@reskflow/shared';
import { DriverPoolService } from './DriverPoolService';
import * as geolib from 'geolib';

interface LocationUpdate {
  driverId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp: Date;
}

interface TrackingSubscription {
  userId: string;
  orderId: string;
  driverId: string;
  socketId: string;
}

export class RealTimeTrackingService {
  private io: SocketServer;
  private driverPoolService: DriverPoolService;
  private trackingSubscriptions: Map<string, TrackingSubscription[]> = new Map();
  private locationBuffer: Map<string, LocationUpdate[]> = new Map();

  constructor(io: SocketServer, driverPoolService: DriverPoolService) {
    this.io = io;
    this.driverPoolService = driverPoolService;
    this.startLocationProcessor();
  }

  async updateDriverLocation(update: LocationUpdate) {
    // Buffer location updates for batch processing
    const driverBuffer = this.locationBuffer.get(update.driverId) || [];
    driverBuffer.push(update);
    this.locationBuffer.set(update.driverId, driverBuffer);

    // Update driver pool service
    await this.driverPoolService.updateDriverLocation(update);

    // Check for geofence events
    await this.checkGeofenceEvents(update);

    // Broadcast to tracking subscribers
    await this.broadcastLocationUpdate(update);
  }

  async subscribeToOrderTracking(
    userId: string,
    orderId: string,
    socketId: string
  ) {
    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        reskflow: true,
      },
    });

    if (!order || !order.reskflow || !order.reskflow.driver_id) {
      throw new Error('Order not found or no driver assigned');
    }

    // Verify user has access to track this order
    if (order.customer_id !== userId && order.merchant_id !== userId) {
      throw new Error('Unauthorized to track this order');
    }

    const driverId = order.reskflow.driver_id;

    // Add subscription
    const subscription: TrackingSubscription = {
      userId,
      orderId,
      driverId,
      socketId,
    };

    const driverSubs = this.trackingSubscriptions.get(driverId) || [];
    driverSubs.push(subscription);
    this.trackingSubscriptions.set(driverId, driverSubs);

    // Join socket room
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(`tracking:${orderId}`);
    }

    // Send current driver location
    const driverStatus = this.driverPoolService.getDriverStatus(driverId);
    if (driverStatus) {
      this.io.to(socketId).emit('driver:location', {
        orderId,
        location: driverStatus.location,
        lastUpdate: driverStatus.lastUpdate,
      });
    }

    logger.info(`User ${userId} subscribed to tracking order ${orderId}`);
  }

  async unsubscribeFromOrderTracking(socketId: string) {
    // Remove all subscriptions for this socket
    for (const [driverId, subs] of this.trackingSubscriptions) {
      const filtered = subs.filter(sub => sub.socketId !== socketId);
      if (filtered.length === 0) {
        this.trackingSubscriptions.delete(driverId);
      } else {
        this.trackingSubscriptions.set(driverId, filtered);
      }
    }
  }

  async getDriverLocations(bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  }) {
    const locations = [];

    for (const [driverId, status] of this.driverPoolService['driverPool']) {
      if (status.status === 'online') {
        // Check if within bounds
        if (bounds) {
          if (
            status.location.latitude < bounds.south ||
            status.location.latitude > bounds.north ||
            status.location.longitude < bounds.west ||
            status.location.longitude > bounds.east
          ) {
            continue;
          }
        }

        locations.push({
          driverId,
          location: status.location,
          status: status.status,
          activeDeliveries: status.activeDeliveries,
          lastUpdate: status.lastUpdate,
        });
      }
    }

    return locations;
  }

  private async broadcastLocationUpdate(update: LocationUpdate) {
    // Get subscriptions for this driver
    const subscriptions = this.trackingSubscriptions.get(update.driverId) || [];

    for (const sub of subscriptions) {
      // Get order status
      const reskflow = await prisma.reskflow.findFirst({
        where: {
          order_id: sub.orderId,
          driver_id: update.driverId,
        },
      });

      if (reskflow && reskflow.status !== 'delivered' && reskflow.status !== 'cancelled') {
        // Calculate ETA
        const eta = await this.calculateETA(update, reskflow);

        // Broadcast update
        this.io.to(`tracking:${sub.orderId}`).emit('driver:location', {
          orderId: sub.orderId,
          location: {
            latitude: update.latitude,
            longitude: update.longitude,
            heading: update.heading,
            speed: update.speed,
          },
          eta,
          reskflowStatus: reskflow.status,
          timestamp: update.timestamp,
        });
      }
    }
  }

  private async checkGeofenceEvents(update: LocationUpdate) {
    // Get active reskflow for driver
    const reskflow = await prisma.reskflow.findFirst({
      where: {
        driver_id: update.driverId,
        status: { in: ['assigned', 'picked_up', 'in_transit'] },
      },
      include: {
        order: {
          include: {
            merchant: true,
            reskflow_address: true,
          },
        },
      },
    });

    if (!reskflow) return;

    const driverLocation = {
      latitude: update.latitude,
      longitude: update.longitude,
    };

    // Check proximity to merchant (pickup)
    if (reskflow.status === 'assigned') {
      const merchantLocation = {
        latitude: reskflow.order.merchant.latitude,
        longitude: reskflow.order.merchant.longitude,
      };

      const distanceToMerchant = geolib.getDistance(driverLocation, merchantLocation);

      if (distanceToMerchant < 100) { // Within 100 meters
        await this.handleDriverArrivedAtPickup(reskflow);
      }
    }

    // Check proximity to customer (reskflow)
    if (reskflow.status === 'in_transit') {
      const customerLocation = {
        latitude: reskflow.order.reskflow_address.latitude,
        longitude: reskflow.order.reskflow_address.longitude,
      };

      const distanceToCustomer = geolib.getDistance(driverLocation, customerLocation);

      if (distanceToCustomer < 100) { // Within 100 meters
        await this.handleDriverArrivedAtDelivery(reskflow);
      }
    }
  }

  private async calculateETA(update: LocationUpdate, reskflow: any): Promise<Date> {
    const driverLocation = {
      latitude: update.latitude,
      longitude: update.longitude,
    };

    let destination;
    let totalDistance = 0;

    if (reskflow.status === 'assigned' || reskflow.status === 'picked_up') {
      // Driver going to merchant
      destination = {
        latitude: reskflow.pickup_location.coordinates[1],
        longitude: reskflow.pickup_location.coordinates[0],
      };
      
      totalDistance = geolib.getDistance(driverLocation, destination);

      // Add distance from merchant to customer
      const customerLocation = {
        latitude: reskflow.reskflow_location.coordinates[1],
        longitude: reskflow.reskflow_location.coordinates[0],
      };
      totalDistance += geolib.getDistance(destination, customerLocation);
    } else {
      // Driver going to customer
      destination = {
        latitude: reskflow.reskflow_location.coordinates[1],
        longitude: reskflow.reskflow_location.coordinates[0],
      };
      
      totalDistance = geolib.getDistance(driverLocation, destination);
    }

    // Estimate time based on current speed or average speed
    const speed = update.speed || 8.33; // Default 30 km/h in m/s
    const timeSeconds = totalDistance / speed;

    return new Date(Date.now() + timeSeconds * 1000);
  }

  private async handleDriverArrivedAtPickup(reskflow: any) {
    // Update reskflow status
    await prisma.reskflow.update({
      where: { id: reskflow.id },
      data: {
        status: 'at_pickup',
        arrived_at_pickup: new Date(),
      },
    });

    // Notify customer
    this.io.to(`tracking:${reskflow.order_id}`).emit('reskflow:status', {
      orderId: reskflow.order_id,
      status: 'at_pickup',
      message: 'Driver has arrived at the merchant',
    });

    // Notify merchant
    await redis.publish(`merchant:${reskflow.order.merchant_id}:notifications`, JSON.stringify({
      type: 'driver_arrived',
      orderId: reskflow.order_id,
      message: 'Driver has arrived for pickup',
    }));
  }

  private async handleDriverArrivedAtDelivery(reskflow: any) {
    // Update reskflow status
    await prisma.reskflow.update({
      where: { id: reskflow.id },
      data: {
        status: 'at_reskflow',
        arrived_at_reskflow: new Date(),
      },
    });

    // Notify customer
    this.io.to(`tracking:${reskflow.order_id}`).emit('reskflow:status', {
      orderId: reskflow.order_id,
      status: 'at_reskflow',
      message: 'Driver has arrived with your order',
    });

    // Send push notification
    await redis.publish(`customer:${reskflow.order.customer_id}:notifications`, JSON.stringify({
      type: 'driver_arrived',
      orderId: reskflow.order_id,
      message: 'Your reskflow has arrived!',
    }));
  }

  private startLocationProcessor() {
    // Process buffered locations every 5 seconds
    setInterval(() => {
      this.processBufferedLocations();
    }, 5000);
  }

  private async processBufferedLocations() {
    for (const [driverId, updates] of this.locationBuffer) {
      if (updates.length === 0) continue;

      // Get the most recent update
      const latestUpdate = updates[updates.length - 1];

      // Store location history
      await this.storeLocationHistory(driverId, updates);

      // Clear buffer
      this.locationBuffer.set(driverId, []);

      // Calculate metrics
      const metrics = this.calculateLocationMetrics(updates);

      // Update driver metrics
      await redis.hset(`driver:${driverId}:metrics`, {
        average_speed: metrics.averageSpeed,
        distance_traveled: metrics.distance,
        last_location_update: latestUpdate.timestamp.toISOString(),
      });
    }
  }

  private async storeLocationHistory(driverId: string, updates: LocationUpdate[]) {
    const pipeline = redis.pipeline();

    for (const update of updates) {
      const locationData = {
        lat: update.latitude,
        lng: update.longitude,
        h: update.heading,
        s: update.speed,
        ts: update.timestamp.getTime(),
      };

      pipeline.zadd(
        `driver:${driverId}:locations:${new Date().toISOString().split('T')[0]}`,
        update.timestamp.getTime(),
        JSON.stringify(locationData)
      );
    }

    // Set expiry for 7 days
    pipeline.expire(
      `driver:${driverId}:locations:${new Date().toISOString().split('T')[0]}`,
      7 * 24 * 60 * 60
    );

    await pipeline.exec();
  }

  private calculateLocationMetrics(updates: LocationUpdate[]) {
    let totalDistance = 0;
    let totalSpeed = 0;
    let speedCount = 0;

    for (let i = 1; i < updates.length; i++) {
      const distance = geolib.getDistance(
        {
          latitude: updates[i - 1].latitude,
          longitude: updates[i - 1].longitude,
        },
        {
          latitude: updates[i].latitude,
          longitude: updates[i].longitude,
        }
      );

      totalDistance += distance;

      if (updates[i].speed !== undefined) {
        totalSpeed += updates[i].speed;
        speedCount++;
      }
    }

    return {
      distance: totalDistance,
      averageSpeed: speedCount > 0 ? totalSpeed / speedCount : 0,
    };
  }
}