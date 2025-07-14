import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { config, logger, connectDatabase, redis, prisma } from '@reskflow/shared';
import { IoTManager } from './services/IoTManager';
import { GeofenceService } from './services/GeofenceService';
import { TrackingProcessor } from './services/TrackingProcessor';
import { AlertService } from './services/AlertService';
import { setupMQTTBroker } from './mqtt/broker';

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: '*',
    credentials: true,
  },
});

let iotManager: IoTManager;
let geofenceService: GeofenceService;
let trackingProcessor: TrackingProcessor;
let alertService: AlertService;

async function startService() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Tracking service: Database connected');

    // Initialize services
    iotManager = new IoTManager();
    geofenceService = new GeofenceService();
    trackingProcessor = new TrackingProcessor();
    alertService = new AlertService();

    // Setup MQTT broker for IoT devices
    await setupMQTTBroker();

    // Initialize IoT connections
    await iotManager.initialize();

    // Socket.IO connection handling
    io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // Subscribe to reskflow tracking
      socket.on('track:reskflow', async (reskflowId: string) => {
        socket.join(`reskflow:${reskflowId}`);
        
        // Send current location if available
        const currentLocation = await redis.getJson(`location:reskflow:${reskflowId}`);
        if (currentLocation) {
          socket.emit('location:update', {
            reskflowId,
            location: currentLocation,
          });
        }
      });

      // Subscribe to driver tracking
      socket.on('track:driver', async (driverId: string) => {
        socket.join(`driver:${driverId}`);
        
        const currentLocation = await redis.getJson(`location:driver:${driverId}`);
        if (currentLocation) {
          socket.emit('driver:location', {
            driverId,
            location: currentLocation,
          });
        }
      });

      // Handle driver location updates
      socket.on('location:update', async (data: any) => {
        await handleLocationUpdate(data);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });

    // REST API endpoints
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'tracking' });
    });

    // Get reskflow tracking history
    app.get('/tracking/:reskflowId', async (req, res) => {
      try {
        const { reskflowId } = req.params;
        
        const trackingHistory = await prisma.trackingEvent.findMany({
          where: { reskflowId },
          orderBy: { createdAt: 'desc' },
        });

        const currentLocation = await redis.getJson(`location:reskflow:${reskflowId}`);

        res.json({
          reskflowId,
          currentLocation,
          history: trackingHistory,
        });
      } catch (error) {
        logger.error('Failed to get tracking history', error);
        res.status(500).json({ error: 'Failed to get tracking data' });
      }
    });

    // Create geofence
    app.post('/geofence', async (req, res) => {
      try {
        const { reskflowId, type, coordinates, radius } = req.body;
        
        const geofence = await geofenceService.createGeofence({
          reskflowId,
          type,
          coordinates,
          radius,
        });

        res.json(geofence);
      } catch (error) {
        logger.error('Failed to create geofence', error);
        res.status(500).json({ error: 'Failed to create geofence' });
      }
    });

    // Get IoT device status
    app.get('/devices/:deviceId/status', async (req, res) => {
      try {
        const { deviceId } = req.params;
        const status = await iotManager.getDeviceStatus(deviceId);
        res.json(status);
      } catch (error) {
        logger.error('Failed to get device status', error);
        res.status(500).json({ error: 'Failed to get device status' });
      }
    });

    // Start tracking processor
    trackingProcessor.startProcessing();

    // Start server
    const PORT = 3003;
    httpServer.listen(PORT, () => {
      logger.info(`📍 Tracking service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start tracking service', error);
    process.exit(1);
  }
}

async function handleLocationUpdate(data: any) {
  try {
    const { deviceId, location, metadata } = data;

    // Process location update
    const processed = await trackingProcessor.processLocationUpdate({
      deviceId,
      location,
      metadata,
    });

    // Check geofences
    const geofenceEvents = await geofenceService.checkGeofences(
      processed.entityId,
      location
    );

    // Handle geofence events
    for (const event of geofenceEvents) {
      await alertService.handleGeofenceEvent(event);
    }

    // Update real-time location
    const entityType = processed.entityType;
    const entityId = processed.entityId;

    await redis.setJson(
      `location:${entityType}:${entityId}`,
      {
        ...location,
        lastUpdated: new Date(),
        metadata,
      },
      300 // 5 minutes TTL
    );

    // Broadcast location update
    io.to(`${entityType}:${entityId}`).emit('location:update', {
      entityId,
      location,
      timestamp: new Date(),
    });

    // Store in time-series database for analytics
    await storeLocationHistory({
      entityType,
      entityId,
      location,
      metadata,
    });

  } catch (error) {
    logger.error('Failed to handle location update', error);
  }
}

async function storeLocationHistory(data: any) {
  try {
    // In production, use a time-series database like InfluxDB or TimescaleDB
    const key = `location:history:${data.entityType}:${data.entityId}`;
    const history = await redis.getJson(key) || [];
    
    history.push({
      location: data.location,
      timestamp: new Date(),
      metadata: data.metadata,
    });

    // Keep only last 100 points
    if (history.length > 100) {
      history.shift();
    }

    await redis.setJson(key, history, 3600); // 1 hour TTL
  } catch (error) {
    logger.error('Failed to store location history', error);
  }
}

// IoT device message handler
iotManager.on('message', async (topic: string, message: any) => {
  try {
    const { deviceId, type, data } = message;

    switch (type) {
      case 'location':
        await handleLocationUpdate({
          deviceId,
          location: data.location,
          metadata: data.metadata,
        });
        break;

      case 'sensor':
        await trackingProcessor.processSensorData({
          deviceId,
          sensorType: data.sensorType,
          value: data.value,
          timestamp: data.timestamp,
        });
        break;

      case 'alert':
        await alertService.handleDeviceAlert({
          deviceId,
          alertType: data.alertType,
          severity: data.severity,
          message: data.message,
        });
        break;

      default:
        logger.warn(`Unknown message type: ${type}`);
    }
  } catch (error) {
    logger.error('Failed to process IoT message', error);
  }
});

startService();