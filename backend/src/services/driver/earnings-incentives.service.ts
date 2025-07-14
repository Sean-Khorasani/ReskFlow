/**
 * Driver Earnings Goals & Incentives Service
 * Manages driver earnings targets, bonuses, and performance incentives
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();

interface EarningsGoal {
  id: string;
  driverId: string;
  type: 'daily' | 'weekly' | 'monthly';
  targetAmount: number;
  currentAmount: number;
  startDate: Date;
  endDate: Date;
  status: 'active' | 'completed' | 'failed';
  progress: number; // Percentage
  bonus?: number;
  completedAt?: Date;
}

interface Incentive {
  id: string;
  name: string;
  description: string;
  type: 'peak_hours' | 'bad_weather' | 'high_demand' | 'completion_bonus' | 'streak' | 'rating' | 'referral';
  value: number; // Percentage or fixed amount
  valueType: 'percentage' | 'fixed';
  conditions: IncentiveConditions;
  active: boolean;
  startDate?: Date;
  endDate?: Date;
  applicableZones?: string[];
}

interface IncentiveConditions {
  minDeliveries?: number;
  minRating?: number;
  timeSlots?: TimeSlot[];
  weatherConditions?: string[];
  demandLevel?: number;
  streakDays?: number;
  zone?: string;
}

interface TimeSlot {
  dayOfWeek: number; // 0-6
  startTime: string; // HH:MM
  endTime: string;
  multiplier: number;
}

interface DriverPerformance {
  driverId: string;
  period: 'daily' | 'weekly' | 'monthly';
  reskflowCount: number;
  totalEarnings: number;
  baseEarnings: number;
  tips: number;
  bonuses: number;
  incentives: number;
  averageDeliveryTime: number;
  averageRating: number;
  acceptanceRate: number;
  completionRate: number;
  peakHoursWorked: number;
  totalDistance: number;
}

interface EarningsBreakdown {
  basePayment: number;
  distanceBonus: number;
  timeBonus: number;
  peakHourBonus: number;
  weatherBonus: number;
  demandBonus: number;
  tips: number;
  incentives: number;
  total: number;
}

export class EarningsIncentivesService extends EventEmitter {
  private cronJobs: Map<string, CronJob> = new Map();
  
  // Base rates
  private readonly BASE_DELIVERY_FEE = 3.50;
  private readonly PER_MILE_RATE = 1.25;
  private readonly PER_MINUTE_RATE = 0.15;
  private readonly MINIMUM_EARNINGS = 5.00;

  constructor() {
    super();
    this.initializeCronJobs();
    this.loadActiveIncentives();
  }

  /**
   * Initialize scheduled jobs
   */
  private initializeCronJobs() {
    // Daily goal reset at midnight
    const dailyJob = new CronJob('0 0 * * *', async () => {
      await this.resetDailyGoals();
      await this.calculateDailyBonuses();
    });
    dailyJob.start();

    // Weekly goal reset on Monday
    const weeklyJob = new CronJob('0 0 * * 1', async () => {
      await this.resetWeeklyGoals();
      await this.calculateWeeklyBonuses();
    });
    weeklyJob.start();

    // Monthly goal reset
    const monthlyJob = new CronJob('0 0 1 * *', async () => {
      await this.resetMonthlyGoals();
      await this.calculateMonthlyBonuses();
    });
    monthlyJob.start();

    // Check incentive conditions every 15 minutes
    const incentiveJob = new CronJob('*/15 * * * *', async () => {
      await this.updateActiveIncentives();
    });
    incentiveJob.start();
  }

  /**
   * Set earnings goal for driver
   */
  async setEarningsGoal(driverId: string, data: {
    type: 'daily' | 'weekly' | 'monthly';
    targetAmount: number;
    bonus?: number;
  }): Promise<EarningsGoal> {
    try {
      // Deactivate existing goal of same type
      await prisma.earningsGoal.updateMany({
        where: {
          driverId,
          type: data.type,
          status: 'active',
        },
        data: { status: 'failed' },
      });

      // Calculate date range
      const { startDate, endDate } = this.getGoalDateRange(data.type);

      // Get current earnings for the period
      const currentAmount = await this.getCurrentPeriodEarnings(driverId, startDate);

      // Create new goal
      const goal = await prisma.earningsGoal.create({
        data: {
          driverId,
          type: data.type,
          targetAmount: data.targetAmount,
          currentAmount,
          startDate,
          endDate,
          status: 'active',
          progress: (currentAmount / data.targetAmount) * 100,
          bonus: data.bonus,
        },
      });

      // Send confirmation
      await notificationService.sendDriverNotification(
        driverId,
        'Earnings Goal Set',
        `Your ${data.type} goal of $${data.targetAmount} has been set${data.bonus ? ` with a $${data.bonus} bonus!` : ''}`,
        {
          type: 'earnings_goal_set',
          goalId: goal.id,
        }
      );

      // Emit event
      this.emit('earnings_goal:created', {
        driverId,
        goal,
      });

      return goal;

    } catch (error) {
      logger.error('Failed to set earnings goal', error);
      throw error;
    }
  }

  /**
   * Update earnings after reskflow
   */
  async updateEarningsAfterDelivery(reskflowId: string): Promise<EarningsBreakdown> {
    try {
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: reskflowId },
        include: {
          order: true,
          driver: true,
        },
      });

      if (!reskflow) {
        throw new Error('Delivery not found');
      }

      // Calculate earnings breakdown
      const earnings = await this.calculateDeliveryEarnings(reskflow);

      // Record earnings
      await prisma.driverEarnings.create({
        data: {
          driverId: reskflow.driverId,
          reskflowId,
          orderId: reskflow.orderId,
          baseAmount: earnings.basePayment,
          distanceBonus: earnings.distanceBonus,
          timeBonus: earnings.timeBonus,
          peakHourBonus: earnings.peakHourBonus,
          weatherBonus: earnings.weatherBonus,
          demandBonus: earnings.demandBonus,
          tips: earnings.tips,
          incentives: earnings.incentives,
          totalAmount: earnings.total,
          earnedAt: new Date(),
        },
      });

      // Update driver's current balance
      await prisma.driver.update({
        where: { id: reskflow.driverId },
        data: {
          currentBalance: {
            increment: earnings.total,
          },
          totalEarnings: {
            increment: earnings.total,
          },
        },
      });

      // Update earnings goals
      await this.updateEarningsGoals(reskflow.driverId, earnings.total);

      // Check for milestone achievements
      await this.checkEarningsMilestones(reskflow.driverId);

      // Send earnings notification
      await notificationService.sendDriverNotification(
        reskflow.driverId,
        'Earnings Added',
        `You earned $${earnings.total.toFixed(2)} from your reskflow!`,
        {
          type: 'earnings_added',
          reskflowId,
          breakdown: earnings,
        }
      );

      return earnings;

    } catch (error) {
      logger.error('Failed to update earnings', error);
      throw error;
    }
  }

  /**
   * Calculate reskflow earnings
   */
  private async calculateDeliveryEarnings(reskflow: any): Promise<EarningsBreakdown> {
    const breakdown: EarningsBreakdown = {
      basePayment: this.BASE_DELIVERY_FEE,
      distanceBonus: 0,
      timeBonus: 0,
      peakHourBonus: 0,
      weatherBonus: 0,
      demandBonus: 0,
      tips: reskflow.order.tipAmount || 0,
      incentives: 0,
      total: 0,
    };

    // Distance bonus
    const distance = reskflow.actualDistance || reskflow.estimatedDistance || 0;
    breakdown.distanceBonus = distance * this.PER_MILE_RATE;

    // Time bonus
    const reskflowTime = reskflow.completedAt && reskflow.pickedUpAt
      ? Math.floor((reskflow.completedAt.getTime() - reskflow.pickedUpAt.getTime()) / 60000)
      : 0;
    breakdown.timeBonus = reskflowTime * this.PER_MINUTE_RATE;

    // Get active incentives
    const incentives = await this.getApplicableIncentives(reskflow);
    
    // Peak hour bonus
    const peakHourIncentive = incentives.find(i => i.type === 'peak_hours');
    if (peakHourIncentive && this.isInPeakHour(new Date(), peakHourIncentive.conditions.timeSlots)) {
      breakdown.peakHourBonus = this.calculateIncentiveValue(
        breakdown.basePayment + breakdown.distanceBonus,
        peakHourIncentive
      );
    }

    // Weather bonus
    const weatherIncentive = incentives.find(i => i.type === 'bad_weather');
    if (weatherIncentive && await this.checkWeatherConditions(reskflow.driver.currentLocation)) {
      breakdown.weatherBonus = this.calculateIncentiveValue(
        breakdown.basePayment,
        weatherIncentive
      );
    }

    // High demand bonus
    const demandIncentive = incentives.find(i => i.type === 'high_demand');
    if (demandIncentive && await this.checkDemandLevel(reskflow.order.merchantId)) {
      breakdown.demandBonus = this.calculateIncentiveValue(
        breakdown.basePayment,
        demandIncentive
      );
    }

    // Additional incentives (streaks, ratings, etc.)
    for (const incentive of incentives) {
      if (!['peak_hours', 'bad_weather', 'high_demand'].includes(incentive.type)) {
        const incentiveAmount = await this.calculateSpecialIncentive(reskflow.driverId, incentive);
        breakdown.incentives += incentiveAmount;
      }
    }

    // Calculate total
    breakdown.total = Object.values(breakdown).reduce((sum, value) => sum + (value || 0), 0);

    // Ensure minimum earnings
    if (breakdown.total < this.MINIMUM_EARNINGS) {
      breakdown.basePayment += this.MINIMUM_EARNINGS - breakdown.total;
      breakdown.total = this.MINIMUM_EARNINGS;
    }

    return breakdown;
  }

  /**
   * Get applicable incentives for reskflow
   */
  private async getApplicableIncentives(reskflow: any): Promise<Incentive[]> {
    const activeIncentives = await prisma.incentive.findMany({
      where: {
        active: true,
        OR: [
          { startDate: null },
          { startDate: { lte: new Date() } },
        ],
        AND: [
          { OR: [
            { endDate: null },
            { endDate: { gte: new Date() } },
          ]},
        ],
      },
    });

    // Filter by zone if applicable
    return activeIncentives.filter(incentive => {
      if (incentive.applicableZones && incentive.applicableZones.length > 0) {
        // Check if reskflow is in applicable zone
        return incentive.applicableZones.includes(reskflow.zone || 'default');
      }
      return true;
    });
  }

  /**
   * Calculate incentive value
   */
  private calculateIncentiveValue(baseAmount: number, incentive: Incentive): number {
    if (incentive.valueType === 'percentage') {
      return baseAmount * (incentive.value / 100);
    } else {
      return incentive.value;
    }
  }

  /**
   * Check if in peak hour
   */
  private isInPeakHour(date: Date, timeSlots?: TimeSlot[]): boolean {
    if (!timeSlots || timeSlots.length === 0) return false;

    const dayOfWeek = date.getDay();
    const currentTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

    return timeSlots.some(slot => 
      slot.dayOfWeek === dayOfWeek &&
      currentTime >= slot.startTime &&
      currentTime <= slot.endTime
    );
  }

  /**
   * Check weather conditions
   */
  private async checkWeatherConditions(location: any): Promise<boolean> {
    // Integration with weather API
    // For now, return mock data
    return Math.random() > 0.7; // 30% chance of bad weather
  }

  /**
   * Check demand level
   */
  private async checkDemandLevel(merchantId: string): Promise<boolean> {
    // Check current order volume
    const recentOrders = await prisma.order.count({
      where: {
        merchantId,
        createdAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        },
      },
    });

    return recentOrders > 10; // High demand if more than 10 orders in last hour
  }

  /**
   * Calculate special incentives
   */
  private async calculateSpecialIncentive(driverId: string, incentive: Incentive): Promise<number> {
    switch (incentive.type) {
      case 'completion_bonus':
        return await this.checkCompletionBonus(driverId, incentive);
      
      case 'streak':
        return await this.checkStreakBonus(driverId, incentive);
      
      case 'rating':
        return await this.checkRatingBonus(driverId, incentive);
      
      case 'referral':
        return await this.checkReferralBonus(driverId, incentive);
      
      default:
        return 0;
    }
  }

  /**
   * Check completion bonus eligibility
   */
  private async checkCompletionBonus(driverId: string, incentive: Incentive): Promise<number> {
    if (!incentive.conditions.minDeliveries) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reskflowCount = await prisma.reskflow.count({
      where: {
        driverId,
        completedAt: { gte: today },
        status: 'delivered',
      },
    });

    if (reskflowCount >= incentive.conditions.minDeliveries) {
      // Check if already claimed today
      const claimed = await prisma.incentiveClaim.findFirst({
        where: {
          driverId,
          incentiveId: incentive.id,
          claimedAt: { gte: today },
        },
      });

      if (!claimed) {
        await prisma.incentiveClaim.create({
          data: {
            driverId,
            incentiveId: incentive.id,
            amount: incentive.value,
            claimedAt: new Date(),
          },
        });
        return incentive.value;
      }
    }

    return 0;
  }

  /**
   * Check streak bonus
   */
  private async checkStreakBonus(driverId: string, incentive: Incentive): Promise<number> {
    if (!incentive.conditions.streakDays) return 0;

    const streak = await this.calculateDriverStreak(driverId);
    
    if (streak >= incentive.conditions.streakDays) {
      return this.calculateIncentiveValue(50, incentive); // Base $50 for streak
    }

    return 0;
  }

  /**
   * Check rating bonus
   */
  private async checkRatingBonus(driverId: string, incentive: Incentive): Promise<number> {
    if (!incentive.conditions.minRating) return 0;

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        ratings: {
          orderBy: { createdAt: 'desc' },
          take: 20, // Last 20 ratings
        },
      },
    });

    if (!driver || driver.ratings.length === 0) return 0;

    const averageRating = driver.ratings.reduce((sum, r) => sum + r.rating, 0) / driver.ratings.length;

    if (averageRating >= incentive.conditions.minRating) {
      return this.calculateIncentiveValue(30, incentive); // Base $30 for high rating
    }

    return 0;
  }

  /**
   * Check referral bonus
   */
  private async checkReferralBonus(driverId: string, incentive: Incentive): Promise<number> {
    // Check if driver has successful referrals this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const referrals = await prisma.driverReferral.count({
      where: {
        referrerId: driverId,
        status: 'completed',
        completedAt: { gte: startOfMonth },
      },
    });

    if (referrals > 0) {
      return incentive.value * referrals;
    }

    return 0;
  }

  /**
   * Update earnings goals progress
   */
  private async updateEarningsGoals(driverId: string, amount: number): Promise<void> {
    const activeGoals = await prisma.earningsGoal.findMany({
      where: {
        driverId,
        status: 'active',
      },
    });

    for (const goal of activeGoals) {
      const updatedAmount = goal.currentAmount + amount;
      const progress = (updatedAmount / goal.targetAmount) * 100;
      const completed = progress >= 100;

      await prisma.earningsGoal.update({
        where: { id: goal.id },
        data: {
          currentAmount: updatedAmount,
          progress,
          status: completed ? 'completed' : 'active',
          completedAt: completed ? new Date() : null,
        },
      });

      // Award bonus if completed
      if (completed && goal.bonus && !goal.completedAt) {
        await prisma.driverEarnings.create({
          data: {
            driverId,
            baseAmount: 0,
            incentives: goal.bonus,
            totalAmount: goal.bonus,
            earnedAt: new Date(),
            type: 'goal_bonus',
            description: `${goal.type} goal completion bonus`,
          },
        });

        await notificationService.sendDriverNotification(
          driverId,
          'Goal Achieved! 🎯',
          `Congratulations! You've completed your ${goal.type} earnings goal and earned a $${goal.bonus} bonus!`,
          {
            type: 'goal_completed',
            goalId: goal.id,
            bonus: goal.bonus,
          }
        );
      }
    }
  }

  /**
   * Get driver performance stats
   */
  async getDriverPerformance(driverId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<DriverPerformance> {
    const { startDate } = this.getGoalDateRange(period);

    // Get deliveries for period
    const deliveries = await prisma.reskflow.findMany({
      where: {
        driverId,
        completedAt: { gte: startDate },
        status: 'delivered',
      },
      include: {
        earnings: true,
        rating: true,
      },
    });

    // Get all reskflow requests for acceptance rate
    const allRequests = await prisma.reskflowRequest.count({
      where: {
        driverId,
        createdAt: { gte: startDate },
      },
    });

    const acceptedRequests = await prisma.reskflowRequest.count({
      where: {
        driverId,
        createdAt: { gte: startDate },
        status: 'accepted',
      },
    });

    // Calculate metrics
    const performance: DriverPerformance = {
      driverId,
      period,
      reskflowCount: deliveries.length,
      totalEarnings: 0,
      baseEarnings: 0,
      tips: 0,
      bonuses: 0,
      incentives: 0,
      averageDeliveryTime: 0,
      averageRating: 0,
      acceptanceRate: allRequests > 0 ? (acceptedRequests / allRequests) * 100 : 0,
      completionRate: 0,
      peakHoursWorked: 0,
      totalDistance: 0,
    };

    // Calculate earnings breakdown
    for (const reskflow of deliveries) {
      if (reskflow.earnings) {
        performance.totalEarnings += reskflow.earnings.totalAmount;
        performance.baseEarnings += reskflow.earnings.baseAmount + reskflow.earnings.distanceBonus + reskflow.earnings.timeBonus;
        performance.tips += reskflow.earnings.tips;
        performance.bonuses += reskflow.earnings.peakHourBonus + reskflow.earnings.weatherBonus + reskflow.earnings.demandBonus;
        performance.incentives += reskflow.earnings.incentives;
      }

      // Add distance
      performance.totalDistance += reskflow.actualDistance || 0;

      // Calculate reskflow time
      if (reskflow.pickedUpAt && reskflow.completedAt) {
        const reskflowTime = (reskflow.completedAt.getTime() - reskflow.pickedUpAt.getTime()) / 60000;
        performance.averageDeliveryTime += reskflowTime;
      }

      // Add rating
      if (reskflow.rating) {
        performance.averageRating += reskflow.rating.rating;
      }
    }

    // Calculate averages
    if (deliveries.length > 0) {
      performance.averageDeliveryTime /= deliveries.length;
      performance.averageRating /= deliveries.filter(d => d.rating).length || 1;
    }

    // Calculate completion rate
    const startedDeliveries = await prisma.reskflow.count({
      where: {
        driverId,
        createdAt: { gte: startDate },
      },
    });

    performance.completionRate = startedDeliveries > 0 
      ? (deliveries.length / startedDeliveries) * 100 
      : 0;

    return performance;
  }

  /**
   * Get earnings history
   */
  async getEarningsHistory(driverId: string, startDate: Date, endDate: Date): Promise<any[]> {
    const earnings = await prisma.driverEarnings.findMany({
      where: {
        driverId,
        earnedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        reskflow: {
          include: {
            order: {
              include: {
                merchant: true,
                customer: true,
              },
            },
          },
        },
      },
      orderBy: { earnedAt: 'desc' },
    });

    return earnings.map(earning => ({
      ...earning,
      breakdown: {
        base: earning.baseAmount,
        distance: earning.distanceBonus,
        time: earning.timeBonus,
        peakHour: earning.peakHourBonus,
        weather: earning.weatherBonus,
        demand: earning.demandBonus,
        tips: earning.tips,
        incentives: earning.incentives,
      },
    }));
  }

  /**
   * Get earnings goals
   */
  async getEarningsGoals(driverId: string): Promise<any> {
    const goals = await prisma.earningsGoal.findMany({
      where: {
        driverId,
        endDate: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      active: goals.filter(g => g.status === 'active'),
      completed: goals.filter(g => g.status === 'completed'),
      upcoming: [], // Future feature
    };
  }

  /**
   * Get available incentives
   */
  async getAvailableIncentives(driverId: string): Promise<any[]> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        currentLocation: true,
      },
    });

    if (!driver) return [];

    const incentives = await prisma.incentive.findMany({
      where: {
        active: true,
        OR: [
          { applicableZones: { isEmpty: true } },
          { applicableZones: { has: driver.zone } },
        ],
      },
    });

    // Check eligibility for each incentive
    const eligibleIncentives = [];
    for (const incentive of incentives) {
      const eligible = await this.checkIncentiveEligibility(driverId, incentive);
      if (eligible) {
        eligibleIncentives.push({
          ...incentive,
          estimatedValue: this.estimateIncentiveValue(incentive),
          requirements: this.getIncentiveRequirements(incentive),
        });
      }
    }

    return eligibleIncentives;
  }

  /**
   * Check incentive eligibility
   */
  private async checkIncentiveEligibility(driverId: string, incentive: Incentive): Promise<boolean> {
    // Check time-based eligibility
    const now = new Date();
    if (incentive.startDate && now < incentive.startDate) return false;
    if (incentive.endDate && now > incentive.endDate) return false;

    // Check other conditions based on type
    switch (incentive.type) {
      case 'rating':
        const driver = await prisma.driver.findUnique({ where: { id: driverId } });
        return !incentive.conditions.minRating || 
               (driver?.averageRating || 0) >= incentive.conditions.minRating;

      case 'streak':
        const streak = await this.calculateDriverStreak(driverId);
        return !incentive.conditions.streakDays || 
               streak >= incentive.conditions.streakDays;

      default:
        return true;
    }
  }

  /**
   * Estimate incentive value
   */
  private estimateIncentiveValue(incentive: Incentive): string {
    if (incentive.valueType === 'fixed') {
      return `$${incentive.value}`;
    } else {
      return `${incentive.value}% bonus`;
    }
  }

  /**
   * Get incentive requirements
   */
  private getIncentiveRequirements(incentive: Incentive): string[] {
    const requirements = [];

    if (incentive.conditions.minDeliveries) {
      requirements.push(`Complete ${incentive.conditions.minDeliveries} deliveries`);
    }

    if (incentive.conditions.minRating) {
      requirements.push(`Maintain ${incentive.conditions.minRating}+ rating`);
    }

    if (incentive.conditions.streakDays) {
      requirements.push(`${incentive.conditions.streakDays}-day reskflow streak`);
    }

    if (incentive.conditions.timeSlots) {
      requirements.push('Work during peak hours');
    }

    return requirements;
  }

  /**
   * Calculate driver streak
   */
  private async calculateDriverStreak(driverId: string): Promise<number> {
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    while (true) {
      const deliveries = await prisma.reskflow.count({
        where: {
          driverId,
          completedAt: {
            gte: currentDate,
            lt: new Date(currentDate.getTime() + 24 * 60 * 60 * 1000),
          },
          status: 'delivered',
        },
      });

      if (deliveries === 0) break;

      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    }

    return streak;
  }

  /**
   * Get goal date range
   */
  private getGoalDateRange(type: string): { startDate: Date; endDate: Date } {
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    switch (type) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;

      case 'weekly':
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
        startDate.setDate(now.getDate() - diff);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;

      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
        endDate.setDate(0);
        endDate.setHours(23, 59, 59, 999);
        break;
    }

    return { startDate, endDate };
  }

  /**
   * Get current period earnings
   */
  private async getCurrentPeriodEarnings(driverId: string, startDate: Date): Promise<number> {
    const result = await prisma.driverEarnings.aggregate({
      where: {
        driverId,
        earnedAt: { gte: startDate },
      },
      _sum: {
        totalAmount: true,
      },
    });

    return result._sum.totalAmount || 0;
  }

  /**
   * Check earnings milestones
   */
  private async checkEarningsMilestones(driverId: string): Promise<void> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    });

    if (!driver) return;

    const milestones = [
      { amount: 100, name: 'First $100' },
      { amount: 500, name: 'Half Grand' },
      { amount: 1000, name: 'Grand' },
      { amount: 5000, name: 'High Roller' },
      { amount: 10000, name: 'Elite Earner' },
    ];

    for (const milestone of milestones) {
      if (driver.totalEarnings >= milestone.amount) {
        // Check if already achieved
        const achieved = await prisma.driverMilestone.findFirst({
          where: {
            driverId,
            type: 'earnings',
            value: milestone.amount,
          },
        });

        if (!achieved) {
          await prisma.driverMilestone.create({
            data: {
              driverId,
              type: 'earnings',
              name: milestone.name,
              value: milestone.amount,
              achievedAt: new Date(),
            },
          });

          await notificationService.sendDriverNotification(
            driverId,
            'Milestone Achieved! 🏆',
            `Congratulations! You've reached ${milestone.name} in total earnings!`,
            {
              type: 'milestone_achieved',
              milestone: milestone.name,
            }
          );
        }
      }
    }
  }

  /**
   * Reset daily goals
   */
  private async resetDailyGoals(): Promise<void> {
    await prisma.earningsGoal.updateMany({
      where: {
        type: 'daily',
        status: 'active',
        endDate: { lt: new Date() },
      },
      data: { status: 'failed' },
    });
  }

  /**
   * Reset weekly goals
   */
  private async resetWeeklyGoals(): Promise<void> {
    await prisma.earningsGoal.updateMany({
      where: {
        type: 'weekly',
        status: 'active',
        endDate: { lt: new Date() },
      },
      data: { status: 'failed' },
    });
  }

  /**
   * Reset monthly goals
   */
  private async resetMonthlyGoals(): Promise<void> {
    await prisma.earningsGoal.updateMany({
      where: {
        type: 'monthly',
        status: 'active',
        endDate: { lt: new Date() },
      },
      data: { status: 'failed' },
    });
  }

  /**
   * Calculate daily bonuses
   */
  private async calculateDailyBonuses(): Promise<void> {
    // Implementation for daily bonus calculations
  }

  /**
   * Calculate weekly bonuses
   */
  private async calculateWeeklyBonuses(): Promise<void> {
    // Implementation for weekly bonus calculations
  }

  /**
   * Calculate monthly bonuses
   */
  private async calculateMonthlyBonuses(): Promise<void> {
    // Implementation for monthly bonus calculations
  }

  /**
   * Update active incentives based on conditions
   */
  private async updateActiveIncentives(): Promise<void> {
    // Check weather conditions and activate weather incentives
    // Check demand levels and activate surge pricing
    // Update time-based incentives
  }

  /**
   * Load active incentives
   */
  private async loadActiveIncentives(): Promise<void> {
    // Load and cache active incentives
  }

  /**
   * Create custom incentive
   */
  async createIncentive(data: Partial<Incentive>): Promise<Incentive> {
    const incentive = await prisma.incentive.create({
      data: {
        name: data.name!,
        description: data.description!,
        type: data.type!,
        value: data.value!,
        valueType: data.valueType || 'fixed',
        conditions: data.conditions || {},
        active: true,
        startDate: data.startDate,
        endDate: data.endDate,
        applicableZones: data.applicableZones,
      },
    });

    // Notify eligible drivers
    await this.notifyEligibleDrivers(incentive);

    return incentive;
  }

  /**
   * Notify eligible drivers about new incentive
   */
  private async notifyEligibleDrivers(incentive: Incentive): Promise<void> {
    const drivers = await prisma.driver.findMany({
      where: {
        isActive: true,
        isOnline: true,
        ...(incentive.applicableZones?.length ? {
          zone: { in: incentive.applicableZones },
        } : {}),
      },
    });

    const notifications = drivers.map(driver => 
      notificationService.sendDriverNotification(
        driver.id,
        'New Earning Opportunity! 💰',
        `${incentive.name}: ${incentive.description}`,
        {
          type: 'new_incentive',
          incentiveId: incentive.id,
        }
      )
    );

    await Promise.all(notifications);
  }
}

// Export singleton instance
export const earningsIncentivesService = new EarningsIncentivesService();