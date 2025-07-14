import { prisma, logger, redis } from '@reskflow/shared';
import Bull from 'bull';
import { addHours, isWithinInterval } from 'date-fns';

interface PricingRule {
  id: string;
  merchantId: string;
  name: string;
  type: 'surge' | 'discount' | 'happy_hour' | 'bulk' | 'time_based' | 'location_based';
  conditions: {
    startTime?: string;
    endTime?: string;
    dayOfWeek?: number[];
    minOrderValue?: number;
    minQuantity?: number;
    maxQuantity?: number;
    locationRadius?: number;
    locationCenter?: { lat: number; lng: number };
    demandThreshold?: number;
  };
  action: {
    type: 'percentage' | 'fixed' | 'multiplier';
    value: number;
    maxDiscount?: number;
    maxSurge?: number;
  };
  priority: number;
  isActive: boolean;
  validFrom: Date;
  validTo: Date;
}

interface ItemPricing {
  itemId: string;
  basePrice: number;
  currentPrice: number;
  discount?: {
    amount: number;
    percentage: number;
    rule: string;
  };
  surge?: {
    multiplier: number;
    amount: number;
    reason: string;
  };
  breakdown: Array<{
    rule: string;
    type: string;
    amount: number;
  }>;
}

interface DynamicPricingData {
  merchantId: string;
  demandLevel: number; // 0-100
  competitorPrices?: Record<string, number>;
  weatherImpact?: number; // multiplier
  specialEvents?: string[];
}

export class PricingService {
  private queue: Bull.Queue;
  private pricingInterval?: NodeJS.Timeout;

  constructor(queue: Bull.Queue) {
    this.queue = queue;
  }

  async startPricingEngine(): Promise<void> {
    // Update dynamic pricing every 5 minutes
    this.pricingInterval = setInterval(async () => {
      try {
        await this.updateDynamicPricing();
      } catch (error) {
        logger.error('Dynamic pricing update error', error);
      }
    }, 5 * 60 * 1000);

    // Process pricing rules
    this.queue.process('surge-pricing', async (job) => {
      return this.processSurgePricing(job.data);
    });

    this.queue.process('time-based-pricing', async (job) => {
      return this.processTimeBasedPricing(job.data);
    });

    logger.info('Pricing engine started');
  }

  async stopPricingEngine(): Promise<void> {
    if (this.pricingInterval) {
      clearInterval(this.pricingInterval);
    }
  }

