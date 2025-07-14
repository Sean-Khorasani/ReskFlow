import { Request, Response } from 'express';
import { TrackingService } from '../services/TrackingService';
import { GeofenceService } from '../services/GeofenceService';
import { RouteOptimizationService } from '../services/RouteOptimizationService';
import { 
  TrackingSessionData, 
  LocationUpdateRequest, 
  TrackingEventData,
  GeofenceZoneData,
  RouteOptimizationRequest,
  TrackingStatus,
  EventType,
  EventSource
} from '../types/tracking.types';
import { logger } from '../utils/logger';

export class TrackingController {
  private trackingService: TrackingService;
  private geofenceService: GeofenceService;
  private routeOptimizationService: RouteOptimizationService;

  constructor() {
    this.trackingService = new TrackingService();
    this.geofenceService = new GeofenceService();
    this.routeOptimizationService = new RouteOptimizationService();
  }

  // Tracking Session Management
  async createTrackingSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionData: TrackingSessionData = req.body;
      
      // Validate required fields
      if (!sessionData.orderId || !sessionData.driverId || !sessionData.customerId || !sessionData.merchantId) {
        res.status(400).json({
          error: 'Missing required fields: orderId, driverId, customerId, merchantId',
        });
        return;
      }

      const session = await this.trackingService.createTrackingSession(sessionData);

