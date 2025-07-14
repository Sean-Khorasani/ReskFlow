/**
 * Dynamic Pricing Service
 * Manages surge pricing, demand-based pricing, and promotional pricing strategies
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { analyticsService } from '../analytics/analytics.service';
import { redisClient } from '../../config/redis';
import * as geolib from 'geolib';

const prisma = new PrismaClient();

interface PricingRule {
  id: string;
  name: string;
  description: string;
  type: 'surge' | 'demand' | 'time_based' | 'distance_based' | 'weather' | 'event' | 'loyalty' | 'competitive';
  status: 'active' | 'inactive' | 'scheduled' | 'testing';
  priority: number; // Higher priority rules override lower ones
  conditions: PricingCondition[];
  actions: PricingAction[];
  scope: {
    zones?: string[];
    merchants?: string[];
    categories?: string[];
    items?: string[];
    customerSegments?: string[];
  };
  schedule?: {
    startDate: Date;
    endDate?: Date;
    recurringPattern?: RecurringPattern;
  };
  limits: {
    maxMultiplier?: number;
    minMultiplier?: number;
    maxDailyApplications?: number;
    maxCustomerApplications?: number;
  };
  performance: {
    totalApplications: number;
    revenueImpact: number;
    conversionRate: number;
    customerSatisfaction?: number;
  };
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PricingCondition {
  type: 'demand' | 'supply' | 'time' | 'weather' | 'location' | 'event' | 'inventory' | 'competition';
  operator: 'greater_than' | 'less_than' | 'equals' | 'between' | 'in' | 'not_in';
  value: any;
  weight?: number; // For weighted conditions
}

interface PricingAction {
  type: 'multiply' | 'add' | 'subtract' | 'set' | 'percentage';
  target: 'reskflow_fee' | 'service_fee' | 'item_price' | 'total';
  value: number;
  cap?: number; // Maximum amount for this action
}

interface RecurringPattern {
  frequency: 'daily' | 'weekly' | 'monthly';
  daysOfWeek?: number[]; // 0-6 for weekly
  timeRanges?: Array<{ start: string; end: string }>;
}

interface DemandData {
  zone: string;
  timestamp: Date;
  activeOrders: number;
  pendingOrders: number;
  availableDrivers: number;
  avgWaitTime: number;
  demandScore: number; // 0-100
  supplyScore: number; // 0-100
}

interface PriceCalculation {
  basePrice: number;
  appliedRules: Array<{
    ruleId: string;
    ruleName: string;
    adjustment: number;
    reason: string;
  }>;
  finalPrice: number;
  savings?: number;
  multiplier: number;
  breakdown: {
    itemsTotal: number;
    reskflowFee: number;
    serviceFee: number;
    discount?: number;
    surge?: number;
  };
}

interface SurgeZone {
  id: string;
  name: string;
  polygon: Array<{ lat: number; lng: number }>;
  currentMultiplier: number;
  demandScore: number;
  activeUntil?: Date;
  affectedMerchants: number;
  estimatedWaitTime: number;
}

interface PricingExperiment {
  id: string;
  name: string;
  hypothesis: string;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  controlGroup: {
    ruleId?: string;
    size: number;
  };
  testGroups: Array<{
    id: string;
    ruleId: string;
    size: number;
  }>;
  metrics: {
    primaryMetric: string;
    secondaryMetrics: string[];
    successCriteria: any;
  };
  results?: ExperimentResults;
  startDate: Date;
  endDate?: Date;
}

interface ExperimentResults {
  winner?: string;
  confidence: number;
  impact: {
    revenue: number;
    orders: number;
    conversionRate: number;
  };
  recommendation: string;
}

interface CompetitorPricing {
  competitorId: string;
  merchantCategory: string;
  avgDeliveryFee: number;
  avgServiceFee: number;
  promotions: string[];
  lastUpdated: Date;
}

export class DynamicPricingService extends EventEmitter {
  private pricingRules: Map<string, PricingRule> = new Map();
  private surgeZones: Map<string, SurgeZone> = new Map();
  private experiments: Map<string, PricingExperiment> = new Map();
  private demandMonitorJob: CronJob;
  private competitorMonitorJob: CronJob;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private async initializeService() {
    // Load active pricing rules
    await this.loadPricingRules();

    // Setup demand monitoring
    this.demandMonitorJob = new CronJob('*/2 * * * *', async () => {
      await this.monitorDemand();
    });
    this.demandMonitorJob.start();

    // Setup competitor monitoring
    this.competitorMonitorJob = new CronJob('0 */6 * * *', async () => {
      await this.monitorCompetitorPricing();
    });
    this.competitorMonitorJob.start();

    // Setup real-time monitoring
    this.setupRealtimeMonitoring();
  }

  /**
   * Calculate price for order
   */
  async calculatePrice(params: {
    customerId: string;
    merchantId: string;
    items: Array<{ id: string; quantity: number; basePrice: number }>;
    reskflowLocation: { lat: number; lng: number };
    reskflowDistance: number;
    orderTime?: Date;
  }): Promise<PriceCalculation> {
    try {
      const baseCalc = this.calculateBasePrice(params);
      const applicableRules = await this.getApplicableRules(params);
      
      let calculation: PriceCalculation = {
        basePrice: baseCalc.total,
        appliedRules: [],
        finalPrice: baseCalc.total,
        multiplier: 1,
        breakdown: baseCalc,
      };

      // Apply rules in priority order
      const sortedRules = applicableRules.sort((a, b) => b.priority - a.priority);

      for (const rule of sortedRules) {
        const adjustment = await this.applyRule(rule, calculation, params);
        
        if (adjustment.applied) {
          calculation.appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.name,
            adjustment: adjustment.amount,
            reason: adjustment.reason,
          });

          calculation = adjustment.newCalculation;
        }
      }

      // Apply limits
      calculation = this.applyPricingLimits(calculation, baseCalc);

      // Cache the calculation
      await this.cachePriceCalculation(params, calculation);

      // Track metrics
      await this.trackPricingMetrics(calculation, params);

      return calculation;

    } catch (error) {
      logger.error('Failed to calculate price', error);
      // Return base price on error
      return this.getDefaultPriceCalculation(params);
    }
  }

  /**
   * Create pricing rule
   */
  async createPricingRule(
    rule: Omit<PricingRule, 'id' | 'performance' | 'createdAt' | 'updatedAt'>
  ): Promise<PricingRule> {
    try {
      const newRule: PricingRule = {
        id: `rule_${Date.now()}`,
        ...rule,
        performance: {
          totalApplications: 0,
          revenueImpact: 0,
          conversionRate: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await prisma.pricingRule.create({
        data: newRule,
      });

      this.pricingRules.set(newRule.id, newRule);

      // Schedule if needed
      if (newRule.schedule && newRule.status === 'scheduled') {
        await this.scheduleRule(newRule);
      }

      this.emit('rule:created', newRule);

      return newRule;

    } catch (error) {
      logger.error('Failed to create pricing rule', error);
      throw error;
    }
  }

  /**
   * Update surge pricing
   */
  async updateSurgePricing(
    zoneId: string,
    multiplier: number,
    duration: number // minutes
  ): Promise<void> {
    try {
      const zone = await this.getOrCreateSurgeZone(zoneId);
      
      zone.currentMultiplier = Math.min(multiplier, 3.0); // Cap at 3x
      zone.activeUntil = new Date(Date.now() + duration * 60 * 1000);

      this.surgeZones.set(zoneId, zone);

      // Store in Redis for quick access
      await redisClient.setex(
        `surge:${zoneId}`,
        duration * 60,
        JSON.stringify(zone)
      );

      // Notify affected merchants and customers
      await this.notifySurgePricing(zone);

      this.emit('surge:updated', zone);

    } catch (error) {
      logger.error('Failed to update surge pricing', error);
      throw error;
    }
  }

  /**
   * Create pricing experiment
   */
  async createExperiment(
    experiment: Omit<PricingExperiment, 'id' | 'results'>
  ): Promise<PricingExperiment> {
    try {
      const newExperiment: PricingExperiment = {
        id: `exp_${Date.now()}`,
        ...experiment,
      };

      await prisma.pricingExperiment.create({
        data: newExperiment,
      });

      this.experiments.set(newExperiment.id, newExperiment);

      // Start experiment if active
      if (newExperiment.status === 'running') {
        await this.startExperiment(newExperiment);
      }

      this.emit('experiment:created', newExperiment);

      return newExperiment;

    } catch (error) {
      logger.error('Failed to create experiment', error);
      throw error;
    }
  }

  /**
   * Get pricing analytics
   */
  async getPricingAnalytics(
    timeRange: { start: Date; end: Date }
  ): Promise<{
    overview: {
      totalRevenue: number;
      revenueFromDynamicPricing: number;
      avgOrderValue: number;
      conversionRate: number;
      customerSatisfaction: number;
    };
    rulePerformance: Array<{
      rule: PricingRule;
      applications: number;
      revenueImpact: number;
      conversionRate: number;
      customerFeedback: number;
    }>;
    surgeAnalysis: {
      totalSurgeEvents: number;
      avgMultiplier: number;
      peakZones: Array<{ zone: string; frequency: number }>;
      revenueFromSurge: number;
    };
    experiments: Array<{
      experiment: PricingExperiment;
      status: string;
      impact: number;
    }>;
    insights: string[];
  }> {
    try {
      // Get revenue data
      const orders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
        include: {
          pricingDetails: true,
        },
      });

      const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
      const dynamicPricingRevenue = orders
        .filter(o => o.pricingDetails?.appliedRules?.length > 0)
        .reduce((sum, order) => sum + (order.pricingDetails?.adjustment || 0), 0);

      // Calculate metrics
      const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
      const conversionRate = await this.calculateConversionRate(timeRange);
      const customerSatisfaction = await this.getCustomerSatisfaction(timeRange);

      // Get rule performance
      const rulePerformance = await this.getRulePerformance(timeRange);

      // Analyze surge events
      const surgeAnalysis = await this.analyzeSurgeEvents(timeRange);

      // Get experiment results
      const experimentResults = await this.getExperimentResults();

      // Generate insights
      const insights = this.generatePricingInsights({
        orders,
        rulePerformance,
        surgeAnalysis,
        customerSatisfaction,
      });

      return {
        overview: {
          totalRevenue,
          revenueFromDynamicPricing: dynamicPricingRevenue,
          avgOrderValue,
          conversionRate,
          customerSatisfaction,
        },
        rulePerformance,
        surgeAnalysis,
        experiments: experimentResults,
        insights,
      };

    } catch (error) {
      logger.error('Failed to get pricing analytics', error);
      throw error;
    }
  }

  /**
   * Get surge zones
   */
  async getSurgeZones(): Promise<SurgeZone[]> {
    const zones = Array.from(this.surgeZones.values());
    
    // Filter active zones
    const activeZones = zones.filter(zone => 
      !zone.activeUntil || zone.activeUntil > new Date()
    );

    return activeZones;
  }

  /**
   * Simulate pricing
   */
  async simulatePricing(
    rule: Partial<PricingRule>,
    sampleSize: number = 1000
  ): Promise<{
    estimatedRevenue: number;
    estimatedOrders: number;
    avgPriceChange: number;
    affectedCustomers: number;
    priceDistribution: Array<{ range: string; count: number }>;
  }> {
    try {
      // Get sample orders
      const sampleOrders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        take: sampleSize,
        include: {
          customer: true,
          merchant: true,
        },
      });

      let totalRevenue = 0;
      let totalPriceChange = 0;
      const affectedCustomerSet = new Set<string>();
      const priceChanges: number[] = [];

      // Simulate rule application
      for (const order of sampleOrders) {
        const params = {
          customerId: order.customerId,
          merchantId: order.merchantId,
          items: order.items,
          reskflowLocation: order.reskflowAddress,
          reskflowDistance: order.reskflowDistance || 5,
        };

        const basePrice = order.total;
        const simulatedPrice = await this.simulateRuleApplication(rule as PricingRule, params);
        
        const priceChange = simulatedPrice - basePrice;
        totalRevenue += simulatedPrice;
        totalPriceChange += priceChange;
        priceChanges.push(priceChange);

        if (priceChange !== 0) {
          affectedCustomerSet.add(order.customerId);
        }
      }

      // Create price distribution
      const priceDistribution = this.createPriceDistribution(priceChanges);

      return {
        estimatedRevenue: totalRevenue,
        estimatedOrders: sampleOrders.length,
        avgPriceChange: totalPriceChange / sampleOrders.length,
        affectedCustomers: affectedCustomerSet.size,
        priceDistribution,
      };

    } catch (error) {
      logger.error('Failed to simulate pricing', error);
      throw error;
    }
  }

  /**
   * Get competitive pricing analysis
   */
  async getCompetitivePricingAnalysis(
    merchantCategory: string
  ): Promise<{
    marketPosition: 'below' | 'at' | 'above';
    avgMarketPrice: number;
    ourAvgPrice: number;
    competitors: CompetitorPricing[];
    recommendations: Array<{
      action: string;
      impact: string;
      confidence: number;
    }>;
  }> {
    try {
      // Get competitor data
      const competitors = await this.getCompetitorPricing(merchantCategory);
      
      // Calculate market average
      const avgMarketPrice = competitors.reduce((sum, c) => 
        sum + c.avgDeliveryFee + c.avgServiceFee, 0
      ) / competitors.length;

      // Get our average
      const ourPrices = await this.getOurAveragePricing(merchantCategory);
      const ourAvgPrice = ourPrices.reskflowFee + ourPrices.serviceFee;

      // Determine position
      let marketPosition: 'below' | 'at' | 'above';
      const priceDiff = ((ourAvgPrice - avgMarketPrice) / avgMarketPrice) * 100;
      
      if (priceDiff < -5) marketPosition = 'below';
      else if (priceDiff > 5) marketPosition = 'above';
      else marketPosition = 'at';

      // Generate recommendations
      const recommendations = this.generateCompetitiveRecommendations(
        marketPosition,
        priceDiff,
        competitors
      );

      return {
        marketPosition,
        avgMarketPrice,
        ourAvgPrice,
        competitors,
        recommendations,
      };

    } catch (error) {
      logger.error('Failed to get competitive pricing analysis', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async loadPricingRules(): Promise<void> {
    const rules = await prisma.pricingRule.findMany({
      where: {
        status: { in: ['active', 'scheduled'] },
      },
    });

    rules.forEach(rule => {
      this.pricingRules.set(rule.id, rule);
    });

    // Create default rules if none exist
    if (rules.length === 0) {
      await this.createDefaultRules();
    }
  }

  private async createDefaultRules(): Promise<void> {
    // Peak hours pricing
    await this.createPricingRule({
      name: 'Peak Hours Pricing',
      description: 'Increased pricing during lunch and dinner rush',
      type: 'time_based',
      status: 'active',
      priority: 10,
      conditions: [
        {
          type: 'time',
          operator: 'between',
          value: { start: '11:30', end: '13:30' },
        },
      ],
      actions: [
        {
          type: 'multiply',
          target: 'reskflow_fee',
          value: 1.2,
          cap: 5,
        },
      ],
      scope: {},
      limits: {
        maxMultiplier: 1.5,
      },
      createdBy: 'system',
    });

    // Bad weather pricing
    await this.createPricingRule({
      name: 'Bad Weather Surge',
      description: 'Increased pricing during severe weather',
      type: 'weather',
      status: 'active',
      priority: 20,
      conditions: [
        {
          type: 'weather',
          operator: 'in',
          value: ['rain', 'snow', 'storm'],
        },
      ],
      actions: [
        {
          type: 'multiply',
          target: 'reskflow_fee',
          value: 1.5,
          cap: 10,
        },
      ],
      scope: {},
      limits: {
        maxMultiplier: 2.0,
      },
      createdBy: 'system',
    });

    // Loyalty discount
    await this.createPricingRule({
      name: 'Loyalty Discount',
      description: 'Discount for loyal customers',
      type: 'loyalty',
      status: 'active',
      priority: 5,
      conditions: [
        {
          type: 'demand',
          operator: 'greater_than',
          value: { orderCount: 10 },
        },
      ],
      actions: [
        {
          type: 'percentage',
          target: 'service_fee',
          value: -10,
        },
      ],
      scope: {
        customerSegments: ['loyal'],
      },
      limits: {
        maxCustomerApplications: 5,
      },
      createdBy: 'system',
    });
  }

  private calculateBasePrice(params: any): any {
    const itemsTotal = params.items.reduce((sum: number, item: any) => 
      sum + (item.basePrice * item.quantity), 0
    );

    const baseDeliveryFee = this.calculateBaseDeliveryFee(params.reskflowDistance);
    const serviceFee = itemsTotal * 0.1; // 10% service fee

    return {
      itemsTotal,
      reskflowFee: baseDeliveryFee,
      serviceFee,
      total: itemsTotal + baseDeliveryFee + serviceFee,
    };
  }

  private calculateBaseDeliveryFee(distance: number): number {
    const baseFee = 2.99;
    const perKmFee = 0.75;
    return baseFee + (distance * perKmFee);
  }

  private async getApplicableRules(params: any): Promise<PricingRule[]> {
    const allRules = Array.from(this.pricingRules.values())
      .filter(rule => rule.status === 'active');

    const applicableRules: PricingRule[] = [];

    for (const rule of allRules) {
      if (await this.isRuleApplicable(rule, params)) {
        applicableRules.push(rule);
      }
    }

    return applicableRules;
  }

  private async isRuleApplicable(rule: PricingRule, params: any): Promise<boolean> {
    // Check scope
    if (!this.matchesScope(rule.scope, params)) {
      return false;
    }

    // Check schedule
    if (!this.matchesSchedule(rule.schedule)) {
      return false;
    }

    // Check conditions
    for (const condition of rule.conditions) {
      if (!await this.evaluateCondition(condition, params)) {
        return false;
      }
    }

    // Check limits
    if (!await this.checkRuleLimits(rule, params)) {
      return false;
    }

    return true;
  }

  private matchesScope(scope: PricingRule['scope'], params: any): boolean {
    if (scope.merchants && !scope.merchants.includes(params.merchantId)) {
      return false;
    }

    if (scope.zones) {
      const inZone = scope.zones.some(zoneId => 
        this.isLocationInZone(params.reskflowLocation, zoneId)
      );
      if (!inZone) return false;
    }

    return true;
  }

  private matchesSchedule(schedule?: PricingRule['schedule']): boolean {
    if (!schedule) return true;

    const now = new Date();
    
    if (schedule.startDate > now) return false;
    if (schedule.endDate && schedule.endDate < now) return false;

    if (schedule.recurringPattern) {
      return this.matchesRecurringPattern(schedule.recurringPattern, now);
    }

    return true;
  }

  private matchesRecurringPattern(pattern: RecurringPattern, date: Date): boolean {
    if (pattern.daysOfWeek && !pattern.daysOfWeek.includes(date.getDay())) {
      return false;
    }

    if (pattern.timeRanges) {
      const currentTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      const inTimeRange = pattern.timeRanges.some(range => 
        currentTime >= range.start && currentTime <= range.end
      );
      if (!inTimeRange) return false;
    }

    return true;
  }

  private async evaluateCondition(condition: PricingCondition, params: any): Promise<boolean> {
    switch (condition.type) {
      case 'demand':
        return await this.evaluateDemandCondition(condition, params);
      
      case 'time':
        return this.evaluateTimeCondition(condition);
      
      case 'weather':
        return await this.evaluateWeatherCondition(condition, params);
      
      case 'location':
        return this.evaluateLocationCondition(condition, params);
      
      default:
        return true;
    }
  }

  private async evaluateDemandCondition(condition: PricingCondition, params: any): Promise<boolean> {
    const demandData = await this.getCurrentDemandData(params.reskflowLocation);
    
    switch (condition.operator) {
      case 'greater_than':
        return demandData.demandScore > condition.value;
      case 'less_than':
        return demandData.demandScore < condition.value;
      default:
        return false;
    }
  }

  private evaluateTimeCondition(condition: PricingCondition): boolean {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    if (condition.operator === 'between' && condition.value.start && condition.value.end) {
      return currentTime >= condition.value.start && currentTime <= condition.value.end;
    }

    return false;
  }

  private async evaluateWeatherCondition(condition: PricingCondition, params: any): Promise<boolean> {
    const weather = await this.getCurrentWeather(params.reskflowLocation);
    
    if (condition.operator === 'in' && Array.isArray(condition.value)) {
      return condition.value.includes(weather);
    }

    return false;
  }

  private evaluateLocationCondition(condition: PricingCondition, params: any): boolean {
    // Evaluate location-based conditions
    return true;
  }

  private async checkRuleLimits(rule: PricingRule, params: any): Promise<boolean> {
    if (rule.limits.maxDailyApplications) {
      const todayApplications = await this.getRuleDailyApplications(rule.id);
      if (todayApplications >= rule.limits.maxDailyApplications) {
        return false;
      }
    }

    if (rule.limits.maxCustomerApplications) {
      const customerApplications = await this.getCustomerRuleApplications(
        rule.id,
        params.customerId
      );
      if (customerApplications >= rule.limits.maxCustomerApplications) {
        return false;
      }
    }

    return true;
  }

  private async applyRule(
    rule: PricingRule,
    calculation: PriceCalculation,
    params: any
  ): Promise<{
    applied: boolean;
    amount: number;
    reason: string;
    newCalculation: PriceCalculation;
  }> {
    let totalAdjustment = 0;
    const newCalculation = { ...calculation };

    for (const action of rule.actions) {
      const adjustment = this.calculateAdjustment(action, newCalculation);
      
      // Apply cap if specified
      const cappedAdjustment = action.cap ? 
        Math.min(adjustment, action.cap) : adjustment;

      // Apply adjustment
      switch (action.target) {
        case 'reskflow_fee':
          newCalculation.breakdown.reskflowFee += cappedAdjustment;
          break;
        case 'service_fee':
          newCalculation.breakdown.serviceFee += cappedAdjustment;
          break;
        case 'total':
          newCalculation.finalPrice += cappedAdjustment;
          break;
      }

      totalAdjustment += cappedAdjustment;
    }

    // Update final price
    newCalculation.finalPrice = 
      newCalculation.breakdown.itemsTotal +
      newCalculation.breakdown.reskflowFee +
      newCalculation.breakdown.serviceFee +
      (newCalculation.breakdown.discount || 0) +
      (newCalculation.breakdown.surge || 0);

    // Calculate multiplier
    newCalculation.multiplier = newCalculation.finalPrice / calculation.basePrice;

    // Record rule application
    await this.recordRuleApplication(rule.id, params, totalAdjustment);

    return {
      applied: totalAdjustment !== 0,
      amount: totalAdjustment,
      reason: this.getRuleReason(rule),
      newCalculation,
    };
  }

  private calculateAdjustment(action: PricingAction, calculation: PriceCalculation): number {
    let baseAmount = 0;

    switch (action.target) {
      case 'reskflow_fee':
        baseAmount = calculation.breakdown.reskflowFee;
        break;
      case 'service_fee':
        baseAmount = calculation.breakdown.serviceFee;
        break;
      case 'total':
        baseAmount = calculation.finalPrice;
        break;
    }

    switch (action.type) {
      case 'multiply':
        return baseAmount * (action.value - 1);
      case 'add':
        return action.value;
      case 'subtract':
        return -action.value;
      case 'percentage':
        return baseAmount * (action.value / 100);
      case 'set':
        return action.value - baseAmount;
      default:
        return 0;
    }
  }

  private getRuleReason(rule: PricingRule): string {
    const reasons: Record<string, string> = {
      surge: 'High demand in your area',
      time_based: 'Peak hours pricing',
      weather: 'Weather conditions',
      loyalty: 'Loyalty discount applied',
      distance_based: 'Distance-based pricing',
    };

    return reasons[rule.type] || rule.description;
  }

  private applyPricingLimits(
    calculation: PriceCalculation,
    baseCalc: any
  ): PriceCalculation {
    // Apply global multiplier limits
    const maxMultiplier = 3.0;
    const minMultiplier = 0.5;

    if (calculation.multiplier > maxMultiplier) {
      calculation.finalPrice = baseCalc.total * maxMultiplier;
      calculation.multiplier = maxMultiplier;
    } else if (calculation.multiplier < minMultiplier) {
      calculation.finalPrice = baseCalc.total * minMultiplier;
      calculation.multiplier = minMultiplier;
    }

    return calculation;
  }

  private async cachePriceCalculation(params: any, calculation: PriceCalculation): Promise<void> {
    const cacheKey = `price:${params.customerId}:${params.merchantId}`;
    await redisClient.setex(
      cacheKey,
      300, // 5 minutes
      JSON.stringify(calculation)
    );
  }

  private async trackPricingMetrics(calculation: PriceCalculation, params: any): Promise<void> {
    // Track applied rules
    for (const rule of calculation.appliedRules) {
      await analyticsService.trackEvent('pricing_rule_applied', {
        ruleId: rule.ruleId,
        customerId: params.customerId,
        merchantId: params.merchantId,
        adjustment: rule.adjustment,
      });
    }

    // Track price multiplier
    if (calculation.multiplier !== 1) {
      await analyticsService.trackMetric('price_multiplier', calculation.multiplier, {
        hasSurge: calculation.breakdown.surge ? true : false,
      });
    }
  }

  private getDefaultPriceCalculation(params: any): PriceCalculation {
    const baseCalc = this.calculateBasePrice(params);
    
    return {
      basePrice: baseCalc.total,
      appliedRules: [],
      finalPrice: baseCalc.total,
      multiplier: 1,
      breakdown: baseCalc,
    };
  }

  private async scheduleRule(rule: PricingRule): Promise<void> {
    if (!rule.schedule || !rule.schedule.startDate) return;

    const delay = rule.schedule.startDate.getTime() - Date.now();
    if (delay > 0) {
      setTimeout(async () => {
        rule.status = 'active';
        await prisma.pricingRule.update({
          where: { id: rule.id },
          data: { status: 'active' },
        });
        this.emit('rule:activated', rule);
      }, delay);
    }
  }

  private async getOrCreateSurgeZone(zoneId: string): Promise<SurgeZone> {
    let zone = this.surgeZones.get(zoneId);
    
    if (!zone) {
      // Get zone details from database
      const zoneData = await prisma.zone.findUnique({
        where: { id: zoneId },
      });

      if (!zoneData) {
        throw new Error('Zone not found');
      }

      zone = {
        id: zoneId,
        name: zoneData.name,
        polygon: zoneData.polygon,
        currentMultiplier: 1,
        demandScore: 0,
        affectedMerchants: 0,
        estimatedWaitTime: 0,
      };

      this.surgeZones.set(zoneId, zone);
    }

    return zone;
  }

  private async notifySurgePricing(zone: SurgeZone): Promise<void> {
    // Get affected merchants
    const merchants = await prisma.merchant.findMany({
      where: {
        location: {
          // In zone polygon
        },
      },
    });

    zone.affectedMerchants = merchants.length;

    // Notify merchants
    for (const merchant of merchants) {
      await notificationService.sendMerchantNotification(
        merchant.id,
        'Surge Pricing Active',
        `Delivery fees in your area are ${zone.currentMultiplier}x due to high demand`,
        {
          type: 'surge_pricing',
          multiplier: zone.currentMultiplier,
          duration: zone.activeUntil,
        }
      );
    }

    // Notify customers in the area
    await notificationService.sendWebSocketEvent(
      `zone_${zone.id}`,
      'surge_pricing_update',
      {
        multiplier: zone.currentMultiplier,
        reason: 'High demand in your area',
        estimatedWaitTime: zone.estimatedWaitTime,
      }
    );
  }

  private async startExperiment(experiment: PricingExperiment): Promise<void> {
    // Assign users to control/test groups
    const totalSize = experiment.controlGroup.size + 
      experiment.testGroups.reduce((sum, g) => sum + g.size, 0);

    // Track experiment participants
    await analyticsService.trackExperiment(experiment.id, {
      name: experiment.name,
      groups: [
        { id: 'control', size: experiment.controlGroup.size },
        ...experiment.testGroups.map(g => ({ id: g.id, size: g.size })),
      ],
    });

    this.emit('experiment:started', experiment);
  }

  private async getCurrentDemandData(location: { lat: number; lng: number }): Promise<DemandData> {
    // Get zone for location
    const zone = await this.getZoneForLocation(location);
    
    // Get real-time metrics
    const [activeOrders, availableDrivers] = await Promise.all([
      this.getActiveOrdersInZone(zone),
      this.getAvailableDriversInZone(zone),
    ]);

    const demandScore = this.calculateDemandScore(activeOrders, availableDrivers);
    const supplyScore = this.calculateSupplyScore(availableDrivers, activeOrders);

    return {
      zone,
      timestamp: new Date(),
      activeOrders: activeOrders.length,
      pendingOrders: activeOrders.filter(o => o.status === 'pending').length,
      availableDrivers: availableDrivers.length,
      avgWaitTime: this.calculateAvgWaitTime(activeOrders, availableDrivers),
      demandScore,
      supplyScore,
    };
  }

  private async getZoneForLocation(location: { lat: number; lng: number }): Promise<string> {
    // Find zone containing location
    const zones = await prisma.zone.findMany();
    
    for (const zone of zones) {
      if (this.isLocationInPolygon(location, zone.polygon)) {
        return zone.id;
      }
    }

    return 'default';
  }

  private isLocationInPolygon(
    location: { lat: number; lng: number },
    polygon: Array<{ lat: number; lng: number }>
  ): boolean {
    return geolib.isPointInPolygon(location, polygon);
  }

  private isLocationInZone(location: { lat: number; lng: number }, zoneId: string): boolean {
    const zone = this.surgeZones.get(zoneId);
    if (!zone) return false;
    
    return this.isLocationInPolygon(location, zone.polygon);
  }

  private async getActiveOrdersInZone(zoneId: string): Promise<any[]> {
    return await prisma.order.findMany({
      where: {
        status: { in: ['pending', 'confirmed', 'preparing'] },
        zoneId,
      },
    });
  }

  private async getAvailableDriversInZone(zoneId: string): Promise<any[]> {
    return await prisma.driver.findMany({
      where: {
        isOnline: true,
        isAvailable: true,
        currentZoneId: zoneId,
      },
    });
  }

  private calculateDemandScore(orders: any[], drivers: any[]): number {
    if (drivers.length === 0) return 100;
    
    const ratio = orders.length / drivers.length;
    return Math.min(100, ratio * 20);
  }

  private calculateSupplyScore(drivers: any[], orders: any[]): number {
    if (orders.length === 0) return 100;
    
    const ratio = drivers.length / orders.length;
    return Math.min(100, ratio * 20);
  }

  private calculateAvgWaitTime(orders: any[], drivers: any[]): number {
    if (drivers.length === 0) return 60;
    
    const ordersPerDriver = orders.length / drivers.length;
    return Math.min(60, ordersPerDriver * 10);
  }

  private async getCurrentWeather(location: { lat: number; lng: number }): Promise<string> {
    // In real implementation, would call weather API
    // For now, return simulated weather
    const weatherTypes = ['clear', 'rain', 'snow', 'cloudy'];
    return weatherTypes[Math.floor(Math.random() * weatherTypes.length)];
  }

  private async getRuleDailyApplications(ruleId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await prisma.ruleApplication.count({
      where: {
        ruleId,
        appliedAt: { gte: today },
      },
    });

    return count;
  }

  private async getCustomerRuleApplications(ruleId: string, customerId: string): Promise<number> {
    const count = await prisma.ruleApplication.count({
      where: {
        ruleId,
        customerId,
      },
    });

    return count;
  }

  private async recordRuleApplication(
    ruleId: string,
    params: any,
    adjustment: number
  ): Promise<void> {
    await prisma.ruleApplication.create({
      data: {
        ruleId,
        customerId: params.customerId,
        merchantId: params.merchantId,
        adjustment,
        appliedAt: new Date(),
      },
    });

    // Update rule performance
    const rule = this.pricingRules.get(ruleId);
    if (rule) {
      rule.performance.totalApplications++;
      rule.performance.revenueImpact += adjustment;
    }
  }

  private setupRealtimeMonitoring(): void {
    // Monitor order creation for demand
    this.on('order:created', async (order) => {
      await this.updateDemandData(order.merchantLocation);
    });

    // Monitor driver availability
    this.on('driver:status_changed', async (driver) => {
      await this.updateSupplyData(driver.currentLocation);
    });

    // Monitor weather changes
    this.on('weather:changed', async (data) => {
      await this.handleWeatherChange(data);
    });
  }

  private async monitorDemand(): Promise<void> {
    try {
      // Get all active zones
      const zones = await prisma.zone.findMany({ where: { active: true } });

      for (const zone of zones) {
        const demandData = await this.getCurrentDemandData(zone.center);
        
        // Check if surge pricing needed
        if (demandData.demandScore > 80 && demandData.supplyScore < 50) {
          const multiplier = this.calculateSurgeMultiplier(demandData);
          await this.updateSurgePricing(zone.id, multiplier, 30);
        } else if (demandData.demandScore < 50) {
          // Remove surge if demand is low
          const surgeZone = this.surgeZones.get(zone.id);
          if (surgeZone && surgeZone.currentMultiplier > 1) {
            await this.updateSurgePricing(zone.id, 1, 0);
          }
        }
      }

    } catch (error) {
      logger.error('Failed to monitor demand', error);
    }
  }

  private calculateSurgeMultiplier(demandData: DemandData): number {
    const baseSurge = demandData.demandScore / 50;
    const waitTimeFactor = Math.min(demandData.avgWaitTime / 30, 2);
    
    return Math.min(3, Math.max(1, baseSurge * waitTimeFactor));
  }

  private async monitorCompetitorPricing(): Promise<void> {
    try {
      // In real implementation, would scrape or API call competitor data
      // For now, simulate competitor monitoring
      
      const categories = ['fast_food', 'restaurant', 'grocery'];
      
      for (const category of categories) {
        const competitorData = await this.fetchCompetitorPricing(category);
        
        // Store competitor data
        for (const competitor of competitorData) {
          await prisma.competitorPricing.upsert({
            where: {
              competitorId_merchantCategory: {
                competitorId: competitor.competitorId,
                merchantCategory: category,
              },
            },
            create: competitor,
            update: competitor,
          });
        }

        // Analyze and adjust if needed
        await this.analyzeCompetitivePricing(category);
      }

    } catch (error) {
      logger.error('Failed to monitor competitor pricing', error);
    }
  }

  private async fetchCompetitorPricing(category: string): Promise<CompetitorPricing[]> {
    // Simulated competitor data
    return [
      {
        competitorId: 'comp_1',
        merchantCategory: category,
        avgDeliveryFee: 3.99,
        avgServiceFee: 2.99,
        promotions: ['free_reskflow_over_25'],
        lastUpdated: new Date(),
      },
    ];
  }

  private async analyzeCompetitivePricing(category: string): Promise<void> {
    const analysis = await this.getCompetitivePricingAnalysis(category);
    
    if (analysis.marketPosition === 'above' && analysis.ourAvgPrice > analysis.avgMarketPrice * 1.2) {
      // Consider creating competitive pricing rule
      logger.info(`Our pricing is 20% above market for ${category}`);
    }
  }

  private async updateDemandData(location: { lat: number; lng: number }): Promise<void> {
    const demandData = await this.getCurrentDemandData(location);
    
    // Cache demand data
    const zone = await this.getZoneForLocation(location);
    await redisClient.setex(
      `demand:${zone}`,
      300,
      JSON.stringify(demandData)
    );
  }

  private async updateSupplyData(location: { lat: number; lng: number }): Promise<void> {
    const zone = await this.getZoneForLocation(location);
    const drivers = await this.getAvailableDriversInZone(zone);
    
    await redisClient.setex(
      `supply:${zone}`,
      300,
      JSON.stringify({ count: drivers.length, timestamp: new Date() })
    );
  }

  private async handleWeatherChange(data: any): Promise<void> {
    if (['rain', 'snow', 'storm'].includes(data.condition)) {
      // Activate weather-based pricing rules
      const weatherRules = Array.from(this.pricingRules.values())
        .filter(rule => rule.type === 'weather' && rule.status === 'inactive');

      for (const rule of weatherRules) {
        rule.status = 'active';
        await prisma.pricingRule.update({
          where: { id: rule.id },
          data: { status: 'active' },
        });
      }
    }
  }

  private async calculateConversionRate(timeRange: { start: Date; end: Date }): Promise<number> {
    // Get cart abandonment data
    const analytics = await analyticsService.getMetrics('conversion_rate', timeRange);
    return analytics.value || 0.7;
  }

  private async getCustomerSatisfaction(timeRange: { start: Date; end: Date }): Promise<number> {
    const reviews = await prisma.review.findMany({
      where: {
        createdAt: {
          gte: timeRange.start,
          lte: timeRange.end,
        },
      },
    });

    if (reviews.length === 0) return 0;

    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return (avgRating / 5) * 100;
  }

  private async getRulePerformance(
    timeRange: { start: Date; end: Date }
  ): Promise<Array<{
    rule: PricingRule;
    applications: number;
    revenueImpact: number;
    conversionRate: number;
    customerFeedback: number;
  }>> {
    const performance = [];

    for (const rule of this.pricingRules.values()) {
      const applications = await prisma.ruleApplication.count({
        where: {
          ruleId: rule.id,
          appliedAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
      });

      const revenueImpact = await prisma.ruleApplication.aggregate({
        where: {
          ruleId: rule.id,
          appliedAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
        _sum: { adjustment: true },
      });

      performance.push({
        rule,
        applications,
        revenueImpact: revenueImpact._sum.adjustment || 0,
        conversionRate: rule.performance.conversionRate,
        customerFeedback: 0, // Would calculate from reviews mentioning pricing
      });
    }

    return performance;
  }

  private async analyzeSurgeEvents(
    timeRange: { start: Date; end: Date }
  ): Promise<{
    totalSurgeEvents: number;
    avgMultiplier: number;
    peakZones: Array<{ zone: string; frequency: number }>;
    revenueFromSurge: number;
  }> {
    const surgeEvents = await prisma.surgeEvent.findMany({
      where: {
        startedAt: {
          gte: timeRange.start,
          lte: timeRange.end,
        },
      },
    });

    const zoneFrequency = new Map<string, number>();
    let totalMultiplier = 0;
    let surgeRevenue = 0;

    for (const event of surgeEvents) {
      zoneFrequency.set(event.zoneId, (zoneFrequency.get(event.zoneId) || 0) + 1);
      totalMultiplier += event.multiplier;
      surgeRevenue += event.revenueGenerated || 0;
    }

    const peakZones = Array.from(zoneFrequency.entries())
      .map(([zone, frequency]) => ({ zone, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    return {
      totalSurgeEvents: surgeEvents.length,
      avgMultiplier: surgeEvents.length > 0 ? totalMultiplier / surgeEvents.length : 1,
      peakZones,
      revenueFromSurge: surgeRevenue,
    };
  }

  private async getExperimentResults(): Promise<Array<{
    experiment: PricingExperiment;
    status: string;
    impact: number;
  }>> {
    const results = [];

    for (const experiment of this.experiments.values()) {
      let impact = 0;

      if (experiment.results) {
        impact = experiment.results.impact.revenue;
      }

      results.push({
        experiment,
        status: experiment.status,
        impact,
      });
    }

    return results;
  }

  private generatePricingInsights(data: any): string[] {
    const insights: string[] = [];

    // Surge pricing insights
    if (data.surgeAnalysis.totalSurgeEvents > 10) {
      insights.push(`High surge frequency (${data.surgeAnalysis.totalSurgeEvents} events) may indicate need for more drivers`);
    }

    // Customer satisfaction
    if (data.customerSatisfaction < 70) {
      insights.push('Customer satisfaction is below target - consider reviewing pricing strategy');
    }

    // Rule performance
    const underperformingRules = data.rulePerformance.filter((r: any) => 
      r.conversionRate < 0.5 && r.applications > 100
    );
    if (underperformingRules.length > 0) {
      insights.push(`${underperformingRules.length} pricing rules showing poor conversion rates`);
    }

    return insights;
  }

  private async simulateRuleApplication(rule: PricingRule, params: any): Promise<number> {
    const baseCalc = this.calculateBasePrice(params);
    let price = baseCalc.total;

    for (const action of rule.actions) {
      const adjustment = this.calculateAdjustment(action, {
        basePrice: price,
        finalPrice: price,
        appliedRules: [],
        multiplier: 1,
        breakdown: baseCalc,
      });

      price += adjustment;
    }

    return price;
  }

  private createPriceDistribution(priceChanges: number[]): Array<{ range: string; count: number }> {
    const ranges = [
      { min: -Infinity, max: -10, label: 'Decrease > $10' },
      { min: -10, max: -5, label: 'Decrease $5-10' },
      { min: -5, max: 0, label: 'Decrease < $5' },
      { min: 0, max: 0, label: 'No change' },
      { min: 0, max: 5, label: 'Increase < $5' },
      { min: 5, max: 10, label: 'Increase $5-10' },
      { min: 10, max: Infinity, label: 'Increase > $10' },
    ];

    return ranges.map(range => ({
      range: range.label,
      count: priceChanges.filter(change => change > range.min && change <= range.max).length,
    }));
  }

  private async getCompetitorPricing(category: string): Promise<CompetitorPricing[]> {
    return await prisma.competitorPricing.findMany({
      where: { merchantCategory: category },
      orderBy: { lastUpdated: 'desc' },
    });
  }

  private async getOurAveragePricing(category: string): Promise<{
    reskflowFee: number;
    serviceFee: number;
  }> {
    const merchants = await prisma.merchant.findMany({
      where: { category },
    });

    const orders = await prisma.order.findMany({
      where: {
        merchantId: { in: merchants.map(m => m.id) },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    if (orders.length === 0) {
      return { reskflowFee: 3.99, serviceFee: 2.99 };
    }

    const avgDeliveryFee = orders.reduce((sum, o) => sum + (o.reskflowFee || 0), 0) / orders.length;
    const avgServiceFee = orders.reduce((sum, o) => sum + (o.serviceFee || 0), 0) / orders.length;

    return { reskflowFee: avgDeliveryFee, serviceFee: avgServiceFee };
  }

  private generateCompetitiveRecommendations(
    position: string,
    priceDiff: number,
    competitors: CompetitorPricing[]
  ): Array<{
    action: string;
    impact: string;
    confidence: number;
  }> {
    const recommendations = [];

    if (position === 'above' && priceDiff > 10) {
      recommendations.push({
        action: 'Consider competitive pricing rule to match market rates',
        impact: 'Could increase order volume by 15-20%',
        confidence: 0.8,
      });
    }

    if (position === 'below' && priceDiff < -10) {
      recommendations.push({
        action: 'Opportunity to increase prices to market level',
        impact: 'Could increase revenue by 8-10% with minimal volume impact',
        confidence: 0.75,
      });
    }

    // Check for promotional gaps
    const competitorPromos = new Set(competitors.flatMap(c => c.promotions));
    if (!competitorPromos.has('free_reskflow')) {
      recommendations.push({
        action: 'Launch free reskflow promotion to differentiate',
        impact: 'Could capture 5-8% market share',
        confidence: 0.7,
      });
    }

    return recommendations;
  }
}

// Export singleton instance
export const dynamicPricingService = new DynamicPricingService();