import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface LoyaltyProgram {
  id: string;
  merchantId: string;
  name: string;
  pointsPerDollar: number;
  tiers: LoyaltyTier[];
  rewards: LoyaltyReward[];
  expirationDays?: number;
  isActive: boolean;
}

interface LoyaltyTier {
  name: string;
  minPoints: number;
  benefits: string[];
  multiplier: number;
  color: string;
}

interface LoyaltyReward {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  type: 'discount' | 'free_item' | 'free_reskflow' | 'custom';
  value: number;
  isActive: boolean;
}

interface CustomerLoyalty {
  customerId: string;
  merchantId: string;
  currentPoints: number;
  lifetimePoints: number;
  currentTier: string;
  tierProgress: number;
  availableRewards: LoyaltyReward[];
  pointsExpiring?: {
    points: number;
    expiresAt: Date;
  };
}

interface PointsTransaction {
  id: string;
  customerId: string;
  merchantId: string;
  type: 'earned' | 'redeemed' | 'expired' | 'adjusted';
  points: number;
  balance: number;
  orderId?: string;
  rewardId?: string;
  description: string;
  createdAt: Date;
  expiresAt?: Date;
}

export class LoyaltyService {
  async createLoyaltyProgram(params: {
    merchantId: string;
    name: string;
    pointsPerDollar: number;
    tiers?: LoyaltyTier[];
    expirationDays?: number;
  }): Promise<LoyaltyProgram> {
    const defaultTiers: LoyaltyTier[] = [
      {
        name: 'Bronze',
        minPoints: 0,
        benefits: ['Earn points on every order'],
        multiplier: 1,
        color: '#CD7F32',
      },
      {
        name: 'Silver',
        minPoints: 500,
        benefits: ['1.5x points multiplier', 'Birthday bonus'],
        multiplier: 1.5,
        color: '#C0C0C0',
      },
      {
        name: 'Gold',
        minPoints: 1500,
        benefits: ['2x points multiplier', 'Priority support', 'Exclusive offers'],
        multiplier: 2,
        color: '#FFD700',
      },
      {
        name: 'Platinum',
        minPoints: 5000,
        benefits: ['3x points multiplier', 'Free reskflow', 'VIP perks'],
        multiplier: 3,
        color: '#E5E4E2',
      },
    ];

    const program = await prisma.loyaltyProgram.create({
      data: {
        id: uuidv4(),
        merchant_id: params.merchantId,
        name: params.name,
        points_per_dollar: params.pointsPerDollar,
        tiers: params.tiers || defaultTiers,
        expiration_days: params.expirationDays,
        is_active: true,
      },
    });

    // Create default rewards
    await this.createDefaultRewards(program.id);

    return this.mapToLoyaltyProgram(program);
  }

  async earnPoints(params: {
    customerId: string;
    merchantId: string;
    orderId: string;
    orderAmount: number;
  }): Promise<PointsTransaction> {
    // Get loyalty program
    const program = await prisma.loyaltyProgram.findFirst({
      where: {
        merchant_id: params.merchantId,
        is_active: true,
      },
    });

    if (!program) {
      throw new Error('No active loyalty program found');
    }

    // Get customer loyalty record
    const customerLoyalty = await this.getOrCreateCustomerLoyalty(
      params.customerId,
      params.merchantId
    );

    // Calculate points based on tier multiplier
    const tier = this.getCurrentTier(customerLoyalty.lifetime_points, program.tiers);
    const basePoints = Math.floor(params.orderAmount * program.points_per_dollar);
    const earnedPoints = Math.floor(basePoints * tier.multiplier);

    // Calculate expiration
    const expiresAt = program.expiration_days
      ? dayjs().add(program.expiration_days, 'day').toDate()
      : undefined;

    // Create transaction
    const transaction = await prisma.pointsTransaction.create({
      data: {
        id: uuidv4(),
        customer_id: params.customerId,
        merchant_id: params.merchantId,
        type: 'earned',
        points: earnedPoints,
        balance: customerLoyalty.current_points + earnedPoints,
        order_id: params.orderId,
        description: `Earned ${earnedPoints} points for order #${params.orderId}`,
        expires_at: expiresAt,
      },
    });

    // Update customer loyalty
    await prisma.customerLoyalty.update({
      where: {
        customer_id_merchant_id: {
          customer_id: params.customerId,
          merchant_id: params.merchantId,
        },
      },
      data: {
        current_points: { increment: earnedPoints },
        lifetime_points: { increment: earnedPoints },
        last_earned_at: new Date(),
      },
    });

    // Check for tier upgrade
    await this.checkTierUpgrade(params.customerId, params.merchantId);

    return this.mapToPointsTransaction(transaction);
  }

