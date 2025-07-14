import { prisma, logger, redis } from '@reskflow/shared';
import Bull from 'bull';
import dayjs from 'dayjs';

interface BenefitJob {
  type: 'apply' | 'reset' | 'expire';
  subscriptionId?: string;
  benefitId?: string;
  metadata?: any;
}

interface SubscriptionBenefits {
  freeDelivery: {
    enabled: boolean;
    minimumOrder?: number;
    remainingUses?: number;
  };
  reducedServiceFee: {
    enabled: boolean;
    percentage: number;
  };
  monthlyCredits: {
    amount: number;
    remaining: number;
    expiresAt: Date;
  };
  exclusiveOffers: boolean;
  prioritySupport: boolean;
  rewardMultiplier: number;
}

export class BenefitsService {
  private benefitsQueue: Bull.Queue;

  constructor(benefitsQueue: Bull.Queue) {
    this.benefitsQueue = benefitsQueue;
  }

  async processBenefitJob(job: BenefitJob) {
    logger.info(`Processing benefit job: ${job.type}`);

    try {
      switch (job.type) {
        case 'apply':
          return await this.applyBenefitToOrder(job.metadata);
        case 'reset':
          return await this.resetSubscriptionBenefits(job.subscriptionId!);
        case 'expire':
          return await this.expireBenefits(job.benefitId!);
        default:
          throw new Error(`Unknown benefit job type: ${job.type}`);
      }
    } catch (error) {
      logger.error(`Benefit job failed: ${job.type}`, error);
      throw error;
    }
  }

  async initializeSubscriptionBenefits(subscriptionId: string, planBenefits: any) {
    // Create benefit records
    await prisma.subscriptionBenefit.create({
      data: {
        subscription_id: subscriptionId,
        type: 'free_reskflow',
        enabled: planBenefits.free_reskflow,
        metadata: {
          minimum_order: planBenefits.free_reskflow_minimum,
        },
      },
    });

    await prisma.subscriptionBenefit.create({
      data: {
        subscription_id: subscriptionId,
        type: 'reduced_service_fee',
        enabled: planBenefits.reduced_service_fee > 0,
        metadata: {
          percentage: planBenefits.reduced_service_fee,
        },
      },
    });

    if (planBenefits.monthly_credits > 0) {
      await prisma.subscriptionBenefit.create({
        data: {
          subscription_id: subscriptionId,
          type: 'monthly_credits',
          enabled: true,
          value: planBenefits.monthly_credits,
          remaining_value: planBenefits.monthly_credits,
          expires_at: dayjs().endOf('month').toDate(),
        },
      });
    }

    await prisma.subscriptionBenefit.create({
      data: {
        subscription_id: subscriptionId,
        type: 'exclusive_offers',
        enabled: planBenefits.exclusive_offers,
      },
    });

    await prisma.subscriptionBenefit.create({
      data: {
        subscription_id: subscriptionId,
        type: 'priority_support',
        enabled: planBenefits.priority_support,
      },
    });

    await prisma.subscriptionBenefit.create({
      data: {
        subscription_id: subscriptionId,
        type: 'reward_multiplier',
        enabled: planBenefits.reward_multiplier > 1,
        value: planBenefits.reward_multiplier,
      },
    });

    logger.info(`Initialized benefits for subscription ${subscriptionId}`);
  }

