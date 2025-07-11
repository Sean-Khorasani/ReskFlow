/**
 * Tracking Service
 * Provides real-time location tracking and delivery updates
 */

import { PrismaClient, DeliveryStatus } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { redisClient } from '../../config/redis';
import { socketService } from '../socket/socket.service';
import { calculateDistance, calculateETA, isWithinGeofence } from '../../utils/geo';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();

interface TrackingData {
  deliveryId: string;
  status: DeliveryStatus;
  location: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    heading?: number;
    speed?: number;
  };
  timestamp: Date;
  notes?: string;
  photo?: string;
}

interface LocationUpdate {
  driverId: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    heading?: number;
    speed?: number;
  };
  timestamp: Date;
}

interface TrackingSession {
  sessionId: string;
  deliveryId: string;
  driverId: string;
  startTime: Date;
  endTime?: Date;
  trackingPoints: TrackingPoint[];
  totalDistance: number;
  status: 'active' | 'paused' | 'completed';
}

interface TrackingPoint {
  location: {
    latitude: number;
    longitude: number;
  };
  timestamp: Date;
  speed?: number;
  heading?: number;
}

interface ETAUpdate {
  deliveryId: string;
  currentETA: Date;
  originalETA: Date;
  delayMinutes: number;
  reason?: string;
}

class TrackingService extends EventEmitter {
  private activeSessions: Map<string, TrackingSession> = new Map();
  private readonly LOCATION_UPDATE_INTERVAL = 10000; // 10 seconds
  private readonly GEOFENCE_RADIUS = 100; // 100 meters
  private readonly SPEED_THRESHOLD = 120; // 120 km/h max speed
  private readonly STATIONARY_THRESHOLD = 5; // 5 minutes

  constructor() {
    super();
    this.initializeLocationCleanup();
  }

  /**
   * Create tracking record
   */
  async createTracking(data: TrackingData): Promise<any> {
    try {
      const tracking = await prisma.trackingEvent.create({
        data: {
          deliveryId: data.deliveryId,
          status: data.status,
          location: data.location,
          timestamp: data.timestamp,
          notes: data.notes,
          photo: data.photo
        }
      });

      // Store latest location in Redis for fast access
      await this.updateCachedLocation(data.deliveryId, data.location);

      // Check for geofence events
      await this.checkGeofenceEvents(data.deliveryId, data.location);

      // Broadcast real-time update
      this.broadcastTrackingUpdate(data);

      // Emit tracking event
      this.emit('tracking:created', {
        deliveryId: data.deliveryId,
        status: data.status,
        location: data.location
      });

      return tracking;
    } catch (error) {
      logger.error('Error creating tracking record:', error);
      throw error;
    }
  }

  /**
   * Start tracking session
   */
  async startTrackingSession(deliveryId: string, driverId: string): Promise<TrackingSession> {
    try {
      // Check if session already exists
      const existingSession = Array.from(this.activeSessions.values())
        .find(s => s.deliveryId === deliveryId && s.status === 'active');

      if (existingSession) {
        return existingSession;
      }

      // Create new session
      const session: TrackingSession = {
        sessionId: `tracking_${Date.now()}_${driverId}`,
        deliveryId,
        driverId,
        startTime: new Date(),
        trackingPoints: [],
        totalDistance: 0,
        status: 'active'
      };

      // Store session
      this.activeSessions.set(session.sessionId, session);

      // Store in Redis for persistence
      await redisClient.setex(
        `tracking_session:${session.sessionId}`,
        24 * 60 * 60, // 24 hours
        JSON.stringify(session)
      );

      // Start location polling
      this.startLocationPolling(session.sessionId);

      // Emit session started event
      this.emit('tracking:session_started', {
        sessionId: session.sessionId,
        deliveryId,
        driverId
      });

      logger.info(`Tracking session started: ${session.sessionId}`);

      return session;
    } catch (error) {
      logger.error('Error starting tracking session:', error);
      throw error;
    }
  }

