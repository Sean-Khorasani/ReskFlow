import { Router } from 'express';
import paymentRoutes from './payment.routes';
import walletRoutes from './wallet.routes';
import cryptoRoutes from './crypto.routes';
import webhookRoutes from './webhook.routes';

const router = Router();

router.use('/payments', paymentRoutes);
router.use('/wallets', walletRoutes);
router.use('/crypto', cryptoRoutes);
router.use('/webhooks', webhookRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Payment service is running',
    timestamp: new Date()
  });
});

export default router;