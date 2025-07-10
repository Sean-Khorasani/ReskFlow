import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { TemperatureMonitoringService } from './services/TemperatureMonitoringService';
import { AlertService } from './services/AlertService';
import { DeviceManager } from './services/DeviceManager';
import { ComplianceReportingService } from './services/ComplianceReportingService';
import { PredictiveAnalyticsService } from './services/PredictiveAnalyticsService';
import { TemperatureZoneService } from './services/TemperatureZoneService';
import cron from 'node-cron';

const app = express();
app.use(express.json());

// Create HTTP server and Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// Initialize queues
const temperatureQueue = new Bull('temperature-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const alertQueue = new Bull('alert-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const deviceManager = new DeviceManager();
const alertService = new AlertService(alertQueue, io);
const temperatureZoneService = new TemperatureZoneService();
const complianceReportingService = new ComplianceReportingService();
const predictiveAnalyticsService = new PredictiveAnalyticsService();
const temperatureMonitoringService = new TemperatureMonitoringService(
  deviceManager,
  alertService,
  temperatureZoneService,
  temperatureQueue,
  io
);

// Temperature monitoring routes
app.post('/api/temperature/reading', authMiddleware, async (req, res) => {
  try {
    const { deviceId, temperature, humidity, batteryLevel, location } = req.body;
    
    const reading = await temperatureMonitoringService.recordReading({
      deviceId,
      temperature,
      humidity,
      batteryLevel,
      location,
      timestamp: new Date(),
    });
    
    res.json(reading);
  } catch (error) {
    logger.error('Error recording temperature:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/temperature/history/:orderId', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { startTime, endTime } = req.query;
    
    const history = await temperatureMonitoringService.getTemperatureHistory({
      orderId,
      startTime: startTime as string,
      endTime: endTime as string,
    });
    
    res.json(history);
  } catch (error) {
    logger.error('Error getting temperature history:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/temperature/current/:orderId', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const current = await temperatureMonitoringService.getCurrentTemperature(orderId);
    
    res.json(current);
  } catch (error) {
    logger.error('Error getting current temperature:', error);
    res.status(400).json({ error: error.message });
  }
});

// Device management routes
app.post('/api/devices/register', authMiddleware, async (req, res) => {
  try {
    const { deviceType, serialNumber, vehicleId } = req.body;
    
    const device = await deviceManager.registerDevice({
      deviceType,
      serialNumber,
      vehicleId,
      ownerId: req.user.id,
    });
    
    res.json(device);
  } catch (error) {
    logger.error('Error registering device:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/devices/:deviceId/calibrate', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { calibrationData } = req.body;
    
    const result = await deviceManager.calibrateDevice(deviceId, calibrationData);
    
    res.json(result);
  } catch (error) {
    logger.error('Error calibrating device:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/devices/status/:deviceId', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const status = await deviceManager.getDeviceStatus(deviceId);
    
    res.json(status);
  } catch (error) {
    logger.error('Error getting device status:', error);
    res.status(400).json({ error: error.message });
  }
});

// Alert management routes
app.get('/api/alerts/active', authMiddleware, async (req, res) => {
  try {
    const { orderId, severity } = req.query;
    
    const alerts = await alertService.getActiveAlerts({
      orderId: orderId as string,
      severity: severity as string,
    });
    
    res.json(alerts);
  } catch (error) {
    logger.error('Error getting active alerts:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/alerts/:alertId/acknowledge', authMiddleware, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { notes } = req.body;
    
    const result = await alertService.acknowledgeAlert(alertId, req.user.id, notes);
    
    res.json(result);
  } catch (error) {
    logger.error('Error acknowledging alert:', error);
    res.status(400).json({ error: error.message });
  }
});

// Compliance reports
app.get('/api/compliance/report/:orderId', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const report = await complianceReportingService.generateReport(orderId);
    
    res.json(report);
  } catch (error) {
    logger.error('Error generating compliance report:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/compliance/violations', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, severity } = req.query;
    
    const violations = await complianceReportingService.getViolations({
      startDate: startDate as string,
      endDate: endDate as string,
      severity: severity as string,
    });
    
    res.json(violations);
  } catch (error) {
    logger.error('Error getting violations:', error);
    res.status(500).json({ error: 'Failed to get violations' });
  }
});

// Analytics routes
app.get('/api/analytics/predictions/:vehicleId', authMiddleware, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    
    const predictions = await predictiveAnalyticsService.predictTemperatureIssues(vehicleId);
    
    res.json(predictions);
  } catch (error) {
    logger.error('Error getting predictions:', error);
    res.status(500).json({ error: 'Failed to get predictions' });
  }
});

app.get('/api/analytics/performance', authMiddleware, async (req, res) => {
  try {
    const { driverId, period } = req.query;
    
    const performance = await predictiveAnalyticsService.analyzeDriverPerformance(
      driverId as string,
      period as string
    );
    
    res.json(performance);
  } catch (error) {
    logger.error('Error analyzing performance:', error);
    res.status(500).json({ error: 'Failed to analyze performance' });
  }
});

// WebSocket connections for real-time monitoring
io.use(async (socket, next) => {
  try {
    // Authenticate WebSocket connection
    const token = socket.handshake.auth.token;
    // Verify token (implementation depends on auth method)
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);

  socket.on('monitor:order', async (orderId) => {
    // Join order-specific room for real-time updates
    socket.join(`order:${orderId}`);
    
    // Send current temperature
    const current = await temperatureMonitoringService.getCurrentTemperature(orderId);
    socket.emit('temperature:current', current);
  });

  socket.on('monitor:vehicle', async (vehicleId) => {
    // Join vehicle-specific room
    socket.join(`vehicle:${vehicleId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });
});

// Process queues
temperatureQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'analyze-reading':
      await temperatureMonitoringService.analyzeReading(data);
      break;
    case 'check-compliance':
      await complianceReportingService.checkCompliance(data);
      break;
    case 'predict-failure':
      await predictiveAnalyticsService.predictEquipmentFailure(data);
      break;
  }
});

alertQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'send-alert':
      await alertService.sendAlert(data);
      break;
    case 'escalate-alert':
      await alertService.escalateAlert(data);
      break;
  }
});

// Scheduled tasks
// Check device health every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  logger.info('Running device health check');
  await deviceManager.checkAllDeviceHealth();
});

// Generate daily compliance reports
cron.schedule('0 2 * * *', async () => {
  logger.info('Generating daily compliance reports');
  await complianceReportingService.generateDailyReports();
});

// Clean up old data weekly
cron.schedule('0 3 * * 0', async () => {
  logger.info('Cleaning up old temperature data');
  await temperatureMonitoringService.cleanupOldData();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'temperature-monitoring' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3019;

async function start() {
  try {
    await connectDB();
    
    httpServer.listen(PORT, () => {
      logger.info(`Temperature monitoring service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();