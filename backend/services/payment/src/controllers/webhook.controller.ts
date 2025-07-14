import { Request, Response, NextFunction } from 'express';
import { CryptoService } from '../services';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { verifyWebhookSignature } from '../utils/webhook';
import { logger } from '../utils/logger';

export class WebhookController {
  private cryptoService: CryptoService;

  constructor() {
    this.cryptoService = new CryptoService();
  }

  handleCryptoDeposit = asyncHandler(async (req: Request, res: Response) => {
    // Verify webhook signature
    const signature = req.headers['x-webhook-signature'] as string;
    if (!verifyWebhookSignature(req.body, signature)) {
      throw new AppError('Invalid webhook signature', 401);
    }

    const {
      transactionHash,
      fromAddress,
      toAddress,
      amount,
      cryptocurrency,
      network,
      confirmations,
      blockNumber
    } = req.body;

    logger.info('Received crypto deposit webhook:', {
      transactionHash,
      toAddress,
      amount,
      cryptocurrency
    });

    await this.cryptoService.processDepositWebhook({
      transactionHash,
      fromAddress,
      toAddress,
      amount,
      cryptocurrency,
      network,
      confirmations,
      blockNumber
    });

    res.json({
      success: true,
      message: 'Webhook processed successfully'
    });
  });

  handlePaymentWebhook = asyncHandler(async (req: Request, res: Response) => {
    // Generic payment webhook handler
    const signature = req.headers['x-webhook-signature'] as string;
    if (!verifyWebhookSignature(req.body, signature)) {
      throw new AppError('Invalid webhook signature', 401);
    }

    const { event, data } = req.body;

    logger.info('Received payment webhook:', { event, data });

    // Process different webhook events
    switch (event) {
      case 'payment.completed':
        // Handle payment completion
        break;
      case 'payment.failed':
        // Handle payment failure
        break;
      case 'refund.processed':
        // Handle refund
        break;
      default:
        logger.warn(`Unknown webhook event: ${event}`);
    }

    res.json({
      success: true,
      message: 'Webhook received'
    });
  });
}