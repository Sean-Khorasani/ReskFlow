import { Router } from 'express';
import { WebhookController } from '../controllers';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();
const webhookController = new WebhookController();

// Apply rate limiting to webhook endpoints
const webhookLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute
});

// Crypto deposit webhook
router.post(
  '/crypto/deposit',
  webhookLimiter,
  webhookController.handleCryptoDeposit
);

// Generic payment webhook
router.post(
  '/payment',
  webhookLimiter,
  webhookController.handlePaymentWebhook
);

export default router;