  async redeemReward(params: {
    customerId: string;
    merchantId: string;
    rewardId: string;
    orderId?: string;
  }): Promise<{
    success: boolean;
    transaction?: PointsTransaction;
    error?: string;
  }> {
    // Get reward
    const reward = await prisma.loyaltyReward.findUnique({
      where: { id: params.rewardId },
      include: {
        program: true,
      },
    });

    if (!reward || !reward.is_active) {
      return {
        success: false,
        error: 'Reward not found or inactive',
      };
    }

    // Get customer loyalty
    const customerLoyalty = await prisma.customerLoyalty.findUnique({
      where: {
        customer_id_merchant_id: {
          customer_id: params.customerId,
          merchant_id: params.merchantId,
        },
      },
    });

    if (!customerLoyalty || customerLoyalty.current_points < reward.points_cost) {
      return {
        success: false,
        error: 'Insufficient points',
      };
    }

    // Create redemption transaction
    const transaction = await prisma.pointsTransaction.create({
      data: {
        id: uuidv4(),
        customer_id: params.customerId,
        merchant_id: params.merchantId,
        type: 'redeemed',
        points: -reward.points_cost,
        balance: customerLoyalty.current_points - reward.points_cost,
        reward_id: params.rewardId,
        order_id: params.orderId,
        description: `Redeemed ${reward.name}`,
      },
    });

    // Update customer points
    await prisma.customerLoyalty.update({
      where: {
        customer_id_merchant_id: {
          customer_id: params.customerId,
          merchant_id: params.merchantId,
        },
      },
      data: {
        current_points: { decrement: reward.points_cost },
        last_redeemed_at: new Date(),
      },
    });

    // Create reward redemption record
    await prisma.rewardRedemption.create({
      data: {
        id: uuidv4(),
        customer_id: params.customerId,
        reward_id: params.rewardId,
        order_id: params.orderId,
        points_used: reward.points_cost,
        status: 'pending',
        created_at: new Date(),
      },
    });

    return {
      success: true,
      transaction: this.mapToPointsTransaction(transaction),
    };
  }