  async getUserBenefits(
    subscriptionId: string,
    userId: string
  ): Promise<SubscriptionBenefits> {
    const cacheKey = `subscription_benefits:${subscriptionId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const benefits = await prisma.subscriptionBenefit.findMany({
      where: {
        subscription_id: subscriptionId,
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } },
        ],
      },
    });

    const benefitMap = new Map(benefits.map(b => [b.type, b]));

    const result: SubscriptionBenefits = {
      freeDelivery: {
        enabled: benefitMap.get('free_reskflow')?.enabled || false,
        minimumOrder: benefitMap.get('free_reskflow')?.metadata?.minimum_order,
        remainingUses: benefitMap.get('free_reskflow')?.remaining_uses,
      },
      reducedServiceFee: {
        enabled: benefitMap.get('reduced_service_fee')?.enabled || false,
        percentage: benefitMap.get('reduced_service_fee')?.metadata?.percentage || 0,
      },
      monthlyCredits: {
        amount: benefitMap.get('monthly_credits')?.value || 0,
        remaining: benefitMap.get('monthly_credits')?.remaining_value || 0,
        expiresAt: benefitMap.get('monthly_credits')?.expires_at || new Date(),
      },
      exclusiveOffers: benefitMap.get('exclusive_offers')?.enabled || false,
      prioritySupport: benefitMap.get('priority_support')?.enabled || false,
      rewardMultiplier: benefitMap.get('reward_multiplier')?.value || 1,
    };

    await redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }

  async checkBenefitEligibility(
    userId: string,
    orderId: string,
    merchantId: string
  ) {
    // Get user's active subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        user_id: userId,
        status: { in: ['active', 'trialing'] },
      },
      include: {
        benefits: true,
      },
    });

    if (!subscription) {
      return { eligible: false, reason: 'No active subscription' };
    }

    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return { eligible: false, reason: 'Order not found' };
    }

    const eligibleBenefits = [];

    // Check free reskflow eligibility
    const freeDeliveryBenefit = subscription.benefits.find(
      b => b.type === 'free_reskflow' && b.enabled
    );
    if (freeDeliveryBenefit) {
      const minimumOrder = freeDeliveryBenefit.metadata?.minimum_order || 0;
      if (order.subtotal >= minimumOrder) {
        eligibleBenefits.push({
          type: 'free_reskflow',
          value: order.reskflow_fee,
          description: `Free reskflow (min order $${minimumOrder})`,
        });
      }
    }

    // Check service fee reduction
    const serviceFee = subscription.benefits.find(
      b => b.type === 'reduced_service_fee' && b.enabled
    );
    if (serviceFee) {
      const reduction = order.service_fee * (serviceFee.metadata.percentage / 100);
      eligibleBenefits.push({
        type: 'reduced_service_fee',
        value: reduction,
        description: `${serviceFee.metadata.percentage}% off service fee`,
      });
    }

    // Check monthly credits
    const credits = subscription.benefits.find(
      b => b.type === 'monthly_credits' && b.enabled && b.remaining_value > 0
    );
    if (credits) {
      const applicableCredit = Math.min(credits.remaining_value, order.total);
      eligibleBenefits.push({
        type: 'monthly_credits',
        value: applicableCredit,
        description: `$${applicableCredit} credit applied`,
      });
    }

    // Check exclusive merchant offers
    const exclusiveOffers = await this.checkExclusiveOffers(
      subscription.id,
      merchantId
    );
    if (exclusiveOffers.length > 0) {
      eligibleBenefits.push(...exclusiveOffers);
    }

    return {
      eligible: eligibleBenefits.length > 0,
      benefits: eligibleBenefits,
      totalSavings: eligibleBenefits.reduce((sum, b) => sum + b.value, 0),
    };
  }

  async applyBenefit(userId: string, orderId: string, benefitType: string) {
    const eligibility = await this.checkBenefitEligibility(
      userId,
      orderId,
      ''
    );

    if (!eligibility.eligible) {
      throw new Error('Not eligible for benefits');
    }

    const benefit = eligibility.benefits.find(b => b.type === benefitType);
    if (!benefit) {
      throw new Error('Benefit not available');
    }

    // Apply benefit to order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    let updatedOrder;
    switch (benefitType) {
      case 'free_reskflow':
        updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            reskflow_fee: 0,
            subscription_discount: order.subscription_discount + benefit.value,
          },
        });
        break;

      case 'reduced_service_fee':
        updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            service_fee: order.service_fee - benefit.value,
            subscription_discount: order.subscription_discount + benefit.value,
          },
        });
        break;

      case 'monthly_credits':
        // Deduct from remaining credits
        const subscription = await prisma.subscription.findFirst({
          where: { user_id: userId, status: 'active' },
        });

        await prisma.subscriptionBenefit.updateMany({
          where: {
            subscription_id: subscription!.id,
            type: 'monthly_credits',
          },
          data: {
            remaining_value: {
              decrement: benefit.value,
            },
          },
        });

        updatedOrder = await prisma.order.update({
          where: { id: orderId },
          data: {
            subscription_credit_used: benefit.value,
            total: order.total - benefit.value,
          },
        });
        break;
    }

    // Record benefit usage
    await prisma.benefitUsage.create({
      data: {
        subscription_id: subscription!.id,
        benefit_type: benefitType,
        order_id: orderId,
        value_saved: benefit.value,
        used_at: new Date(),
      },
    });

    // Clear cache
    await redis.del(`subscription_benefits:${subscription!.id}`);

    return {
      success: true,
      appliedBenefit: benefit,
      updatedTotal: updatedOrder!.total,
    };
  }

  async resetMonthlyBenefits() {
    logger.info('Resetting monthly subscription benefits');

    // Get all active subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: { status: 'active' },
      include: {
        plan: {
          include: { benefits: true },
        },
      },
    });

    for (const subscription of subscriptions) {
      // Reset monthly credits
      if (subscription.plan.benefits.monthly_credits > 0) {
        await prisma.subscriptionBenefit.updateMany({
          where: {
            subscription_id: subscription.id,
            type: 'monthly_credits',
          },
          data: {
            remaining_value: subscription.plan.benefits.monthly_credits,
            expires_at: dayjs().endOf('month').toDate(),
          },
        });
      }

      // Reset usage counters if any
      await prisma.subscriptionBenefit.updateMany({
        where: {
          subscription_id: subscription.id,
          type: 'free_reskflow',
        },
        data: {
          remaining_uses: subscription.plan.benefits.free_reskflow_monthly_limit,
        },
      });

      // Clear cache
      await redis.del(`subscription_benefits:${subscription.id}`);
    }

    logger.info(`Reset benefits for ${subscriptions.length} subscriptions`);
  }

  async updatePlanBenefits(subscriptionId: string, newPlanBenefits: any) {
    // Update existing benefits
    await prisma.subscriptionBenefit.updateMany({
      where: {
        subscription_id: subscriptionId,
        type: 'free_reskflow',
      },
      data: {
        enabled: newPlanBenefits.free_reskflow,
        metadata: {
          minimum_order: newPlanBenefits.free_reskflow_minimum,
        },
      },
    });

    await prisma.subscriptionBenefit.updateMany({
      where: {
        subscription_id: subscriptionId,
        type: 'reduced_service_fee',
      },
      data: {
        enabled: newPlanBenefits.reduced_service_fee > 0,
        metadata: {
          percentage: newPlanBenefits.reduced_service_fee,
        },
      },
    });

    // Handle monthly credits change
    const currentCredits = await prisma.subscriptionBenefit.findFirst({
      where: {
        subscription_id: subscriptionId,
        type: 'monthly_credits',
      },
    });

    if (currentCredits) {
      const creditDiff = newPlanBenefits.monthly_credits - currentCredits.value;
      if (creditDiff > 0) {
        // Add additional credits
        await prisma.subscriptionBenefit.update({
          where: { id: currentCredits.id },
          data: {
            value: newPlanBenefits.monthly_credits,
            remaining_value: currentCredits.remaining_value + creditDiff,
          },
        });
      }
    }

    // Clear cache
    await redis.del(`subscription_benefits:${subscriptionId}`);
  }

  private async checkExclusiveOffers(
    subscriptionId: string,
    merchantId: string
  ) {
    // Check for subscription-exclusive merchant offers
    const offers = await prisma.merchantOffer.findMany({
      where: {
        merchant_id: merchantId,
        subscription_only: true,
        is_active: true,
        valid_from: { lte: new Date() },
        valid_until: { gte: new Date() },
      },
    });

    return offers.map(offer => ({
      type: 'exclusive_offer',
      value: offer.discount_value,
      description: offer.description,
      offerId: offer.id,
    }));
  }

  private async applyBenefitToOrder(metadata: any) {
    const { orderId, benefitType, value } = metadata;
    
    // Implementation handled by applyBenefit method
    logger.info(`Applied ${benefitType} benefit to order ${orderId}`);
  }

  private async resetSubscriptionBenefits(subscriptionId: string) {
    // Implementation handled by resetMonthlyBenefits
    logger.info(`Reset benefits for subscription ${subscriptionId}`);
  }

  private async expireBenefits(benefitId: string) {
    await prisma.subscriptionBenefit.update({
      where: { id: benefitId },
      data: {
        enabled: false,
        expires_at: new Date(),
      },
    });
    
    logger.info(`Expired benefit ${benefitId}`);
  }
}