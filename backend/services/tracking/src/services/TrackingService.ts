import { PrismaClient } from '@prisma/client';
import { 
  TrackingSessionData, 
  TrackingEventData, 
  Location, 
  LocationUpdateRequest,
  TrackingStatus,
  EventType,
  TrackingType,
  EventSource
} from '../types/tracking.types';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

export class TrackingService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async createTrackingSession(data: TrackingSessionData): Promise<any> {
    try {
      logger.info('Creating tracking session', { orderId: data.orderId, driverId: data.driverId });

      const session = await this.prisma.trackingSession.create({
        data: {
          orderId: data.orderId,
          driverId: data.driverId,
          customerId: data.customerId,
          merchantId: data.merchantId,
          sessionType: data.sessionType,
          status: data.status || TrackingStatus.PENDING,
          startLocation: data.startLocation,
          currentLocation: data.currentLocation,
          endLocation: data.endLocation,
          plannedRoute: data.plannedRoute || [],
          actualRoute: data.actualRoute || [],
          estimatedArrival: data.estimatedArrival,
          metadata: data.metadata || {},
        },
        include: {
          trackingEvents: true,
          locationUpdates: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
        },
      });

      // Cache session in Redis
      await redisClient.cache(`session:${session.id}`, session, 3600);
      await redisClient.setSessionStatus(session.id, session.status);

      // Create initial tracking event
      await this.createTrackingEvent({
        sessionId: session.id,
        eventType: EventType.SESSION_STARTED,
        eventData: { sessionType: data.sessionType },
        location: data.startLocation,
        source: EventSource.SYSTEM,
      });

      logger.info('Tracking session created successfully', { sessionId: session.id });
      return session;
    } catch (error) {
      logger.error('Failed to create tracking session', { error: error.message, data });
      throw new Error(`Failed to create tracking session: ${error.message}`);
    }
  }

  async getTrackingSession(sessionId: string): Promise<any> {
    try {
      // Try to get from cache first
      let session = await redisClient.getCached(`session:${sessionId}`);
      
      if (!session) {
        session = await this.prisma.trackingSession.findUnique({
          where: { id: sessionId },
          include: {
            trackingEvents: {
              orderBy: { timestamp: 'desc' },
              take: 50,
            },
            locationUpdates: {
              orderBy: { timestamp: 'desc' },
              take: 100,
            },
          },
        });

        if (session) {
          await redisClient.cache(`session:${sessionId}`, session, 1800);
        }
      }

      if (!session) {
        throw new Error('Tracking session not found');
      }

      return session;
    } catch (error) {
      logger.error('Failed to get tracking session', { error: error.message, sessionId });
      throw error;
    }
  }

  async updateTrackingSession(sessionId: string, updates: Partial<TrackingSessionData>): Promise<any> {
    try {
      logger.info('Updating tracking session', { sessionId, updates });

      const session = await this.prisma.trackingSession.update({
        where: { id: sessionId },
        data: {
          ...updates,
          updatedAt: new Date(),
        },
        include: {
          trackingEvents: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
          locationUpdates: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
        },
      });

      // Update cache
      await redisClient.cache(`session:${sessionId}`, session, 1800);
      
      // Update status in Redis if changed
      if (updates.status) {
        await redisClient.setSessionStatus(sessionId, updates.status);
      }

      logger.info('Tracking session updated successfully', { sessionId });
      return session;
    } catch (error) {
      logger.error('Failed to update tracking session', { error: error.message, sessionId, updates });
      throw new Error(`Failed to update tracking session: ${error.message}`);
    }
  }

  async updateLocation(request: LocationUpdateRequest): Promise<void> {
    try {
      logger.debug('Updating location', { sessionId: request.sessionId, location: request.location });

      // Validate session exists
      const session = await this.getTrackingSession(request.sessionId);
      if (!session) {
        throw new Error('Tracking session not found');
      }

      // Create location update record
      const locationUpdate = await this.prisma.locationUpdate.create({
        data: {
          sessionId: request.sessionId,
          latitude: request.location.latitude,
          longitude: request.location.longitude,
          accuracy: request.location.accuracy,
          altitude: request.location.altitude,
          speed: request.location.speed,
          heading: request.location.heading,
          address: request.location.address,
          city: request.location.city,
          country: request.location.country,
          batteryLevel: request.batteryLevel,
          networkType: request.networkType,
        },
      });

      // Update current location in session
      await this.prisma.trackingSession.update({
        where: { id: request.sessionId },
        data: {
          currentLocation: request.location,
          updatedAt: new Date(),
        },
      });

      // Update location in Redis for real-time tracking
      await redisClient.updateLocation(request.sessionId, request.location);
      
      // Update driver location for nearby driver queries
      await redisClient.setDriverLocation(session.driverId, request.location);

      // Create location update event
      await this.createTrackingEvent({
        sessionId: request.sessionId,
        eventType: EventType.LOCATION_UPDATED,
        eventData: {
          batteryLevel: request.batteryLevel,
          networkType: request.networkType,
          accuracy: request.location.accuracy,
        },
        location: request.location,
        source: EventSource.MOBILE_APP,
      });

      logger.debug('Location updated successfully', { sessionId: request.sessionId });
    } catch (error) {
      logger.error('Failed to update location', { error: error.message, request });
      throw new Error(`Failed to update location: ${error.message}`);
    }
  }

  async createTrackingEvent(data: TrackingEventData): Promise<any> {
    try {
      const event = await this.prisma.trackingEvent.create({
        data: {
          sessionId: data.sessionId,
          eventType: data.eventType,
          eventData: data.eventData,
          location: data.location,
          source: data.source,
          metadata: data.metadata || {},
        },
      });

      logger.info('Tracking event created', { 
        sessionId: data.sessionId, 
        eventType: data.eventType,
        eventId: event.id 
      });

      return event;
    } catch (error) {
      logger.error('Failed to create tracking event', { error: error.message, data });
      throw new Error(`Failed to create tracking event: ${error.message}`);
    }
  }

  async getTrackingEvents(sessionId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      const events = await this.prisma.trackingEvent.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      });

      return events;
    } catch (error) {
      logger.error('Failed to get tracking events', { error: error.message, sessionId });
      throw new Error(`Failed to get tracking events: ${error.message}`);
    }
  }

  async getLocationHistory(sessionId: string, limit: number = 100): Promise<any[]> {
    try {
      // Try Redis first for recent data
      const redisHistory = await redisClient.getLocationHistory(sessionId, Math.min(limit, 100));
      
      if (redisHistory.length >= limit) {
        return redisHistory.slice(0, limit);
      }

      // Fall back to database for older data
      const dbHistory = await this.prisma.locationUpdate.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return dbHistory;
    } catch (error) {
      logger.error('Failed to get location history', { error: error.message, sessionId });
      throw new Error(`Failed to get location history: ${error.message}`);
    }
  }

  async startTracking(sessionId: string): Promise<void> {
    try {
      logger.info('Starting tracking session', { sessionId });

      await this.updateTrackingSession(sessionId, {
        status: TrackingStatus.ACTIVE,
        startedAt: new Date(),
      });

      await this.createTrackingEvent({
        sessionId,
        eventType: EventType.SESSION_STARTED,
        eventData: { startedAt: new Date() },
        source: EventSource.SYSTEM,
      });

      logger.info('Tracking session started successfully', { sessionId });
    } catch (error) {
      logger.error('Failed to start tracking session', { error: error.message, sessionId });
      throw error;
    }
  }

  async pauseTracking(sessionId: string): Promise<void> {
    try {
      logger.info('Pausing tracking session', { sessionId });

      await this.updateTrackingSession(sessionId, {
        status: TrackingStatus.PAUSED,
      });

      await this.createTrackingEvent({
        sessionId,
        eventType: EventType.SESSION_PAUSED,
        eventData: { pausedAt: new Date() },
        source: EventSource.SYSTEM,
      });

      logger.info('Tracking session paused successfully', { sessionId });
    } catch (error) {
      logger.error('Failed to pause tracking session', { error: error.message, sessionId });
      throw error;
    }
  }

  async resumeTracking(sessionId: string): Promise<void> {
    try {
      logger.info('Resuming tracking session', { sessionId });

      await this.updateTrackingSession(sessionId, {
        status: TrackingStatus.ACTIVE,
      });

      await this.createTrackingEvent({
        sessionId,
        eventType: EventType.SESSION_RESUMED,
        eventData: { resumedAt: new Date() },
        source: EventSource.SYSTEM,
      });

      logger.info('Tracking session resumed successfully', { sessionId });
    } catch (error) {
      logger.error('Failed to resume tracking session', { error: error.message, sessionId });
      throw error;
    }
  }

  async completeTracking(sessionId: string, endLocation?: Location): Promise<void> {
    try {
      logger.info('Completing tracking session', { sessionId });

      const updates: Partial<TrackingSessionData> = {
        status: TrackingStatus.COMPLETED,
        completedAt: new Date(),
      };

      if (endLocation) {
        updates.endLocation = endLocation;
      }

      await this.updateTrackingSession(sessionId, updates);

      await this.createTrackingEvent({
        sessionId,
        eventType: EventType.SESSION_COMPLETED,
        eventData: { 
          completedAt: new Date(),
          endLocation 
        },
        location: endLocation,
        source: EventSource.SYSTEM,
      });

      logger.info('Tracking session completed successfully', { sessionId });
    } catch (error) {
      logger.error('Failed to complete tracking session', { error: error.message, sessionId });
      throw error;
    }
  }

  async cancelTracking(sessionId: string, reason?: string): Promise<void> {
    try {
      logger.info('Cancelling tracking session', { sessionId, reason });

      await this.updateTrackingSession(sessionId, {
        status: TrackingStatus.CANCELLED,
      });

      await this.createTrackingEvent({
        sessionId,
        eventType: EventType.SESSION_COMPLETED,
        eventData: { 
          cancelledAt: new Date(),
          reason 
        },
        source: EventSource.SYSTEM,
      });

      logger.info('Tracking session cancelled successfully', { sessionId });
    } catch (error) {
      logger.error('Failed to cancel tracking session', { error: error.message, sessionId });
      throw error;
    }
  }

  async getActiveSessionsByDriver(driverId: string): Promise<any[]> {
    try {
      const sessions = await this.prisma.trackingSession.findMany({
        where: {
          driverId,
          status: {
            in: [TrackingStatus.ACTIVE, TrackingStatus.PAUSED],
          },
        },
        include: {
          locationUpdates: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });

      return sessions;
    } catch (error) {
      logger.error('Failed to get active sessions by driver', { error: error.message, driverId });
      throw new Error(`Failed to get active sessions: ${error.message}`);
    }
  }

  async getSessionsByOrder(orderId: string): Promise<any[]> {
    try {
      const sessions = await this.prisma.trackingSession.findMany({
        where: { orderId },
        include: {
          trackingEvents: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
          locationUpdates: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return sessions;
    } catch (error) {
      logger.error('Failed to get sessions by order', { error: error.message, orderId });
      throw new Error(`Failed to get sessions by order: ${error.message}`);
    }
  }

  async getCurrentLocation(sessionId: string): Promise<Location | null> {
    try {
      // Try Redis first for real-time data
      const location = await redisClient.getLocation(sessionId);
      if (location) {
        return location;
      }

      // Fall back to database
      const session = await this.prisma.trackingSession.findUnique({
        where: { id: sessionId },
        select: { currentLocation: true },
      });

      return session?.currentLocation as Location || null;
    } catch (error) {
      logger.error('Failed to get current location', { error: error.message, sessionId });
      throw new Error(`Failed to get current location: ${error.message}`);
    }
  }

  async triggerEmergency(sessionId: string, location: Location, description?: string): Promise<void> {
    try {
      logger.error('Emergency triggered for tracking session', { sessionId, location, description });

      await this.createTrackingEvent({
        sessionId,
        eventType: EventType.EMERGENCY_TRIGGERED,
        eventData: {
          description,
          triggeredAt: new Date(),
          priority: 'CRITICAL',
        },
        location,
        source: EventSource.MOBILE_APP,
      });

      // Update session status to indicate emergency
      await this.updateTrackingSession(sessionId, {
        metadata: {
          emergency: {
            triggered: true,
            timestamp: new Date(),
            description,
            location,
          },
        },
      });

      // TODO: Trigger emergency response workflow
      // This would integrate with emergency services, notifications, etc.

      logger.info('Emergency event created successfully', { sessionId });
    } catch (error) {
      logger.error('Failed to trigger emergency', { error: error.message, sessionId });
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      await redisClient.disconnect();
      logger.info('TrackingService cleanup completed');
    } catch (error) {
      logger.error('Error during TrackingService cleanup', { error: error.message });
    }
  }
}