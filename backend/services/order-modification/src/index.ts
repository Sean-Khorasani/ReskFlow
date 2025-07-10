import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { OrderModificationService } from './services/OrderModificationService';
import { CancellationService } from './services/CancellationService';
import { RefundService } from './services/RefundService';
import { ModificationValidationService } from './services/ModificationValidationService';
import { RealTimeUpdateService } from './services/RealTimeUpdateService';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },
});

app.use(express.json());

// Initialize queues
const modificationQueue = new Bull('modification-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const refundQueue = new Bull('refund-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const validationService = new ModificationValidationService();
const refundService = new RefundService(refundQueue);
const cancellationService = new CancellationService(refundService, validationService);
const realTimeService = new RealTimeUpdateService(io);
const modificationService = new OrderModificationService(
  validationService,
  cancellationService,
  realTimeService,
  modificationQueue
);

// Order modification routes
app.post('/api/orders/:orderId/modify', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { modifications, reason } = req.body;
    
    const result = await modificationService.requestModification({
      orderId,
      customerId: req.user.id,
      modifications,
      reason,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error modifying order:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/orders/:orderId/modifications', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const modifications = await modificationService.getOrderModifications(
      orderId,
      req.user.id
    );
    res.json(modifications);
  } catch (error) {
    logger.error('Error getting modifications:', error);
    res.status(500).json({ error: 'Failed to get modifications' });
  }
});

app.put('/api/modifications/:modificationId/approve', authMiddleware, async (req, res) => {
  try {
    const { modificationId } = req.params;
    const { notes } = req.body;
    
    const result = await modificationService.approveModification(
      modificationId,
      req.user.id,
      notes
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error approving modification:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/modifications/:modificationId/reject', authMiddleware, async (req, res) => {
  try {
    const { modificationId } = req.params;
    const { reason } = req.body;
    
    const result = await modificationService.rejectModification(
      modificationId,
      req.user.id,
      reason
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error rejecting modification:', error);
    res.status(400).json({ error: error.message });
  }
});

// Cancellation routes
app.post('/api/orders/:orderId/cancel', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason, details } = req.body;
    
    const result = await cancellationService.cancelOrder({
      orderId,
      initiatedBy: req.user.id,
      reason,
      details,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error cancelling order:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/orders/:orderId/cancellation-policy', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const policy = await cancellationService.getCancellationPolicy(orderId);
    res.json(policy);
  } catch (error) {
    logger.error('Error getting cancellation policy:', error);
    res.status(500).json({ error: 'Failed to get cancellation policy' });
  }
});

// Refund routes
app.get('/api/orders/:orderId/refund', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const refund = await refundService.getRefundDetails(orderId, req.user.id);
    res.json(refund);
  } catch (error) {
    logger.error('Error getting refund details:', error);
    res.status(500).json({ error: 'Failed to get refund details' });
  }
});

app.post('/api/refunds/process', authMiddleware, async (req, res) => {
  try {
    const { orderId, amount, reason, items } = req.body;
    
    const refund = await refundService.processRefund({
      orderId,
      amount,
      reason,
      items,
      processedBy: req.user.id,
    });
    
    res.json(refund);
  } catch (error) {
    logger.error('Error processing refund:', error);
    res.status(400).json({ error: error.message });
  }
});

// Real-time modification tracking
app.get('/api/orders/:orderId/modification-status', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const status = await modificationService.getModificationStatus(
      orderId,
      req.user.id
    );
    res.json(status);
  } catch (error) {
    logger.error('Error getting modification status:', error);
    res.status(500).json({ error: 'Failed to get modification status' });
  }
});

// Analytics routes
app.get('/api/analytics/modifications', authMiddleware, async (req, res) => {
  try {
    const { merchantId, period = '30d' } = req.query;
    
    const analytics = await modificationService.getModificationAnalytics(
      merchantId as string,
      period as string
    );
    
    res.json(analytics);
  } catch (error) {
    logger.error('Error getting modification analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info('Client connected for order modifications');

  socket.on('join-order', (orderId: string) => {
    socket.join(`order:${orderId}`);
  });

  socket.on('leave-order', (orderId: string) => {
    socket.leave(`order:${orderId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected');
  });
});

// Process queues
modificationQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'process-modification':
      await modificationService.processModification(data);
      break;
    case 'notify-parties':
      await modificationService.notifyParties(data);
      break;
    case 'update-inventory':
      await modificationService.updateInventory(data);
      break;
  }
});

refundQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'process-refund':
      await refundService.executeRefund(data);
      break;
    case 'notify-refund':
      await refundService.notifyRefundStatus(data);
      break;
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-modification' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3017;

async function start() {
  try {
    await connectDB();
    
    httpServer.listen(PORT, () => {
      logger.info(`Order modification service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();