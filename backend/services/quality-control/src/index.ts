import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { AccuracyTrackingService } from './services/AccuracyTrackingService';
import { QualityMonitoringService } from './services/QualityMonitoringService';
import { FeedbackCollectionService } from './services/FeedbackCollectionService';
import { CompensationService } from './services/CompensationService';
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

// Initialize queues
const qualityQueue = new Bull('quality-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const accuracyTrackingService = new AccuracyTrackingService();
const qualityMonitoringService = new QualityMonitoringService();
const feedbackCollectionService = new FeedbackCollectionService();
const compensationService = new CompensationService();

// Accuracy tracking routes
app.post('/api/accuracy/report-issue', authMiddleware, async (req, res) => {
  try {
    const { orderId, issues, receivedItems, photoEvidence } = req.body;
    
    const report = await accuracyTrackingService.reportOrderIssue({
      orderId,
      customerId: req.user.id,
      issues,
      receivedItems,
      photoEvidence,
    });
    
    res.json(report);
  } catch (error) {
    logger.error('Error reporting issue:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accuracy/verify', authMiddleware, async (req, res) => {
  try {
    const { orderId, photoEvidence } = req.body;
    
    const result = await accuracyTrackingService.verifyOrderAccuracy({
      orderId,
      customerId: req.user.id,
      photoEvidence,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error verifying accuracy:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/accuracy/merchant/:merchantId/metrics', authMiddleware, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { start, end } = req.query;
    
    const metrics = await accuracyTrackingService.getMerchantAccuracyMetrics(
      merchantId,
      {
        start: new Date(start as string),
        end: new Date(end as string),
      }
    );
    
    res.json(metrics);
  } catch (error) {
    logger.error('Error getting accuracy metrics:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/accuracy/report/:reportId/resolve', authMiddleware, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { resolution, compensationAmount, notes } = req.body;
    
    const report = await accuracyTrackingService.resolveAccuracyReport({
      reportId,
      merchantId: req.user.merchantId,
      resolution,
      compensationAmount,
      notes,
    });
    
    res.json(report);
  } catch (error) {
    logger.error('Error resolving report:', error);
    res.status(400).json({ error: error.message });
  }
});

// Quality monitoring routes
app.get('/api/quality/metrics/:merchantId', authMiddleware, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { start, end } = req.query;
    
    const metrics = await qualityMonitoringService.getQualityMetrics(
      merchantId,
      start && end ? {
        start: new Date(start as string),
        end: new Date(end as string),
      } : undefined
    );
    
    res.json(metrics);
  } catch (error) {
    logger.error('Error getting quality metrics:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/quality/alerts', authMiddleware, async (req, res) => {
  try {
    const { merchantId, severity, acknowledged } = req.query;
    
    const alerts = await qualityMonitoringService.getQualityAlerts({
      merchantId: merchantId as string,
      severity: severity as string,
      acknowledged: acknowledged === 'true',
    });
    
    res.json(alerts);
  } catch (error) {
    logger.error('Error getting alerts:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/quality/alerts/:alertId/acknowledge', authMiddleware, async (req, res) => {
  try {
    const { alertId } = req.params;
    
    await qualityMonitoringService.acknowledgeAlert(alertId, req.user.id);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error acknowledging alert:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/quality/benchmarks/:merchantId', authMiddleware, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { category } = req.query;
    
    const benchmarks = await qualityMonitoringService.getBenchmarks(
      merchantId,
      category as string
    );
    
    res.json(benchmarks);
  } catch (error) {
    logger.error('Error getting benchmarks:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/quality/report/:merchantId', authMiddleware, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { start, end } = req.query;
    
    const report = await qualityMonitoringService.generateQualityReport(
      merchantId,
      {
        start: new Date(start as string),
        end: new Date(end as string),
      }
    );
    
    res.json(report);
  } catch (error) {
    logger.error('Error generating report:', error);
    res.status(400).json({ error: error.message });
  }
});

// Feedback collection routes
app.get('/api/feedback/:orderId/request', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const request = await feedbackCollectionService.createFeedbackRequest(orderId);
    
    res.json(request);
  } catch (error) {
    logger.error('Error creating feedback request:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/feedback/:orderId/submit', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { responses } = req.body;
    
    const feedback = await feedbackCollectionService.submitFeedback({
      orderId,
      customerId: req.user.id,
      responses,
    });
    
    res.json(feedback);
  } catch (error) {
    logger.error('Error submitting feedback:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/feedback/:orderId/quick-options', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const options = await feedbackCollectionService.getQuickFeedbackOptions(orderId);
    
    res.json(options);
  } catch (error) {
    logger.error('Error getting quick options:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/feedback/:orderId/quick', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { optionId, comment } = req.body;
    
    await feedbackCollectionService.submitQuickFeedback({
      orderId,
      customerId: req.user.id,
      optionId,
      comment,
    });
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error submitting quick feedback:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/feedback/trends', authMiddleware, async (req, res) => {
  try {
    const { merchantId, start, end, groupBy } = req.query;
    
    const trends = await feedbackCollectionService.getFeedbackTrends({
      merchantId: merchantId as string,
      period: {
        start: new Date(start as string),
        end: new Date(end as string),
      },
      groupBy: (groupBy as 'day' | 'week' | 'month') || 'day',
    });
    
    res.json(trends);
  } catch (error) {
    logger.error('Error getting feedback trends:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/feedback/insights/:merchantId', authMiddleware, async (req, res) => {
  try {
    const { merchantId } = req.params;
    
    const insights = await feedbackCollectionService.getInsightsSummary(merchantId);
    
    res.json(insights);
  } catch (error) {
    logger.error('Error getting insights:', error);
    res.status(400).json({ error: error.message });
  }
});

// Compensation routes
app.post('/api/compensation/calculate', authMiddleware, async (req, res) => {
  try {
    const { orderId, issueType, severity } = req.body;
    
    const calculation = await compensationService.calculateCompensation({
      orderId,
      issueType,
      severity,
      customerId: req.user.id,
    });
    
    res.json(calculation);
  } catch (error) {
    logger.error('Error calculating compensation:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/compensation/request', authMiddleware, async (req, res) => {
  try {
    const { orderId, reason, requestedAmount, evidence } = req.body;
    
    const request = await compensationService.requestCompensation({
      orderId,
      customerId: req.user.id,
      reason,
      requestedAmount,
      evidence,
    });
    
    res.json(request);
  } catch (error) {
    logger.error('Error requesting compensation:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/compensation/:requestId/approve', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approvedAmount, notes } = req.body;
    
    const request = await compensationService.approveCompensation({
      requestId,
      approvedBy: req.user.id,
      approvedAmount,
      notes,
    });
    
    res.json(request);
  } catch (error) {
    logger.error('Error approving compensation:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/compensation/:requestId/reject', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    
    const request = await compensationService.rejectCompensation({
      requestId,
      rejectedBy: req.user.id,
      reason,
    });
    
    res.json(request);
  } catch (error) {
    logger.error('Error rejecting compensation:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/compensation/history', authMiddleware, async (req, res) => {
  try {
    const { customerId, merchantId, status } = req.query;
    
    const history = await compensationService.getCompensationHistory({
      customerId: customerId as string,
      merchantId: merchantId as string,
      status: status as string,
    });
    
    res.json(history);
  } catch (error) {
    logger.error('Error getting compensation history:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/compensation/stats', authMiddleware, async (req, res) => {
  try {
    const { merchantId, start, end } = req.query;
    
    const stats = await compensationService.getCompensationStats({
      merchantId: merchantId as string,
      period: {
        start: new Date(start as string),
        end: new Date(end as string),
      },
    });
    
    res.json(stats);
  } catch (error) {
    logger.error('Error getting compensation stats:', error);
    res.status(400).json({ error: error.message });
  }
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  logger.info('Client connected to quality control service');

  socket.on('join-merchant', (merchantId: string) => {
    socket.join(`merchant:${merchantId}`);
  });

  socket.on('join-customer', (customerId: string) => {
    socket.join(`customer:${customerId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected from quality control service');
  });
});

// Service event handlers
accuracyTrackingService.on('accuracy-issue-reported', (data) => {
  io.to(`merchant:${data.merchantId}`).emit('accuracy-issue', data);
});

accuracyTrackingService.on('accuracy-issue-resolved', (data) => {
  io.to(`customer:${data.customerId}`).emit('issue-resolved', data);
});

feedbackCollectionService.on('negative-feedback-alert', (data) => {
  io.to(`merchant:${data.merchantId}`).emit('negative-feedback', data);
});

// Process queues
qualityQueue.process('process-feedback', async (job) => {
  const { orderId } = job.data;
  await feedbackCollectionService.createFeedbackRequest(orderId);
});

qualityQueue.process('quality-check', async (job) => {
  const { merchantId } = job.data;
  const metrics = await qualityMonitoringService.getQualityMetrics(merchantId);
  
  // Check thresholds and create alerts if needed
  if (metrics.overallScore < 4.0) {
    io.to(`merchant:${merchantId}`).emit('quality-alert', {
      merchantId,
      score: metrics.overallScore,
      message: 'Quality score below threshold',
    });
  }
});

// Schedule periodic quality checks
setInterval(async () => {
  try {
    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
      select: { id: true },
    });

    merchants.forEach(merchant => {
      qualityQueue.add('quality-check', { merchantId: merchant.id });
    });
  } catch (error) {
    logger.error('Error scheduling quality checks:', error);
  }
}, 3600000); // Every hour

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'quality-control' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3022;

async function start() {
  try {
    await connectDB();
    await redisClient.connect();
    
    httpServer.listen(PORT, () => {
      logger.info(`Quality control service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();