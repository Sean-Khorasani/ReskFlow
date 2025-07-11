/**
 * Payment Service Unit Tests
 */

import { PaymentService } from '../../../backend/src/services/payment/payment.service';
import { PaymentRequest, PaymentStatus } from '../../../backend/src/services/payment/types';
import { generateUUID, generatePaymentCard } from '../../utils/test-data-generator';

// Mock external dependencies
jest.mock('stripe');
jest.mock('@prisma/client');
jest.mock('ioredis');

describe('PaymentService', () => {
  let paymentService: PaymentService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockStripe: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Prisma
    mockPrisma = {
      payment: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn()
      },
      paymentMethod: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      wallet: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      transaction: {
        create: jest.fn()
      }
    };

    // Mock Stripe
    mockStripe = {
      paymentIntents: {
        create: jest.fn(),
        confirm: jest.fn(),
        cancel: jest.fn()
      },
      paymentMethods: {
        create: jest.fn(),
        attach: jest.fn()
      },
      refunds: {
        create: jest.fn()
      },
      customers: {
        create: jest.fn()
      }
    };

    // Mock Redis
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      setex: jest.fn()
    };

    // Mock EventEmitter
    mockEventEmitter = {
      emit: jest.fn()
    };

    // Initialize service
    paymentService = new PaymentService();
    (paymentService as any).prisma = mockPrisma;
    (paymentService as any).redis = mockRedis;
    (paymentService as any).stripe = mockStripe;
    (paymentService as any).eventEmitter = mockEventEmitter;
  });

  describe('processPayment', () => {
    it('should process card payment successfully', async () => {
      const paymentRequest: PaymentRequest = {
        orderId: generateUUID(),
        userId: generateUUID(),
        amount: 29.99,
        currency: 'USD',
        paymentMethodType: 'card',
        paymentMethodId: 'pm_test_123'
      };

      const stripeIntent = {
        id: 'pi_test_123',
        status: 'succeeded',
        amount: 2999,
        currency: 'usd'
      };

      const payment = {
        id: generateUUID(),
        ...paymentRequest,
        status: PaymentStatus.COMPLETED,
        transactionId: stripeIntent.id
      };

      mockStripe.paymentIntents.create.mockResolvedValue(stripeIntent);
      mockStripe.paymentIntents.confirm.mockResolvedValue(stripeIntent);
      mockPrisma.payment.create.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue(payment);

      const result = await paymentService.processPayment(paymentRequest);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 2999,
        currency: 'usd',
        payment_method: paymentRequest.paymentMethodId,
        confirm: false,
        metadata: {
          orderId: paymentRequest.orderId,
          userId: paymentRequest.userId
        }
      });

      expect(mockPrisma.payment.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.payment).toEqual(payment);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('payment.completed', expect.any(Object));
    });

    it('should process wallet payment successfully', async () => {
      const paymentRequest: PaymentRequest = {
        orderId: generateUUID(),
        userId: generateUUID(),
        amount: 15.99,
        currency: 'USD',
        paymentMethodType: 'wallet'
      };

      const wallet = {
        id: generateUUID(),
        userId: paymentRequest.userId,
        balance: 50.00,
        currency: 'USD'
      };

      const payment = {
        id: generateUUID(),
        ...paymentRequest,
        status: PaymentStatus.COMPLETED
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      mockPrisma.wallet.update.mockResolvedValue({
        ...wallet,
        balance: wallet.balance - paymentRequest.amount
      });
      mockPrisma.payment.create.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue(payment);

      const result = await paymentService.processPayment(paymentRequest);

      expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId: paymentRequest.userId }
      });
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: wallet.id },
        data: { balance: { decrement: paymentRequest.amount } }
      });
      expect(result.success).toBe(true);
      expect(result.payment).toEqual(payment);
    });

    it('should fail wallet payment with insufficient balance', async () => {
      const paymentRequest: PaymentRequest = {
        orderId: generateUUID(),
        userId: generateUUID(),
        amount: 100.00,
        currency: 'USD',
        paymentMethodType: 'wallet'
      };

      const wallet = {
        id: generateUUID(),
        userId: paymentRequest.userId,
        balance: 50.00,
        currency: 'USD'
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);

      await expect(paymentService.processPayment(paymentRequest)).rejects.toThrow(
        'Insufficient wallet balance'
      );
      expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
    });

    it('should validate payment amount', async () => {
      const paymentRequest: PaymentRequest = {
        orderId: generateUUID(),
        userId: generateUUID(),
        amount: -10.00,
        currency: 'USD',
        paymentMethodType: 'card',
        paymentMethodId: 'pm_test_123'
      };

      await expect(paymentService.processPayment(paymentRequest)).rejects.toThrow(
        'Invalid payment amount'
      );
    });

    it('should handle payment failure', async () => {
      const paymentRequest: PaymentRequest = {
        orderId: generateUUID(),
        userId: generateUUID(),
        amount: 29.99,
        currency: 'USD',
        paymentMethodType: 'card',
        paymentMethodId: 'pm_test_123'
      };

      const stripeIntent = {
        id: 'pi_test_123',
        status: 'failed',
        amount: 2999,
        currency: 'usd',
        last_payment_error: {
          message: 'Card declined'
        }
      };

      mockStripe.paymentIntents.create.mockResolvedValue(stripeIntent);
      mockStripe.paymentIntents.confirm.mockResolvedValue(stripeIntent);
      mockPrisma.payment.create.mockResolvedValue({ id: generateUUID() });
      mockPrisma.payment.update.mockResolvedValue({
        id: generateUUID(),
        status: PaymentStatus.FAILED
      });

      const result = await paymentService.processPayment(paymentRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Card declined');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('payment.failed', expect.any(Object));
    });
  });

  describe('refundPayment', () => {
    it('should process refund successfully', async () => {
      const paymentId = generateUUID();
      const amount = 20.00;
      const reason = 'Customer request';

      const payment = {
        id: paymentId,
        amount: 50.00,
        status: PaymentStatus.COMPLETED,
        transactionId: 'pi_test_123',
        paymentMethodType: 'card'
      };

      const stripeRefund = {
        id: 're_test_123',
        amount: 2000,
        status: 'succeeded'
      };

      mockPrisma.payment.findUnique.mockResolvedValue(payment);
      mockStripe.refunds.create.mockResolvedValue(stripeRefund);
      mockPrisma.payment.update.mockResolvedValue({
        ...payment,
        refundedAmount: amount,
        status: PaymentStatus.PARTIALLY_REFUNDED
      });

      const result = await paymentService.refundPayment(paymentId, amount, reason);

      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: payment.transactionId,
        amount: 2000,
        reason: 'requested_by_customer'
      });
      expect(result.success).toBe(true);
      expect(result.refundId).toBe(stripeRefund.id);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('payment.refunded', expect.any(Object));
    });

    it('should handle full refund', async () => {
      const paymentId = generateUUID();
      const payment = {
        id: paymentId,
        amount: 50.00,
        status: PaymentStatus.COMPLETED,
        transactionId: 'pi_test_123',
        paymentMethodType: 'card'
      };

      mockPrisma.payment.findUnique.mockResolvedValue(payment);
      mockStripe.refunds.create.mockResolvedValue({
        id: 're_test_123',
        amount: 5000,
        status: 'succeeded'
      });
      mockPrisma.payment.update.mockResolvedValue({
        ...payment,
        refundedAmount: payment.amount,
        status: PaymentStatus.REFUNDED
      });

      const result = await paymentService.refundPayment(paymentId, payment.amount, 'Full refund');

      expect(result.success).toBe(true);
      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: paymentId },
        data: expect.objectContaining({
          status: PaymentStatus.REFUNDED,
          refundedAmount: payment.amount
        })
      });
    });

    it('should prevent refund exceeding original amount', async () => {
      const paymentId = generateUUID();
      const payment = {
        id: paymentId,
        amount: 50.00,
        refundedAmount: 30.00,
        status: PaymentStatus.PARTIALLY_REFUNDED
      };

      mockPrisma.payment.findUnique.mockResolvedValue(payment);

      await expect(
        paymentService.refundPayment(paymentId, 25.00, 'Excessive refund')
      ).rejects.toThrow('Refund amount exceeds remaining balance');
    });

    it('should handle wallet refund', async () => {
      const paymentId = generateUUID();
      const userId = generateUUID();
      const amount = 15.00;

      const payment = {
        id: paymentId,
        userId,
        amount: 30.00,
        status: PaymentStatus.COMPLETED,
        paymentMethodType: 'wallet'
      };

      const wallet = {
        id: generateUUID(),
        userId,
        balance: 10.00
      };

      mockPrisma.payment.findUnique.mockResolvedValue(payment);
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);
      mockPrisma.wallet.update.mockResolvedValue({
        ...wallet,
        balance: wallet.balance + amount
      });
      mockPrisma.payment.update.mockResolvedValue({
        ...payment,
        refundedAmount: amount,
        status: PaymentStatus.PARTIALLY_REFUNDED
      });

      const result = await paymentService.refundPayment(paymentId, amount, 'Wallet refund');

      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: wallet.id },
        data: { balance: { increment: amount } }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('addPaymentMethod', () => {
    it('should add card payment method', async () => {
      const userId = generateUUID();
      const card = generatePaymentCard();
      
      const stripePaymentMethod = {
        id: 'pm_test_123',
        type: 'card',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: card.expMonth,
          exp_year: card.expYear
        }
      };

      const stripeCustomer = {
        id: 'cus_test_123'
      };

      mockStripe.customers.create.mockResolvedValue(stripeCustomer);
      mockStripe.paymentMethods.create.mockResolvedValue(stripePaymentMethod);
      mockStripe.paymentMethods.attach.mockResolvedValue(stripePaymentMethod);
      mockPrisma.paymentMethod.create.mockResolvedValue({
        id: generateUUID(),
        userId,
        type: 'card',
        provider: 'stripe',
        externalId: stripePaymentMethod.id,
        lastFour: '4242',
        brand: 'visa',
        isDefault: true
      });

      const result = await paymentService.addPaymentMethod(userId, 'card', card);

      expect(mockStripe.paymentMethods.create).toHaveBeenCalledWith({
        type: 'card',
        card: expect.objectContaining({
          number: card.number,
          exp_month: card.expMonth,
          exp_year: card.expYear,
          cvc: card.cvc
        })
      });
      expect(result).toBeDefined();
      expect(result.lastFour).toBe('4242');
    });
  });

  describe('calculateFees', () => {
    it('should calculate correct fees', () => {
      const amount = 100.00;
      const fees = (paymentService as any).calculateFees(amount);

      expect(fees.platformFee).toBe(3.00); // 3%
      expect(fees.processingFee).toBe(0.30); // Fixed $0.30
      expect(fees.totalFees).toBe(3.30);
      expect(fees.netAmount).toBe(96.70);
    });

    it('should apply minimum platform fee', () => {
      const amount = 10.00;
      const fees = (paymentService as any).calculateFees(amount);

      expect(fees.platformFee).toBe(0.50); // Minimum $0.50
      expect(fees.processingFee).toBe(0.30);
      expect(fees.totalFees).toBe(0.80);
      expect(fees.netAmount).toBe(9.20);
    });
  });
});