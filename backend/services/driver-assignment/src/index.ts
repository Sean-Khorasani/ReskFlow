import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { ZoneService } from './services/ZoneService';
import { DriverPoolService } from './services/DriverPoolService';
import { AssignmentService } from './services/AssignmentService';
import { OptimizationService } from './services/OptimizationService';
import { RealTimeTrackingService } from './services/RealTimeTrackingService';
import { authenticate } from '@reskflow/shared';
import Bull from 'bull';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

let zoneService: ZoneService;
let driverPoolService: DriverPoolService;
let assignmentService: AssignmentService;
let optimizationService: OptimizationService;
let trackingService: RealTimeTrackingService;

// Initialize queues
const assignmentQueue = new Bull('driver-assignment', {
  redis: config.redis.url,
});

const optimizationQueue = new Bull('route-optimization', {
  redis: config.redis.url,
});

async function startService() {
  try {
    await connectDatabase();
    logger.info('Driver Assignment service: Database connected');

    // Initialize services
    zoneService = new ZoneService();
    driverPoolService = new DriverPoolService(io);
    optimizationService = new OptimizationService();
    assignmentService = new AssignmentService(
      zoneService,
      driverPoolService,
      optimizationService,
      assignmentQueue
    );
    trackingService = new RealTimeTrackingService(io, driverPoolService);

    // Initialize zones
    await zoneService.initializeZones();

    // Process queues
    assignmentQueue.process(async (job) => {
      return assignmentService.processAssignmentJob(job.data);
    });

    optimizationQueue.process(async (job) => {
      return optimizationService.processOptimizationJob(job.data);
    });

    // WebSocket connections
    io.on('connection', (socket) => {
      logger.info(`Driver connected: ${socket.id}`);

      socket.on('driver:authenticate', async (data) => {
        const { driverId, token } = data;
        const isValid = await driverPoolService.authenticateDriver(driverId, token);
        
        if (isValid) {
          socket.join(`driver:${driverId}`);
          await driverPoolService.onDriverConnect(driverId, socket.id);
          socket.emit('authenticated', { success: true });
        } else {
          socket.emit('authenticated', { success: false });
          socket.disconnect();
        }
      });

      socket.on('driver:location', async (data) => {
        await trackingService.updateDriverLocation(data);
      });

      socket.on('driver:status', async (data) => {
        await driverPoolService.updateDriverStatus(data.driverId, data.status);
      });

      socket.on('disconnect', async () => {
        await driverPoolService.onDriverDisconnect(socket.id);
      });
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'driver-assignment' });
    });

    // Get available drivers in zone
    app.get('/zones/:zoneId/drivers', authenticate, async (req, res) => {
      try {
        const { zoneId } = req.params;
        const { status } = req.query;

        const drivers = await driverPoolService.getDriversInZone(
          zoneId,
          status as string
        );

        res.json(drivers);
      } catch (error) {
        logger.error('Failed to get zone drivers', error);
        res.status(500).json({ error: 'Failed to get drivers' });
      }
    });

    // Assign driver to order
    app.post('/assign', authenticate, async (req, res) => {
      try {
        const { orderId, strategy = 'proximity' } = req.body;

        const assignment = await assignmentService.assignDriver(
          orderId,
          strategy
        );

        res.json(assignment);
      } catch (error) {
        logger.error('Failed to assign driver', error);
        res.status(500).json({ error: 'Failed to assign driver' });
      }
    });

    // Reassign order to different driver
    app.post('/reassign', authenticate, async (req, res) => {
      try {
        const { orderId, reason } = req.body;

        const reassignment = await assignmentService.reassignOrder(
          orderId,
          reason
        );

        res.json(reassignment);
      } catch (error) {
        logger.error('Failed to reassign order', error);
        res.status(500).json({ error: 'Failed to reassign order' });
      }
    });

    // Get driver's current assignments
    app.get('/drivers/:driverId/assignments', authenticate, async (req, res) => {
      try {
        const { driverId } = req.params;
        const assignments = await assignmentService.getDriverAssignments(driverId);
        res.json(assignments);
      } catch (error) {
        logger.error('Failed to get driver assignments', error);
        res.status(500).json({ error: 'Failed to get assignments' });
      }
    });

    // Update driver availability
    app.put('/drivers/:driverId/availability', authenticate, async (req, res) => {
      try {
        const { driverId } = req.params;
        const { available, shiftEnd } = req.body;

        await driverPoolService.updateDriverAvailability(
          driverId,
          available,
          shiftEnd
        );

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to update driver availability', error);
        res.status(500).json({ error: 'Failed to update availability' });
      }
    });

    // Get zone statistics
    app.get('/zones/:zoneId/stats', authenticate, async (req, res) => {
      try {
        const { zoneId } = req.params;
        const stats = await zoneService.getZoneStatistics(zoneId);
        res.json(stats);
      } catch (error) {
        logger.error('Failed to get zone stats', error);
        res.status(500).json({ error: 'Failed to get stats' });
      }
    });

    // Optimize routes for driver
    app.post('/optimize-route', authenticate, async (req, res) => {
      try {
        const { driverId, orderIds } = req.body;

        const optimizedRoute = await optimizationService.optimizeRoute(
          driverId,
          orderIds
        );

        res.json(optimizedRoute);
      } catch (error) {
        logger.error('Failed to optimize route', error);
        res.status(500).json({ error: 'Failed to optimize route' });
      }
    });

    // Get real-time driver locations
    app.get('/drivers/locations', authenticate, async (req, res) => {
      try {
        const { bounds } = req.query;
        const locations = await trackingService.getDriverLocations(
          bounds ? JSON.parse(bounds as string) : undefined
        );
        res.json(locations);
      } catch (error) {
        logger.error('Failed to get driver locations', error);
        res.status(500).json({ error: 'Failed to get locations' });
      }
    });

    // Admin: Zone management
    app.post('/admin/zones', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const zone = await zoneService.createZone(req.body);
        res.json(zone);
      } catch (error) {
        logger.error('Failed to create zone', error);
        res.status(500).json({ error: 'Failed to create zone' });
      }
    });

    app.put('/admin/zones/:zoneId', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { zoneId } = req.params;
        const zone = await zoneService.updateZone(zoneId, req.body);
        res.json(zone);
      } catch (error) {
        logger.error('Failed to update zone', error);
        res.status(500).json({ error: 'Failed to update zone' });
      }
    });

    // Analytics endpoints
    app.get('/analytics/assignment-metrics', authenticate, async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const metrics = await assignmentService.getAssignmentMetrics(
          startDate as string,
          endDate as string
        );
        res.json(metrics);
      } catch (error) {
        logger.error('Failed to get assignment metrics', error);
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    app.get('/analytics/driver-performance', authenticate, async (req, res) => {
      try {
        const { driverId, period = '7d' } = req.query;
        const performance = await driverPoolService.getDriverPerformance(
          driverId as string,
          period as string
        );
        res.json(performance);
      } catch (error) {
        logger.error('Failed to get driver performance', error);
        res.status(500).json({ error: 'Failed to get performance' });
      }
    });

    // Schedule periodic optimization
    setInterval(async () => {
      await optimizationService.runPeriodicOptimization();
    }, 5 * 60 * 1000); // Every 5 minutes

    const PORT = 3015;
    httpServer.listen(PORT, () => {
      logger.info(`🚗 Driver Assignment service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start driver assignment service', error);
    process.exit(1);
  }
}

startService();