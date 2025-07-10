import express from 'express';
import { config, logger, connectDatabase, prisma, blockchain } from '@reskflow/shared';
import { PaymentProcessor } from './services/PaymentProcessor';
import { BillingService } from './services/BillingService';
import { InvoiceService } from './services/InvoiceService';
import { WalletService } from './services/WalletService';
import { CryptoPaymentService } from './services/CryptoPaymentService';
import { setupPaymentQueues } from './queues/paymentQueue';
import { webhookRouter } from './routes/webhooks';

const app = express();

// Webhook routes need raw body
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// Regular routes
app.use(express.json());

let paymentProcessor: PaymentProcessor;
let billingService: BillingService;
let invoiceService: InvoiceService;
let walletService: WalletService;
let cryptoPaymentService: CryptoPaymentService;

async function startService() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Payment service: Database connected');

    // Initialize services
    paymentProcessor = new PaymentProcessor();
    billingService = new BillingService();
    invoiceService = new InvoiceService();
    walletService = new WalletService();
    cryptoPaymentService = new CryptoPaymentService();

    // Setup payment processing queues
    await setupPaymentQueues();

    // API endpoints
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'payment' });
    });

    // Create payment intent
    app.post('/payment-intent', async (req, res) => {
      try {
        const { deliveryId, amount, currency, paymentMethod } = req.body;
        
        const intent = await paymentProcessor.createPaymentIntent({
          deliveryId,
          amount,
          currency: currency || 'USD',
          paymentMethod,
        });

        res.json(intent);
      } catch (error) {
        logger.error('Failed to create payment intent', error);
        res.status(500).json({ error: 'Payment intent creation failed' });
      }
    });

    // Process payment
    app.post('/process-payment', async (req, res) => {
      try {
        const { paymentIntentId, paymentMethodId } = req.body;
        
        const result = await paymentProcessor.processPayment({
          paymentIntentId,
          paymentMethodId,
        });

        res.json(result);
      } catch (error) {
        logger.error('Payment processing failed', error);
        res.status(500).json({ error: 'Payment processing failed' });
      }
    });

    // Create crypto payment
    app.post('/crypto-payment', async (req, res) => {
      try {
        const { deliveryId, amount, currency, walletAddress } = req.body;
        
        const payment = await cryptoPaymentService.createCryptoPayment({
          deliveryId,
          amount,
          currency,
          walletAddress,
        });

        res.json(payment);
      } catch (error) {
        logger.error('Crypto payment creation failed', error);
        res.status(500).json({ error: 'Crypto payment creation failed' });
      }
    });

    // Get payment status
    app.get('/payment/:paymentId/status', async (req, res) => {
      try {
        const { paymentId } = req.params;
        
        const status = await paymentProcessor.getPaymentStatus(paymentId);
        res.json(status);
      } catch (error) {
        logger.error('Failed to get payment status', error);
        res.status(500).json({ error: 'Failed to get payment status' });
      }
    });

    // Refund payment
    app.post('/refund', async (req, res) => {
      try {
        const { paymentId, amount, reason } = req.body;
        
        const refund = await paymentProcessor.refundPayment({
          paymentId,
          amount,
          reason,
        });

        res.json(refund);
      } catch (error) {
        logger.error('Refund failed', error);
        res.status(500).json({ error: 'Refund failed' });
      }
    });

    // Wallet operations
    app.get('/wallet/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        
        const wallet = await walletService.getWallet(userId);
        res.json(wallet);
      } catch (error) {
        logger.error('Failed to get wallet', error);
        res.status(500).json({ error: 'Failed to get wallet' });
      }
    });

    app.post('/wallet/topup', async (req, res) => {
      try {
        const { userId, amount, paymentMethodId } = req.body;
        
        const result = await walletService.topUpWallet({
          userId,
          amount,
          paymentMethodId,
        });

        res.json(result);
      } catch (error) {
        logger.error('Wallet top-up failed', error);
        res.status(500).json({ error: 'Wallet top-up failed' });
      }
    });

    app.post('/wallet/withdraw', async (req, res) => {
      try {
        const { userId, amount, destination } = req.body;
        
        const result = await walletService.withdrawFromWallet({
          userId,
          amount,
          destination,
        });

        res.json(result);
      } catch (error) {
        logger.error('Wallet withdrawal failed', error);
        res.status(500).json({ error: 'Wallet withdrawal failed' });
      }
    });

    // Billing and invoices
    app.get('/billing/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;
        
        const billing = await billingService.getUserBilling({
          userId,
          startDate: startDate as string,
          endDate: endDate as string,
        });

        res.json(billing);
      } catch (error) {
        logger.error('Failed to get billing', error);
        res.status(500).json({ error: 'Failed to get billing' });
      }
    });

    app.post('/invoice/generate', async (req, res) => {
      try {
        const { userId, period, items } = req.body;
        
        const invoice = await invoiceService.generateInvoice({
          userId,
          period,
          items,
        });

        res.json(invoice);
      } catch (error) {
        logger.error('Invoice generation failed', error);
        res.status(500).json({ error: 'Invoice generation failed' });
      }
    });

    app.get('/invoice/:invoiceId', async (req, res) => {
      try {
        const { invoiceId } = req.params;
        
        const invoice = await invoiceService.getInvoice(invoiceId);
        res.json(invoice);
      } catch (error) {
        logger.error('Failed to get invoice', error);
        res.status(500).json({ error: 'Failed to get invoice' });
      }
    });

    // Payment methods
    app.get('/payment-methods/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        
        const methods = await paymentProcessor.getUserPaymentMethods(userId);
        res.json(methods);
      } catch (error) {
        logger.error('Failed to get payment methods', error);
        res.status(500).json({ error: 'Failed to get payment methods' });
      }
    });

    app.post('/payment-method', async (req, res) => {
      try {
        const { userId, type, details } = req.body;
        
        const method = await paymentProcessor.addPaymentMethod({
          userId,
          type,
          details,
        });

        res.json(method);
      } catch (error) {
        logger.error('Failed to add payment method', error);
        res.status(500).json({ error: 'Failed to add payment method' });
      }
    });

    app.delete('/payment-method/:methodId', async (req, res) => {
      try {
        const { methodId } = req.params;
        
        await paymentProcessor.removePaymentMethod(methodId);
        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to remove payment method', error);
        res.status(500).json({ error: 'Failed to remove payment method' });
      }
    });

    // Start scheduled jobs
    billingService.startBillingCycle();
    invoiceService.startInvoiceReminders();

    // Start server
    const PORT = 3004;
    app.listen(PORT, () => {
      logger.info(`💳 Payment service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start payment service', error);
    process.exit(1);
  }
}

// Blockchain event listeners
blockchain.listenToEvents('paymentEscrow', 'EscrowCreated', async (event: any) => {
  try {
    const { deliveryId, payer, amount } = event.args;
    
    await prisma.payment.create({
      data: {
        deliveryId,
        amount: parseFloat(blockchain.formatEther(amount)),
        currency: 'MATIC',
        method: 'CRYPTO',
        status: 'COMPLETED',
        blockchainTxHash: event.transactionHash,
        processedAt: new Date(),
      },
    });

    logger.info(`Blockchain payment recorded: ${deliveryId}`);
  } catch (error) {
    logger.error('Failed to record blockchain payment', error);
  }
});

blockchain.listenToEvents('paymentEscrow', 'PaymentReleased', async (event: any) => {
  try {
    const { deliveryId, driver, driverAmount, platformAmount } = event.args;
    
    // Update payment records
    await prisma.payment.updateMany({
      where: { deliveryId },
      data: {
        status: 'COMPLETED',
        metadata: {
          driverAmount: blockchain.formatEther(driverAmount),
          platformAmount: blockchain.formatEther(platformAmount),
          releasedAt: new Date(),
        },
      },
    });

    // Update driver earnings
    await walletService.creditDriverEarnings(
      driver,
      parseFloat(blockchain.formatEther(driverAmount))
    );

    logger.info(`Payment released for delivery: ${deliveryId}`);
  } catch (error) {
    logger.error('Failed to process payment release', error);
  }
});

startService();