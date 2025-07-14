import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';

export class PaymentController {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  createPayment = asyncHandler(async (req: Request, res: Response) => {
    const { userId, orderId, amount, currency, method, metadata } = req.body;

    const payment = await this.paymentService.createPayment({
      userId,
      orderId,
      amount,
      currency,
      method,
      metadata
    });

    res.status(201).json({
      success: true,
      data: payment
    });
  });

  processPayment = asyncHandler(async (req: Request, res: Response) => {
    const { paymentId } = req.params;
    const { walletId, cryptoPaymentData } = req.body;

    const result = await this.paymentService.processPayment({
      paymentId,
      walletId,
      cryptoPaymentData
    });

    res.json({
      success: true,
      data: result
    });
  });

  refundPayment = asyncHandler(async (req: Request, res: Response) => {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    const result = await this.paymentService.refundPayment({
      paymentId,
      amount,
      reason
    });

    res.json({
      success: true,
      data: result
    });
  });

  getPayment = asyncHandler(async (req: Request, res: Response) => {
    const { paymentId } = req.params;

    const payment = await this.paymentService.getPayment(paymentId);
    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    res.json({
      success: true,
      data: payment
    });
  });

  getPaymentByOrderId = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params;

    const payment = await this.paymentService.getPaymentByOrderId(orderId);
    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    res.json({
      success: true,
      data: payment
    });
  });

  getUserPayments = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const payments = await this.paymentService.getUserPayments(userId);

    res.json({
      success: true,
      data: payments
    });
  });

  updatePaymentStatus = asyncHandler(async (req: Request, res: Response) => {
    const { paymentId } = req.params;
    const { status } = req.body;

    const payment = await this.paymentService.updatePaymentStatus(paymentId, status);

    res.json({
      success: true,
      data: payment
    });
  });
}