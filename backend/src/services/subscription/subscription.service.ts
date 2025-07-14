/**
 * Subscription & Membership Service
 * Manages ReskFlow Plus memberships with exclusive benefits
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import Stripe from 'stripe';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price: {
    monthly: number;
    yearly: number;
  };
  benefits: {
    freeDelivery: boolean;
    freeDeliveryLimit?: number; // unlimited if not specified
    discountPercentage: number;
    prioritySupport: boolean;
    earlyAccess: boolean;
    exclusiveRestaurants: boolean;
    cashbackPercentage: number;
    familySharing: boolean;
    maxFamilyMembers?: number;
  };
  stripeProductId: string;
  stripePrices: {
    monthly: string;
    yearly: string;
  };
}

interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: 'active' | 'cancelled' | 'past_due' | 'paused';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId: string;
  familyMembers?: string[];
}

export class SubscriptionService extends EventEmitter {
  private plans: SubscriptionPlan[] = [
    {
      id: 'reskflow_plus',
      name: 'ReskFlow Plus',
      description: 'Unlimited free reskflow and exclusive perks',
      price: {
        monthly: 9.99,
        yearly: 99.99,
      },
      benefits: {
        freeDelivery: true,
        discountPercentage: 5,
        prioritySupport: true,
        earlyAccess: false,
        exclusiveRestaurants: false,
        cashbackPercentage: 2,
        familySharing: false,
      },
      stripeProductId: process.env.STRIPE_PLUS_PRODUCT_ID || '',
      stripePrices: {
        monthly: process.env.STRIPE_PLUS_MONTHLY_PRICE_ID || '',
        yearly: process.env.STRIPE_PLUS_YEARLY_PRICE_ID || '',
      },
    },
    {
      id: 'reskflow_premium',
      name: 'ReskFlow Premium',
      description: 'All Plus benefits + exclusive restaurants and family sharing',
      price: {
        monthly: 19.99,
        yearly: 199.99,
      },
      benefits: {
        freeDelivery: true,
        discountPercentage: 10,
        prioritySupport: true,
        earlyAccess: true,
        exclusiveRestaurants: true,
        cashbackPercentage: 5,
        familySharing: true,
        maxFamilyMembers: 4,
      },
      stripeProductId: process.env.STRIPE_PREMIUM_PRODUCT_ID || '',
      stripePrices: {
        monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || '',
        yearly: process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID || '',
      },
    },
  ];

  constructor() {
    super();
    this.setupWebhooks();
    this.setupRenewalReminders();
  }

  /**
   * Setup Stripe webhooks
   */
  private setupWebhooks() {
    // This would be handled by a webhook endpoint
    // See webhook handler implementation below
  }

  /**
   * Setup renewal reminders
   */
  private setupRenewalReminders() {
    // Check daily for upcoming renewals
    setInterval(async () => {
      await this.sendRenewalReminders();
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Create a new subscription
   */
  async createSubscription(
    customerId: string,
    planId: string,
    billingPeriod: 'monthly' | 'yearly',
    paymentMethodId: string
  ): Promise<Subscription> {
    try {
      const plan = this.plans.find(p => p.id === planId);
      if (!plan) {
        throw new Error('Invalid plan');
      }

      // Get customer
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { user: true },
      });

      if (!customer) {
        throw new Error('Customer not found');
      }

      // Create or get Stripe customer
      let stripeCustomerId = customer.stripeCustomerId;
      if (!stripeCustomerId) {
        const stripeCustomer = await stripe.customers.create({
          email: customer.user.email,
          name: customer.name,
          metadata: {
            customerId: customer.id,
          },
        });
        stripeCustomerId = stripeCustomer.id;

        // Save Stripe customer ID
        await prisma.customer.update({
          where: { id: customerId },
          data: { stripeCustomerId },
        });
      }

      // Attach payment method
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId,
      });

      // Set as default payment method
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      // Create subscription
      const stripeSubscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [
          {
            price: plan.stripePrices[billingPeriod],
          },
        ],
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        metadata: {
          customerId,
          planId,
        },
        trial_period_days: 7, // 7-day free trial
      });

      // Save subscription to database
      const subscription = await prisma.subscription.create({
        data: {
          customerId,
          planId,
          status: this.mapStripeStatus(stripeSubscription.status),
          billingPeriod,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          stripeSubscriptionId: stripeSubscription.id,
          trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
        },
      });

      // Apply immediate benefits
      await this.applySubscriptionBenefits(customerId, plan);

      // Send welcome email
      await notificationService.sendEmail(
        customer.user.email,
        'subscription_welcome',
        {
          customerName: customer.name,
          planName: plan.name,
          trialDays: 7,
          benefits: plan.benefits,
        }
      );

      // Emit event
      this.emit('subscription:created', {
        subscription,
        plan,
        customer,
      });

      return subscription;

    } catch (error) {
      logger.error('Failed to create subscription', error);
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    customerId: string,
    immediately: boolean = false,
    reason?: string
  ): Promise<void> {
    try {
      const subscription = await prisma.subscription.findFirst({
        where: {
          customerId,
          status: 'active',
        },
      });

      if (!subscription) {
        throw new Error('No active subscription found');
      }

      // Cancel in Stripe
      const stripeSubscription = await stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        {
          cancel_at_period_end: !immediately,
          metadata: {
            cancellationReason: reason,
          },
        }
      );

      if (immediately) {
        await stripe.subscriptions.del(subscription.stripeSubscriptionId);
      }

      // Update database
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: immediately ? 'cancelled' : 'active',
          cancelAtPeriodEnd: !immediately,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });

      // If immediate cancellation, remove benefits
      if (immediately) {
        await this.removeSubscriptionBenefits(customerId);
      }

      // Send cancellation email
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { user: true },
      });

      if (customer) {
        await notificationService.sendEmail(
          customer.user.email,
          'subscription_cancelled',
          {
            customerName: customer.name,
            endDate: subscription.currentPeriodEnd,
            immediately,
          }
        );
      }

      // Emit event
      this.emit('subscription:cancelled', {
        subscription,
        immediately,
        reason,
      });

    } catch (error) {
      logger.error('Failed to cancel subscription', error);
      throw error;
    }
  }

  /**
   * Pause subscription
   */
  async pauseSubscription(customerId: string, resumeDate: Date): Promise<void> {
    try {
      const subscription = await prisma.subscription.findFirst({
        where: {
          customerId,
          status: 'active',
        },
      });

      if (!subscription) {
        throw new Error('No active subscription found');
      }

      // Pause in Stripe
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        pause_collection: {
          behavior: 'keep_as_draft',
          resumes_at: Math.floor(resumeDate.getTime() / 1000),
        },
      });

      // Update database
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'paused',
          pausedAt: new Date(),
          resumesAt: resumeDate,
        },
      });

      // Temporarily remove benefits
      await this.removeSubscriptionBenefits(customerId);

      // Send notification
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { user: true },
      });

      if (customer) {
        await notificationService.sendEmail(
          customer.user.email,
          'subscription_paused',
          {
            customerName: customer.name,
            resumeDate,
          }
        );
      }

    } catch (error) {
      logger.error('Failed to pause subscription', error);
      throw error;
    }
  }

  /**
   * Add family member to subscription
   */
  async addFamilyMember(
    primaryCustomerId: string,
    memberEmail: string,
    memberName: string
  ): Promise<void> {
    try {
      const subscription = await prisma.subscription.findFirst({
        where: {
          customerId: primaryCustomerId,
          status: 'active',
        },
        include: {
          familyMembers: true,
        },
      });

      if (!subscription) {
        throw new Error('No active subscription found');
      }

      const plan = this.plans.find(p => p.id === subscription.planId);
      if (!plan?.benefits.familySharing) {
        throw new Error('Plan does not support family sharing');
      }

      if (subscription.familyMembers.length >= (plan.benefits.maxFamilyMembers || 0)) {
        throw new Error('Maximum family members reached');
      }

      // Check if member already exists
      let member = await prisma.customer.findFirst({
        where: {
          user: { email: memberEmail },
        },
      });

      if (!member) {
        // Create invitation
        const invitation = await prisma.familyInvitation.create({
          data: {
            subscriptionId: subscription.id,
            email: memberEmail,
            name: memberName,
            invitedBy: primaryCustomerId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            token: this.generateInvitationToken(),
          },
        });

        // Send invitation email
        await notificationService.sendEmail(
          memberEmail,
          'family_invitation',
          {
            inviterName: subscription.customer.name,
            planName: plan.name,
            invitationLink: `${process.env.FRONTEND_URL}/family-invite/${invitation.token}`,
          }
        );
      } else {
        // Add as family member
        await prisma.familyMember.create({
          data: {
            subscriptionId: subscription.id,
            customerId: member.id,
            addedAt: new Date(),
          },
        });

        // Apply benefits to family member
        await this.applySubscriptionBenefits(member.id, plan, true);
      }

    } catch (error) {
      logger.error('Failed to add family member', error);
      throw error;
    }
  }

  /**
   * Apply subscription benefits
   */
  private async applySubscriptionBenefits(
    customerId: string,
    plan: SubscriptionPlan,
    isFamilyMember: boolean = false
  ): Promise<void> {
    // Update customer benefits
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        hasActiveSubscription: true,
        subscriptionPlan: plan.id,
        benefits: {
          freeDelivery: plan.benefits.freeDelivery,
          discountPercentage: plan.benefits.discountPercentage,
          cashbackPercentage: plan.benefits.cashbackPercentage,
          prioritySupport: plan.benefits.prioritySupport,
          isFamilyMember,
        },
      },
    });

    // Add free reskflow credits if limited
    if (plan.benefits.freeDelivery && plan.benefits.freeDeliveryLimit) {
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          freeDeliveryCredits: plan.benefits.freeDeliveryLimit,
        },
      });
    }
  }

  /**
   * Remove subscription benefits
   */
  private async removeSubscriptionBenefits(customerId: string): Promise<void> {
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        hasActiveSubscription: false,
        subscriptionPlan: null,
        benefits: {
          freeDelivery: false,
          discountPercentage: 0,
          cashbackPercentage: 0,
          prioritySupport: false,
          isFamilyMember: false,
        },
        freeDeliveryCredits: 0,
      },
    });
  }

  /**
   * Check subscription benefits for order
   */
  async checkOrderBenefits(customerId: string, orderAmount: number): Promise<any> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer?.hasActiveSubscription) {
      return {
        hasSubscription: false,
        benefits: {},
      };
    }

    const plan = this.plans.find(p => p.id === customer.subscriptionPlan);
    if (!plan) {
      return {
        hasSubscription: false,
        benefits: {},
      };
    }

    const benefits = {
      freeDelivery: false,
      discount: 0,
      cashback: 0,
    };

    // Check free reskflow
    if (plan.benefits.freeDelivery) {
      if (!plan.benefits.freeDeliveryLimit || customer.freeDeliveryCredits > 0) {
        benefits.freeDelivery = true;
      }
    }

    // Calculate discount
    if (plan.benefits.discountPercentage > 0) {
      benefits.discount = orderAmount * (plan.benefits.discountPercentage / 100);
    }

    // Calculate cashback
    if (plan.benefits.cashbackPercentage > 0) {
      benefits.cashback = orderAmount * (plan.benefits.cashbackPercentage / 100);
    }

    return {
      hasSubscription: true,
      planName: plan.name,
      benefits,
    };
  }

  /**
   * Use subscription benefit
   */
  async useSubscriptionBenefit(customerId: string, benefitType: string): Promise<void> {
    if (benefitType === 'free_reskflow') {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (customer && customer.freeDeliveryCredits > 0) {
        await prisma.customer.update({
          where: { id: customerId },
          data: {
            freeDeliveryCredits: {
              decrement: 1,
            },
          },
        });
      }
    }

    // Track benefit usage
    await prisma.benefitUsage.create({
      data: {
        customerId,
        benefitType,
        usedAt: new Date(),
      },
    });
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails(customerId: string): Promise<any> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        customerId,
        status: { in: ['active', 'paused'] },
      },
      include: {
        familyMembers: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!subscription) {
      return null;
    }

    const plan = this.plans.find(p => p.id === subscription.planId);
    
    // Get usage statistics
    const currentPeriodStart = subscription.currentPeriodStart;
    const usageStats = await prisma.benefitUsage.groupBy({
      by: ['benefitType'],
      where: {
        customerId,
        usedAt: { gte: currentPeriodStart },
      },
      _count: true,
    });

    // Calculate savings
    const savings = await this.calculatePeriodSavings(customerId, currentPeriodStart);

    return {
      subscription,
      plan,
      usage: usageStats,
      savings,
      nextBillingDate: subscription.currentPeriodEnd,
      canAddFamilyMembers: plan?.benefits.familySharing && 
        subscription.familyMembers.length < (plan.benefits.maxFamilyMembers || 0),
    };
  }

  /**
   * Calculate period savings
   */
  private async calculatePeriodSavings(customerId: string, periodStart: Date): Promise<number> {
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        createdAt: { gte: periodStart },
      },
    });

    let totalSavings = 0;

    for (const order of orders) {
      // Add reskflow fee savings
      if (order.reskflowFeeWaived) {
        totalSavings += order.reskflowFee;
      }

      // Add discount savings
      if (order.subscriptionDiscount) {
        totalSavings += order.subscriptionDiscount;
      }
    }

    return totalSavings;
  }

  /**
   * Handle Stripe webhook
   */
  async handleStripeWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
  }

  /**
   * Handle subscription update from Stripe
   */
  private async handleSubscriptionUpdate(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: this.mapStripeStatus(stripeSubscription.status),
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        },
      });
    }
  }

  /**
   * Handle subscription deletion from Stripe
   */
  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'cancelled' },
      });

      await this.removeSubscriptionBenefits(subscription.customerId);
    }
  }

  /**
   * Handle payment succeeded
   */
  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.subscription) {
      const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: invoice.subscription as string },
      });

      if (subscription) {
        // Record payment
        await prisma.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency,
            status: 'succeeded',
            stripeInvoiceId: invoice.id,
          },
        });

        // Reset monthly benefits
        if (subscription.planId) {
          const plan = this.plans.find(p => p.id === subscription.planId);
          if (plan?.benefits.freeDeliveryLimit) {
            await prisma.customer.update({
              where: { id: subscription.customerId },
              data: {
                freeDeliveryCredits: plan.benefits.freeDeliveryLimit,
              },
            });
          }
        }
      }
    }
  }

  /**
   * Handle payment failed
   */
  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.subscription) {
      const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: invoice.subscription as string },
        include: { customer: { include: { user: true } } },
      });

      if (subscription) {
        // Record failed payment
        await prisma.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            amount: invoice.amount_due / 100,
            currency: invoice.currency,
            status: 'failed',
            stripeInvoiceId: invoice.id,
          },
        });

        // Send payment failed notification
        await notificationService.sendEmail(
          subscription.customer.user.email,
          'payment_failed',
          {
            customerName: subscription.customer.name,
            amount: invoice.amount_due / 100,
            updatePaymentLink: `${process.env.FRONTEND_URL}/account/payment-methods`,
          }
        );
      }
    }
  }

  /**
   * Map Stripe status to our status
   */
  private mapStripeStatus(stripeStatus: Stripe.Subscription.Status): Subscription['status'] {
    switch (stripeStatus) {
      case 'active':
      case 'trialing':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
      case 'unpaid':
        return 'cancelled';
      case 'paused':
        return 'paused';
      default:
        return 'cancelled';
    }
  }

  /**
   * Send renewal reminders
   */
  private async sendRenewalReminders(): Promise<void> {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: {
          gte: new Date(),
          lte: threeDaysFromNow,
        },
        renewalReminderSent: false,
      },
      include: {
        customer: {
          include: { user: true },
        },
      },
    });

    for (const subscription of subscriptions) {
      const plan = this.plans.find(p => p.id === subscription.planId);
      
      await notificationService.sendEmail(
        subscription.customer.user.email,
        'subscription_renewal_reminder',
        {
          customerName: subscription.customer.name,
          planName: plan?.name,
          renewalDate: subscription.currentPeriodEnd,
          amount: plan?.price[subscription.billingPeriod],
        }
      );

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { renewalReminderSent: true },
      });
    }
  }

  /**
   * Generate invitation token
   */
  private generateInvitationToken(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get available plans
   */
  getAvailablePlans(): SubscriptionPlan[] {
    return this.plans;
  }

  /**
   * Compare plans
   */
  comparePlans(): any {
    return {
      plans: this.plans,
      features: [
        {
          name: 'Free Delivery',
          plus: '✓ Unlimited',
          premium: '✓ Unlimited',
          free: '✗',
        },
        {
          name: 'Member Discount',
          plus: '5%',
          premium: '10%',
          free: '0%',
        },
        {
          name: 'Cashback',
          plus: '2%',
          premium: '5%',
          free: '0%',
        },
        {
          name: 'Priority Support',
          plus: '✓',
          premium: '✓',
          free: '✗',
        },
        {
          name: 'Early Access',
          plus: '✗',
          premium: '✓',
          free: '✗',
        },
        {
          name: 'Exclusive Restaurants',
          plus: '✗',
          premium: '✓',
          free: '✗',
        },
        {
          name: 'Family Sharing',
          plus: '✗',
          premium: '✓ Up to 4',
          free: '✗',
        },
      ],
    };
  }
}

// Export singleton instance
export const subscriptionService = new SubscriptionService();