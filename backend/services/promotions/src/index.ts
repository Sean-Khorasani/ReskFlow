import express from 'express';
import Bull from 'bull';
import { CronJob } from 'cron';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { PromotionService } from './services/PromotionService';
import { DiscountService } from './services/DiscountService';
import { CouponService } from './services/CouponService';
import { LoyaltyService } from './services/LoyaltyService';
import { CampaignService } from './services/CampaignService';
import { ValidationService } from './services/ValidationService';

const app = express();
app.use(express.json());

// Initialize queues
const promotionQueue = new Bull('promotion-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const campaignQueue = new Bull('campaign-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const validationService = new ValidationService();
const discountService = new DiscountService(validationService);
const couponService = new CouponService(validationService);
const loyaltyService = new LoyaltyService();
const campaignService = new CampaignService(campaignQueue);
const promotionService = new PromotionService(
  discountService,
  couponService,
  loyaltyService,
  campaignService,
  promotionQueue
);

// Promotion routes
app.post('/api/promotions', authMiddleware, async (req, res) => {
  try {
    const promotion = await promotionService.createPromotion({
      ...req.body,
      merchantId: req.user.merchantId,
      createdBy: req.user.id,
    });
    res.json(promotion);
  } catch (error) {
    logger.error('Error creating promotion:', error);
    res.status(500).json({ error: 'Failed to create promotion' });
  }
});

app.get('/api/promotions', authMiddleware, async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    
    const promotions = await promotionService.getMerchantPromotions(
      req.user.merchantId,
      {
        status: status as string,
        type: type as string,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      }
    );
    
    res.json(promotions);
  } catch (error) {
    logger.error('Error getting promotions:', error);
    res.status(500).json({ error: 'Failed to get promotions' });
  }
});

app.get('/api/promotions/:id', authMiddleware, async (req, res) => {
  try {
    const promotion = await promotionService.getPromotion(
      req.params.id,
      req.user.merchantId
    );
    res.json(promotion);
  } catch (error) {
    logger.error('Error getting promotion:', error);
    res.status(404).json({ error: 'Promotion not found' });
  }
});

app.put('/api/promotions/:id', authMiddleware, async (req, res) => {
  try {
    const promotion = await promotionService.updatePromotion(
      req.params.id,
      req.user.merchantId,
      req.body
    );
    res.json(promotion);
  } catch (error) {
    logger.error('Error updating promotion:', error);
    res.status(500).json({ error: 'Failed to update promotion' });
  }
});

app.delete('/api/promotions/:id', authMiddleware, async (req, res) => {
  try {
    await promotionService.deactivatePromotion(
      req.params.id,
      req.user.merchantId
    );
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deactivating promotion:', error);
    res.status(500).json({ error: 'Failed to deactivate promotion' });
  }
});

// Discount calculation routes
app.post('/api/discounts/calculate', authMiddleware, async (req, res) => {
  try {
    const { orderId, items, subtotal, customerId, couponCode } = req.body;
    
    const discounts = await discountService.calculateDiscounts({
      orderId,
      merchantId: req.user.merchantId,
      customerId,
      items,
      subtotal,
      couponCode,
    });
    
    res.json(discounts);
  } catch (error) {
    logger.error('Error calculating discounts:', error);
    res.status(500).json({ error: 'Failed to calculate discounts' });
  }
});

// Coupon routes
app.post('/api/coupons/validate', authMiddleware, async (req, res) => {
  try {
    const { code, customerId, orderAmount } = req.body;
    
    const validation = await couponService.validateCoupon(
      code,
      req.user.merchantId,
      customerId,
      orderAmount
    );
    
    res.json(validation);
  } catch (error) {
    logger.error('Error validating coupon:', error);
    res.status(400).json({ error: 'Invalid coupon' });
  }
});

app.post('/api/coupons/generate', authMiddleware, async (req, res) => {
  try {
    const { promotionId, count, prefix } = req.body;
    
    const coupons = await couponService.generateBulkCoupons(
      promotionId,
      count,
      prefix
    );
    
    res.json(coupons);
  } catch (error) {
    logger.error('Error generating coupons:', error);
    res.status(500).json({ error: 'Failed to generate coupons' });
  }
});

// Campaign routes
app.post('/api/campaigns', authMiddleware, async (req, res) => {
  try {
    const campaign = await campaignService.createCampaign({
      ...req.body,
      merchantId: req.user.merchantId,
    });
    res.json(campaign);
  } catch (error) {
    logger.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

app.get('/api/campaigns/:id/performance', authMiddleware, async (req, res) => {
  try {
    const performance = await campaignService.getCampaignPerformance(
      req.params.id,
      req.user.merchantId
    );
    res.json(performance);
  } catch (error) {
    logger.error('Error getting campaign performance:', error);
    res.status(500).json({ error: 'Failed to get campaign performance' });
  }
});

// Loyalty routes
app.get('/api/loyalty/points/:customerId', authMiddleware, async (req, res) => {
  try {
    const points = await loyaltyService.getCustomerPoints(
      req.params.customerId,
      req.user.merchantId
    );
    res.json(points);
  } catch (error) {
    logger.error('Error getting loyalty points:', error);
    res.status(500).json({ error: 'Failed to get loyalty points' });
  }
});

app.post('/api/loyalty/earn', authMiddleware, async (req, res) => {
  try {
    const { customerId, orderId, orderAmount } = req.body;
    
    const points = await loyaltyService.earnPoints({
      customerId,
      merchantId: req.user.merchantId,
      orderId,
      orderAmount,
    });
    
    res.json(points);
  } catch (error) {
    logger.error('Error earning points:', error);
    res.status(500).json({ error: 'Failed to earn points' });
  }
});

// Analytics routes
app.get('/api/promotions/analytics', authMiddleware, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    const analytics = await promotionService.getPromotionAnalytics(
      req.user.merchantId,
      period as string
    );
    
    res.json(analytics);
  } catch (error) {
    logger.error('Error getting promotion analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Process queues
promotionQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'activate-promotion':
      await promotionService.activatePromotion(data.promotionId);
      break;
    case 'deactivate-promotion':
      await promotionService.deactivatePromotion(data.promotionId);
      break;
    case 'process-loyalty':
      await loyaltyService.processLoyaltyTransaction(data);
      break;
  }
});

campaignQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'send-campaign':
      await campaignService.sendCampaign(data.campaignId);
      break;
    case 'update-metrics':
      await campaignService.updateCampaignMetrics(data.campaignId);
      break;
  }
});

// Scheduled jobs
new CronJob('0 * * * *', async () => {
  // Check and update promotion statuses every hour
  await promotionService.updatePromotionStatuses();
}, null, true);

new CronJob('0 0 * * *', async () => {
  // Process loyalty tier updates daily
  await loyaltyService.updateCustomerTiers();
}, null, true);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'promotions' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3016;

async function start() {
  try {
    await connectDB();
    
    app.listen(PORT, () => {
      logger.info(`Promotions service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();