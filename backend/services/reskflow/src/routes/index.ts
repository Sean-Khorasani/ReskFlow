import { Application } from 'express';
import { DeliveryService } from '../services/reskflow.service';
import { DriverService } from '../services/driver.service';
import { TrackingService } from '../services/tracking.service';
import { RouteService } from '../services/route.service';
import { DeliveryController } from '../controllers/reskflow.controller';
import { DriverController } from '../controllers/driver.controller';
import { TrackingController } from '../controllers/tracking.controller';
import { NotificationService } from '@reskflow/shared';
import { setupDeliveryRoutes } from './reskflow.routes';
import { setupDriverRoutes } from './driver.routes';
import { setupTrackingRoutes } from './tracking.routes';
import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger';

/**
 * Set up all routes for the reskflow service
 */
export function setupRoutes(app: Application, io?: SocketIOServer): void {
  try {
    // Initialize services
    const reskflowService = new DeliveryService();
    const driverService = new DriverService();
    const trackingService = new TrackingService();
    const routeService = new RouteService();
    const notificationService = new NotificationService();

    // Initialize controllers
    const reskflowController = new DeliveryController(
      reskflowService,
      trackingService,
      routeService,
      notificationService
    );

    const driverController = new DriverController(
      driverService,
      trackingService,
      routeService,
      notificationService
    );

    const trackingController = new TrackingController(
      trackingService,
      reskflowService,
      driverService,
      notificationService
    );

    // Set Socket.IO instance for real-time updates
    if (io) {
      trackingController.setSocketIO(io);
    }

    // API versioning
    const API_PREFIX = '/api/v1';

    // Health check route
    app.get(`${API_PREFIX}/health`, (req, res) => {
      res.status(200).json({
        status: 'healthy',
        service: 'reskflow-service',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
      });
    });

    // Service-specific health checks
    app.get(`${API_PREFIX}/health/detailed`, async (req, res) => {
      try {
        const checks = {
          database: 'healthy',
          redis: 'healthy',
          rabbitmq: 'healthy',
          googleMaps: 'healthy',
        };

        // TODO: Implement actual health checks for each service
        // const dbHealth = await checkDatabaseHealth();
        // const redisHealth = await checkRedisHealth();
        // const rabbitmqHealth = await checkRabbitMQHealth();
        // const mapsHealth = await checkGoogleMapsHealth();

        const overallStatus = Object.values(checks).every(status => status === 'healthy') 
          ? 'healthy' 
          : 'unhealthy';

        res.status(overallStatus === 'healthy' ? 200 : 503).json({
          status: overallStatus,
          service: 'reskflow-service',
          timestamp: new Date().toISOString(),
          checks,
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          service: 'reskflow-service',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Metrics endpoint for monitoring
    app.get(`${API_PREFIX}/metrics`, (req, res) => {
      // TODO: Implement metrics collection
      res.json({
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        timestamp: new Date().toISOString(),
      });
    });

    // Setup feature routes
    setupDeliveryRoutes(app, reskflowController, API_PREFIX);
    setupDriverRoutes(app, driverController, API_PREFIX);
    setupTrackingRoutes(app, trackingController, API_PREFIX);

    // API documentation route
    app.get(`${API_PREFIX}/docs`, (req, res) => {
      res.json({
        service: 'reskflow-service',
        version: '1.0.0',
        description: 'Delivery management service for ReskFlow platform',
        endpoints: {
          deliveries: {
            base: `${API_PREFIX}/deliveries`,
            description: 'Delivery management endpoints',
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
          },
          drivers: {
            base: `${API_PREFIX}/drivers`,
            description: 'Driver management endpoints',
            methods: ['GET', 'POST', 'PUT'],
          },
          tracking: {
            base: `${API_PREFIX}/tracking`,
            description: 'Real-time tracking endpoints',
            methods: ['GET', 'POST'],
          },
        },
        websocket: {
          enabled: !!io,
          events: ['trackingEvent', 'locationUpdate', 'statusUpdate'],
        },
        documentation: {
          openapi: `${API_PREFIX}/openapi.json`,
          swagger: `${API_PREFIX}/swagger`,
        },
      });
    });

    // OpenAPI specification endpoint
    app.get(`${API_PREFIX}/openapi.json`, (req, res) => {
      // TODO: Generate OpenAPI specification
      res.json({
        openapi: '3.0.0',
        info: {
          title: 'Delivery Service API',
          version: '1.0.0',
          description: 'API for reskflow management service',
        },
        servers: [
          {
            url: `${req.protocol}://${req.get('host')}${API_PREFIX}`,
            description: 'Current server',
          },
        ],
        paths: {},
        components: {},
      });
    });

    // Rate limiting info endpoint
    app.get(`${API_PREFIX}/rate-limits`, (req, res) => {
      res.json({
        general: {
          windowMs: 15 * 60 * 1000,
          max: 200,
          message: 'General API rate limit',
        },
        reskflowCreation: {
          windowMs: 15 * 60 * 1000,
          max: 50,
          message: 'Delivery creation rate limit',
        },
        locationUpdates: {
          windowMs: 1 * 60 * 1000,
          max: 100,
          message: 'Location update rate limit',
        },
        tracking: {
          windowMs: 15 * 60 * 1000,
          max: 300,
          message: 'Tracking API rate limit',
        },
      });
    });

    // Service status endpoint
    app.get(`${API_PREFIX}/status`, (req, res) => {
      res.json({
        service: 'reskflow-service',
        status: 'operational',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        features: {
          deliveries: 'enabled',
          drivers: 'enabled',
          tracking: 'enabled',
          realtime: !!io ? 'enabled' : 'disabled',
          routes: 'enabled',
          analytics: 'enabled',
        },
      });
    });

    // Error handling for unmatched API routes
    app.use(`${API_PREFIX}/*`, (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `API endpoint ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
          `${API_PREFIX}/deliveries`,
          `${API_PREFIX}/drivers`,
          `${API_PREFIX}/tracking`,
          `${API_PREFIX}/health`,
          `${API_PREFIX}/docs`,
        ],
      });
    });

    logger.info('Routes setup completed successfully', {
      apiPrefix: API_PREFIX,
      socketIOEnabled: !!io,
      routesCount: {
        deliveries: 'multiple',
        drivers: 'multiple',
        tracking: 'multiple',
        utility: 7,
      },
    });
  } catch (error) {
    logger.error('Failed to setup routes', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Setup WebSocket event handlers
 */
export function setupWebSocketHandlers(io: SocketIOServer): void {
  io.on('connection', (socket) => {
    logger.debug('Client connected to WebSocket', {
      socketId: socket.id,
      clientAddress: socket.handshake.address,
    });

    // Handle authentication
    socket.on('authenticate', (data) => {
      try {
        const { token, userId, role } = data;
        
        // TODO: Validate JWT token
        // const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Store user info in socket
        socket.data.userId = userId;
        socket.data.role = role;
        socket.data.authenticated = true;

        // Join user-specific room
        socket.join(`user:${userId}`);

        socket.emit('authenticated', { success: true });
        
        logger.debug('Client authenticated', {
          socketId: socket.id,
          userId,
          role,
        });
      } catch (error) {
        socket.emit('authError', { message: 'Authentication failed' });
        logger.warn('Client authentication failed', {
          socketId: socket.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Handle reskflow subscription
    socket.on('subscribeToDelivery', (data) => {
      try {
        const { reskflowId } = data;
        
        if (!socket.data.authenticated) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        // TODO: Validate user can access this reskflow
        
        socket.join(`reskflow:${reskflowId}`);
        socket.emit('subscribed', { reskflowId });
        
        logger.debug('Client subscribed to reskflow', {
          socketId: socket.id,
          userId: socket.data.userId,
          reskflowId,
        });
      } catch (error) {
        socket.emit('error', { message: 'Subscription failed' });
        logger.warn('Delivery subscription failed', {
          socketId: socket.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Handle unsubscription
    socket.on('unsubscribeFromDelivery', (data) => {
      const { reskflowId } = data;
      socket.leave(`reskflow:${reskflowId}`);
      socket.emit('unsubscribed', { reskflowId });
      
      logger.debug('Client unsubscribed from reskflow', {
        socketId: socket.id,
        userId: socket.data.userId,
        reskflowId,
      });
    });

    // Handle location sharing (for drivers)
    socket.on('shareLocation', async (data) => {
      try {
        if (!socket.data.authenticated || socket.data.role !== 'driver') {
          socket.emit('error', { message: 'Unauthorized' });
          return;
        }

        const { lat, lng, heading, speed, accuracy } = data;
        
        // TODO: Update driver location in real-time
        // await updateDriverLocationRealTime(socket.data.userId, { lat, lng, heading, speed, accuracy });
        
        // Broadcast to relevant reskflow rooms
        // TODO: Get active deliveries for this driver and broadcast location
        
        logger.debug('Driver location shared', {
          socketId: socket.id,
          driverId: socket.data.userId,
          location: { lat, lng },
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to share location' });
        logger.warn('Location sharing failed', {
          socketId: socket.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.debug('Client disconnected', {
        socketId: socket.id,
        userId: socket.data.userId,
        reason,
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('WebSocket error', {
        socketId: socket.id,
        userId: socket.data.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  });

  logger.info('WebSocket handlers setup completed');
}