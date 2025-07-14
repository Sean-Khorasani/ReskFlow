import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { MetricsCollector } from './services/MetricsCollector';
import { LogAggregator } from './services/LogAggregator';
import { AlertManager } from './services/AlertManager';
import { TracingService } from './services/TracingService';
import { createClient } from 'redis';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },
});

app.use(express.json());

// Initialize Redis
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

// Initialize services
const metricsCollector = new MetricsCollector();
const logAggregator = new LogAggregator();
const alertManager = new AlertManager();
const tracingService = new TracingService('monitoring-service');

// Middleware to track requests
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    metricsCollector.recordRequest(
      'monitoring',
      req.method,
      req.path,
      res.statusCode,
      duration
    );
  });
  
  next();
});

// Metrics endpoints
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await metricsCollector.getMetrics();
    res.set('Content-Type', metricsCollector.getContentType());
    res.send(metrics);
  } catch (error) {
    logger.error('Error getting metrics:', error);
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

app.post('/api/metrics/record', authMiddleware, async (req, res) => {
  try {
    const { service, metric, value, labels } = req.body;
    
    metricsCollector.recordMetric(metric, value, 'custom', labels);
    
    // Evaluate alerts for this metric
    await alertManager.evaluateMetric(metric, value, labels);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error recording metric:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/metrics/business', authMiddleware, async (req, res) => {
  try {
    const metrics = await metricsCollector.collectBusinessMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Error collecting business metrics:', error);
    res.status(500).json({ error: 'Failed to collect business metrics' });
  }
});

// Logging endpoints
app.post('/api/logs', authMiddleware, async (req, res) => {
  try {
    const logEntry = {
      ...req.body,
      timestamp: new Date(),
    };
    
    await logAggregator.log(logEntry);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error logging entry:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/logs/search', authMiddleware, async (req, res) => {
  try {
    const logs = await logAggregator.searchLogs(req.body);
    res.json(logs);
  } catch (error) {
    logger.error('Error searching logs:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/logs/analyze', authMiddleware, async (req, res) => {
  try {
    const analysis = await logAggregator.analyzeLogs(req.body);
    res.json(analysis);
  } catch (error) {
    logger.error('Error analyzing logs:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/logs/service/:service/health', authMiddleware, async (req, res) => {
  try {
    const health = await logAggregator.getServiceHealth(req.params.service);
    res.json(health);
  } catch (error) {
    logger.error('Error getting service health:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/logs/aggregate', authMiddleware, async (req, res) => {
  try {
    const aggregated = await logAggregator.aggregateLogs(req.body);
    res.json(aggregated);
  } catch (error) {
    logger.error('Error aggregating logs:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/logs/export', authMiddleware, async (req, res) => {
  try {
    const exported = await logAggregator.exportLogs(req.body);
    
    if (req.body.format === 'csv') {
      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', 'attachment; filename=logs.csv');
    } else {
      res.set('Content-Type', 'application/json');
      res.set('Content-Disposition', 'attachment; filename=logs.json');
    }
    
    res.send(exported);
  } catch (error) {
    logger.error('Error exporting logs:', error);
    res.status(400).json({ error: error.message });
  }
});

// Alert endpoints
app.post('/api/alerts/rules', authMiddleware, async (req, res) => {
  try {
    const rule = await alertManager.createRule(req.body);
    res.json(rule);
  } catch (error) {
    logger.error('Error creating alert rule:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/alerts/rules/:ruleId', authMiddleware, async (req, res) => {
  try {
    const rule = await alertManager.updateRule(req.params.ruleId, req.body);
    res.json(rule);
  } catch (error) {
    logger.error('Error updating alert rule:', error);
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/alerts/rules/:ruleId', authMiddleware, async (req, res) => {
  try {
    await alertManager.deleteRule(req.params.ruleId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting alert rule:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/alerts/trigger', authMiddleware, async (req, res) => {
  try {
    const alert = await alertManager.triggerAlert(req.body);
    res.json(alert);
  } catch (error) {
    logger.error('Error triggering alert:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/alerts/:alertId/acknowledge', authMiddleware, async (req, res) => {
  try {
    await alertManager.acknowledgeAlert(req.params.alertId, req.user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error acknowledging alert:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/alerts/:alertId/resolve', authMiddleware, async (req, res) => {
  try {
    await alertManager.resolveAlert(req.params.alertId, req.body.reason);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error resolving alert:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/alerts/active', authMiddleware, async (req, res) => {
  try {
    const alerts = await alertManager.getActiveAlerts(req.query);
    res.json(alerts);
  } catch (error) {
    logger.error('Error getting active alerts:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/alerts/history', authMiddleware, async (req, res) => {
  try {
    const history = await alertManager.getAlertHistory(req.body);
    res.json(history);
  } catch (error) {
    logger.error('Error getting alert history:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/alerts/statistics', authMiddleware, async (req, res) => {
  try {
    const stats = await alertManager.getAlertStatistics(req.body);
    res.json(stats);
  } catch (error) {
    logger.error('Error getting alert statistics:', error);
    res.status(400).json({ error: error.message });
  }
});

// Tracing endpoints
app.get('/api/trace/context', authMiddleware, (req, res) => {
  const context = tracingService.getCurrentTraceContext();
  res.json(context || { message: 'No active trace' });
});

app.post('/api/trace/correlate', authMiddleware, (req, res) => {
  try {
    const correlationId = tracingService.correlateTraces(req.body.traces);
    res.json({ correlationId });
  } catch (error) {
    logger.error('Error correlating traces:', error);
    res.status(400).json({ error: error.message });
  }
});

// Dashboard endpoint
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const [businessMetrics, activeAlerts, serviceHealth] = await Promise.all([
      metricsCollector.collectBusinessMetrics(),
      alertManager.getActiveAlerts(),
      Promise.all([
        'user', 'payment', 'reskflow', 'merchant', 'notification'
      ].map(service => logAggregator.getServiceHealth(service))),
    ]);

    res.json({
      metrics: businessMetrics,
      alerts: activeAlerts,
      services: serviceHealth,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error getting dashboard data:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// Socket.io for real-time monitoring
io.on('connection', (socket) => {
  logger.info('Client connected to monitoring service');

  socket.on('subscribe-metrics', (services: string[]) => {
    services.forEach(service => {
      socket.join(`metrics:${service}`);
    });
  });

  socket.on('subscribe-alerts', (filters: any) => {
    socket.join('alerts:all');
    if (filters.severity) {
      socket.join(`alerts:${filters.severity}`);
    }
  });

  socket.on('subscribe-logs', (service: string) => {
    socket.join(`logs:${service}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected from monitoring service');
  });
});

// Event handlers
metricsCollector.on('metrics-collected', (metrics) => {
  io.to('metrics:all').emit('metrics-update', metrics);
});

logAggregator.on('log-entry', (entry) => {
  io.to(`logs:${entry.service}`).emit('new-log', entry);
});

logAggregator.on('critical-error', (entry) => {
  io.emit('critical-error', entry);
});

alertManager.on('alert-created', (alert) => {
  io.to('alerts:all').emit('new-alert', alert);
  io.to(`alerts:${alert.severity}`).emit('new-alert', alert);
});

alertManager.on('alert-resolved', (alert) => {
  io.to('alerts:all').emit('alert-resolved', alert);
});

// Register services for monitoring
const services = [
  'user', 'merchant', 'catalog', 'cart', 'payment', 'reskflow',
  'tracking', 'notification', 'analytics', 'recommendation',
  'search', 'quality-control', 'blockchain', 'optimization',
];

services.forEach(service => {
  metricsCollector.registerService(service);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'monitoring',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  metricsCollector.recordError('monitoring', 'unhandled_error', err.code || 'unknown');
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  await alertManager.shutdown();
  await tracingService.shutdown();
  await redisClient.quit();
  
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3023;

async function start() {
  try {
    await connectDB();
    await redisClient.connect();
    
    httpServer.listen(PORT, () => {
      logger.info(`Monitoring service running on port ${PORT}`);
      logger.info(`Metrics available at http://localhost:${PORT}/metrics`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();