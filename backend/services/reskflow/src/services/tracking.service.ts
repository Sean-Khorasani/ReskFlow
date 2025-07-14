import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { publishTrackingEvent, publishNotification } from '../config/rabbitmq';
import {
  TrackingEvent,
  TrackingInfo,
  LocationUpdate,
  TrackingEventType,
  DeliveryStatus,
  Coordinates,
  WebSocketMessage,
  LocationUpdateMessage,
  StatusUpdateMessage,
} from '../types/reskflow.types';
import {
  DeliveryNotFoundError,
  DriverNotFoundError,
  ValidationError,
  TrackingError,
} from '../utils/errors';
import {
  validateCoordinates,
  calculateDistance,
  generateUUID,
} from '../utils/helpers';
import { trackingLogger, loggerHelpers } from '../utils/logger';
import { config } from '../config';

export class TrackingService {
  private readonly LOCATION_CACHE_TTL = 300; // 5 minutes
  private readonly EVENT_CACHE_TTL = 3600; // 1 hour
  private readonly MAX_LOCATION_HISTORY = 100; // Maximum locations to keep in memory
  private readonly MIN_LOCATION_ACCURACY = 50; // Minimum GPS accuracy in meters

  /**
   * Log a tracking event
   */
  async logTrackingEvent(eventData: {
    reskflowId: string;
    eventType: TrackingEventType;
    status?: DeliveryStatus;
    location?: Coordinates;
    notes?: string;
    metadata?: Record<string, any>;
    createdBy?: string;
  }): Promise<TrackingEvent> {
    try {
      const {
        reskflowId,
        eventType,
        status,
        location,
        notes,
        metadata,
        createdBy,
      } = eventData;

      // Validate reskflow exists
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
      });

      if (!reskflow) {
        throw new DeliveryNotFoundError(reskflowId);
      }

      // Validate location if provided
      if (location && !validateCoordinates(location.lat, location.lng)) {
        throw new ValidationError('Invalid coordinates provided');
      }

