import express from 'express';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { VirtualRestaurantService } from './services/VirtualRestaurantService';
import { BrandManagementService } from './services/BrandManagementService';
import { MenuSyncService } from './services/MenuSyncService';
import { OperationsManagementService } from './services/OperationsManagementService';
import { AnalyticsService } from './services/AnalyticsService';
import { KitchenIntegrationService } from './services/KitchenIntegrationService';
import multer from 'multer';

const app = express();
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Initialize queues
const virtualRestaurantQueue = new Bull('virtual-restaurant-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const syncQueue = new Bull('menu-sync-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const brandManagementService = new BrandManagementService();
const menuSyncService = new MenuSyncService(syncQueue);
const kitchenIntegrationService = new KitchenIntegrationService();
const operationsManagementService = new OperationsManagementService(kitchenIntegrationService);
const analyticsService = new AnalyticsService();
const virtualRestaurantService = new VirtualRestaurantService(
  brandManagementService,
  menuSyncService,
  operationsManagementService,
  virtualRestaurantQueue
);

// Virtual restaurant routes
app.post('/api/virtual-restaurants', authMiddleware, async (req, res) => {
  try {
    const { name, concept, cuisineType, targetAudience, parentKitchenId } = req.body;
    
    const restaurant = await virtualRestaurantService.createVirtualRestaurant({
      name,
      concept,
      cuisineType,
      targetAudience,
      parentKitchenId,
      ownerId: req.user.id,
    });
    
    res.json(restaurant);
  } catch (error) {
    logger.error('Error creating virtual restaurant:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/virtual-restaurants', authMiddleware, async (req, res) => {
  try {
    const { kitchenId, status } = req.query;
    
    const restaurants = await virtualRestaurantService.getVirtualRestaurants({
      kitchenId: kitchenId as string,
      ownerId: req.user.id,
      status: status as string,
    });
    
    res.json(restaurants);
  } catch (error) {
    logger.error('Error getting virtual restaurants:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/virtual-restaurants/:restaurantId', authMiddleware, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const updates = req.body;
    
    const restaurant = await virtualRestaurantService.updateVirtualRestaurant(
      restaurantId,
      updates,
      req.user.id
    );
    
    res.json(restaurant);
  } catch (error) {
    logger.error('Error updating virtual restaurant:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/virtual-restaurants/:restaurantId/status', authMiddleware, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { status } = req.body;
    
    const result = await virtualRestaurantService.toggleRestaurantStatus(
      restaurantId,
      status,
      req.user.id
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error toggling restaurant status:', error);
    res.status(400).json({ error: error.message });
  }
});

// Brand management routes
app.post('/api/brands', authMiddleware, upload.single('logo'), async (req, res) => {
  try {
    const { name, description, values, colors, fonts } = req.body;
    
    const brand = await brandManagementService.createBrand({
      name,
      description,
      values: JSON.parse(values || '[]'),
      colors: JSON.parse(colors || '{}'),
      fonts: JSON.parse(fonts || '{}'),
      logo: req.file,
      ownerId: req.user.id,
    });
    
    res.json(brand);
  } catch (error) {
    logger.error('Error creating brand:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/brands/:brandId/assets', authMiddleware, async (req, res) => {
  try {
    const { brandId } = req.params;
    
    const assets = await brandManagementService.getBrandAssets(brandId);
    
    res.json(assets);
  } catch (error) {
    logger.error('Error getting brand assets:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/brands/:brandId/generate-assets', authMiddleware, async (req, res) => {
  try {
    const { brandId } = req.params;
    const { assetTypes } = req.body;
    
    const assets = await brandManagementService.generateBrandAssets(
      brandId,
      assetTypes
    );
    
    res.json(assets);
  } catch (error) {
    logger.error('Error generating brand assets:', error);
    res.status(400).json({ error: error.message });
  }
});

// Menu sync routes
app.post('/api/menu-sync/:restaurantId', authMiddleware, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { sourceMenuId, syncOptions } = req.body;
    
    const result = await menuSyncService.syncMenu({
      virtualRestaurantId: restaurantId,
      sourceMenuId,
      syncOptions,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error syncing menu:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/menu-sync/:restaurantId/status', authMiddleware, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const status = await menuSyncService.getSyncStatus(restaurantId);
    
    res.json(status);
  } catch (error) {
    logger.error('Error getting sync status:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/menu-sync/:restaurantId/rules', authMiddleware, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { rules } = req.body;
    
    const result = await menuSyncService.configureSyncRules(restaurantId, rules);
    
    res.json(result);
  } catch (error) {
    logger.error('Error configuring sync rules:', error);
    res.status(400).json({ error: error.message });
  }
});

// Operations management routes
app.get('/api/operations/:kitchenId/capacity', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    
    const capacity = await operationsManagementService.getKitchenCapacity(kitchenId);
    
    res.json(capacity);
  } catch (error) {
    logger.error('Error getting kitchen capacity:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/operations/:kitchenId/allocate', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    const { virtualRestaurantId, percentage } = req.body;
    
    const result = await operationsManagementService.allocateKitchenCapacity(
      kitchenId,
      virtualRestaurantId,
      percentage
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error allocating capacity:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/operations/:kitchenId/orders', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    const { virtualRestaurantId, status } = req.query;
    
    const orders = await operationsManagementService.getConsolidatedOrders({
      kitchenId,
      virtualRestaurantId: virtualRestaurantId as string,
      status: status as string,
    });
    
    res.json(orders);
  } catch (error) {
    logger.error('Error getting consolidated orders:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/operations/:kitchenId/route-order', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    const { orderId } = req.body;
    
    const result = await operationsManagementService.routeOrderToStation(
      orderId,
      kitchenId
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error routing order:', error);
    res.status(400).json({ error: error.message });
  }
});

// Analytics routes
app.get('/api/analytics/virtual-restaurants/:restaurantId', authMiddleware, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { period = '30d' } = req.query;
    
    const analytics = await analyticsService.getVirtualRestaurantAnalytics(
      restaurantId,
      period as string
    );
    
    res.json(analytics);
  } catch (error) {
    logger.error('Error getting analytics:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/analytics/kitchen/:kitchenId/performance', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    const { period = '7d' } = req.query;
    
    const performance = await analyticsService.getKitchenPerformance(
      kitchenId,
      period as string
    );
    
    res.json(performance);
  } catch (error) {
    logger.error('Error getting kitchen performance:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/analytics/brand-comparison', authMiddleware, async (req, res) => {
  try {
    const { brandIds, period = '30d' } = req.query;
    
    const comparison = await analyticsService.compareBrandPerformance(
      (brandIds as string).split(','),
      period as string
    );
    
    res.json(comparison);
  } catch (error) {
    logger.error('Error comparing brands:', error);
    res.status(500).json({ error: 'Failed to compare brands' });
  }
});

app.get('/api/analytics/optimization-suggestions/:kitchenId', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    
    const suggestions = await analyticsService.getOptimizationSuggestions(kitchenId);
    
    res.json(suggestions);
  } catch (error) {
    logger.error('Error getting optimization suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Kitchen integration routes
app.post('/api/kitchen/:kitchenId/register', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    const { name, address, capacity, equipment } = req.body;
    
    const kitchen = await kitchenIntegrationService.registerKitchen({
      id: kitchenId,
      name,
      address,
      capacity,
      equipment,
      ownerId: req.user.id,
    });
    
    res.json(kitchen);
  } catch (error) {
    logger.error('Error registering kitchen:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/kitchen/:kitchenId/stations', authMiddleware, async (req, res) => {
  try {
    const { kitchenId } = req.params;
    
    const stations = await kitchenIntegrationService.getKitchenStations(kitchenId);
    
    res.json(stations);
  } catch (error) {
    logger.error('Error getting kitchen stations:', error);
    res.status(400).json({ error: error.message });
  }
});

// Process queues
virtualRestaurantQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'sync-menu':
      await menuSyncService.processSyncJob(data);
      break;
    case 'update-capacity':
      await operationsManagementService.updateCapacityAllocation(data);
      break;
    case 'generate-report':
      await analyticsService.generatePerformanceReport(data);
      break;
  }
});

syncQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'sync-items':
      await menuSyncService.syncMenuItems(data);
      break;
    case 'update-prices':
      await menuSyncService.updatePrices(data);
      break;
    case 'sync-availability':
      await menuSyncService.syncAvailability(data);
      break;
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'virtual-restaurant' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3020;

async function start() {
  try {
    await connectDB();
    
    app.listen(PORT, () => {
      logger.info(`Virtual restaurant service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();