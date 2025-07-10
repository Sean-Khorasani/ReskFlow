import express from 'express';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { SubscriptionService } from './services/SubscriptionService';
import { BillingService } from './services/BillingService';
import { BenefitsService } from './services/BenefitsService';
import { AnalyticsService } from './services/AnalyticsService';
import { authenticate } from '@reskflow/shared';
import Bull from 'bull';
import * as cron from 'node-cron';

const app = express();
app.use(express.json());

let subscriptionService: SubscriptionService;
let billingService: BillingService;
let benefitsService: BenefitsService;
let analyticsService: AnalyticsService;

// Initialize queues
const billingQueue = new Bull('subscription-billing', {
  redis: config.redis.url,
});

const benefitsQueue = new Bull('subscription-benefits', {
  redis: config.redis.url,
});

async function startService() {
  try {
    await connectDatabase();
    logger.info('Subscription service: Database connected');

    // Initialize services
    billingService = new BillingService(billingQueue);
    benefitsService = new BenefitsService(benefitsQueue);
    analyticsService = new AnalyticsService();
    subscriptionService = new SubscriptionService(
      billingService,
      benefitsService,
      analyticsService
    );

    // Process queues
    billingQueue.process(async (job) => {
      return billingService.processBillingJob(job.data);
    });

    benefitsQueue.process(async (job) => {
      return benefitsService.processBenefitJob(job.data);
    });

    // Schedule daily billing check
    cron.schedule('0 2 * * *', async () => {
      logger.info('Running daily subscription billing check');
      await billingService.processDailyBilling();
    });

    // Schedule benefit usage reset (monthly)
    cron.schedule('0 0 1 * *', async () => {
      logger.info('Resetting monthly benefits');
      await benefitsService.resetMonthlyBenefits();
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'subscription' });
    });

    // Get available subscription plans
    app.get('/plans', async (req, res) => {
      try {
        const plans = await subscriptionService.getAvailablePlans();
        res.json(plans);
      } catch (error) {
        logger.error('Failed to get subscription plans', error);
        res.status(500).json({ error: 'Failed to get plans' });
      }
    });

    // Get plan details
    app.get('/plans/:planId', async (req, res) => {
      try {
        const { planId } = req.params;
        const plan = await subscriptionService.getPlanDetails(planId);
        res.json(plan);
      } catch (error) {
        logger.error('Failed to get plan details', error);
        res.status(500).json({ error: 'Failed to get plan details' });
      }
    });

    // Subscribe to a plan
    app.post('/subscribe', authenticate, async (req, res) => {
      try {
        const { planId, paymentMethodId, promoCode } = req.body;
        const userId = req.user!.id;

        const subscription = await subscriptionService.subscribe({
          userId,
          planId,
          paymentMethodId,
          promoCode,
        });

        res.json(subscription);
      } catch (error) {
        logger.error('Failed to create subscription', error);
        res.status(500).json({ error: 'Failed to create subscription' });
      }
    });

    // Get user's subscription
    app.get('/subscriptions/me', authenticate, async (req, res) => {
      try {
        const userId = req.user!.id;
        const subscription = await subscriptionService.getUserSubscription(userId);
        res.json(subscription);
      } catch (error) {
        logger.error('Failed to get user subscription', error);
        res.status(500).json({ error: 'Failed to get subscription' });
      }
    });

    // Cancel subscription
    app.post('/subscriptions/:subscriptionId/cancel', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const { reason, feedback } = req.body;
        const userId = req.user!.id;

        const result = await subscriptionService.cancelSubscription(
          subscriptionId,
          userId,
          reason,
          feedback
        );

        res.json(result);
      } catch (error) {
        logger.error('Failed to cancel subscription', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
      }
    });

    // Pause subscription
    app.post('/subscriptions/:subscriptionId/pause', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const { resumeDate } = req.body;
        const userId = req.user!.id;

        const result = await subscriptionService.pauseSubscription(
          subscriptionId,
          userId,
          resumeDate
        );

        res.json(result);
      } catch (error) {
        logger.error('Failed to pause subscription', error);
        res.status(500).json({ error: 'Failed to pause subscription' });
      }
    });

    // Resume subscription
    app.post('/subscriptions/:subscriptionId/resume', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const userId = req.user!.id;

        const result = await subscriptionService.resumeSubscription(
          subscriptionId,
          userId
        );

        res.json(result);
      } catch (error) {
        logger.error('Failed to resume subscription', error);
        res.status(500).json({ error: 'Failed to resume subscription' });
      }
    });

    // Change subscription plan
    app.post('/subscriptions/:subscriptionId/change-plan', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const { newPlanId } = req.body;
        const userId = req.user!.id;

        const result = await subscriptionService.changePlan(
          subscriptionId,
          userId,
          newPlanId
        );

        res.json(result);
      } catch (error) {
        logger.error('Failed to change plan', error);
        res.status(500).json({ error: 'Failed to change plan' });
      }
    });

    // Get subscription benefits
    app.get('/subscriptions/:subscriptionId/benefits', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const userId = req.user!.id;

        const benefits = await benefitsService.getUserBenefits(
          subscriptionId,
          userId
        );

        res.json(benefits);
      } catch (error) {
        logger.error('Failed to get benefits', error);
        res.status(500).json({ error: 'Failed to get benefits' });
      }
    });

    // Check benefit eligibility
    app.post('/benefits/check-eligibility', authenticate, async (req, res) => {
      try {
        const { orderId, merchantId } = req.body;
        const userId = req.user!.id;

        const eligibility = await benefitsService.checkBenefitEligibility(
          userId,
          orderId,
          merchantId
        );

        res.json(eligibility);
      } catch (error) {
        logger.error('Failed to check benefit eligibility', error);
        res.status(500).json({ error: 'Failed to check eligibility' });
      }
    });

    // Apply subscription benefits to order
    app.post('/benefits/apply', authenticate, async (req, res) => {
      try {
        const { orderId, benefitType } = req.body;
        const userId = req.user!.id;

        const result = await benefitsService.applyBenefit(
          userId,
          orderId,
          benefitType
        );

        res.json(result);
      } catch (error) {
        logger.error('Failed to apply benefit', error);
        res.status(500).json({ error: 'Failed to apply benefit' });
      }
    });

    // Get billing history
    app.get('/subscriptions/:subscriptionId/billing', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const userId = req.user!.id;

        const history = await billingService.getBillingHistory(
          subscriptionId,
          userId
        );

        res.json(history);
      } catch (error) {
        logger.error('Failed to get billing history', error);
        res.status(500).json({ error: 'Failed to get billing history' });
      }
    });

    // Update payment method
    app.put('/subscriptions/:subscriptionId/payment-method', authenticate, async (req, res) => {
      try {
        const { subscriptionId } = req.params;
        const { paymentMethodId } = req.body;
        const userId = req.user!.id;

        const result = await billingService.updatePaymentMethod(
          subscriptionId,
          userId,
          paymentMethodId
        );

        res.json(result);
      } catch (error) {
        logger.error('Failed to update payment method', error);
        res.status(500).json({ error: 'Failed to update payment method' });
      }
    });

    // Get subscription analytics (admin)
    app.get('/admin/analytics', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { startDate, endDate } = req.query;
        const analytics = await analyticsService.getSubscriptionAnalytics(
          startDate as string,
          endDate as string
        );

        res.json(analytics);
      } catch (error) {
        logger.error('Failed to get analytics', error);
        res.status(500).json({ error: 'Failed to get analytics' });
      }
    });

    // Webhook for payment provider
    app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
      try {
        const event = req.body;
        await billingService.handleStripeWebhook(event);
        res.json({ received: true });
      } catch (error) {
        logger.error('Webhook processing failed', error);
        res.status(400).json({ error: 'Webhook processing failed' });
      }
    });

    const PORT = 3014;
    app.listen(PORT, () => {
      logger.info(`💳 Subscription service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start subscription service', error);
    process.exit(1);
  }
}

startService();