      res.status(201).json({
        success: true,
        data: session,
        message: 'Tracking session created successfully',
      });
    } catch (error) {
      logger.error('Failed to create tracking session', { error: error.message, body: req.body });
      res.status(500).json({
        error: 'Failed to create tracking session',
        message: error.message,
      });
    }
  }

  async getTrackingSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      const session = await this.trackingService.getTrackingSession(sessionId);

      res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error) {
      logger.error('Failed to get tracking session', { error: error.message, sessionId: req.params.sessionId });
      res.status(404).json({
        error: 'Tracking session not found',
        message: error.message,
      });
    }
  }

  async updateTrackingSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const updates = req.body;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      const session = await this.trackingService.updateTrackingSession(sessionId, updates);

      res.status(200).json({
        success: true,
        data: session,
        message: 'Tracking session updated successfully',
      });
    } catch (error) {
      logger.error('Failed to update tracking session', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to update tracking session',
        message: error.message,
      });
    }
  }

  // Location Updates
  async updateLocation(req: Request, res: Response): Promise<void> {
    try {
      const locationRequest: LocationUpdateRequest = req.body;

      if (!locationRequest.sessionId || !locationRequest.location) {
        res.status(400).json({
          error: 'Missing required fields: sessionId, location',
        });
        return;
      }

      if (!locationRequest.location.latitude || !locationRequest.location.longitude) {
        res.status(400).json({
          error: 'Location must include latitude and longitude',
        });
        return;
      }

      await this.trackingService.updateLocation(locationRequest);

      // Check geofences
      const session = await this.trackingService.getTrackingSession(locationRequest.sessionId);
      const geofenceEvents = await this.geofenceService.checkLocationAgainstGeofences(
        session.driverId,
        locationRequest.location,
        locationRequest.sessionId
      );

      res.status(200).json({
        success: true,
        message: 'Location updated successfully',
        geofenceEvents: geofenceEvents.length > 0 ? geofenceEvents : undefined,
      });
    } catch (error) {
      logger.error('Failed to update location', { error: error.message, body: req.body });
      res.status(500).json({
        error: 'Failed to update location',
        message: error.message,
      });
    }
  }

  async getCurrentLocation(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      const location = await this.trackingService.getCurrentLocation(sessionId);

      if (!location) {
        res.status(404).json({ error: 'Location not found for session' });
        return;
      }

      res.status(200).json({
        success: true,
        data: location,
      });
    } catch (error) {
      logger.error('Failed to get current location', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to get current location',
        message: error.message,
      });
    }
  }

  async getLocationHistory(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      const history = await this.trackingService.getLocationHistory(
        sessionId, 
        Number(limit)
      );

      res.status(200).json({
        success: true,
        data: history,
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          total: history.length,
        },
      });
    } catch (error) {
      logger.error('Failed to get location history', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to get location history',
        message: error.message,
      });
    }
  }

  // Session Control
  async startTracking(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      await this.trackingService.startTracking(sessionId);

      res.status(200).json({
        success: true,
        message: 'Tracking started successfully',
      });
    } catch (error) {
      logger.error('Failed to start tracking', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to start tracking',
        message: error.message,
      });
    }
  }

  async pauseTracking(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      await this.trackingService.pauseTracking(sessionId);

      res.status(200).json({
        success: true,
        message: 'Tracking paused successfully',
      });
    } catch (error) {
      logger.error('Failed to pause tracking', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to pause tracking',
        message: error.message,
      });
    }
  }

  async resumeTracking(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      await this.trackingService.resumeTracking(sessionId);

      res.status(200).json({
        success: true,
        message: 'Tracking resumed successfully',
      });
    } catch (error) {
      logger.error('Failed to resume tracking', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to resume tracking',
        message: error.message,
      });
    }
  }

  async completeTracking(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { endLocation } = req.body;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      await this.trackingService.completeTracking(sessionId, endLocation);

      res.status(200).json({
        success: true,
        message: 'Tracking completed successfully',
      });
    } catch (error) {
      logger.error('Failed to complete tracking', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to complete tracking',
        message: error.message,
      });
    }
  }

  async cancelTracking(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { reason } = req.body;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      await this.trackingService.cancelTracking(sessionId, reason);

      res.status(200).json({
        success: true,
        message: 'Tracking cancelled successfully',
      });
    } catch (error) {
      logger.error('Failed to cancel tracking', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to cancel tracking',
        message: error.message,
      });
    }
  }

  // Emergency
  async triggerEmergency(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { location, description } = req.body;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      if (!location) {
        res.status(400).json({ error: 'Location is required for emergency' });
        return;
      }

      await this.trackingService.triggerEmergency(sessionId, location, description);

      res.status(200).json({
        success: true,
        message: 'Emergency triggered successfully',
      });
    } catch (error) {
      logger.error('Failed to trigger emergency', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to trigger emergency',
        message: error.message,
      });
    }
  }

  // Geofence Management
  async createGeofenceZone(req: Request, res: Response): Promise<void> {
    try {
      const zoneData: GeofenceZoneData = req.body;

      if (!zoneData.name || !zoneData.zoneType || !zoneData.coordinates) {
        res.status(400).json({
          error: 'Missing required fields: name, zoneType, coordinates',
        });
        return;
      }

      const zone = await this.geofenceService.createGeofenceZone(zoneData);

      res.status(201).json({
        success: true,
        data: zone,
        message: 'Geofence zone created successfully',
      });
    } catch (error) {
      logger.error('Failed to create geofence zone', { error: error.message, body: req.body });
      res.status(500).json({
        error: 'Failed to create geofence zone',
        message: error.message,
      });
    }
  }

  async getGeofenceZone(req: Request, res: Response): Promise<void> {
    try {
      const { zoneId } = req.params;

      if (!zoneId) {
        res.status(400).json({ error: 'Zone ID is required' });
        return;
      }

      const zone = await this.geofenceService.getGeofenceZone(zoneId);

      res.status(200).json({
        success: true,
        data: zone,
      });
    } catch (error) {
      logger.error('Failed to get geofence zone', { error: error.message, zoneId: req.params.zoneId });
      res.status(404).json({
        error: 'Geofence zone not found',
        message: error.message,
      });
    }
  }

  async updateGeofenceZone(req: Request, res: Response): Promise<void> {
    try {
      const { zoneId } = req.params;
      const updates = req.body;

      if (!zoneId) {
        res.status(400).json({ error: 'Zone ID is required' });
        return;
      }

      const zone = await this.geofenceService.updateGeofenceZone(zoneId, updates);

      res.status(200).json({
        success: true,
        data: zone,
        message: 'Geofence zone updated successfully',
      });
    } catch (error) {
      logger.error('Failed to update geofence zone', { error: error.message, zoneId: req.params.zoneId });
      res.status(500).json({
        error: 'Failed to update geofence zone',
        message: error.message,
      });
    }
  }

  async deleteGeofenceZone(req: Request, res: Response): Promise<void> {
    try {
      const { zoneId } = req.params;

      if (!zoneId) {
        res.status(400).json({ error: 'Zone ID is required' });
        return;
      }

      await this.geofenceService.deleteGeofenceZone(zoneId);

      res.status(200).json({
        success: true,
        message: 'Geofence zone deleted successfully',
      });
    } catch (error) {
      logger.error('Failed to delete geofence zone', { error: error.message, zoneId: req.params.zoneId });
      res.status(500).json({
        error: 'Failed to delete geofence zone',
        message: error.message,
      });
    }
  }

  // Route Optimization
  async optimizeRoute(req: Request, res: Response): Promise<void> {
    try {
      const optimizationRequest: RouteOptimizationRequest = req.body;

      if (!optimizationRequest.driverId || !optimizationRequest.waypoints || !optimizationRequest.optimizationType) {
        res.status(400).json({
          error: 'Missing required fields: driverId, waypoints, optimizationType',
        });
        return;
      }

      if (optimizationRequest.waypoints.length < 2) {
        res.status(400).json({
          error: 'At least 2 waypoints are required for route optimization',
        });
        return;
      }

      const optimizedRoute = await this.routeOptimizationService.optimizeRoute(optimizationRequest);

      res.status(200).json({
        success: true,
        data: optimizedRoute,
        message: 'Route optimized successfully',
      });
    } catch (error) {
      logger.error('Failed to optimize route', { error: error.message, body: req.body });
      res.status(500).json({
        error: 'Failed to optimize route',
        message: error.message,
      });
    }
  }

  async getOptimizationResult(req: Request, res: Response): Promise<void> {
    try {
      const { optimizationId } = req.params;

      if (!optimizationId) {
        res.status(400).json({ error: 'Optimization ID is required' });
        return;
      }

      const result = await this.routeOptimizationService.getOptimizationResult(optimizationId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Failed to get optimization result', { error: error.message, optimizationId: req.params.optimizationId });
      res.status(404).json({
        error: 'Optimization result not found',
        message: error.message,
      });
    }
  }

  // Query Operations
  async getSessionsByOrder(req: Request, res: Response): Promise<void> {
    try {
      const { orderId } = req.params;

      if (!orderId) {
        res.status(400).json({ error: 'Order ID is required' });
        return;
      }

      const sessions = await this.trackingService.getSessionsByOrder(orderId);

      res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (error) {
      logger.error('Failed to get sessions by order', { error: error.message, orderId: req.params.orderId });
      res.status(500).json({
        error: 'Failed to get sessions by order',
        message: error.message,
      });
    }
  }

  async getActiveSessionsByDriver(req: Request, res: Response): Promise<void> {
    try {
      const { driverId } = req.params;

      if (!driverId) {
        res.status(400).json({ error: 'Driver ID is required' });
        return;
      }

      const sessions = await this.trackingService.getActiveSessionsByDriver(driverId);

      res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (error) {
      logger.error('Failed to get active sessions by driver', { error: error.message, driverId: req.params.driverId });
      res.status(500).json({
        error: 'Failed to get active sessions by driver',
        message: error.message,
      });
    }
  }

  async getTrackingEvents(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }

      const events = await this.trackingService.getTrackingEvents(
        sessionId,
        Number(limit),
        Number(offset)
      );

      res.status(200).json({
        success: true,
        data: events,
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          total: events.length,
        },
      });
    } catch (error) {
      logger.error('Failed to get tracking events', { error: error.message, sessionId: req.params.sessionId });
      res.status(500).json({
        error: 'Failed to get tracking events',
        message: error.message,
      });
    }
  }

  // Health Check
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({
        success: true,
        message: 'Tracking service is healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      res.status(500).json({
        error: 'Health check failed',
        message: error.message,
      });
    }
  }
}