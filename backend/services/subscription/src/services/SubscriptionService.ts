import { prisma, logger, redis } from '@reskflow/shared';
import { BillingService } from './BillingService';
import { BenefitsService } from './BenefitsService';
import { AnalyticsService } from './AnalyticsService';
import dayjs from 'dayjs';

interface SubscribeParams {
  userId: string;
  planId: string;
  paymentMethodId: string;
  promoCode?: string;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  billingCycle: 'monthly' | 'annual';
  benefits: {
    freeDelivery: boolean;
    freeDeliveryMinimum?: number;
    reducedServiceFee: number;
    exclusiveOffers: boolean;
    prioritySupport: boolean;
    rewardMultiplier: number;
    monthlyCredits: number;
  };
  features: string[];
  isActive: boolean;
}

export class SubscriptionService {
  private billingService: BillingService;
  private benefitsService: BenefitsService;
  private analyticsService: AnalyticsService;

  constructor(
    billingService: BillingService,
    benefitsService: BenefitsService,
    analyticsService: AnalyticsService
  ) {
    this.billingService = billingService;
    this.benefitsService = benefitsService;
    this.analyticsService = analyticsService;
  }

  async getAvailablePlans(): Promise<SubscriptionPlan[]> {
    const cacheKey = 'subscription_plans';
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const plans = await prisma.subscriptionPlan.findMany({
      where: { is_active: true },
      include: {
        benefits: true,
        features: true,
      },
    });

    const formattedPlans = plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      billingCycle: plan.billing_cycle as 'monthly' | 'annual',
      benefits: {
        freeDelivery: plan.benefits.free_reskflow,
        freeDeliveryMinimum: plan.benefits.free_reskflow_minimum,
        reducedServiceFee: plan.benefits.reduced_service_fee,
        exclusiveOffers: plan.benefits.exclusive_offers,
        prioritySupport: plan.benefits.priority_support,
        rewardMultiplier: plan.benefits.reward_multiplier,
        monthlyCredits: plan.benefits.monthly_credits,
      },
      features: plan.features.map(f => f.description),
      isActive: plan.is_active,
    }));

    await redis.setex(cacheKey, 3600, JSON.stringify(formattedPlans));
    return formattedPlans;
  }

  async getPlanDetails(planId: string): Promise<SubscriptionPlan | null> {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      include: {
        benefits: true,
        features: true,
      },
    });

    if (!plan) return null;

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      billingCycle: plan.billing_cycle as 'monthly' | 'annual',
      benefits: {
        freeDelivery: plan.benefits.free_reskflow,
        freeDeliveryMinimum: plan.benefits.free_reskflow_minimum,
        reducedServiceFee: plan.benefits.reduced_service_fee,
        exclusiveOffers: plan.benefits.exclusive_offers,
        prioritySupport: plan.benefits.priority_support,
        rewardMultiplier: plan.benefits.reward_multiplier,
        monthlyCredits: plan.benefits.monthly_credits,
      },
      features: plan.features.map(f => f.description),
      isActive: plan.is_active,
    };
  }

  async subscribe(params: SubscribeParams) {
    const { userId, planId, paymentMethodId, promoCode } = params;

    // Check if user already has active subscription
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        user_id: userId,
        status: { in: ['active', 'trialing'] },
      },
    });

    if (existingSubscription) {
      throw new Error('User already has an active subscription');
    }

    // Get plan details
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      include: { benefits: true },
    });

    if (!plan || !plan.is_active) {
      throw new Error('Invalid subscription plan');
    }

    // Apply promo code if provided
    let discount = 0;
    let trialDays = 0;
    if (promoCode) {
      const promo = await this.validatePromoCode(promoCode, userId);
      if (promo) {
        discount = promo.discount_percentage;
        trialDays = promo.trial_days || 0;
      }
    }

    // Calculate pricing
    const price = plan.price * (1 - discount / 100);
    const trialEndsAt = trialDays > 0 
      ? dayjs().add(trialDays, 'day').toDate() 
      : null;

    // Create subscription
    const subscription = await prisma.subscription.create({
      data: {
        user_id: userId,
        plan_id: planId,
        status: trialDays > 0 ? 'trialing' : 'active',
        current_period_start: new Date(),
        current_period_end: this.calculatePeriodEnd(plan.billing_cycle),
        trial_end: trialEndsAt,
        payment_method_id: paymentMethodId,
        amount: price,
        currency: 'usd',
        metadata: {
          promo_code: promoCode,
          discount_applied: discount,
        },
      },
    });

    // Set up billing
    if (trialDays === 0) {
      await this.billingService.createInitialCharge(subscription.id, price);
    } else {
      await this.billingService.scheduleTrialEndCharge(subscription.id, trialEndsAt!);
    }

    // Initialize benefits
    await this.benefitsService.initializeSubscriptionBenefits(
      subscription.id,
      plan.benefits
    );

    // Track analytics
    await this.analyticsService.trackSubscriptionEvent({
      event: 'subscription_created',
      subscriptionId: subscription.id,
      userId,
      planId,
      revenue: price,
      metadata: { promo_code: promoCode },
    });

    // Clear user's subscription cache
    await redis.del(`user_subscription:${userId}`);

    return subscription;
  }

  async getUserSubscription(userId: string) {
    const cacheKey = `user_subscription:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        user_id: userId,
        status: { in: ['active', 'trialing', 'past_due'] },
      },
      include: {
        plan: {
          include: {
            benefits: true,
            features: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!subscription) return null;

    const benefits = await this.benefitsService.getUserBenefits(
      subscription.id,
      userId
    );

    const result = {
      id: subscription.id,
      status: subscription.status,
      plan: {
        id: subscription.plan.id,
        name: subscription.plan.name,
        price: subscription.plan.price,
        billingCycle: subscription.plan.billing_cycle,
      },
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      trialEnd: subscription.trial_end,
      canceledAt: subscription.canceled_at,
      benefits,
    };

    await redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }

  async cancelSubscription(
    subscriptionId: string,
    userId: string,
    reason?: string,
    feedback?: string
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

    if (subscription.status === 'canceled') {
      throw new Error('Subscription already canceled');
    }

    // Update subscription
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'canceled',
        canceled_at: new Date(),
        cancel_at_period_end: true,
        cancellation_reason: reason,
        cancellation_feedback: feedback,
      },
    });

    // Cancel future billing
    await this.billingService.cancelFutureBilling(subscriptionId);

    // Track analytics
    await this.analyticsService.trackSubscriptionEvent({
      event: 'subscription_canceled',
      subscriptionId,
      userId,
      metadata: { reason, feedback },
    });

    // Clear cache
    await redis.del(`user_subscription:${userId}`);

    return {
      success: true,
      message: 'Subscription will be canceled at the end of the current period',
      cancelDate: subscription.current_period_end,
    };
  }

  async pauseSubscription(
    subscriptionId: string,
    userId: string,
    resumeDate?: Date
  ) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user_id: userId,
        status: 'active',
      },
    });

    if (!subscription) {
      throw new Error('Active subscription not found');
    }

    // Calculate resume date (max 3 months)
    const maxPauseDate = dayjs().add(3, 'month').toDate();
    const pauseUntil = resumeDate && resumeDate < maxPauseDate 
      ? resumeDate 
      : maxPauseDate;

    // Update subscription
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'paused',
        paused_at: new Date(),
        pause_collection: {
          behavior: 'void',
          resumes_at: pauseUntil,
        },
      },
    });

    // Pause billing
    await this.billingService.pauseBilling(subscriptionId, pauseUntil);

    // Track analytics
    await this.analyticsService.trackSubscriptionEvent({
      event: 'subscription_paused',
      subscriptionId,
      userId,
      metadata: { resume_date: pauseUntil },
    });

    // Clear cache
    await redis.del(`user_subscription:${userId}`);

    return {
      success: true,
      message: 'Subscription paused',
      resumeDate: pauseUntil,
    };
  }

  async resumeSubscription(subscriptionId: string, userId: string) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user_id: userId,
        status: 'paused',
      },
    });

    if (!subscription) {
      throw new Error('Paused subscription not found');
    }

    // Update subscription
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'active',
        paused_at: null,
        pause_collection: null,
      },
    });

    // Resume billing
    await this.billingService.resumeBilling(subscriptionId);

    // Track analytics
    await this.analyticsService.trackSubscriptionEvent({
      event: 'subscription_resumed',
      subscriptionId,
      userId,
    });

    // Clear cache
    await redis.del(`user_subscription:${userId}`);

    return {
      success: true,
      message: 'Subscription resumed',
    };
  }

  async changePlan(
    subscriptionId: string,
    userId: string,
    newPlanId: string
  ) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        user_id: userId,
        status: { in: ['active', 'trialing'] },
      },
      include: { plan: true },
    });

    if (!subscription) {
      throw new Error('Active subscription not found');
    }

    const newPlan = await prisma.subscriptionPlan.findUnique({
      where: { id: newPlanId },
      include: { benefits: true },
    });

    if (!newPlan || !newPlan.is_active) {
      throw new Error('Invalid plan');
    }

    // Calculate proration
    const proration = await this.billingService.calculateProration(
      subscription,
      newPlan
    );

    // Update subscription
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        plan_id: newPlanId,
        amount: newPlan.price,
        updated_at: new Date(),
      },
    });

    // Update benefits
    await this.benefitsService.updatePlanBenefits(
      subscriptionId,
      newPlan.benefits
    );

    // Handle billing change
    if (proration.amount !== 0) {
      await this.billingService.applyProration(subscriptionId, proration);
    }

    // Track analytics
    await this.analyticsService.trackSubscriptionEvent({
      event: 'plan_changed',
      subscriptionId,
      userId,
      metadata: {
        old_plan: subscription.plan.id,
        new_plan: newPlanId,
        proration: proration.amount,
      },
    });

    // Clear cache
    await redis.del(`user_subscription:${userId}`);

    return {
      success: true,
      message: 'Plan changed successfully',
      proration,
    };
  }

  private calculatePeriodEnd(billingCycle: string): Date {
    const now = dayjs();
    switch (billingCycle) {
      case 'monthly':
        return now.add(1, 'month').toDate();
      case 'annual':
        return now.add(1, 'year').toDate();
      default:
        return now.add(1, 'month').toDate();
    }
  }

  private async validatePromoCode(code: string, userId: string) {
    const promo = await prisma.promoCode.findFirst({
      where: {
        code,
        is_active: true,
        valid_from: { lte: new Date() },
        valid_until: { gte: new Date() },
        OR: [
          { usage_limit: null },
          { usage_count: { lt: prisma.promoCode.fields.usage_limit } },
        ],
      },
    });

    if (!promo) return null;

    // Check if user already used this promo
    const previousUsage = await prisma.promoCodeUsage.findFirst({
      where: {
        promo_code_id: promo.id,
        user_id: userId,
      },
    });

    if (previousUsage) return null;

    // Record usage
    await prisma.promoCodeUsage.create({
      data: {
        promo_code_id: promo.id,
        user_id: userId,
        used_at: new Date(),
      },
    });

    // Increment usage count
    await prisma.promoCode.update({
      where: { id: promo.id },
      data: { usage_count: { increment: 1 } },
    });

    return promo;
  }
}