      // Create tracking event in database
      const trackingEvent = await prisma.reskflowTimeline.create({
        data: {
          reskflowId,
          status: status || reskflow.status,
          message: this.getEventMessage(eventType, status),
          location: location ? JSON.stringify(location) : null,
          actor: createdBy || 'system',
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      const formattedEvent: TrackingEvent = {
        id: trackingEvent.id,
        reskflowId,
        eventType,
        status: status || reskflow.status,
        location,
        timestamp: trackingEvent.createdAt,
        notes,
        metadata,
        createdBy,
      };

      // Cache the event
      await this.cacheTrackingEvent(formattedEvent);

      // Log business event
      loggerHelpers.logBusinessEvent('tracking_event_logged', {
        reskflowId,
        eventType,
        status,
        location,
        createdBy,
      });

      // Publish tracking event
      await publishTrackingEvent(eventType, {
        reskflowId,
        eventType,
        status,
        location,
        timestamp: trackingEvent.createdAt,
        metadata,
      });

      trackingLogger.info('Tracking event logged', {
        eventId: trackingEvent.id,
        reskflowId,
        eventType,
        status,
      });

      return formattedEvent;
    } catch (error) {
      trackingLogger.error('Failed to log tracking event', {
        eventData,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update reskflow location in real-time
   */
  async updateLocation(locationUpdate: LocationUpdate): Promise<void> {
    try {
      const {
        reskflowId,
        driverId,
        location,
        heading,
        speed,
        accuracy,
        timestamp,
        status,
        notes,
      } = locationUpdate;

      // Validate coordinates
      if (!validateCoordinates(location.lat, location.lng)) {
        throw new ValidationError('Invalid coordinates provided');
      }

      // Validate accuracy if provided
      if (accuracy && accuracy > this.MIN_LOCATION_ACCURACY) {
        trackingLogger.warn('Location accuracy is low', {
          reskflowId,
          driverId,
          accuracy,
          threshold: this.MIN_LOCATION_ACCURACY,
        });
      }

      // Validate reskflow and driver
      const [reskflow, driver] = await Promise.all([
        prisma.reskflow.findUnique({ where: { id: reskflowId } }),
        prisma.driver.findUnique({ where: { id: driverId } }),
      ]);

      if (!reskflow) {
        throw new DeliveryNotFoundError(reskflowId);
      }

      if (!driver) {
        throw new DriverNotFoundError(driverId);
      }

      // Verify driver is assigned to this reskflow
      if (reskflow.driverId !== driverId) {
        throw new ValidationError('Driver is not assigned to this reskflow');
      }

      // Store location data in database for tracking history
      await prisma.reskflowTracking.create({
        data: {
          reskflowId,
          latitude: location.lat,
          longitude: location.lng,
          accuracy,
          heading,
          speed,
          timestamp: timestamp || new Date(),
        },
      });

      // Store current location in Redis for real-time access
      const locationData = {
        reskflowId,
        driverId,
        location,
        heading,
        speed,
        accuracy,
        timestamp: timestamp || new Date(),
        status,
        notes,
      };

      await redis.setJson(`location:${reskflowId}`, locationData, this.LOCATION_CACHE_TTL);

      // Update location history in Redis (keep last N locations)
      const historyKey = `location_history:${reskflowId}`;
      await redis.lpush(historyKey, JSON.stringify(locationData));
      await redis.ltrim(historyKey, 0, this.MAX_LOCATION_HISTORY - 1);
      await redis.expire(historyKey, this.EVENT_CACHE_TTL);

      // Update driver's current location
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          currentLocation: JSON.stringify(location),
          lastLocationUpdate: new Date(),
        },
      });

      // Log tracking event for location update
      await this.logTrackingEvent({
        reskflowId,
        eventType: TrackingEventType.LOCATION_UPDATE,
        location,
        metadata: {
          heading,
          speed,
          accuracy,
          driverId,
        },
        createdBy: driverId,
      });

      // Calculate estimated arrival time if needed
      if (reskflow.status === DeliveryStatus.IN_TRANSIT) {
        const estimatedArrival = await this.calculateEstimatedArrival(
          reskflowId,
          location,
          JSON.parse(reskflow.reskflowAddress)
        );

        if (estimatedArrival) {
          await redis.setJson(
            `eta:${reskflowId}`,
            { estimatedArrival, calculatedAt: new Date() },
            this.LOCATION_CACHE_TTL
          );
        }
      }

      trackingLogger.debug('Location updated successfully', {
        reskflowId,
        driverId,
        location,
        heading,
        speed,
      });
    } catch (error) {
      trackingLogger.error('Failed to update location', {
        locationUpdate,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get tracking information for a reskflow
   */
  async getTrackingInfo(reskflowId: string): Promise<TrackingInfo> {
    try {
      // Get reskflow details
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
        include: {
          timeline: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!reskflow) {
        throw new DeliveryNotFoundError(reskflowId);
      }

      // Get current location from cache
      const currentLocationData = await redis.getJson(`location:${reskflowId}`);

      // Get estimated arrival time
      const etaData = await redis.getJson(`eta:${reskflowId}`);

      // Format timeline events
      const events: TrackingEvent[] = reskflow.timeline.map(event => ({
        id: event.id,
        reskflowId,
        eventType: this.getEventTypeFromMessage(event.message),
        status: event.status,
        location: event.location ? JSON.parse(event.location) : undefined,
        timestamp: event.createdAt,
        notes: event.message,
        metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
        createdBy: event.actor,
      }));

      const trackingInfo: TrackingInfo = {
        reskflowId,
        currentStatus: reskflow.status,
        currentLocation: currentLocationData?.location,
        estimatedArrival: etaData?.estimatedArrival ? new Date(etaData.estimatedArrival) : undefined,
        lastUpdate: currentLocationData?.timestamp ? new Date(currentLocationData.timestamp) : reskflow.updatedAt,
        events,
      };

      return trackingInfo;
    } catch (error) {
      trackingLogger.error('Failed to get tracking info', {
        reskflowId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get location history for a reskflow
   */
  async getLocationHistory(reskflowId: string, limit = 50): Promise<LocationUpdate[]> {
    try {
      // Try to get from cache first
      const historyKey = `location_history:${reskflowId}`;
      const cachedHistory = await redis.lrange(historyKey, 0, limit - 1);

      if (cachedHistory.length > 0) {
        return cachedHistory.map(item => JSON.parse(item));
      }

      // Get from database if not in cache
      const trackingData = await prisma.reskflowTracking.findMany({
        where: { reskflowId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      const locationHistory: LocationUpdate[] = trackingData.map(track => ({
        reskflowId,
        driverId: '', // Would need to get from reskflow
        location: {
          lat: track.latitude,
          lng: track.longitude,
        },
        heading: track.heading || undefined,
        speed: track.speed || undefined,
        accuracy: track.accuracy || undefined,
        timestamp: track.timestamp,
      }));

      return locationHistory;
    } catch (error) {
      trackingLogger.error('Failed to get location history', {
        reskflowId,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get real-time tracking data for multiple deliveries
   */
  async getBulkTrackingData(reskflowIds: string[]): Promise<Record<string, TrackingInfo>> {
    try {
      const trackingData: Record<string, TrackingInfo> = {};

      await Promise.all(
        reskflowIds.map(async (reskflowId) => {
          try {
            trackingData[reskflowId] = await this.getTrackingInfo(reskflowId);
          } catch (error) {
            trackingLogger.warn('Failed to get tracking data for reskflow', {
              reskflowId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        })
      );

      return trackingData;
    } catch (error) {
      trackingLogger.error('Failed to get bulk tracking data', {
        reskflowIds,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Create WebSocket message for location updates
   */
  createLocationUpdateMessage(locationUpdate: LocationUpdate): LocationUpdateMessage {
    return {
      type: 'LOCATION_UPDATE',
      data: {
        reskflowId: locationUpdate.reskflowId,
        location: locationUpdate.location,
        heading: locationUpdate.heading,
        speed: locationUpdate.speed,
        timestamp: locationUpdate.timestamp,
      },
      timestamp: new Date(),
      reskflowId: locationUpdate.reskflowId,
    };
  }

  /**
   * Create WebSocket message for status updates
   */
  createStatusUpdateMessage(reskflowId: string, status: DeliveryStatus, notes?: string): StatusUpdateMessage {
    return {
      type: 'STATUS_UPDATE',
      data: {
        reskflowId,
        status,
        timestamp: new Date(),
        notes,
      },
      timestamp: new Date(),
      reskflowId,
    };
  }

  /**
   * Calculate geofence events
   */
  async checkGeofenceEvents(locationUpdate: LocationUpdate): Promise<void> {
    try {
      const { reskflowId, location } = locationUpdate;

      // Get reskflow details
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
      });

      if (!reskflow) return;

      const pickupAddress = JSON.parse(reskflow.pickupAddress);
      const reskflowAddress = JSON.parse(reskflow.reskflowAddress);

      const GEOFENCE_RADIUS = 100; // 100 meters

      // Check if driver is near pickup location
      if (reskflow.status === DeliveryStatus.ASSIGNED && pickupAddress.coordinates) {
        const distanceToPickup = calculateDistance(
          location.lat,
          location.lng,
          pickupAddress.coordinates.lat,
          pickupAddress.coordinates.lng
        ) * 1000; // Convert to meters

        if (distanceToPickup <= GEOFENCE_RADIUS) {
          await this.logTrackingEvent({
            reskflowId,
            eventType: TrackingEventType.PICKUP_STARTED,
            location,
            notes: `Driver arrived at pickup location (${Math.round(distanceToPickup)}m away)`,
            metadata: { geofenceType: 'pickup_arrival', distance: distanceToPickup },
            createdBy: locationUpdate.driverId,
          });
        }
      }

      // Check if driver is near reskflow location
      if (reskflow.status === DeliveryStatus.IN_TRANSIT && reskflowAddress.coordinates) {
        const distanceToDelivery = calculateDistance(
          location.lat,
          location.lng,
          reskflowAddress.coordinates.lat,
          reskflowAddress.coordinates.lng
        ) * 1000; // Convert to meters

        if (distanceToDelivery <= GEOFENCE_RADIUS) {
          await this.logTrackingEvent({
            reskflowId,
            eventType: TrackingEventType.DELIVERY_STARTED,
            location,
            notes: `Driver arrived at reskflow location (${Math.round(distanceToDelivery)}m away)`,
            metadata: { geofenceType: 'reskflow_arrival', distance: distanceToDelivery },
            createdBy: locationUpdate.driverId,
          });

          // Send notification to customer
          await publishNotification('driver_nearby', {
            userId: reskflow.customerId,
            reskflowId,
            estimatedArrival: '2-5 minutes',
          });
        }
      }
    } catch (error) {
      trackingLogger.error('Failed to check geofence events', {
        locationUpdate,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Private helper methods
   */
  private async cacheTrackingEvent(event: TrackingEvent): Promise<void> {
    const key = `tracking_event:${event.id}`;
    await redis.setJson(key, event, this.EVENT_CACHE_TTL);
  }

  private getEventMessage(eventType: TrackingEventType, status?: DeliveryStatus): string {
    const messages: Record<TrackingEventType, string> = {
      [TrackingEventType.DELIVERY_CREATED]: 'Delivery created and waiting for driver assignment',
      [TrackingEventType.DRIVER_ASSIGNED]: 'Driver assigned and heading to pickup location',
      [TrackingEventType.PICKUP_STARTED]: 'Driver arrived at pickup location',
      [TrackingEventType.PICKUP_COMPLETED]: 'Order picked up and heading to reskflow location',
      [TrackingEventType.DELIVERY_STARTED]: 'Driver arrived at reskflow location',
      [TrackingEventType.DELIVERY_COMPLETED]: 'Order delivered successfully',
      [TrackingEventType.DELIVERY_CANCELLED]: 'Delivery was cancelled',
      [TrackingEventType.DELIVERY_FAILED]: 'Delivery failed',
      [TrackingEventType.LOCATION_UPDATE]: 'Location updated',
      [TrackingEventType.STATUS_UPDATE]: status ? `Status updated to ${status}` : 'Status updated',
    };

    return messages[eventType] || 'Unknown event';
  }

  private getEventTypeFromMessage(message: string): TrackingEventType {
    if (message.includes('created')) return TrackingEventType.DELIVERY_CREATED;
    if (message.includes('assigned')) return TrackingEventType.DRIVER_ASSIGNED;
    if (message.includes('arrived at pickup')) return TrackingEventType.PICKUP_STARTED;
    if (message.includes('picked up')) return TrackingEventType.PICKUP_COMPLETED;
    if (message.includes('arrived at reskflow')) return TrackingEventType.DELIVERY_STARTED;
    if (message.includes('delivered')) return TrackingEventType.DELIVERY_COMPLETED;
    if (message.includes('cancelled')) return TrackingEventType.DELIVERY_CANCELLED;
    if (message.includes('failed')) return TrackingEventType.DELIVERY_FAILED;
    if (message.includes('Location updated')) return TrackingEventType.LOCATION_UPDATE;
    return TrackingEventType.STATUS_UPDATE;
  }

  private async calculateEstimatedArrival(
    reskflowId: string,
    currentLocation: Coordinates,
    destinationAddress: any
  ): Promise<Date | null> {
    try {
      if (!destinationAddress.coordinates) return null;

      const distance = calculateDistance(
        currentLocation.lat,
        currentLocation.lng,
        destinationAddress.coordinates.lat,
        destinationAddress.coordinates.lng
      );

      // Simple estimation: assume 30 km/h average speed in city
      const averageSpeed = 30; // km/h
      const estimatedMinutes = (distance / averageSpeed) * 60;

      return new Date(Date.now() + estimatedMinutes * 60 * 1000);
    } catch (error) {
      trackingLogger.error('Failed to calculate estimated arrival', {
        reskflowId,
        currentLocation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}