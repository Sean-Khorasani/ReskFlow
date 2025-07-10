import express from 'express';
import multer from 'multer';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { MerchantOnboardingService } from './services/MerchantOnboardingService';
import { MenuManagementService } from './services/MenuManagementService';
import { OrderManagementService } from './services/OrderManagementService';
import { MerchantAnalyticsService } from './services/MerchantAnalyticsService';
import { InventoryService } from './services/InventoryService';
import { authenticate, authorize } from '@reskflow/shared';

const app = express();
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

let merchantOnboarding: MerchantOnboardingService;
let menuManagement: MenuManagementService;
let orderManagement: OrderManagementService;
let merchantAnalytics: MerchantAnalyticsService;
let inventoryService: InventoryService;

async function startService() {
  try {
    await connectDatabase();
    logger.info('Merchant service: Database connected');

    // Initialize services
    merchantOnboarding = new MerchantOnboardingService();
    menuManagement = new MenuManagementService();
    orderManagement = new OrderManagementService();
    merchantAnalytics = new MerchantAnalyticsService();
    inventoryService = new InventoryService();

    // Start background services
    orderManagement.startOrderProcessing();
    inventoryService.startInventorySync();

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'merchant' });
    });

    // Merchant onboarding endpoints
    app.post('/merchants/register', authenticate, async (req, res) => {
      try {
        const merchant = await merchantOnboarding.registerMerchant({
          ...req.body,
          ownerId: req.user!.id,
        });
        res.status(201).json(merchant);
      } catch (error) {
        logger.error('Merchant registration failed', error);
        res.status(400).json({ error: 'Registration failed' });
      }
    });

    app.post('/merchants/:merchantId/verify', 
      authenticate, 
      authorize('ADMIN'), 
      async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { approved, reason } = req.body;
        
        const result = await merchantOnboarding.verifyMerchant(
          merchantId,
          approved,
          reason
        );
        
        res.json(result);
      } catch (error) {
        logger.error('Merchant verification failed', error);
        res.status(400).json({ error: 'Verification failed' });
      }
    });

    app.post('/merchants/:merchantId/documents',
      authenticate,
      upload.array('documents', 10),
      async (req, res) => {
      try {
        const { merchantId } = req.params;
        const files = req.files as Express.Multer.File[];
        
        const documents = await merchantOnboarding.uploadDocuments(
          merchantId,
          files,
          req.body.documentTypes
        );
        
        res.json(documents);
      } catch (error) {
        logger.error('Document upload failed', error);
        res.status(400).json({ error: 'Upload failed' });
      }
    });

    // Menu management endpoints
    app.get('/merchants/:merchantId/menus', async (req, res) => {
      try {
        const { merchantId } = req.params;
        const menus = await menuManagement.getMenus(merchantId);
        res.json(menus);
      } catch (error) {
        logger.error('Failed to get menus', error);
        res.status(500).json({ error: 'Failed to get menus' });
      }
    });

    app.post('/merchants/:merchantId/menus', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const menu = await menuManagement.createMenu(merchantId, req.body);
        res.status(201).json(menu);
      } catch (error) {
        logger.error('Menu creation failed', error);
        res.status(400).json({ error: 'Menu creation failed' });
      }
    });

    app.post('/merchants/:merchantId/menu-items',
      authenticate,
      upload.array('images', 5),
      async (req, res) => {
      try {
        const { merchantId } = req.params;
        const images = req.files as Express.Multer.File[];
        
        const menuItem = await menuManagement.createMenuItem({
          ...req.body,
          merchantId,
          images,
        });
        
        res.status(201).json(menuItem);
      } catch (error) {
        logger.error('Menu item creation failed', error);
        res.status(400).json({ error: 'Menu item creation failed' });
      }
    });

    app.put('/menu-items/:itemId/availability', authenticate, async (req, res) => {
      try {
        const { itemId } = req.params;
        const { available, quantity } = req.body;
        
        const updated = await inventoryService.updateItemAvailability(
          itemId,
          available,
          quantity
        );
        
        res.json(updated);
      } catch (error) {
        logger.error('Availability update failed', error);
        res.status(400).json({ error: 'Update failed' });
      }
    });

    app.post('/menu-items/bulk-import',
      authenticate,
      upload.single('file'),
      async (req, res) => {
      try {
        const { merchantId } = req.body;
        const file = req.file;
        
        if (!file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const result = await menuManagement.bulkImportItems(merchantId, file);
        res.json(result);
      } catch (error) {
        logger.error('Bulk import failed', error);
        res.status(400).json({ error: 'Import failed' });
      }
    });

    // Order management endpoints
    app.get('/merchants/:merchantId/orders', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { status, date, page = 1, limit = 20 } = req.query;
        
        const orders = await orderManagement.getMerchantOrders({
          merchantId,
          status: status as string,
          date: date as string,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
        });
        
        res.json(orders);
      } catch (error) {
        logger.error('Failed to get orders', error);
        res.status(500).json({ error: 'Failed to get orders' });
      }
    });

    app.put('/orders/:orderId/accept', authenticate, async (req, res) => {
      try {
        const { orderId } = req.params;
        const { estimatedTime } = req.body;
        
        const order = await orderManagement.acceptOrder(
          orderId,
          req.user!.id,
          estimatedTime
        );
        
        res.json(order);
      } catch (error) {
        logger.error('Order acceptance failed', error);
        res.status(400).json({ error: 'Acceptance failed' });
      }
    });

    app.put('/orders/:orderId/reject', authenticate, async (req, res) => {
      try {
        const { orderId } = req.params;
        const { reason } = req.body;
        
        const order = await orderManagement.rejectOrder(
          orderId,
          req.user!.id,
          reason
        );
        
        res.json(order);
      } catch (error) {
        logger.error('Order rejection failed', error);
        res.status(400).json({ error: 'Rejection failed' });
      }
    });

    app.put('/orders/:orderId/ready', authenticate, async (req, res) => {
      try {
        const { orderId } = req.params;
        
        const order = await orderManagement.markOrderReady(
          orderId,
          req.user!.id
        );
        
        res.json(order);
      } catch (error) {
        logger.error('Order ready update failed', error);
        res.status(400).json({ error: 'Update failed' });
      }
    });

    // Analytics endpoints
    app.get('/merchants/:merchantId/analytics/dashboard', 
      authenticate, 
      async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { startDate, endDate } = req.query;
        
        const analytics = await merchantAnalytics.getDashboardData({
          merchantId,
          startDate: startDate as string,
          endDate: endDate as string,
        });
        
        res.json(analytics);
      } catch (error) {
        logger.error('Failed to get analytics', error);
        res.status(500).json({ error: 'Failed to get analytics' });
      }
    });

    app.get('/merchants/:merchantId/analytics/revenue',
      authenticate,
      async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { period = 'daily', startDate, endDate } = req.query;
        
        const revenue = await merchantAnalytics.getRevenueAnalytics({
          merchantId,
          period: period as string,
          startDate: startDate as string,
          endDate: endDate as string,
        });
        
        res.json(revenue);
      } catch (error) {
        logger.error('Failed to get revenue analytics', error);
        res.status(500).json({ error: 'Failed to get revenue analytics' });
      }
    });

    // Store hours management
    app.get('/merchants/:merchantId/hours', async (req, res) => {
      try {
        const { merchantId } = req.params;
        const hours = await menuManagement.getOperatingHours(merchantId);
        res.json(hours);
      } catch (error) {
        logger.error('Failed to get operating hours', error);
        res.status(500).json({ error: 'Failed to get operating hours' });
      }
    });

    app.put('/merchants/:merchantId/hours', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const hours = await menuManagement.updateOperatingHours(
          merchantId,
          req.body
        );
        res.json(hours);
      } catch (error) {
        logger.error('Failed to update operating hours', error);
        res.status(400).json({ error: 'Update failed' });
      }
    });

    // Real-time order notifications via WebSocket
    app.get('/merchants/:merchantId/orders/stream', authenticate, (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const { merchantId } = req.params;
      
      // Subscribe to order updates
      const subscription = orderManagement.subscribeToOrders(
        merchantId,
        (order) => {
          res.write(`data: ${JSON.stringify(order)}\n\n`);
        }
      );

      req.on('close', () => {
        subscription.unsubscribe();
        res.end();
      });
    });

    const PORT = 3008;
    app.listen(PORT, () => {
      logger.info(`🏪 Merchant service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start merchant service', error);
    process.exit(1);
  }
}

startService();