  /**
   * Update driver location
   */
  async updateDriverLocation(update: LocationUpdate): Promise<void> {
    try {
      // Validate location
      if (!this.isValidLocation(update.location)) {
        throw new Error('Invalid location data');
      }

      // Check for suspicious movement
      const isSuspicious = await this.checkSuspiciousMovement(
        update.driverId,
        update.location
      );

      if (isSuspicious) {
        logger.warn(`Suspicious movement detected for driver ${update.driverId}`);
        this.emit('tracking:suspicious_movement', {
          driverId: update.driverId,
          location: update.location
        });
      }

      // Store location in Redis
      const locationKey = `driver_location:${update.driverId}`;
      await redisClient.setex(
        locationKey,
        300, // 5 minutes
        JSON.stringify({
          ...update.location,
          timestamp: update.timestamp
        })
      );

      // Update active deliveries
      const activeDeliveries = await this.getActiveDeliveries(update.driverId);
      
      for (const delivery of activeDeliveries) {
        // Update delivery location
        await prisma.delivery.update({
          where: { id: delivery.id },
          data: {
            currentLocation: update.location,
            lastLocationUpdate: update.timestamp
          }
        });

        // Update session if exists
        const session = Array.from(this.activeSessions.values())
          .find(s => s.deliveryId === delivery.id && s.status === 'active');

        if (session) {
          await this.updateTrackingSession(session.sessionId, update.location);
        }

        // Calculate and update ETA
        await this.updateDeliveryETA(delivery.id, update.location);

        // Check for arrival at pickup/delivery location
        await this.checkArrival(delivery, update.location);
      }

      // Broadcast location update
      this.broadcastLocationUpdate(update);

      // Emit location updated event
      this.emit('tracking:location_updated', update);
    } catch (error) {
      logger.error('Error updating driver location:', error);
      throw error;
    }
  }

  /**
   * Get delivery tracking history
   */
  async getTrackingHistory(deliveryId: string): Promise<any[]> {
    try {
      const trackingEvents = await prisma.trackingEvent.findMany({
        where: { deliveryId },
        orderBy: { timestamp: 'asc' }
      });

      return trackingEvents;
    } catch (error) {
      logger.error('Error getting tracking history:', error);
      throw error;
    }
  }

  /**
   * Get live tracking data
   */
  async getLiveTracking(deliveryId: string): Promise<any> {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          driver: {
            include: {
              user: true,
              vehicle: true
            }
          },
          order: {
            include: {
              customer: true,
              merchant: true
            }
          }
        }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      // Get cached location
      const cachedLocation = await this.getCachedLocation(deliveryId);

      // Get active session
      const session = Array.from(this.activeSessions.values())
        .find(s => s.deliveryId === deliveryId && s.status === 'active');

      // Calculate current ETA
      const currentETA = await this.calculateCurrentETA(delivery, cachedLocation);