  async getCustomerPoints(
    customerId: string,
    merchantId: string
  ): Promise<CustomerLoyalty> {
    const [customerLoyalty, program] = await Promise.all([
      this.getOrCreateCustomerLoyalty(customerId, merchantId),
      prisma.loyaltyProgram.findFirst({
        where: {
          merchant_id: merchantId,
          is_active: true,
        },
        include: {
          rewards: {
            where: { is_active: true },
            orderBy: { points_cost: 'asc' },
          },
        },
      }),
    ]);

    if (!program) {
      throw new Error('No active loyalty program');
    }

    // Get current tier
    const currentTier = this.getCurrentTier(
      customerLoyalty.lifetime_points,
      program.tiers
    );

    // Calculate tier progress
    const nextTier = this.getNextTier(
      customerLoyalty.lifetime_points,
      program.tiers
    );
    
    const tierProgress = nextTier
      ? ((customerLoyalty.lifetime_points - currentTier.minPoints) /
         (nextTier.minPoints - currentTier.minPoints)) * 100
      : 100;

    // Get available rewards
    const availableRewards = program.rewards.filter(
      r => r.points_cost <= customerLoyalty.current_points
    );

    // Check for expiring points
    const expiringPoints = await this.getExpiringPoints(
      customerId,
      merchantId,
      30 // Next 30 days
    );

    return {
      customerId,
      merchantId,
      currentPoints: customerLoyalty.current_points,
      lifetimePoints: customerLoyalty.lifetime_points,
      currentTier: currentTier.name,
      tierProgress,
      availableRewards: availableRewards.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        pointsCost: r.points_cost,
        type: r.type,
        value: r.value,
        isActive: r.is_active,
      })),
      pointsExpiring: expiringPoints,
    };
  }

  async getPointsHistory(
    customerId: string,
    merchantId: string,
    limit: number = 50
  ): Promise<PointsTransaction[]> {
    const transactions = await prisma.pointsTransaction.findMany({
      where: {
        customer_id: customerId,
        merchant_id: merchantId,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
          },
        },
        reward: {
          select: {
            name: true,
          },
        },
      },
    });

    return transactions.map(t => this.mapToPointsTransaction(t));
  }

  async updateCustomerTiers(): Promise<void> {
    const programs = await prisma.loyaltyProgram.findMany({
      where: { is_active: true },
    });

    for (const program of programs) {
      const customers = await prisma.customerLoyalty.findMany({
        where: { merchant_id: program.merchant_id },
      });

      for (const customer of customers) {
        const currentTier = this.getCurrentTier(
          customer.lifetime_points,
          program.tiers
        );

        if (currentTier.name !== customer.current_tier) {
          await prisma.customerLoyalty.update({
            where: {
              customer_id_merchant_id: {
                customer_id: customer.customer_id,
                merchant_id: customer.merchant_id,
              },
            },
            data: {
              current_tier: currentTier.name,
              tier_updated_at: new Date(),
            },
          });

          // Send tier upgrade notification
          await this.sendTierNotification(
            customer.customer_id,
            currentTier.name,
            currentTier.benefits
          );
        }
      }
    }

    logger.info('Updated customer loyalty tiers');
  }

  async expirePoints(): Promise<void> {
    const expiredTransactions = await prisma.pointsTransaction.findMany({
      where: {
        expires_at: { lte: new Date() },
        type: 'earned',
        expired: false,
      },
    });

    for (const transaction of expiredTransactions) {
      // Calculate points to expire
      const usedPoints = await this.calculateUsedPoints(transaction);
      const pointsToExpire = Math.max(0, transaction.points - usedPoints);

      if (pointsToExpire > 0) {
        // Create expiration transaction
        await prisma.pointsTransaction.create({
          data: {
            id: uuidv4(),
            customer_id: transaction.customer_id,
            merchant_id: transaction.merchant_id,
            type: 'expired',
            points: -pointsToExpire,
            balance: 0, // Will be updated
            description: `${pointsToExpire} points expired`,
          },
        });

        // Update customer points
        await prisma.customerLoyalty.update({
          where: {
            customer_id_merchant_id: {
              customer_id: transaction.customer_id,
              merchant_id: transaction.merchant_id,
            },
          },
          data: {
            current_points: { decrement: pointsToExpire },
          },
        });
      }

      // Mark transaction as expired
      await prisma.pointsTransaction.update({
        where: { id: transaction.id },
        data: { expired: true },
      });
    }

    logger.info(`Expired points for ${expiredTransactions.length} transactions`);
  }

  async processLoyaltyTransaction(params: any): Promise<void> {
    // Process loyalty-related background tasks
    logger.info('Processing loyalty transaction:', params);
  }

  private async getOrCreateCustomerLoyalty(
    customerId: string,
    merchantId: string
  ): Promise<any> {
    let customerLoyalty = await prisma.customerLoyalty.findUnique({
      where: {
        customer_id_merchant_id: {
          customer_id: customerId,
          merchant_id: merchantId,
        },
      },
    });

    if (!customerLoyalty) {
      customerLoyalty = await prisma.customerLoyalty.create({
        data: {
          customer_id: customerId,
          merchant_id: merchantId,
          current_points: 0,
          lifetime_points: 0,
          current_tier: 'Bronze',
        },
      });
    }

    return customerLoyalty;
  }

  private async createDefaultRewards(programId: string): Promise<void> {
    const defaultRewards = [
      {
        name: '$5 Off',
        description: 'Get $5 off your next order',
        points_cost: 500,
        type: 'discount',
        value: 5,
      },
      {
        name: '$10 Off',
        description: 'Get $10 off your next order',
        points_cost: 1000,
        type: 'discount',
        value: 10,
      },
      {
        name: 'Free Delivery',
        description: 'Free reskflow on your next order',
        points_cost: 300,
        type: 'free_reskflow',
        value: 0,
      },
      {
        name: '$20 Off',
        description: 'Get $20 off your next order',
        points_cost: 1800,
        type: 'discount',
        value: 20,
      },
    ];

    await prisma.loyaltyReward.createMany({
      data: defaultRewards.map(r => ({
        id: uuidv4(),
        program_id: programId,
        ...r,
        is_active: true,
      })),
    });
  }

  private getCurrentTier(lifetimePoints: number, tiers: any[]): LoyaltyTier {
    const sortedTiers = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
    
    for (const tier of sortedTiers) {
      if (lifetimePoints >= tier.minPoints) {
        return tier;
      }
    }

    return tiers[0]; // Default tier
  }

  private getNextTier(lifetimePoints: number, tiers: any[]): LoyaltyTier | null {
    const sortedTiers = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
    
    for (const tier of sortedTiers) {
      if (lifetimePoints < tier.minPoints) {
        return tier;
      }
    }

    return null; // Already at highest tier
  }

  private async checkTierUpgrade(
    customerId: string,
    merchantId: string
  ): Promise<void> {
    const [customerLoyalty, program] = await Promise.all([
      prisma.customerLoyalty.findUnique({
        where: {
          customer_id_merchant_id: {
            customer_id: customerId,
            merchant_id: merchantId,
          },
        },
      }),
      prisma.loyaltyProgram.findFirst({
        where: {
          merchant_id: merchantId,
          is_active: true,
        },
      }),
    ]);

    if (!customerLoyalty || !program) return;

    const newTier = this.getCurrentTier(
      customerLoyalty.lifetime_points,
      program.tiers
    );

    if (newTier.name !== customerLoyalty.current_tier) {
      await prisma.customerLoyalty.update({
        where: {
          customer_id_merchant_id: {
            customer_id: customerId,
            merchant_id: merchantId,
          },
        },
        data: {
          current_tier: newTier.name,
          tier_updated_at: new Date(),
        },
      });

      await this.sendTierNotification(customerId, newTier.name, newTier.benefits);
    }
  }

  private async getExpiringPoints(
    customerId: string,
    merchantId: string,
    days: number
  ): Promise<{ points: number; expiresAt: Date } | undefined> {
    const expiringDate = dayjs().add(days, 'day').toDate();

    const result = await prisma.pointsTransaction.aggregate({
      where: {
        customer_id: customerId,
        merchant_id: merchantId,
        type: 'earned',
        expired: false,
        expires_at: {
          gte: new Date(),
          lte: expiringDate,
        },
      },
      _sum: { points: true },
      _min: { expires_at: true },
    });

    if (result._sum.points && result._sum.points > 0) {
      return {
        points: result._sum.points,
        expiresAt: result._min.expires_at!,
      };
    }

    return undefined;
  }

  private async calculateUsedPoints(transaction: any): Promise<number> {
    // Calculate how many points from this transaction have been used
    // This would require tracking point usage FIFO
    return 0;
  }

  private async sendTierNotification(
    customerId: string,
    tierName: string,
    benefits: string[]
  ): Promise<void> {
    // Send notification about tier upgrade
    logger.info(`Customer ${customerId} upgraded to ${tierName} tier`);
  }

  private mapToLoyaltyProgram(dbProgram: any): LoyaltyProgram {
    return {
      id: dbProgram.id,
      merchantId: dbProgram.merchant_id,
      name: dbProgram.name,
      pointsPerDollar: dbProgram.points_per_dollar,
      tiers: dbProgram.tiers,
      rewards: [],
      expirationDays: dbProgram.expiration_days,
      isActive: dbProgram.is_active,
    };
  }

  private mapToPointsTransaction(dbTransaction: any): PointsTransaction {
    return {
      id: dbTransaction.id,
      customerId: dbTransaction.customer_id,
      merchantId: dbTransaction.merchant_id,
      type: dbTransaction.type,
      points: dbTransaction.points,
      balance: dbTransaction.balance,
      orderId: dbTransaction.order_id,
      rewardId: dbTransaction.reward_id,
      description: dbTransaction.description,
      createdAt: dbTransaction.created_at,
      expiresAt: dbTransaction.expires_at,
    };
  }
}