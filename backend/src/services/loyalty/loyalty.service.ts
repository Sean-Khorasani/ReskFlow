/**
 * Loyalty & Rewards Service
 * Manages customer loyalty points, tiers, and rewards
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { blockchainService } from '../blockchain/blockchain.service';

const prisma = new PrismaClient();

interface LoyaltyTier {
  id: string;
  name: string;
  minPoints: number;
  benefits: {
    discountPercentage: number;
    freeDelivery: boolean;
    prioritySupport: boolean;
    exclusiveOffers: boolean;
    birthdayReward: boolean;
  };
  color: string;
  icon: string;
}

interface Reward {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  type: 'discount' | 'free_reskflow' | 'free_item' | 'cashback' | 'experience';
  value: number;
  validityDays: number;
  minOrderAmount?: number;
  maxRedemptions?: number;
  merchantId?: string;
}

interface PointsTransaction {
  id: string;
  customerId: string;
  points: number;
  type: 'earned' | 'redeemed' | 'expired' | 'bonus' | 'referral';
  description: string;
  orderId?: string;
  rewardId?: string;
  expiresAt?: Date;
  createdAt: Date;
}

export class LoyaltyService extends EventEmitter {
  private tiers: LoyaltyTier[] = [
    {
      id: 'bronze',
      name: 'Bronze',
      minPoints: 0,
      benefits: {
        discountPercentage: 0,
        freeDelivery: false,
        prioritySupport: false,
        exclusiveOffers: false,
        birthdayReward: true,
      },
      color: '#CD7F32',
      icon: 'bronze_medal',
    },
    {
      id: 'silver',
      name: 'Silver',
      minPoints: 500,
      benefits: {
        discountPercentage: 5,
        freeDelivery: false,
        prioritySupport: false,
        exclusiveOffers: true,
        birthdayReward: true,
      },
      color: '#C0C0C0',
      icon: 'silver_medal',
    },
    {
      id: 'gold',
      name: 'Gold',
      minPoints: 2000,
      benefits: {
        discountPercentage: 10,
        freeDelivery: true,
        prioritySupport: true,
        exclusiveOffers: true,
        birthdayReward: true,
      },
      color: '#FFD700',
      icon: 'gold_medal',
    },
    {
      id: 'platinum',
      name: 'Platinum',
      minPoints: 5000,
      benefits: {
        discountPercentage: 15,
        freeDelivery: true,
        prioritySupport: true,
        exclusiveOffers: true,
        birthdayReward: true,
      },
      color: '#E5E4E2',
      icon: 'diamond',
    },
  ];

  constructor() {
    super();
    this.initializeRewards();
    this.setupPointsExpiration();
  }

  /**
   * Initialize default rewards catalog
   */
  private async initializeRewards() {
    const defaultRewards: Reward[] = [
      {
        id: 'free_reskflow_100',
        name: 'Free Delivery',
        description: 'Get free reskflow on your next order',
        pointsCost: 100,
        type: 'free_reskflow',
        value: 0,
        validityDays: 30,
      },
      {
        id: 'discount_5_250',
        name: '5% Off',
        description: 'Get 5% off your next order',
        pointsCost: 250,
        type: 'discount',
        value: 5,
        validityDays: 30,
        minOrderAmount: 20,
      },
      {
        id: 'discount_10_500',
        name: '10% Off',
        description: 'Get 10% off your next order',
        pointsCost: 500,
        type: 'discount',
        value: 10,
        validityDays: 30,
        minOrderAmount: 30,
      },
      {
        id: 'cashback_5_750',
        name: '$5 Cashback',
        description: 'Get $5 cashback to your wallet',
        pointsCost: 750,
        type: 'cashback',
        value: 5,
        validityDays: 60,
      },
      {
        id: 'surprise_meal_1000',
        name: 'Surprise Meal',
        description: 'Get a surprise meal from a partner restaurant',
        pointsCost: 1000,
        type: 'experience',
        value: 0,
        validityDays: 14,
        maxRedemptions: 1,
      },
    ];

    // Store rewards in database
    for (const reward of defaultRewards) {
      await prisma.reward.upsert({
        where: { id: reward.id },
        create: reward,
        update: reward,
      });
    }
  }

  /**
   * Setup cron job for points expiration
   */
  private setupPointsExpiration() {
    // Run daily at midnight
    setInterval(async () => {
      await this.expirePoints();
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Calculate points earned for an order
   */
  calculateOrderPoints(orderAmount: number, customerTier: string): number {
    const basePoints = Math.floor(orderAmount); // 1 point per dollar
    
    // Tier multipliers
    const multipliers: Record<string, number> = {
      bronze: 1,
      silver: 1.5,
      gold: 2,
      platinum: 3,
    };
    
    const multiplier = multipliers[customerTier] || 1;
    return Math.floor(basePoints * multiplier);
  }

  /**
   * Award points to customer
   */
  async awardPoints(
    customerId: string,
    points: number,
    type: PointsTransaction['type'],
    description: string,
    orderId?: string,
    expiresInDays: number = 365
  ): Promise<PointsTransaction> {
    try {
      // Create points transaction
      const transaction = await prisma.pointsTransaction.create({
        data: {
          customerId,
          points,
          type,
          description,
          orderId,
          expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        },
      });

      // Update customer total points
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          loyaltyPoints: {
            increment: points,
          },
          lifetimePoints: {
            increment: points,
          },
        },
      });

      // Check for tier upgrade
      await this.checkTierUpgrade(customerId);

      // Record on blockchain
      if (process.env.BLOCKCHAIN_ENABLED === 'true') {
        await blockchainService.recordLoyaltyPoints(customerId, points, type);
      }

      // Emit event
      this.emit('points:awarded', {
        customerId,
        points,
        transaction,
      });

      logger.info(`Awarded ${points} points to customer ${customerId}`, {
        type,
        orderId,
      });

      return transaction;

    } catch (error) {
      logger.error('Failed to award points', error);
      throw error;
    }
  }

  /**
   * Redeem points for a reward
   */
  async redeemReward(customerId: string, rewardId: string): Promise<any> {
    try {
      // Get customer and reward
      const [customer, reward] = await Promise.all([
        prisma.customer.findUnique({ where: { id: customerId } }),
        prisma.reward.findUnique({ where: { id: rewardId } }),
      ]);

      if (!customer || !reward) {
        throw new Error('Customer or reward not found');
      }

      if (customer.loyaltyPoints < reward.pointsCost) {
        throw new Error('Insufficient points');
      }

      // Check max redemptions
      if (reward.maxRedemptions) {
        const redemptionCount = await prisma.redemption.count({
          where: {
            customerId,
            rewardId,
          },
        });

        if (redemptionCount >= reward.maxRedemptions) {
          throw new Error('Maximum redemptions reached for this reward');
        }
      }

      // Create redemption
      const redemption = await prisma.redemption.create({
        data: {
          customerId,
          rewardId,
          pointsRedeemed: reward.pointsCost,
          status: 'active',
          expiresAt: new Date(Date.now() + reward.validityDays * 24 * 60 * 60 * 1000),
          code: this.generateRedemptionCode(),
        },
      });

      // Deduct points
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          loyaltyPoints: {
            decrement: reward.pointsCost,
          },
        },
      });

      // Create points transaction
      await prisma.pointsTransaction.create({
        data: {
          customerId,
          points: -reward.pointsCost,
          type: 'redeemed',
          description: `Redeemed: ${reward.name}`,
          rewardId,
        },
      });

      // Apply reward based on type
      const rewardApplication = await this.applyReward(customer, reward, redemption);

      // Emit event
      this.emit('reward:redeemed', {
        customerId,
        reward,
        redemption,
        application: rewardApplication,
      });

      return {
        redemption,
        application: rewardApplication,
      };

    } catch (error) {
      logger.error('Failed to redeem reward', error);
      throw error;
    }
  }

  /**
   * Apply reward to customer account
   */
  private async applyReward(customer: any, reward: any, redemption: any): Promise<any> {
    switch (reward.type) {
      case 'discount':
        // Create discount code
        return {
          type: 'discount_code',
          code: redemption.code,
          value: reward.value,
          validUntil: redemption.expiresAt,
        };

      case 'free_reskflow':
        // Add free reskflow credit
        await prisma.customer.update({
          where: { id: customer.id },
          data: {
            freeDeliveryCredits: {
              increment: 1,
            },
          },
        });
        return {
          type: 'free_reskflow_credit',
          creditsAdded: 1,
        };

      case 'cashback':
        // Add to wallet
        await prisma.wallet.update({
          where: { customerId: customer.id },
          data: {
            balance: {
              increment: reward.value,
            },
          },
        });
        return {
          type: 'wallet_credit',
          amount: reward.value,
        };

      case 'free_item':
        // Create voucher for free item
        return {
          type: 'voucher',
          code: redemption.code,
          item: reward.metadata?.itemName,
          merchantId: reward.merchantId,
        };

      case 'experience':
        // Special experience handling
        await this.handleExperienceReward(customer, reward, redemption);
        return {
          type: 'experience',
          details: reward.metadata,
        };

      default:
        throw new Error(`Unknown reward type: ${reward.type}`);
    }
  }

  /**
   * Check and update customer tier
   */
  async checkTierUpgrade(customerId: string): Promise<void> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) return;

    const currentTier = this.getTierByPoints(customer.lifetimePoints);
    
    if (currentTier.id !== customer.loyaltyTier) {
      // Update tier
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          loyaltyTier: currentTier.id,
        },
      });

      // Award tier upgrade bonus
      if (this.isTierUpgrade(customer.loyaltyTier, currentTier.id)) {
        await this.awardPoints(
          customerId,
          100,
          'bonus',
          `Upgraded to ${currentTier.name} tier!`
        );

        // Send notification
        this.emit('tier:upgraded', {
          customerId,
          oldTier: customer.loyaltyTier,
          newTier: currentTier,
        });
      }
    }
  }

  /**
   * Get tier by points
   */
  getTierByPoints(points: number): LoyaltyTier {
    // Sort tiers by minPoints descending
    const sortedTiers = [...this.tiers].sort((a, b) => b.minPoints - a.minPoints);
    
    for (const tier of sortedTiers) {
      if (points >= tier.minPoints) {
        return tier;
      }
    }
    
    return this.tiers[0]; // Default to bronze
  }

  /**
   * Check if tier upgrade
   */
  private isTierUpgrade(oldTierId: string, newTierId: string): boolean {
    const tierOrder = ['bronze', 'silver', 'gold', 'platinum'];
    const oldIndex = tierOrder.indexOf(oldTierId);
    const newIndex = tierOrder.indexOf(newTierId);
    return newIndex > oldIndex;
  }

  /**
   * Get customer loyalty status
   */
  async getCustomerLoyaltyStatus(customerId: string): Promise<any> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        pointsTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        redemptions: {
          where: {
            status: 'active',
            expiresAt: { gte: new Date() },
          },
        },
      },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    const currentTier = this.getTierByPoints(customer.lifetimePoints);
    const nextTier = this.getNextTier(currentTier.id);
    const pointsToNextTier = nextTier ? nextTier.minPoints - customer.lifetimePoints : 0;

    // Get available rewards
    const rewards = await prisma.reward.findMany({
      where: {
        pointsCost: { lte: customer.loyaltyPoints },
        isActive: true,
      },
      orderBy: { pointsCost: 'asc' },
    });

    // Get points expiring soon
    const expiringPoints = await prisma.pointsTransaction.aggregate({
      where: {
        customerId,
        points: { gt: 0 },
        expiresAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      },
      _sum: { points: true },
    });

    return {
      currentPoints: customer.loyaltyPoints,
      lifetimePoints: customer.lifetimePoints,
      currentTier,
      nextTier,
      pointsToNextTier,
      tierBenefits: currentTier.benefits,
      availableRewards: rewards,
      activeRedemptions: customer.redemptions,
      recentTransactions: customer.pointsTransactions,
      expiringPoints: expiringPoints._sum.points || 0,
    };
  }

  /**
   * Get next tier
   */
  private getNextTier(currentTierId: string): LoyaltyTier | null {
    const tierOrder = ['bronze', 'silver', 'gold', 'platinum'];
    const currentIndex = tierOrder.indexOf(currentTierId);
    
    if (currentIndex < tierOrder.length - 1) {
      const nextTierId = tierOrder[currentIndex + 1];
      return this.tiers.find(t => t.id === nextTierId) || null;
    }
    
    return null;
  }

  /**
   * Handle experience rewards
   */
  private async handleExperienceReward(customer: any, reward: any, redemption: any) {
    // Implementation for special experience rewards
    // Could include VIP events, cooking classes, meet the chef, etc.
    
    await prisma.notification.create({
      data: {
        userId: customer.userId,
        type: 'experience_reward',
        title: 'Your Experience Reward is Ready!',
        message: `Your ${reward.name} experience has been activated. Check your email for details.`,
        data: {
          rewardId: reward.id,
          redemptionId: redemption.id,
        },
      },
    });
  }

  /**
   * Award referral points
   */
  async awardReferralPoints(referrerId: string, referredId: string): Promise<void> {
    const referralPoints = 500; // Both get 500 points
    
    // Award to referrer
    await this.awardPoints(
      referrerId,
      referralPoints,
      'referral',
      'Referral bonus - friend joined!',
      undefined,
      180 // 6 months expiry
    );
    
    // Award to referred
    await this.awardPoints(
      referredId,
      referralPoints,
      'referral',
      'Welcome bonus - referred by a friend!',
      undefined,
      180
    );
  }

  /**
   * Process birthday rewards
   */
  async processBirthdayRewards(): Promise<void> {
    const today = new Date();
    const customers = await prisma.customer.findMany({
      where: {
        AND: [
          { birthDate: { not: null } },
          // Match month and day
          {
            birthDate: {
              gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
              lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
            },
          },
        ],
      },
    });

    for (const customer of customers) {
      // Check if already awarded this year
      const alreadyAwarded = await prisma.pointsTransaction.findFirst({
        where: {
          customerId: customer.id,
          type: 'bonus',
          description: { contains: 'Birthday bonus' },
          createdAt: {
            gte: new Date(today.getFullYear(), 0, 1),
          },
        },
      });

      if (!alreadyAwarded) {
        const tier = this.getTierByPoints(customer.lifetimePoints);
        const birthdayPoints = tier.id === 'platinum' ? 1000 : 
                              tier.id === 'gold' ? 500 : 
                              tier.id === 'silver' ? 250 : 100;

        await this.awardPoints(
          customer.id,
          birthdayPoints,
          'bonus',
          'Happy Birthday bonus! 🎂',
          undefined,
          90 // 3 months to use
        );
      }
    }
  }

  /**
   * Expire old points
   */
  async expirePoints(): Promise<void> {
    const expiredTransactions = await prisma.pointsTransaction.findMany({
      where: {
        points: { gt: 0 },
        expiresAt: { lt: new Date() },
        expired: false,
      },
    });

    for (const transaction of expiredTransactions) {
      // Mark as expired
      await prisma.pointsTransaction.update({
        where: { id: transaction.id },
        data: { expired: true },
      });

      // Deduct from customer balance
      await prisma.customer.update({
        where: { id: transaction.customerId },
        data: {
          loyaltyPoints: {
            decrement: transaction.points,
          },
        },
      });

      // Create expiration transaction
      await prisma.pointsTransaction.create({
        data: {
          customerId: transaction.customerId,
          points: -transaction.points,
          type: 'expired',
          description: `Points expired from: ${transaction.description}`,
        },
      });
    }
  }

  /**
   * Generate redemption code
   */
  private generateRedemptionCode(): string {
    return `RESK${Date.now().toString(36).toUpperCase()}`;
  }

  /**
   * Get rewards catalog
   */
  async getRewardsCatalog(customerId?: string): Promise<any[]> {
    const rewards = await prisma.reward.findMany({
      where: { isActive: true },
      orderBy: { pointsCost: 'asc' },
    });

    if (customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      // Mark which rewards are affordable
      return rewards.map(reward => ({
        ...reward,
        canAfford: customer ? customer.loyaltyPoints >= reward.pointsCost : false,
      }));
    }

    return rewards;
  }

  /**
   * Create custom merchant reward
   */
  async createMerchantReward(merchantId: string, rewardData: any): Promise<Reward> {
    const reward = await prisma.reward.create({
      data: {
        ...rewardData,
        merchantId,
        id: `merchant_${merchantId}_${Date.now()}`,
      },
    });

    this.emit('reward:created', {
      merchantId,
      reward,
    });

    return reward;
  }

  /**
   * Get loyalty leaderboard
   */
  async getLeaderboard(limit: number = 10): Promise<any[]> {
    const topCustomers = await prisma.customer.findMany({
      where: {
        lifetimePoints: { gt: 0 },
      },
      orderBy: { lifetimePoints: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        lifetimePoints: true,
        loyaltyTier: true,
      },
    });

    return topCustomers.map((customer, index) => ({
      rank: index + 1,
      ...customer,
      tier: this.getTierByPoints(customer.lifetimePoints),
    }));
  }
}

// Export singleton instance
export const loyaltyService = new LoyaltyService();