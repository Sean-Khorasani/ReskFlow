import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { CatalogService } from './services/CatalogService';
import { InventoryRealtimeService } from './services/InventoryRealtimeService';
import { PricingService } from './services/PricingService';
import { CatalogSyncService } from './services/CatalogSyncService';
import { authenticate } from '@reskflow/shared';
import Bull from 'bull';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

let catalogService: CatalogService;
let inventoryRealtimeService: InventoryRealtimeService;
let pricingService: PricingService;
let catalogSyncService: CatalogSyncService;

// Initialize queues
const inventoryQueue = new Bull('inventory-updates', {
  redis: config.redis.url,
});

const pricingQueue = new Bull('pricing-updates', {
  redis: config.redis.url,
});

async function startService() {
  try {
    await connectDatabase();
    logger.info('Catalog service: Database connected');

    // Initialize services
    catalogService = new CatalogService();
    inventoryRealtimeService = new InventoryRealtimeService(io, inventoryQueue);
    pricingService = new PricingService(pricingQueue);
    catalogSyncService = new CatalogSyncService();

    // Start background services
    await inventoryRealtimeService.startRealtimeSync();
    await pricingService.startPricingEngine();
    await catalogSyncService.startSync();

    // Process queues
    inventoryQueue.process(async (job) => {
      return inventoryRealtimeService.processInventoryUpdate(job.data);
    });

    pricingQueue.process(async (job) => {
      return pricingService.processPricingUpdate(job.data);
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'catalog' });
    });

    // Catalog endpoints
    app.get('/catalogs/:merchantId', async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { includeOutOfStock = false } = req.query;

        const catalog = await catalogService.getMerchantCatalog(
          merchantId,
          includeOutOfStock === 'true'
        );

        res.json(catalog);
      } catch (error) {
        logger.error('Failed to get catalog', error);
        res.status(500).json({ error: 'Failed to get catalog' });
      }
    });

    app.get('/catalogs/:merchantId/categories', async (req, res) => {
      try {
        const { merchantId } = req.params;

        const categories = await catalogService.getCategories(merchantId);
        res.json(categories);
      } catch (error) {
        logger.error('Failed to get categories', error);
        res.status(500).json({ error: 'Failed to get categories' });
      }
    });

    app.get('/items/:itemId', async (req, res) => {
      try {
        const { itemId } = req.params;
        const { latitude, longitude } = req.query;

        const item = await catalogService.getItemDetails(
          itemId,
          latitude ? parseFloat(latitude as string) : undefined,
          longitude ? parseFloat(longitude as string) : undefined
        );

        if (!item) {
          return res.status(404).json({ error: 'Item not found' });
        }

        res.json(item);
      } catch (error) {
        logger.error('Failed to get item', error);
        res.status(500).json({ error: 'Failed to get item' });
      }
    });

    // Real-time inventory endpoints
    app.get('/inventory/:merchantId/status', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;

        const status = await inventoryRealtimeService.getInventoryStatus(merchantId);
        res.json(status);
      } catch (error) {
        logger.error('Failed to get inventory status', error);
        res.status(500).json({ error: 'Failed to get inventory status' });
      }
    });

    app.put('/inventory/:itemId', authenticate, async (req, res) => {
      try {
        const { itemId } = req.params;
        const { quantity, reason } = req.body;

        await inventoryRealtimeService.updateInventory(
          itemId,
          quantity,
          reason,
          req.user!.id
        );

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to update inventory', error);
        res.status(400).json({ error: 'Failed to update inventory' });
      }
    });

    app.post('/inventory/batch', authenticate, async (req, res) => {
      try {
        const { updates } = req.body;

        const results = await inventoryRealtimeService.batchUpdateInventory(
          updates,
          req.user!.id
        );

        res.json(results);
      } catch (error) {
        logger.error('Batch inventory update failed', error);
        res.status(400).json({ error: 'Batch update failed' });
      }
    });

    app.get('/inventory/:itemId/history', authenticate, async (req, res) => {
      try {
        const { itemId } = req.params;
        const { days = 30 } = req.query;

        const history = await inventoryRealtimeService.getInventoryHistory(
          itemId,
          parseInt(days as string)
        );

        res.json(history);
      } catch (error) {
        logger.error('Failed to get inventory history', error);
        res.status(500).json({ error: 'Failed to get inventory history' });
      }
    });

    // Pricing endpoints
    app.get('/pricing/:merchantId/current', async (req, res) => {
      try {
        const { merchantId } = req.params;

        const pricing = await pricingService.getCurrentPricing(merchantId);
        res.json(pricing);
      } catch (error) {
        logger.error('Failed to get pricing', error);
        res.status(500).json({ error: 'Failed to get pricing' });
      }
    });

    app.post('/pricing/:merchantId/rules', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const rule = req.body;

        const created = await pricingService.createPricingRule(merchantId, rule);
        res.status(201).json(created);
      } catch (error) {
        logger.error('Failed to create pricing rule', error);
        res.status(400).json({ error: 'Failed to create pricing rule' });
      }
    });

    app.get('/pricing/:itemId/calculate', async (req, res) => {
      try {
        const { itemId } = req.params;
        const { quantity = 1, promoCode } = req.query;

        const price = await pricingService.calculateItemPrice(
          itemId,
          parseInt(quantity as string),
          promoCode as string
        );

        res.json(price);
      } catch (error) {
        logger.error('Failed to calculate price', error);
        res.status(500).json({ error: 'Failed to calculate price' });
      }
    });

    // Catalog sync endpoints
    app.post('/sync/:merchantId/trigger', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;

        await catalogSyncService.triggerSync(merchantId);
        res.json({ success: true, message: 'Sync triggered' });
      } catch (error) {
        logger.error('Failed to trigger sync', error);
        res.status(500).json({ error: 'Failed to trigger sync' });
      }
    });

    app.get('/sync/:merchantId/status', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;

        const status = await catalogSyncService.getSyncStatus(merchantId);
        res.json(status);
      } catch (error) {
        logger.error('Failed to get sync status', error);
        res.status(500).json({ error: 'Failed to get sync status' });
      }
    });

    // WebSocket connections for real-time updates
    io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // Subscribe to merchant inventory updates
      socket.on('subscribe:inventory', async (merchantId: string) => {
        socket.join(`merchant:${merchantId}:inventory`);
        logger.info(`Client ${socket.id} subscribed to inventory updates for ${merchantId}`);

        // Send current inventory status
        const status = await inventoryRealtimeService.getInventoryStatus(merchantId);
        socket.emit('inventory:status', status);
      });

      // Subscribe to item updates
      socket.on('subscribe:item', (itemId: string) => {
        socket.join(`item:${itemId}`);
        logger.info(`Client ${socket.id} subscribed to item ${itemId}`);
      });

      // Subscribe to pricing updates
      socket.on('subscribe:pricing', (merchantId: string) => {
        socket.join(`merchant:${merchantId}:pricing`);
        logger.info(`Client ${socket.id} subscribed to pricing updates for ${merchantId}`);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });

    const PORT = 3010;
    httpServer.listen(PORT, () => {
      logger.info(`📦 Catalog service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start catalog service', error);
    process.exit(1);
  }
}

startService();