  async getCurrentPricing(merchantId: string): Promise<Record<string, ItemPricing>> {
    try {
      // Check cache first
      const cacheKey = `pricing:current:${merchantId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get all active items for merchant
      const items = await prisma.menuItem.findMany({
        where: {
          merchantId,
          status: 'AVAILABLE',
        },
      });

      // Get active pricing rules
      const rules = await this.getActivePricingRules(merchantId);

      // Calculate pricing for each item
      const pricing: Record<string, ItemPricing> = {};
      
      for (const item of items) {
        pricing[item.id] = await this.calculateItemPricing(item, rules);
      }

      // Cache for 5 minutes
      await redis.set(cacheKey, JSON.stringify(pricing), 'EX', 300);

      return pricing;
    } catch (error) {
      logger.error('Failed to get current pricing', error);
      throw error;
    }
  }

  async calculateItemPrice(
    itemId: string,
    quantity: number = 1,
    promoCode?: string,
    location?: { lat: number; lng: number }
  ): Promise<{
    unitPrice: number;
    totalPrice: number;
    originalPrice: number;
    savings: number;
    appliedRules: string[];
  }> {
    try {
      const item = await prisma.menuItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        throw new Error('Item not found');
      }

      // Get applicable rules
      const rules = await this.getActivePricingRules(item.merchantId);
      const applicableRules = this.filterApplicableRules(rules, {
        item,
        quantity,
        location,
      });

      // Calculate base pricing
      let currentPrice = item.price;
      const originalPrice = item.price * quantity;
      const appliedRules: string[] = [];
      const breakdown: any[] = [];

      // Apply rules in priority order
      const sortedRules = applicableRules.sort((a, b) => b.priority - a.priority);
      
      for (const rule of sortedRules) {
        const adjustment = this.applyPricingRule(currentPrice, rule, quantity);
        if (adjustment.amount !== 0) {
          currentPrice = adjustment.newPrice;
          appliedRules.push(rule.name);
          breakdown.push({
            rule: rule.name,
            type: rule.type,
            amount: adjustment.amount,
          });
        }
      }

      // Apply promo code if provided
      if (promoCode) {
        const promo = await this.validatePromoCode(promoCode, item.merchantId);
        if (promo && this.isPromoApplicable(promo, item, quantity)) {
          const promoAdjustment = this.applyPromoCode(currentPrice, promo, quantity);
          currentPrice = promoAdjustment.newPrice;
          appliedRules.push(`Promo: ${promoCode}`);
          breakdown.push({
            rule: `Promo: ${promoCode}`,
            type: 'promo',
            amount: promoAdjustment.amount,
          });
        }
      }

      const totalPrice = currentPrice * quantity;
      const savings = originalPrice - totalPrice;

      // Store pricing event for analytics
      await this.storePricingEvent({
        itemId,
        merchantId: item.merchantId,
        originalPrice: item.price,
        finalPrice: currentPrice,
        quantity,
        appliedRules,
        timestamp: new Date(),
      });

      return {
        unitPrice: currentPrice,
        totalPrice,
        originalPrice,
        savings: Math.max(0, savings),
        appliedRules,
      };
    } catch (error) {
      logger.error('Failed to calculate item price', error);
      throw error;
    }
  }

  async createPricingRule(merchantId: string, rule: Partial<PricingRule>): Promise<PricingRule> {
    try {
      const newRule: PricingRule = {
        id: `rule_${Date.now()}`,
        merchantId,
        name: rule.name || 'Unnamed Rule',
        type: rule.type || 'discount',
        conditions: rule.conditions || {},
        action: rule.action || { type: 'percentage', value: 0 },
        priority: rule.priority || 0,
        isActive: rule.isActive !== false,
        validFrom: rule.validFrom || new Date(),
        validTo: rule.validTo || addHours(new Date(), 24 * 365), // 1 year default
      };

      // Store in database (using Redis for demo)
      await redis.set(
        `pricing:rule:${newRule.id}`,
        JSON.stringify(newRule),
        'EX',
        365 * 24 * 60 * 60
      );

      // Add to merchant's rules
      await redis.sadd(`pricing:merchant:${merchantId}:rules`, newRule.id);

      // Invalidate pricing cache
      await redis.del(`pricing:current:${merchantId}`);

      logger.info(`Pricing rule created: ${newRule.id} for merchant ${merchantId}`);
      return newRule;
    } catch (error) {
      logger.error('Failed to create pricing rule', error);
      throw error;
    }
  }

  async updateDynamicPricing(): Promise<void> {
    try {
      // Get all active merchants
      const merchants = await prisma.merchant.findMany({
        where: { status: 'ACTIVE' },
      });

      for (const merchant of merchants) {
        // Calculate demand level
        const demandData = await this.calculateDemandLevel(merchant.id);
        
        // Get weather impact
        const weatherImpact = await this.getWeatherImpact(merchant.id);
        
        // Check for special events
        const specialEvents = await this.checkSpecialEvents(merchant.id);

        const pricingData: DynamicPricingData = {
          merchantId: merchant.id,
          demandLevel: demandData.level,
          weatherImpact,
          specialEvents,
        };

        // Queue surge pricing update if needed
        if (demandData.level > 70) {
          await this.queue.add('surge-pricing', pricingData);
        }

        // Store current demand data
        await redis.set(
          `pricing:demand:${merchant.id}`,
          JSON.stringify(demandData),
          'EX',
          600 // 10 minutes
        );
      }
    } catch (error) {
      logger.error('Failed to update dynamic pricing', error);
    }
  }

  private async calculateDemandLevel(merchantId: string): Promise<{
    level: number;
    factors: Record<string, number>;
  }> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Get recent order count
      const recentOrders = await prisma.order.count({
        where: {
          merchantId,
          createdAt: { gte: oneHourAgo },
        },
      });

      // Get average orders for this hour
      const hourOfDay = now.getHours();
      const avgOrdersKey = `pricing:avg:${merchantId}:hour:${hourOfDay}`;
      const avgOrders = parseInt(await redis.get(avgOrdersKey) || '10');

      // Get current driver availability
      const availableDrivers = await this.getAvailableDriverCount(merchantId);
      const driverRatio = availableDrivers > 0 ? recentOrders / availableDrivers : 10;

      // Calculate demand factors
      const orderFactor = Math.min((recentOrders / avgOrders) * 50, 50);
      const driverFactor = Math.min(driverRatio * 10, 30);
      const timeFactor = this.getTimeDemandFactor(hourOfDay);

      const demandLevel = Math.min(orderFactor + driverFactor + timeFactor, 100);

      return {
        level: Math.round(demandLevel),
        factors: {
          orders: orderFactor,
          drivers: driverFactor,
          time: timeFactor,
        },
      };
    } catch (error) {
      logger.error('Failed to calculate demand level', error);
      return { level: 0, factors: {} };
    }
  }

  private async processSurgePricing(data: DynamicPricingData): Promise<void> {
    try {
      const { merchantId, demandLevel } = data;

      // Calculate surge multiplier based on demand
      let surgeMultiplier = 1.0;
      if (demandLevel > 90) {
        surgeMultiplier = 2.0;
      } else if (demandLevel > 80) {
        surgeMultiplier = 1.5;
      } else if (demandLevel > 70) {
        surgeMultiplier = 1.25;
      }

      // Apply surge to reskflow fees
      await redis.set(
        `pricing:surge:${merchantId}`,
        JSON.stringify({
          multiplier: surgeMultiplier,
          reason: 'High demand',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        }),
        'EX',
        1800
      );

      // Notify merchant
      await this.queue.add('pricing-notification', {
        merchantId,
        type: 'surge_active',
        multiplier: surgeMultiplier,
        demandLevel,
      });

      logger.info(`Surge pricing activated for merchant ${merchantId}: ${surgeMultiplier}x`);
    } catch (error) {
      logger.error('Failed to process surge pricing', error);
    }
  }

  private async processTimeBasedPricing(data: any): Promise<void> {
    // Implementation for time-based pricing rules
    // (Happy hours, lunch specials, etc.)
  }

  private async getActivePricingRules(merchantId: string): Promise<PricingRule[]> {
    try {
      const ruleIds = await redis.smembers(`pricing:merchant:${merchantId}:rules`);
      const rules: PricingRule[] = [];

      for (const ruleId of ruleIds) {
        const ruleData = await redis.get(`pricing:rule:${ruleId}`);
        if (ruleData) {
          const rule = JSON.parse(ruleData);
          if (rule.isActive && isWithinInterval(new Date(), {
            start: new Date(rule.validFrom),
            end: new Date(rule.validTo),
          })) {
            rules.push(rule);
          }
        }
      }

      return rules;
    } catch (error) {
      logger.error('Failed to get active pricing rules', error);
      return [];
    }
  }

  private filterApplicableRules(
    rules: PricingRule[],
    context: { item: any; quantity: number; location?: any }
  ): PricingRule[] {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return rules.filter(rule => {
      // Check time conditions
      if (rule.conditions.dayOfWeek && !rule.conditions.dayOfWeek.includes(dayOfWeek)) {
        return false;
      }

      if (rule.conditions.startTime && rule.conditions.endTime) {
        if (currentTime < rule.conditions.startTime || currentTime > rule.conditions.endTime) {
          return false;
        }
      }

      // Check quantity conditions
      if (rule.conditions.minQuantity && context.quantity < rule.conditions.minQuantity) {
        return false;
      }

      if (rule.conditions.maxQuantity && context.quantity > rule.conditions.maxQuantity) {
        return false;
      }

      // Add more condition checks as needed

      return true;
    });
  }

  private applyPricingRule(
    basePrice: number,
    rule: PricingRule,
    quantity: number
  ): { newPrice: number; amount: number } {
    let adjustment = 0;

    switch (rule.action.type) {
      case 'percentage':
        adjustment = basePrice * (rule.action.value / 100);
        break;
      case 'fixed':
        adjustment = rule.action.value;
        break;
      case 'multiplier':
        adjustment = basePrice * (rule.action.value - 1);
        break;
    }

    // Apply limits
    if (rule.type === 'discount' && rule.action.maxDiscount) {
      adjustment = Math.min(adjustment, rule.action.maxDiscount);
    } else if (rule.type === 'surge' && rule.action.maxSurge) {
      adjustment = Math.min(adjustment, rule.action.maxSurge);
    }

    const newPrice = rule.type === 'surge' 
      ? basePrice + adjustment 
      : Math.max(0, basePrice - adjustment);

    return {
      newPrice,
      amount: rule.type === 'surge' ? adjustment : -adjustment,
    };
  }

  private async validatePromoCode(code: string, merchantId: string): Promise<any> {
    try {
      const promo = await prisma.promotion.findFirst({
        where: {
          code,
          merchantId,
          isActive: true,
          validFrom: { lte: new Date() },
          validTo: { gte: new Date() },
        },
      });

      return promo;
    } catch (error) {
      return null;
    }
  }

  private isPromoApplicable(promo: any, item: any, quantity: number): boolean {
    // Check if promo applies to this item
    if (promo.applicableItems?.length > 0 && !promo.applicableItems.includes(item.id)) {
      return false;
    }

    if (promo.excludedItems?.includes(item.id)) {
      return false;
    }

    return true;
  }

  private applyPromoCode(
    price: number,
    promo: any,
    quantity: number
  ): { newPrice: number; amount: number } {
    let discount = 0;

    switch (promo.type) {
      case 'PERCENTAGE':
        discount = price * (promo.value / 100);
        break;
      case 'FIXED_AMOUNT':
        discount = promo.value / quantity; // Distribute across units
        break;
    }

    if (promo.maxDiscount) {
      discount = Math.min(discount, promo.maxDiscount / quantity);
    }

    return {
      newPrice: Math.max(0, price - discount),
      amount: -discount,
    };
  }

  private async storePricingEvent(event: any): Promise<void> {
    // Store for analytics
    await redis.lpush(
      `pricing:events:${event.merchantId}`,
      JSON.stringify(event)
    );
    await redis.ltrim(`pricing:events:${event.merchantId}`, 0, 9999);
  }

  private async getAvailableDriverCount(merchantId: string): Promise<number> {
    // Mock implementation - would query driver service
    return 10;
  }

  private getTimeDemandFactor(hour: number): number {
    // Peak hours: 12-2 PM (lunch) and 6-9 PM (dinner)
    if ((hour >= 12 && hour <= 14) || (hour >= 18 && hour <= 21)) {
      return 20;
    } else if ((hour >= 11 && hour <= 15) || (hour >= 17 && hour <= 22)) {
      return 10;
    }
    return 0;
  }

  private async getWeatherImpact(merchantId: string): Promise<number> {
    // Mock implementation - would integrate with weather API
    // Bad weather increases demand
    return 1.0;
  }

  private async checkSpecialEvents(merchantId: string): Promise<string[]> {
    // Check for special events that might impact pricing
    // (Sports events, holidays, etc.)
    return [];
  }

  async processPricingUpdate(data: any): Promise<void> {
    // Process pricing updates from queue
    logger.info('Processing pricing update', data);
  }
}