import express from 'express';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { BatchOptimizationService } from './services/BatchOptimizationService';
import { BatchGroupingService } from './services/BatchGroupingService';
import { RouteGenerationService } from './services/RouteGenerationService';
import { BatchMonitoringService } from './services/BatchMonitoringService';
import { authenticate } from '@reskflow/shared';
import Bull from 'bull';
import * as schedule from 'node-schedule';

const app = express();
app.use(express.json());

let batchOptimization: BatchOptimizationService;
let batchGrouping: BatchGroupingService;
let routeGeneration: RouteGenerationService;
let batchMonitoring: BatchMonitoringService;

// Initialize queues
const batchQueue = new Bull('batch-optimization', {
  redis: config.redis.url,
});

const routeQueue = new Bull('route-generation', {
  redis: config.redis.url,
});

async function startService() {
  try {
    await connectDatabase();
    logger.info('Batch Delivery service: Database connected');

    // Initialize services
    batchGrouping = new BatchGroupingService();
    routeGeneration = new RouteGenerationService();
    batchOptimization = new BatchOptimizationService(
      batchGrouping,
      routeGeneration,
      batchQueue
    );
    batchMonitoring = new BatchMonitoringService();

    // Process queues
    batchQueue.process(async (job) => {
      return batchOptimization.processBatchJob(job.data);
    });

    routeQueue.process(async (job) => {
      return routeGeneration.processRouteJob(job.data);
    });

    // Schedule periodic batch optimization
    schedule.scheduleJob('*/5 * * * *', async () => {
      logger.info('Running scheduled batch optimization');
      await batchOptimization.runScheduledOptimization();
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'batch-reskflow' });
    });

    // Create batch from orders
    app.post('/batches/create', authenticate, async (req, res) => {
      try {
        const { orderIds, strategy = 'proximity' } = req.body;

        const batch = await batchOptimization.createBatch(orderIds, strategy);
        res.json(batch);
      } catch (error) {
        logger.error('Failed to create batch', error);
        res.status(500).json({ error: 'Failed to create batch' });
      }
    });

    // Get batch suggestions
    app.get('/batches/suggestions', authenticate, async (req, res) => {
      try {
        const { zoneId, maxBatchSize = 5 } = req.query;

        const suggestions = await batchOptimization.getBatchSuggestions(
          zoneId as string,
          parseInt(maxBatchSize as string)
        );

        res.json(suggestions);
      } catch (error) {
        logger.error('Failed to get batch suggestions', error);
        res.status(500).json({ error: 'Failed to get suggestions' });
      }
    });

    // Optimize existing batch
    app.post('/batches/:batchId/optimize', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const { addOrderIds, removeOrderIds } = req.body;

        const optimizedBatch = await batchOptimization.optimizeBatch(
          batchId,
          addOrderIds,
          removeOrderIds
        );

        res.json(optimizedBatch);
      } catch (error) {
        logger.error('Failed to optimize batch', error);
        res.status(500).json({ error: 'Failed to optimize batch' });
      }
    });

    // Generate routes for batch
    app.post('/batches/:batchId/routes', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const { driverId } = req.body;

        const routes = await routeGeneration.generateBatchRoutes(
          batchId,
          driverId
        );

        res.json(routes);
      } catch (error) {
        logger.error('Failed to generate routes', error);
        res.status(500).json({ error: 'Failed to generate routes' });
      }
    });

    // Get batch details
    app.get('/batches/:batchId', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const batch = await batchOptimization.getBatchDetails(batchId);
        res.json(batch);
      } catch (error) {
        logger.error('Failed to get batch details', error);
        res.status(500).json({ error: 'Failed to get batch details' });
      }
    });

    // Update batch status
    app.put('/batches/:batchId/status', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const { status, driverId } = req.body;

        await batchOptimization.updateBatchStatus(batchId, status, driverId);
        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to update batch status', error);
        res.status(500).json({ error: 'Failed to update status' });
      }
    });

    // Split batch
    app.post('/batches/:batchId/split', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const { splitStrategy = 'equal' } = req.body;

        const newBatches = await batchOptimization.splitBatch(
          batchId,
          splitStrategy
        );

        res.json(newBatches);
      } catch (error) {
        logger.error('Failed to split batch', error);
        res.status(500).json({ error: 'Failed to split batch' });
      }
    });

    // Merge batches
    app.post('/batches/merge', authenticate, async (req, res) => {
      try {
        const { batchIds } = req.body;

        const mergedBatch = await batchOptimization.mergeBatches(batchIds);
        res.json(mergedBatch);
      } catch (error) {
        logger.error('Failed to merge batches', error);
        res.status(500).json({ error: 'Failed to merge batches' });
      }
    });

    // Get batch performance metrics
    app.get('/batches/:batchId/metrics', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const metrics = await batchMonitoring.getBatchMetrics(batchId);
        res.json(metrics);
      } catch (error) {
        logger.error('Failed to get batch metrics', error);
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    // Analytics endpoints
    app.get('/analytics/efficiency', authenticate, async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const efficiency = await batchMonitoring.getBatchingEfficiency(
          startDate as string,
          endDate as string
        );
        res.json(efficiency);
      } catch (error) {
        logger.error('Failed to get efficiency metrics', error);
        res.status(500).json({ error: 'Failed to get efficiency' });
      }
    });

    app.get('/analytics/savings', authenticate, async (req, res) => {
      try {
        const { period = '7d' } = req.query;
        const savings = await batchMonitoring.calculateSavings(period as string);
        res.json(savings);
      } catch (error) {
        logger.error('Failed to calculate savings', error);
        res.status(500).json({ error: 'Failed to calculate savings' });
      }
    });

    // Real-time batch tracking
    app.get('/batches/:batchId/tracking', authenticate, async (req, res) => {
      try {
        const { batchId } = req.params;
        const tracking = await batchMonitoring.getBatchTracking(batchId);
        res.json(tracking);
      } catch (error) {
        logger.error('Failed to get batch tracking', error);
        res.status(500).json({ error: 'Failed to get tracking' });
      }
    });

    // Admin endpoints
    app.get('/admin/active-batches', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const activeBatches = await batchOptimization.getActiveBatches();
        res.json(activeBatches);
      } catch (error) {
        logger.error('Failed to get active batches', error);
        res.status(500).json({ error: 'Failed to get active batches' });
      }
    });

    app.post('/admin/batch-settings', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const settings = await batchOptimization.updateBatchSettings(req.body);
        res.json(settings);
      } catch (error) {
        logger.error('Failed to update batch settings', error);
        res.status(500).json({ error: 'Failed to update settings' });
      }
    });

    const PORT = 3016;
    app.listen(PORT, () => {
      logger.info(`📦 Batch Delivery service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start batch reskflow service', error);
    process.exit(1);
  }
}

startService();