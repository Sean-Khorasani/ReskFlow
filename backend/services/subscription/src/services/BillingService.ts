import { prisma, logger, redis } from '@reskflow/shared';
import Bull from 'bull';
import Stripe from 'stripe';
import dayjs from 'dayjs';

interface BillingJob {
  type: 'charge' | 'refund' | 'retry' | 'trial_end';
  subscriptionId: string;
  amount?: number;
  metadata?: any;
}

interface Proration {
  amount: number;
  description: string;
  credits: number;
  charges: number;
}

export class BillingService {
  private stripe: Stripe;
  private billingQueue: Bull.Queue;

  constructor(billingQueue: Bull.Queue) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2023-10-16',
    });
    this.billingQueue = billingQueue;
  }

  async processBillingJob(job: BillingJob) {
    logger.info(`Processing billing job: ${job.type} for subscription ${job.subscriptionId}`);

    try {
      switch (job.type) {
        case 'charge':
          return await this.processCharge(job.subscriptionId, job.amount!);
        case 'refund':
          return await this.processRefund(job.subscriptionId, job.amount!);
        case 'retry':
          return await this.retryFailedPayment(job.subscriptionId);
        case 'trial_end':
          return await this.processTrialEnd(job.subscriptionId);
        default:
          throw new Error(`Unknown billing job type: ${job.type}`);
      }
    } catch (error) {
      logger.error(`Billing job failed: ${job.type}`, error);
      throw error;
    }
  }

  async createInitialCharge(subscriptionId: string, amount: number) {
    await this.billingQueue.add('initial-charge', {
      type: 'charge',
      subscriptionId,
      amount,
    });
  }

  async scheduleTrialEndCharge(subscriptionId: string, trialEndDate: Date) {
    const delay = trialEndDate.getTime() - Date.now();
    await this.billingQueue.add(
      'trial-end-charge',
      {
        type: 'trial_end',
        subscriptionId,
      },
      { delay }
    );
  }

  async processDailyBilling() {
    // Get all subscriptions that need billing today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        current_period_end: {
          gte: today,
          lt: dayjs(today).add(1, 'day').toDate(),
        },
      },
      include: {
        plan: true,
      },
    });

    logger.info(`Processing billing for ${subscriptions.length} subscriptions`);

    for (const subscription of subscriptions) {
      await this.billingQueue.add('recurring-charge', {
        type: 'charge',
        subscriptionId: subscription.id,
        amount: subscription.amount,
      });
    }
  }

  async processCharge(subscriptionId: string, amount: number) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: true,
      },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    try {
      // Create Stripe payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: subscription.currency,
        customer: subscription.user.stripe_customer_id!,
        payment_method: subscription.payment_method_id!,
        off_session: true,
        confirm: true,
        metadata: {
          subscription_id: subscriptionId,
          user_id: subscription.user_id,
        },
      });

      // Record successful payment
      const invoice = await prisma.subscriptionInvoice.create({
        data: {
          subscription_id: subscriptionId,
          amount,
          currency: subscription.currency,
          status: 'paid',
          stripe_payment_intent_id: paymentIntent.id,
          paid_at: new Date(),
          period_start: subscription.current_period_start,
          period_end: subscription.current_period_end,
        },
      });

      // Update subscription period
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          current_period_start: subscription.current_period_end,
          current_period_end: this.calculateNextPeriodEnd(
            subscription.current_period_end,
            subscription.plan.billing_cycle
          ),
          last_payment_date: new Date(),
          failed_payment_count: 0,
        },
      });

      // Send receipt
      await this.sendReceipt(subscription.user.email, invoice);

      logger.info(`Payment processed successfully for subscription ${subscriptionId}`);
      return { success: true, invoiceId: invoice.id };

    } catch (error: any) {
      logger.error(`Payment failed for subscription ${subscriptionId}`, error);

      // Record failed payment
      await prisma.subscriptionInvoice.create({
        data: {
          subscription_id: subscriptionId,
          amount,
          currency: subscription.currency,
          status: 'failed',
          error_message: error.message,
          period_start: subscription.current_period_start,
          period_end: subscription.current_period_end,
        },
      });

      // Update subscription
      const failedCount = subscription.failed_payment_count + 1;
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          failed_payment_count: failedCount,
          status: failedCount >= 3 ? 'past_due' : subscription.status,
        },
      });

      // Schedule retry
      if (failedCount < 3) {
        const retryDelay = this.getRetryDelay(failedCount);
        await this.billingQueue.add(
          'retry-payment',
          {
            type: 'retry',
            subscriptionId,
          },
          { delay: retryDelay }
        );
      }

      throw error;
    }
  }

  async processRefund(subscriptionId: string, amount: number) {
    const lastInvoice = await prisma.subscriptionInvoice.findFirst({
      where: {
        subscription_id: subscriptionId,
        status: 'paid',
      },
      orderBy: { created_at: 'desc' },
    });

    if (!lastInvoice || !lastInvoice.stripe_payment_intent_id) {
      throw new Error('No paid invoice found for refund');
    }

    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: lastInvoice.stripe_payment_intent_id,
        amount: Math.round(amount * 100),
      });

      await prisma.subscriptionInvoice.update({
        where: { id: lastInvoice.id },
        data: {
          status: 'refunded',
          refunded_amount: amount,
          refunded_at: new Date(),
        },
      });

      logger.info(`Refund processed for subscription ${subscriptionId}`);
      return { success: true, refundId: refund.id };

    } catch (error) {
      logger.error(`Refund failed for subscription ${subscriptionId}`, error);
      throw error;
    }
  }

  async retryFailedPayment(subscriptionId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    return this.processCharge(subscriptionId, subscription.amount);
  }

  async processTrialEnd(subscriptionId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Update subscription status
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'active',
        trial_end: null,
      },
    });

    // Process first payment
    return this.processCharge(subscriptionId, subscription.amount);
  }

  async calculateProration(
    subscription: any,
    newPlan: any
  ): Promise<Proration> {
    const now = dayjs();
    const periodStart = dayjs(subscription.current_period_start);
    const periodEnd = dayjs(subscription.current_period_end);
    
    const totalDays = periodEnd.diff(periodStart, 'day');
    const remainingDays = periodEnd.diff(now, 'day');
    const usedDays = totalDays - remainingDays;

    // Calculate credits for unused time on current plan
    const dailyRate = subscription.amount / totalDays;
    const credits = dailyRate * remainingDays;

    // Calculate charges for remaining period on new plan
    const newDailyRate = newPlan.price / totalDays;
    const charges = newDailyRate * remainingDays;

    return {
      amount: charges - credits,
      description: `Proration for plan change: ${remainingDays} days remaining`,
      credits,
      charges,
    };
  }

  async applyProration(subscriptionId: string, proration: Proration) {
    if (proration.amount > 0) {
      // Charge the difference
      await this.createInitialCharge(subscriptionId, proration.amount);
    } else if (proration.amount < 0) {
      // Credit the difference
      await prisma.subscriptionCredit.create({
        data: {
          subscription_id: subscriptionId,
          amount: Math.abs(proration.amount),
          description: proration.description,
          expires_at: dayjs().add(6, 'month').toDate(),
        },
      });
    }
  }

  async getBillingHistory(subscriptionId: string, userId: string) {
    // Verify ownership
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user_id: userId,
      },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { subscription_id: subscriptionId },
      orderBy: { created_at: 'desc' },
      take: 12, // Last 12 invoices
    });

    return invoices.map(invoice => ({
      id: invoice.id,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      paidAt: invoice.paid_at,
      periodStart: invoice.period_start,
      periodEnd: invoice.period_end,
      downloadUrl: `/api/subscriptions/invoices/${invoice.id}/download`,
    }));
  }

  async updatePaymentMethod(
    subscriptionId: string,
    userId: string,
    paymentMethodId: string
  ) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user_id: userId,
      },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Verify payment method with Stripe
    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (!paymentMethod) {
      throw new Error('Invalid payment method');
    }

    // Update subscription
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        payment_method_id: paymentMethodId,
        updated_at: new Date(),
      },
    });

    return { success: true };
  }

  async cancelFutureBilling(subscriptionId: string) {
    // Cancel any scheduled billing jobs
    const jobs = await this.billingQueue.getJobs(['delayed', 'waiting']);
    for (const job of jobs) {
      if (job.data.subscriptionId === subscriptionId) {
        await job.remove();
      }
    }
  }

  async pauseBilling(subscriptionId: string, resumeDate: Date) {
    // Cancel future billing
    await this.cancelFutureBilling(subscriptionId);

    // Schedule resume
    const delay = resumeDate.getTime() - Date.now();
    await this.billingQueue.add(
      'resume-billing',
      {
        type: 'resume',
        subscriptionId,
      },
      { delay }
    );
  }

  async resumeBilling(subscriptionId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) return;

    // Calculate next billing date
    const now = dayjs();
    const nextBilling = this.calculateNextBillingDate(
      now.toDate(),
      subscription.plan.billing_cycle
    );

    // Update subscription
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        current_period_start: now.toDate(),
        current_period_end: nextBilling,
      },
    });

    // Schedule next charge
    const delay = nextBilling.getTime() - now.toDate().getTime();
    await this.billingQueue.add(
      'scheduled-charge',
      {
        type: 'charge',
        subscriptionId,
        amount: subscription.amount,
      },
      { delay }
    );
  }

  async handleStripeWebhook(event: any) {
    // Verify webhook signature
    const sig = event.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    try {
      const stripeEvent = this.stripe.webhooks.constructEvent(
        event.body,
        sig,
        webhookSecret
      );

      switch (stripeEvent.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(stripeEvent.data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(stripeEvent.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(stripeEvent.data.object);
          break;
      }
    } catch (error) {
      logger.error('Webhook signature verification failed', error);
      throw error;
    }
  }

  private calculateNextPeriodEnd(currentEnd: Date, billingCycle: string): Date {
    const end = dayjs(currentEnd);
    switch (billingCycle) {
      case 'monthly':
        return end.add(1, 'month').toDate();
      case 'annual':
        return end.add(1, 'year').toDate();
      default:
        return end.add(1, 'month').toDate();
    }
  }

  private calculateNextBillingDate(from: Date, billingCycle: string): Date {
    const date = dayjs(from);
    switch (billingCycle) {
      case 'monthly':
        return date.add(1, 'month').toDate();
      case 'annual':
        return date.add(1, 'year').toDate();
      default:
        return date.add(1, 'month').toDate();
    }
  }

  private getRetryDelay(attemptNumber: number): number {
    // Exponential backoff: 1 hour, 4 hours, 24 hours
    const delays = [
      60 * 60 * 1000,       // 1 hour
      4 * 60 * 60 * 1000,   // 4 hours
      24 * 60 * 60 * 1000,  // 24 hours
    ];
    return delays[Math.min(attemptNumber - 1, delays.length - 1)];
  }

  private async sendReceipt(email: string, invoice: any) {
    // Implementation would send email receipt
    logger.info(`Sending receipt to ${email} for invoice ${invoice.id}`);
  }

  private async handlePaymentSuccess(paymentIntent: any) {
    const subscriptionId = paymentIntent.metadata.subscription_id;
    if (!subscriptionId) return;

    logger.info(`Stripe webhook: Payment succeeded for subscription ${subscriptionId}`);
  }

  private async handlePaymentFailure(paymentIntent: any) {
    const subscriptionId = paymentIntent.metadata.subscription_id;
    if (!subscriptionId) return;

    logger.info(`Stripe webhook: Payment failed for subscription ${subscriptionId}`);
  }

  private async handleSubscriptionDeleted(subscription: any) {
    logger.info(`Stripe webhook: Subscription deleted ${subscription.id}`);
  }
}