      return {
        delivery: {
          id: delivery.id,
          trackingNumber: delivery.trackingNumber,
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime,
          currentETA
        },
        driver: delivery.driver ? {
          id: delivery.driver.id,
          name: `${delivery.driver.user.firstName} ${delivery.driver.user.lastName}`,
          photo: delivery.driver.user.avatar,
          vehicle: {
            type: delivery.driver.vehicle.type,
            licensePlate: delivery.driver.vehicle.licensePlate
          },
          rating: delivery.driver.rating
        } : null,
        currentLocation: cachedLocation || delivery.currentLocation,
        tracking: {
          sessionActive: !!session,
          lastUpdate: cachedLocation?.timestamp || delivery.lastLocationUpdate,
          polyline: session ? this.generatePolyline(session.trackingPoints) : null
        },
        destination: delivery.status === DeliveryStatus.PICKED_UP
          ? delivery.deliveryAddress
          : delivery.pickupAddress
      };
    } catch (error) {
      logger.error('Error getting live tracking:', error);
      throw error;
    }
  }

  /**
   * Stop tracking session
   */
  async stopTrackingSession(sessionId: string): Promise<void> {
    try {
      const session = this.activeSessions.get(sessionId);
      
      if (!session) {
        throw new Error('Tracking session not found');
      }

      // Update session status
      session.status = 'completed';
      session.endTime = new Date();

      // Calculate total distance
      session.totalDistance = this.calculateTotalDistance(session.trackingPoints);

      // Store final session data
      await redisClient.setex(
        `tracking_session:${sessionId}:completed`,
        7 * 24 * 60 * 60, // 7 days
        JSON.stringify(session)
      );

      // Remove from active sessions
      this.activeSessions.delete(sessionId);

      // Remove from Redis active sessions
      await redisClient.del(`tracking_session:${sessionId}`);

      // Emit session stopped event
      this.emit('tracking:session_stopped', {
        sessionId,
        deliveryId: session.deliveryId,
        totalDistance: session.totalDistance
      });

      logger.info(`Tracking session stopped: ${sessionId}`);
    } catch (error) {
      logger.error('Error stopping tracking session:', error);
      throw error;
    }
  }

  /**
   * Get driver tracking analytics
   */
  async getTrackingAnalytics(driverId: string, dateRange: { start: Date; end: Date }) {
    try {
      const deliveries = await prisma.delivery.findMany({
        where: {
          driverId,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end
          },
          status: DeliveryStatus.DELIVERED
        },
        include: {
          trackingEvents: true
        }
      });

      const analytics = {
        totalDeliveries: deliveries.length,
        totalDistance: 0,
        totalTime: 0,
        averageSpeed: 0,
        routeEfficiency: 0,
        stationaryTime: 0,
        speedingIncidents: 0,
        geofenceViolations: 0
      };

      for (const delivery of deliveries) {
        const metrics = await this.calculateDeliveryMetrics(delivery);
        analytics.totalDistance += metrics.distance;
        analytics.totalTime += metrics.duration;
        analytics.stationaryTime += metrics.stationaryTime;
        analytics.speedingIncidents += metrics.speedingIncidents;
      }

      analytics.averageSpeed = analytics.totalDistance / (analytics.totalTime / 3600);
      analytics.routeEfficiency = this.calculateRouteEfficiency(deliveries);

      return analytics;
    } catch (error) {
      logger.error('Error getting tracking analytics:', error);
      throw error;
    }
  }

  /**
   * Set up geofence
   */
  async setupGeofence(params: {
    deliveryId: string;
    location: { latitude: number; longitude: number };
    radius: number;
    type: 'pickup' | 'delivery' | 'waypoint';
    name: string;
  }): Promise<void> {
    try {
      const geofence = {
        ...params,
        id: `geofence_${Date.now()}`,
        createdAt: new Date(),
        triggered: false
      };

      // Store geofence in Redis
      await redisClient.setex(
        `geofence:${params.deliveryId}:${geofence.id}`,
        24 * 60 * 60,
        JSON.stringify(geofence)
      );

      logger.info(`Geofence created: ${geofence.id}`);
    } catch (error) {
      logger.error('Error setting up geofence:', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private async updateTrackingSession(sessionId: string, location: any): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'active') return;

    const trackingPoint: TrackingPoint = {
      location: {
        latitude: location.latitude,
        longitude: location.longitude
      },
      timestamp: new Date(),
      speed: location.speed,
      heading: location.heading
    };

    // Calculate distance from last point
    if (session.trackingPoints.length > 0) {
      const lastPoint = session.trackingPoints[session.trackingPoints.length - 1];
      const distance = calculateDistance(
        lastPoint.location.latitude,
        lastPoint.location.longitude,
        location.latitude,
        location.longitude
      );
      session.totalDistance += distance;
    }

    session.trackingPoints.push(trackingPoint);

    // Limit tracking points to last 1000
    if (session.trackingPoints.length > 1000) {
      session.trackingPoints.shift();
    }

    // Update in Redis
    await redisClient.setex(
      `tracking_session:${sessionId}`,
      24 * 60 * 60,
      JSON.stringify(session)
    );
  }

  private async updateCachedLocation(deliveryId: string, location: any): Promise<void> {
    const key = `delivery_location:${deliveryId}`;
    await redisClient.setex(
      key,
      300, // 5 minutes
      JSON.stringify({
        ...location,
        timestamp: new Date()
      })
    );
  }

  private async getCachedLocation(deliveryId: string): Promise<any> {
    const key = `delivery_location:${deliveryId}`;
    const cached = await redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  private async checkGeofenceEvents(deliveryId: string, location: any): Promise<void> {
    const geofenceKeys = await redisClient.keys(`geofence:${deliveryId}:*`);
    
    for (const key of geofenceKeys) {
      const geofenceData = await redisClient.get(key);
      if (!geofenceData) continue;

      const geofence = JSON.parse(geofenceData);
      
      if (geofence.triggered) continue;

      const isInside = isWithinGeofence(
        location,
        geofence.location,
        geofence.radius
      );

      if (isInside) {
        geofence.triggered = true;
        geofence.triggeredAt = new Date();
        
        await redisClient.setex(key, 24 * 60 * 60, JSON.stringify(geofence));

        this.emit('tracking:geofence_triggered', {
          deliveryId,
          geofence
        });

        // Send notification
        if (geofence.type === 'delivery') {
          const delivery = await prisma.delivery.findUnique({
            where: { id: deliveryId },
            include: { order: true }
          });

          if (delivery) {
            await notificationService.sendNotification({
              userId: delivery.order.customerId,
              type: 'DELIVERY_NEARBY',
              title: 'Driver Nearby',
              message: 'Your delivery driver is approaching!',
              data: { deliveryId }
            });
          }
        }
      }
    }
  }

  private async checkSuspiciousMovement(driverId: string, newLocation: any): Promise<boolean> {
    const lastLocationKey = `driver_location:${driverId}:previous`;
    const lastLocationData = await redisClient.get(lastLocationKey);
    
    if (!lastLocationData) {
      // Store current location for next check
      await redisClient.setex(
        lastLocationKey,
        300,
        JSON.stringify({ ...newLocation, timestamp: new Date() })
      );
      return false;
    }

    const lastLocation = JSON.parse(lastLocationData);
    const timeDiff = (new Date().getTime() - new Date(lastLocation.timestamp).getTime()) / 1000; // seconds
    const distance = calculateDistance(
      lastLocation.latitude,
      lastLocation.longitude,
      newLocation.latitude,
      newLocation.longitude
    );

    // Calculate speed in km/h
    const speed = (distance / 1000) / (timeDiff / 3600);

    // Update stored location
    await redisClient.setex(
      lastLocationKey,
      300,
      JSON.stringify({ ...newLocation, timestamp: new Date() })
    );

    // Check if speed exceeds threshold
    return speed > this.SPEED_THRESHOLD;
  }

  private async updateDeliveryETA(deliveryId: string, currentLocation: any): Promise<void> {
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) return;

    const destination = delivery.status === DeliveryStatus.PICKED_UP
      ? delivery.deliveryAddress
      : delivery.pickupAddress;

    const distance = calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      destination.latitude,
      destination.longitude
    );

    const newETA = new Date(Date.now() + calculateETA(distance) * 1000);
    const originalETA = delivery.estimatedDeliveryTime;

    if (originalETA && Math.abs(newETA.getTime() - originalETA.getTime()) > 5 * 60 * 1000) {
      // ETA changed by more than 5 minutes
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: { estimatedDeliveryTime: newETA }
      });

      const delayMinutes = Math.round((newETA.getTime() - originalETA.getTime()) / 60000);

      this.emit('tracking:eta_updated', {
        deliveryId,
        currentETA: newETA,
        originalETA,
        delayMinutes
      });

      // Notify customer if delayed
      if (delayMinutes > 10) {
        const order = await prisma.order.findFirst({
          where: { deliveries: { some: { id: deliveryId } } }
        });

        if (order) {
          await notificationService.sendNotification({
            userId: order.customerId,
            type: 'DELIVERY_DELAYED',
            title: 'Delivery Delayed',
            message: `Your delivery is running ${delayMinutes} minutes late. New ETA: ${newETA.toLocaleTimeString()}`,
            data: { deliveryId, newETA, delayMinutes }
          });
        }
      }
    }
  }

  private async checkArrival(delivery: any, currentLocation: any): Promise<void> {
    const destination = delivery.status === DeliveryStatus.ASSIGNED
      ? delivery.pickupAddress
      : delivery.deliveryAddress;

    const distance = calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      destination.latitude,
      destination.longitude
    );

    if (distance <= this.GEOFENCE_RADIUS) {
      this.emit('tracking:arrived', {
        deliveryId: delivery.id,
        location: currentLocation,
        type: delivery.status === DeliveryStatus.ASSIGNED ? 'pickup' : 'delivery'
      });
    }
  }

  private async getActiveDeliveries(driverId: string): Promise<any[]> {
    return prisma.delivery.findMany({
      where: {
        driverId,
        status: {
          in: [DeliveryStatus.ASSIGNED, DeliveryStatus.IN_TRANSIT, DeliveryStatus.PICKED_UP]
        }
      }
    });
  }

  private broadcastTrackingUpdate(data: TrackingData): void {
    socketService.emitToRoom(`delivery:${data.deliveryId}`, 'tracking:update', {
      deliveryId: data.deliveryId,
      status: data.status,
      location: data.location,
      timestamp: data.timestamp
    });
  }

  private broadcastLocationUpdate(update: LocationUpdate): void {
    socketService.emitToRoom(`driver:${update.driverId}`, 'location:update', {
      driverId: update.driverId,
      location: update.location,
      timestamp: update.timestamp
    });
  }

  private isValidLocation(location: any): boolean {
    return (
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number' &&
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      location.longitude >= -180 &&
      location.longitude <= 180
    );
  }

  private calculateTotalDistance(trackingPoints: TrackingPoint[]): number {
    let totalDistance = 0;

    for (let i = 1; i < trackingPoints.length; i++) {
      const distance = calculateDistance(
        trackingPoints[i - 1].location.latitude,
        trackingPoints[i - 1].location.longitude,
        trackingPoints[i].location.latitude,
        trackingPoints[i].location.longitude
      );
      totalDistance += distance;
    }

    return totalDistance;
  }

  private generatePolyline(trackingPoints: TrackingPoint[]): string {
    // Generate encoded polyline for map display
    // In production, use Google's polyline encoding algorithm
    return trackingPoints.map(point => 
      `${point.location.latitude},${point.location.longitude}`
    ).join('|');
  }

  private async calculateCurrentETA(delivery: any, currentLocation: any): Promise<Date | null> {
    if (!currentLocation) return delivery.estimatedDeliveryTime;

    const destination = delivery.status === DeliveryStatus.PICKED_UP
      ? delivery.deliveryAddress
      : delivery.pickupAddress;

    const distance = calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      destination.latitude,
      destination.longitude
    );

    const eta = calculateETA(distance);
    return new Date(Date.now() + eta * 1000);
  }

  private async calculateDeliveryMetrics(delivery: any): Promise<any> {
    const trackingEvents = delivery.trackingEvents;
    let distance = 0;
    let duration = 0;
    let stationaryTime = 0;
    let speedingIncidents = 0;

    for (let i = 1; i < trackingEvents.length; i++) {
      const prevEvent = trackingEvents[i - 1];
      const currentEvent = trackingEvents[i];

      // Calculate distance
      const segmentDistance = calculateDistance(
        prevEvent.location.latitude,
        prevEvent.location.longitude,
        currentEvent.location.latitude,
        currentEvent.location.longitude
      );
      distance += segmentDistance;

      // Calculate time
      const timeDiff = (currentEvent.timestamp.getTime() - prevEvent.timestamp.getTime()) / 1000;
      duration += timeDiff;

      // Check for stationary time
      if (segmentDistance < 10 && timeDiff > 60) {
        stationaryTime += timeDiff;
      }

      // Check for speeding
      const speed = (segmentDistance / 1000) / (timeDiff / 3600);
      if (speed > this.SPEED_THRESHOLD) {
        speedingIncidents++;
      }
    }

    return {
      distance,
      duration,
      stationaryTime,
      speedingIncidents
    };
  }

  private calculateRouteEfficiency(deliveries: any[]): number {
    // Calculate route efficiency based on actual vs optimal distance
    // This is a simplified calculation
    let actualDistance = 0;
    let optimalDistance = 0;

    for (const delivery of deliveries) {
      actualDistance += delivery.actualDistance || delivery.estimatedDistance;
      optimalDistance += delivery.estimatedDistance;
    }

    return optimalDistance > 0 ? (optimalDistance / actualDistance) * 100 : 0;
  }

  private startLocationPolling(sessionId: string): void {
    const interval = setInterval(async () => {
      const session = this.activeSessions.get(sessionId);
      
      if (!session || session.status !== 'active') {
        clearInterval(interval);
        return;
      }

      // Request location update from driver
      socketService.emitToUser(session.driverId, 'tracking:request_location', {
        sessionId,
        deliveryId: session.deliveryId
      });
    }, this.LOCATION_UPDATE_INTERVAL);
  }

  private initializeLocationCleanup(): void {
    // Clean up old location data every hour
    setInterval(async () => {
      try {
        const keys = await redisClient.keys('driver_location:*');
        const now = Date.now();

        for (const key of keys) {
          const data = await redisClient.get(key);
          if (!data) continue;

          const location = JSON.parse(data);
          const age = now - new Date(location.timestamp).getTime();

          // Remove locations older than 1 hour
          if (age > 60 * 60 * 1000) {
            await redisClient.del(key);
          }
        }
      } catch (error) {
        logger.error('Error cleaning up location data:', error);
      }
    }, 60 * 60 * 1000); // Every hour
  }
}

export const trackingService = new TrackingService();