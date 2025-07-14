/**
 * Fraud Detection Service
 * Monitors and prevents fraudulent activities across the platform
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { redisClient } from '../../config/redis';
import { analyticsService } from '../analytics/analytics.service';

const prisma = new PrismaClient();

interface FraudRule {
  id: string;
  name: string;
  description: string;
  category: 'payment' | 'account' | 'order' | 'promo' | 'reskflow' | 'review';
  type: 'threshold' | 'pattern' | 'anomaly' | 'velocity' | 'geolocation';
  status: 'active' | 'inactive' | 'testing';
  conditions: RuleCondition[];
  actions: RuleAction[];
  riskScore: number; // 1-100
  priority: 'low' | 'medium' | 'high' | 'critical';
  falsePositiveRate?: number;
  truePositiveRate?: number;
  lastTriggered?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in' | 'not_in' | 'matches_pattern';
  value: any;
  timeWindow?: number; // minutes
  aggregation?: 'count' | 'sum' | 'avg' | 'max' | 'min';
}

interface RuleAction {
  type: 'flag' | 'block' | 'review' | 'notify' | 'limit' | 'challenge' | 'suspend';
  target: 'transaction' | 'user' | 'merchant' | 'driver' | 'order';
  parameters?: any;
}

interface FraudIncident {
  id: string;
  type: FraudRule['category'];
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'detected' | 'investigating' | 'confirmed' | 'false_positive' | 'resolved';
  entityType: 'customer' | 'merchant' | 'driver' | 'order' | 'transaction';
  entityId: string;
  ruleIds: string[];
  riskScore: number;
  evidence: Evidence[];
  timeline: IncidentEvent[];
  assignedTo?: string;
  resolution?: {
    action: string;
    notes: string;
    resolvedBy: string;
    resolvedAt: Date;
  };
  detectedAt: Date;
  updatedAt: Date;
}

interface Evidence {
  type: string;
  description: string;
  data: any;
  timestamp: Date;
  source: string;
}

interface IncidentEvent {
  timestamp: Date;
  type: string;
  description: string;
  performedBy?: string;
  metadata?: any;
}

interface RiskProfile {
  entityType: 'customer' | 'merchant' | 'driver';
  entityId: string;
  overallRisk: number; // 0-100
  factors: RiskFactor[];
  history: {
    totalTransactions: number;
    flaggedTransactions: number;
    confirmedFraud: number;
    falsePositives: number;
    lastIncident?: Date;
  };
  restrictions: string[];
  lastCalculated: Date;
}

interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  details: string;
}

interface FraudPattern {
  id: string;
  name: string;
  description: string;
  indicators: string[];
  frequency: number;
  locations?: string[];
  timePatterns?: {
    dayOfWeek?: number[];
    hourOfDay?: number[];
  };
  associatedEntities: string[];
  confidence: number;
  firstSeen: Date;
  lastSeen: Date;
}

interface MachineLearningModel {
  id: string;
  name: string;
  version: string;
  type: 'classification' | 'anomaly_detection' | 'clustering';
  features: string[];
  performance: {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
  };
  lastTrained: Date;
  status: 'training' | 'active' | 'inactive';
}

export class FraudDetectionService extends EventEmitter {
  private rules: Map<string, FraudRule> = new Map();
  private activeIncidents: Map<string, FraudIncident> = new Map();
  private riskProfiles: Map<string, RiskProfile> = new Map();
  private mlModels: Map<string, MachineLearningModel> = new Map();
  private monitoringJob: CronJob;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private async initializeService() {
    // Load fraud rules
    await this.loadFraudRules();

    // Initialize ML models
    await this.initializeMLModels();

    // Setup monitoring job
    this.monitoringJob = new CronJob('*/5 * * * *', async () => {
      await this.runFraudDetection();
    });
    this.monitoringJob.start();

    // Setup real-time monitoring
    this.setupRealtimeMonitoring();
  }

  /**
   * Evaluate transaction for fraud
   */
  async evaluateTransaction(transaction: {
    id: string;
    type: 'payment' | 'refund' | 'payout';
    amount: number;
    currency: string;
    customerId?: string;
    merchantId?: string;
    driverId?: string;
    orderId?: string;
    paymentMethod: string;
    metadata?: any;
  }): Promise<{
    allowed: boolean;
    riskScore: number;
    flags: string[];
    requiredActions: string[];
  }> {
    try {
      const applicableRules = this.getApplicableRules('payment', transaction);
      let totalRiskScore = 0;
      const flags: string[] = [];
      const requiredActions: Set<string> = new Set();
      let blocked = false;

      // Evaluate each rule
      for (const rule of applicableRules) {
        const result = await this.evaluateRule(rule, transaction);
        
        if (result.triggered) {
          totalRiskScore += rule.riskScore;
          flags.push(rule.name);

          // Apply actions
          for (const action of rule.actions) {
            if (action.type === 'block') {
              blocked = true;
            }
            requiredActions.add(action.type);
          }

          // Log rule trigger
          await this.logRuleTrigger(rule, transaction);
        }
      }

      // ML-based evaluation
      const mlScore = await this.evaluateWithML(transaction);
      totalRiskScore = Math.min(100, (totalRiskScore + mlScore) / 2);

      // Create incident if high risk
      if (totalRiskScore > 70 || blocked) {
        await this.createFraudIncident({
          type: 'payment',
          severity: this.calculateSeverity(totalRiskScore),
          entityType: 'transaction',
          entityId: transaction.id,
          ruleIds: flags.map(f => this.getRuleIdByName(f)),
          riskScore: totalRiskScore,
          evidence: this.gatherEvidence(transaction, flags),
        });
      }

      // Update risk profiles
      if (transaction.customerId) {
        await this.updateRiskProfile('customer', transaction.customerId, totalRiskScore);
      }
      if (transaction.merchantId) {
        await this.updateRiskProfile('merchant', transaction.merchantId, totalRiskScore);
      }

      return {
        allowed: !blocked && totalRiskScore < 80,
        riskScore: totalRiskScore,
        flags,
        requiredActions: Array.from(requiredActions),
      };

    } catch (error) {
      logger.error('Failed to evaluate transaction', error);
      // Default to safe mode
      return {
        allowed: false,
        riskScore: 100,
        flags: ['evaluation_error'],
        requiredActions: ['manual_review'],
      };
    }
  }

  /**
   * Evaluate order for fraud
   */
  async evaluateOrder(order: {
    id: string;
    customerId: string;
    merchantId: string;
    total: number;
    items: any[];
    reskflowAddress: any;
    customerLocation?: { lat: number; lng: number };
    device?: {
      ip: string;
      userAgent: string;
      fingerprint?: string;
    };
  }): Promise<{
    allowed: boolean;
    riskScore: number;
    flags: string[];
  }> {
    try {
      const flags: string[] = [];
      let riskScore = 0;

      // Check customer risk profile
      const customerProfile = await this.getRiskProfile('customer', order.customerId);
      if (customerProfile.overallRisk > 50) {
        flags.push('high_risk_customer');
        riskScore += 20;
      }

      // Velocity checks
      const velocityCheck = await this.checkVelocity('order', order.customerId, {
        timeWindow: 60, // 1 hour
        maxCount: 5,
        maxAmount: 500,
      });

      if (velocityCheck.exceeded) {
        flags.push('velocity_limit_exceeded');
        riskScore += 30;
      }

      // Geolocation checks
      if (order.customerLocation && order.reskflowAddress) {
        const distance = this.calculateDistance(
          order.customerLocation,
          { lat: order.reskflowAddress.latitude, lng: order.reskflowAddress.longitude }
        );

        if (distance > 50) { // 50km
          flags.push('unusual_reskflow_distance');
          riskScore += 15;
        }
      }

      // Device fingerprinting
      if (order.device) {
        const deviceRisk = await this.checkDeviceReputation(order.device);
        if (deviceRisk.suspicious) {
          flags.push('suspicious_device');
          riskScore += deviceRisk.score;
        }
      }

      // Pattern detection
      const patterns = await this.detectPatterns(order);
      if (patterns.length > 0) {
        flags.push(...patterns.map(p => p.name));
        riskScore += patterns.reduce((sum, p) => sum + p.confidence * 20, 0);
      }

      // High-value order check
      if (order.total > 200) {
        const avgOrderValue = await this.getAverageOrderValue(order.customerId);
        if (order.total > avgOrderValue * 3) {
          flags.push('unusually_high_value');
          riskScore += 10;
        }
      }

      riskScore = Math.min(100, riskScore);

      // Create incident if needed
      if (riskScore > 60) {
        await this.createFraudIncident({
          type: 'order',
          severity: this.calculateSeverity(riskScore),
          entityType: 'order',
          entityId: order.id,
          ruleIds: [],
          riskScore,
          evidence: this.gatherEvidence(order, flags),
        });
      }

      return {
        allowed: riskScore < 70,
        riskScore,
        flags,
      };

    } catch (error) {
      logger.error('Failed to evaluate order', error);
      return {
        allowed: true, // Don't block orders on error
        riskScore: 0,
        flags: [],
      };
    }
  }

  /**
   * Report suspicious activity
   */
  async reportSuspiciousActivity(report: {
    reportedBy: string;
    reporterType: 'customer' | 'merchant' | 'driver' | 'admin';
    entityType: string;
    entityId: string;
    reason: string;
    evidence?: any;
  }): Promise<FraudIncident> {
    try {
      const incident = await this.createFraudIncident({
        type: 'account',
        severity: 'medium',
        entityType: report.entityType as any,
        entityId: report.entityId,
        ruleIds: [],
        riskScore: 50,
        evidence: [
          {
            type: 'user_report',
            description: report.reason,
            data: {
              reportedBy: report.reportedBy,
              reporterType: report.reporterType,
              additionalEvidence: report.evidence,
            },
            timestamp: new Date(),
            source: 'user_report',
          },
        ],
      });

      // Investigate the reported entity
      await this.investigateEntity(report.entityType, report.entityId);

      return incident;

    } catch (error) {
      logger.error('Failed to report suspicious activity', error);
      throw error;
    }
  }

  /**
   * Get fraud dashboard data
   */
  async getFraudDashboard(timeRange: { start: Date; end: Date }): Promise<{
    summary: {
      totalIncidents: number;
      confirmedFraud: number;
      falsePositives: number;
      preventedLoss: number;
      averageRiskScore: number;
    };
    incidentsByType: Record<string, number>;
    topRules: Array<{ rule: FraudRule; triggers: number }>;
    riskTrends: Array<{ date: Date; averageRisk: number; incidents: number }>;
    highRiskEntities: Array<{ entity: any; riskScore: number; incidents: number }>;
  }> {
    try {
      // Get incidents in time range
      const incidents = await prisma.fraudIncident.findMany({
        where: {
          detectedAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
      });

      // Calculate summary
      const confirmedFraud = incidents.filter(i => i.status === 'confirmed').length;
      const falsePositives = incidents.filter(i => i.status === 'false_positive').length;
      const totalIncidents = incidents.length;
      const averageRiskScore = incidents.reduce((sum, i) => sum + i.riskScore, 0) / totalIncidents || 0;

      // Calculate prevented loss
      const preventedLoss = await this.calculatePreventedLoss(incidents);

      // Group by type
      const incidentsByType = incidents.reduce((acc, incident) => {
        acc[incident.type] = (acc[incident.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get top triggered rules
      const ruleTriggers = new Map<string, number>();
      incidents.forEach(incident => {
        incident.ruleIds.forEach(ruleId => {
          ruleTriggers.set(ruleId, (ruleTriggers.get(ruleId) || 0) + 1);
        });
      });

      const topRules = Array.from(ruleTriggers.entries())
        .map(([ruleId, triggers]) => ({
          rule: this.rules.get(ruleId)!,
          triggers,
        }))
        .filter(item => item.rule)
        .sort((a, b) => b.triggers - a.triggers)
        .slice(0, 10);

      // Calculate risk trends
      const riskTrends = await this.calculateRiskTrends(timeRange);

      // Get high risk entities
      const highRiskEntities = await this.getHighRiskEntities();

      return {
        summary: {
          totalIncidents,
          confirmedFraud,
          falsePositives,
          preventedLoss,
          averageRiskScore,
        },
        incidentsByType,
        topRules,
        riskTrends,
        highRiskEntities,
      };

    } catch (error) {
      logger.error('Failed to get fraud dashboard', error);
      throw error;
    }
  }

  /**
   * Update fraud rule
   */
  async updateFraudRule(
    ruleId: string,
    updates: Partial<FraudRule>
  ): Promise<FraudRule> {
    try {
      const rule = this.rules.get(ruleId);
      if (!rule) {
        throw new Error('Rule not found');
      }

      const updatedRule = {
        ...rule,
        ...updates,
        updatedAt: new Date(),
      };

      await prisma.fraudRule.update({
        where: { id: ruleId },
        data: updatedRule,
      });

      this.rules.set(ruleId, updatedRule);

      this.emit('rule:updated', {
        ruleId,
        changes: updates,
      });

      return updatedRule;

    } catch (error) {
      logger.error('Failed to update fraud rule', error);
      throw error;
    }
  }

  /**
   * Investigate fraud incident
   */
  async investigateIncident(
    incidentId: string,
    investigatorId: string
  ): Promise<{
    incident: FraudIncident;
    relatedIncidents: FraudIncident[];
    entityHistory: any;
    recommendations: string[];
  }> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident) {
        throw new Error('Incident not found');
      }

      // Update incident status
      incident.status = 'investigating';
      incident.assignedTo = investigatorId;
      incident.timeline.push({
        timestamp: new Date(),
        type: 'investigation_started',
        description: 'Investigation started',
        performedBy: investigatorId,
      });

      await prisma.fraudIncident.update({
        where: { id: incidentId },
        data: incident,
      });

      // Find related incidents
      const relatedIncidents = await this.findRelatedIncidents(incident);

      // Get entity history
      const entityHistory = await this.getEntityHistory(
        incident.entityType,
        incident.entityId
      );

      // Generate recommendations
      const recommendations = this.generateInvestigationRecommendations(
        incident,
        relatedIncidents,
        entityHistory
      );

      return {
        incident,
        relatedIncidents,
        entityHistory,
        recommendations,
      };

    } catch (error) {
      logger.error('Failed to investigate incident', error);
      throw error;
    }
  }

  /**
   * Resolve fraud incident
   */
  async resolveIncident(
    incidentId: string,
    resolution: {
      status: 'confirmed' | 'false_positive' | 'resolved';
      action: string;
      notes: string;
      resolvedBy: string;
    }
  ): Promise<void> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident) {
        throw new Error('Incident not found');
      }

      incident.status = resolution.status;
      incident.resolution = {
        ...resolution,
        resolvedAt: new Date(),
      };

      incident.timeline.push({
        timestamp: new Date(),
        type: 'incident_resolved',
        description: `Incident resolved as ${resolution.status}`,
        performedBy: resolution.resolvedBy,
        metadata: { action: resolution.action },
      });

      await prisma.fraudIncident.update({
        where: { id: incidentId },
        data: incident,
      });

      // Update rule performance
      if (resolution.status === 'false_positive') {
        await this.updateRulePerformance(incident.ruleIds, false);
      } else if (resolution.status === 'confirmed') {
        await this.updateRulePerformance(incident.ruleIds, true);
      }

      // Apply resolution actions
      await this.applyResolutionActions(incident, resolution);

      // Remove from active incidents
      this.activeIncidents.delete(incidentId);

      this.emit('incident:resolved', {
        incidentId,
        status: resolution.status,
      });

    } catch (error) {
      logger.error('Failed to resolve incident', error);
      throw error;
    }
  }

  /**
   * Train ML model with new data
   */
  async trainMLModel(
    modelId: string,
    trainingData?: any
  ): Promise<void> {
    try {
      const model = this.mlModels.get(modelId);
      if (!model) {
        throw new Error('Model not found');
      }

      model.status = 'training';
      this.emit('ml:training_started', { modelId });

      // In a real implementation, this would:
      // 1. Prepare training data
      // 2. Train the model (possibly on a separate service)
      // 3. Evaluate performance
      // 4. Deploy if performance is better

      // Simulated training
      setTimeout(() => {
        model.performance = {
          accuracy: 0.92,
          precision: 0.89,
          recall: 0.87,
          f1Score: 0.88,
        };
        model.lastTrained = new Date();
        model.status = 'active';

        this.emit('ml:training_completed', {
          modelId,
          performance: model.performance,
        });
      }, 5000);

    } catch (error) {
      logger.error('Failed to train ML model', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async loadFraudRules(): Promise<void> {
    // Load default rules
    const defaultRules: FraudRule[] = [
      {
        id: 'rule_velocity_orders',
        name: 'High Order Velocity',
        description: 'Detects unusually high order frequency',
        category: 'order',
        type: 'velocity',
        status: 'active',
        conditions: [
          {
            field: 'order_count',
            operator: 'greater_than',
            value: 10,
            timeWindow: 60,
            aggregation: 'count',
          },
        ],
        actions: [
          { type: 'flag', target: 'user' },
          { type: 'review', target: 'order' },
        ],
        riskScore: 40,
        priority: 'medium',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rule_payment_failure',
        name: 'Multiple Payment Failures',
        description: 'Detects multiple failed payment attempts',
        category: 'payment',
        type: 'pattern',
        status: 'active',
        conditions: [
          {
            field: 'payment_failures',
            operator: 'greater_than',
            value: 3,
            timeWindow: 30,
            aggregation: 'count',
          },
        ],
        actions: [
          { type: 'block', target: 'transaction' },
          { type: 'notify', target: 'user' },
        ],
        riskScore: 60,
        priority: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rule_promo_abuse',
        name: 'Promo Code Abuse',
        description: 'Detects abuse of promotional codes',
        category: 'promo',
        type: 'pattern',
        status: 'active',
        conditions: [
          {
            field: 'promo_usage',
            operator: 'greater_than',
            value: 5,
            timeWindow: 1440, // 24 hours
            aggregation: 'count',
          },
        ],
        actions: [
          { type: 'limit', target: 'user' },
          { type: 'flag', target: 'user' },
        ],
        riskScore: 30,
        priority: 'medium',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Load from database
    const dbRules = await prisma.fraudRule.findMany({
      where: { status: 'active' },
    });

    const allRules = [...defaultRules, ...dbRules];
    allRules.forEach(rule => {
      this.rules.set(rule.id, rule);
    });
  }

  private async initializeMLModels(): Promise<void> {
    // Initialize fraud detection models
    this.mlModels.set('transaction_classifier', {
      id: 'transaction_classifier',
      name: 'Transaction Fraud Classifier',
      version: '1.0',
      type: 'classification',
      features: ['amount', 'time_of_day', 'merchant_category', 'user_history'],
      performance: {
        accuracy: 0.89,
        precision: 0.86,
        recall: 0.84,
        f1Score: 0.85,
      },
      lastTrained: new Date(),
      status: 'active',
    });

    this.mlModels.set('anomaly_detector', {
      id: 'anomaly_detector',
      name: 'Behavioral Anomaly Detector',
      version: '1.0',
      type: 'anomaly_detection',
      features: ['order_patterns', 'location_patterns', 'time_patterns'],
      performance: {
        accuracy: 0.91,
        precision: 0.88,
        recall: 0.90,
        f1Score: 0.89,
      },
      lastTrained: new Date(),
      status: 'active',
    });
  }

  private setupRealtimeMonitoring(): void {
    // Monitor order events
    this.on('order:created', async (order) => {
      await this.evaluateOrder(order);
    });

    // Monitor payment events
    this.on('payment:processed', async (payment) => {
      await this.evaluateTransaction(payment);
    });

    // Monitor account events
    this.on('account:created', async (account) => {
      await this.evaluateNewAccount(account);
    });
  }

  private async runFraudDetection(): Promise<void> {
    try {
      // Run batch fraud detection
      await this.detectAnomalies();
      await this.updateRiskProfiles();
      await this.detectEmergingPatterns();

    } catch (error) {
      logger.error('Failed to run fraud detection', error);
    }
  }

  private getApplicableRules(category: string, data: any): FraudRule[] {
    return Array.from(this.rules.values()).filter(rule => 
      rule.category === category && rule.status === 'active'
    );
  }

  private async evaluateRule(rule: FraudRule, data: any): Promise<{ triggered: boolean }> {
    for (const condition of rule.conditions) {
      const fieldValue = this.getFieldValue(data, condition.field);
      
      if (condition.timeWindow && condition.aggregation) {
        // Time-based aggregation
        const aggregatedValue = await this.getAggregatedValue(
          data,
          condition.field,
          condition.timeWindow,
          condition.aggregation
        );

        if (!this.evaluateCondition(aggregatedValue, condition.operator, condition.value)) {
          return { triggered: false };
        }
      } else {
        // Simple condition
        if (!this.evaluateCondition(fieldValue, condition.operator, condition.value)) {
          return { triggered: false };
        }
      }
    }

    return { triggered: true };
  }

  private getFieldValue(data: any, field: string): any {
    const fields = field.split('.');
    let value = data;
    
    for (const f of fields) {
      value = value?.[f];
    }
    
    return value;
  }

  private evaluateCondition(value: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'equals':
        return value === expected;
      case 'not_equals':
        return value !== expected;
      case 'greater_than':
        return value > expected;
      case 'less_than':
        return value < expected;
      case 'contains':
        return String(value).includes(expected);
      case 'in':
        return expected.includes(value);
      case 'not_in':
        return !expected.includes(value);
      case 'matches_pattern':
        return new RegExp(expected).test(String(value));
      default:
        return false;
    }
  }

  private async getAggregatedValue(
    data: any,
    field: string,
    timeWindow: number,
    aggregation: string
  ): Promise<number> {
    // This would query historical data and aggregate
    // For now, return simulated value
    return Math.random() * 20;
  }

  private async evaluateWithML(data: any): Promise<number> {
    // Use ML model for evaluation
    const model = this.mlModels.get('transaction_classifier');
    if (!model || model.status !== 'active') {
      return 0;
    }

    // In real implementation, this would call ML service
    // For now, return simulated score
    return Math.random() * 30;
  }

  private calculateSeverity(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= 80) return 'critical';
    if (riskScore >= 60) return 'high';
    if (riskScore >= 40) return 'medium';
    return 'low';
  }

  private getRuleIdByName(name: string): string {
    for (const [id, rule] of this.rules) {
      if (rule.name === name) return id;
    }
    return '';
  }

  private gatherEvidence(data: any, flags: string[]): Evidence[] {
    const evidence: Evidence[] = [];

    // Add flag evidence
    flags.forEach(flag => {
      evidence.push({
        type: 'rule_trigger',
        description: `Triggered rule: ${flag}`,
        data: { flag },
        timestamp: new Date(),
        source: 'rule_engine',
      });
    });

    // Add transaction details
    if (data.amount) {
      evidence.push({
        type: 'transaction_details',
        description: 'Transaction information',
        data: {
          amount: data.amount,
          paymentMethod: data.paymentMethod,
        },
        timestamp: new Date(),
        source: 'transaction_system',
      });
    }

    return evidence;
  }

  private async createFraudIncident(
    incident: Omit<FraudIncident, 'id' | 'timeline' | 'detectedAt' | 'updatedAt'>
  ): Promise<FraudIncident> {
    const newIncident: FraudIncident = {
      id: `incident_${Date.now()}`,
      ...incident,
      timeline: [
        {
          timestamp: new Date(),
          type: 'incident_created',
          description: 'Fraud incident detected',
        },
      ],
      detectedAt: new Date(),
      updatedAt: new Date(),
    };

    await prisma.fraudIncident.create({
      data: newIncident,
    });

    this.activeIncidents.set(newIncident.id, newIncident);

    // Alert security team
    await this.alertSecurityTeam(newIncident);

    this.emit('incident:created', newIncident);

    return newIncident;
  }

  private async updateRiskProfile(
    entityType: RiskProfile['entityType'],
    entityId: string,
    incidentScore: number
  ): Promise<void> {
    const profileKey = `${entityType}:${entityId}`;
    let profile = this.riskProfiles.get(profileKey);

    if (!profile) {
      profile = await this.createRiskProfile(entityType, entityId);
    }

    // Update risk factors
    const incidentFactor: RiskFactor = {
      name: 'recent_incident',
      score: incidentScore,
      weight: 0.3,
      details: `Recent incident with risk score ${incidentScore}`,
    };

    profile.factors = profile.factors.filter(f => f.name !== 'recent_incident');
    profile.factors.push(incidentFactor);

    // Recalculate overall risk
    profile.overallRisk = this.calculateOverallRisk(profile.factors);
    profile.lastCalculated = new Date();

    // Update history
    if (incidentScore > 50) {
      profile.history.flaggedTransactions++;
    }

    await prisma.riskProfile.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      create: profile,
      update: profile,
    });

    this.riskProfiles.set(profileKey, profile);
  }

  private async createRiskProfile(
    entityType: RiskProfile['entityType'],
    entityId: string
  ): Promise<RiskProfile> {
    return {
      entityType,
      entityId,
      overallRisk: 0,
      factors: [],
      history: {
        totalTransactions: 0,
        flaggedTransactions: 0,
        confirmedFraud: 0,
        falsePositives: 0,
      },
      restrictions: [],
      lastCalculated: new Date(),
    };
  }

  private calculateOverallRisk(factors: RiskFactor[]): number {
    if (factors.length === 0) return 0;

    const weightedSum = factors.reduce((sum, factor) => 
      sum + (factor.score * factor.weight), 0
    );

    const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);

    return Math.min(100, Math.round(weightedSum / totalWeight));
  }

  private async getRiskProfile(
    entityType: RiskProfile['entityType'],
    entityId: string
  ): Promise<RiskProfile> {
    const profileKey = `${entityType}:${entityId}`;
    let profile = this.riskProfiles.get(profileKey);

    if (!profile) {
      profile = await prisma.riskProfile.findUnique({
        where: { entityType_entityId: { entityType, entityId } },
      });

      if (!profile) {
        profile = await this.createRiskProfile(entityType, entityId);
      }

      this.riskProfiles.set(profileKey, profile);
    }

    return profile;
  }

  private async checkVelocity(
    type: string,
    entityId: string,
    limits: { timeWindow: number; maxCount: number; maxAmount?: number }
  ): Promise<{ exceeded: boolean; count: number; amount?: number }> {
    const key = `velocity:${type}:${entityId}`;
    const windowStart = new Date(Date.now() - limits.timeWindow * 60 * 1000);

    // Get recent activity
    const recentActivity = await redisClient.zrangebyscore(
      key,
      windowStart.getTime(),
      Date.now()
    );

    const count = recentActivity.length;
    
    // Check count limit
    if (count >= limits.maxCount) {
      return { exceeded: true, count };
    }

    // Check amount limit if applicable
    if (limits.maxAmount) {
      const totalAmount = recentActivity.reduce((sum, activity) => {
        const data = JSON.parse(activity);
        return sum + (data.amount || 0);
      }, 0);

      if (totalAmount >= limits.maxAmount) {
        return { exceeded: true, count, amount: totalAmount };
      }
    }

    return { exceeded: false, count };
  }

  private calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLon = (point2.lng - point1.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private async checkDeviceReputation(device: any): Promise<{
    suspicious: boolean;
    score: number;
  }> {
    // Check device fingerprint against known bad devices
    if (device.fingerprint) {
      const isBadDevice = await redisClient.sismember('bad_devices', device.fingerprint);
      if (isBadDevice) {
        return { suspicious: true, score: 50 };
      }
    }

    // Check IP reputation
    // In real implementation, would use IP reputation service
    return { suspicious: false, score: 0 };
  }

  private async detectPatterns(data: any): Promise<FraudPattern[]> {
    const patterns: FraudPattern[] = [];

    // Look for known patterns
    // This is simplified - real implementation would use pattern matching algorithms
    
    return patterns;
  }

  private async getAverageOrderValue(customerId: string): Promise<number> {
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        createdAt: {
          gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
        },
      },
      select: { total: true },
    });

    if (orders.length === 0) return 50; // Default

    return orders.reduce((sum, order) => sum + order.total, 0) / orders.length;
  }

  private async logRuleTrigger(rule: FraudRule, data: any): Promise<void> {
    await prisma.ruleTrigger.create({
      data: {
        ruleId: rule.id,
        timestamp: new Date(),
        data: JSON.stringify(data),
      },
    });

    // Update rule last triggered
    rule.lastTriggered = new Date();
  }

  private async investigateEntity(entityType: string, entityId: string): Promise<void> {
    // Perform automated investigation
    // This would gather all related data and look for patterns
  }

  private async calculatePreventedLoss(incidents: FraudIncident[]): Promise<number> {
    let totalPrevented = 0;

    for (const incident of incidents) {
      if (incident.status === 'confirmed' || incident.status === 'resolved') {
        // Estimate prevented loss based on incident type and severity
        const estimatedLoss = this.estimatePotentialLoss(incident);
        totalPrevented += estimatedLoss;
      }
    }

    return totalPrevented;
  }

  private estimatePotentialLoss(incident: FraudIncident): number {
    // Simplified estimation
    const baseLoss = {
      payment: 200,
      order: 150,
      account: 500,
      promo: 50,
      reskflow: 100,
      review: 20,
    };

    const severityMultiplier = {
      low: 1,
      medium: 2,
      high: 5,
      critical: 10,
    };

    return (baseLoss[incident.type] || 100) * severityMultiplier[incident.severity];
  }

  private async calculateRiskTrends(
    timeRange: { start: Date; end: Date }
  ): Promise<Array<{ date: Date; averageRisk: number; incidents: number }>> {
    const trends: Array<{ date: Date; averageRisk: number; incidents: number }> = [];
    
    // Calculate daily trends
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.ceil((timeRange.end.getTime() - timeRange.start.getTime()) / dayMs);

    for (let i = 0; i < days; i++) {
      const dayStart = new Date(timeRange.start.getTime() + i * dayMs);
      const dayEnd = new Date(dayStart.getTime() + dayMs);

      const dayIncidents = await prisma.fraudIncident.findMany({
        where: {
          detectedAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
        select: { riskScore: true },
      });

      const averageRisk = dayIncidents.length > 0
        ? dayIncidents.reduce((sum, i) => sum + i.riskScore, 0) / dayIncidents.length
        : 0;

      trends.push({
        date: dayStart,
        averageRisk,
        incidents: dayIncidents.length,
      });
    }

    return trends;
  }

  private async getHighRiskEntities(): Promise<Array<{
    entity: any;
    riskScore: number;
    incidents: number;
  }>> {
    const highRiskProfiles = Array.from(this.riskProfiles.values())
      .filter(profile => profile.overallRisk > 70)
      .sort((a, b) => b.overallRisk - a.overallRisk)
      .slice(0, 10);

    const entities = await Promise.all(
      highRiskProfiles.map(async (profile) => {
        let entity;
        
        switch (profile.entityType) {
          case 'customer':
            entity = await prisma.customer.findUnique({
              where: { id: profile.entityId },
              select: { id: true, name: true, email: true },
            });
            break;
          case 'merchant':
            entity = await prisma.merchant.findUnique({
              where: { id: profile.entityId },
              select: { id: true, name: true },
            });
            break;
          case 'driver':
            entity = await prisma.driver.findUnique({
              where: { id: profile.entityId },
              include: { user: { select: { name: true } } },
            });
            break;
        }

        return {
          entity: { ...entity, type: profile.entityType },
          riskScore: profile.overallRisk,
          incidents: profile.history.flaggedTransactions,
        };
      })
    );

    return entities.filter(e => e.entity);
  }

  private async findRelatedIncidents(
    incident: FraudIncident
  ): Promise<FraudIncident[]> {
    // Find incidents with same entity or similar patterns
    const related = await prisma.fraudIncident.findMany({
      where: {
        OR: [
          { entityId: incident.entityId },
          { 
            evidence: {
              some: {
                data: {
                  path: ['ip'],
                  equals: incident.evidence.find(e => e.data?.ip)?.data.ip,
                },
              },
            },
          },
        ],
        id: { not: incident.id },
      },
      take: 10,
      orderBy: { detectedAt: 'desc' },
    });

    return related;
  }

  private async getEntityHistory(entityType: string, entityId: string): Promise<any> {
    const history: any = {
      transactions: [],
      incidents: [],
      riskProfile: null,
    };

    switch (entityType) {
      case 'customer':
        history.transactions = await prisma.order.findMany({
          where: { customerId: entityId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        break;
      case 'merchant':
        history.transactions = await prisma.order.findMany({
          where: { merchantId: entityId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        break;
    }

    history.incidents = await prisma.fraudIncident.findMany({
      where: { entityId },
      orderBy: { detectedAt: 'desc' },
    });

    history.riskProfile = await this.getRiskProfile(entityType as any, entityId);

    return history;
  }

  private generateInvestigationRecommendations(
    incident: FraudIncident,
    relatedIncidents: FraudIncident[],
    entityHistory: any
  ): string[] {
    const recommendations: string[] = [];

    // Check for patterns
    if (relatedIncidents.length > 2) {
      recommendations.push('Multiple related incidents detected - consider account suspension');
    }

    // Check risk profile
    if (entityHistory.riskProfile?.overallRisk > 80) {
      recommendations.push('High risk entity - recommend enhanced monitoring');
    }

    // Check incident severity
    if (incident.severity === 'critical') {
      recommendations.push('Critical incident - immediate action required');
      recommendations.push('Contact law enforcement if fraud is confirmed');
    }

    // Check for velocity
    const recentIncidents = relatedIncidents.filter(i => 
      new Date(i.detectedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
    );
    if (recentIncidents.length > 1) {
      recommendations.push('Recent pattern of suspicious activity detected');
    }

    return recommendations;
  }

  private async updateRulePerformance(
    ruleIds: string[],
    wasCorrect: boolean
  ): Promise<void> {
    for (const ruleId of ruleIds) {
      const rule = this.rules.get(ruleId);
      if (!rule) continue;

      // Update performance metrics
      const totalTriggers = await prisma.ruleTrigger.count({
        where: { ruleId },
      });

      const truePositives = await prisma.fraudIncident.count({
        where: {
          ruleIds: { has: ruleId },
          status: 'confirmed',
        },
      });

      const falsePositives = await prisma.fraudIncident.count({
        where: {
          ruleIds: { has: ruleId },
          status: 'false_positive',
        },
      });

      rule.truePositiveRate = totalTriggers > 0 ? truePositives / totalTriggers : 0;
      rule.falsePositiveRate = totalTriggers > 0 ? falsePositives / totalTriggers : 0;

      await this.updateFraudRule(ruleId, {
        truePositiveRate: rule.truePositiveRate,
        falsePositiveRate: rule.falsePositiveRate,
      });
    }
  }

  private async applyResolutionActions(
    incident: FraudIncident,
    resolution: any
  ): Promise<void> {
    switch (resolution.action) {
      case 'suspend_account':
        await this.suspendEntity(incident.entityType, incident.entityId);
        break;
      case 'block_device':
        if (incident.evidence.find(e => e.data?.device?.fingerprint)) {
          await redisClient.sadd(
            'bad_devices',
            incident.evidence.find(e => e.data?.device?.fingerprint)!.data.device.fingerprint
          );
        }
        break;
      case 'restrict_access':
        await this.restrictEntity(incident.entityType, incident.entityId);
        break;
    }
  }

  private async suspendEntity(entityType: string, entityId: string): Promise<void> {
    switch (entityType) {
      case 'customer':
        await prisma.customer.update({
          where: { id: entityId },
          data: { status: 'suspended' },
        });
        break;
      case 'merchant':
        await prisma.merchant.update({
          where: { id: entityId },
          data: { isActive: false },
        });
        break;
      case 'driver':
        await prisma.driver.update({
          where: { id: entityId },
          data: { isActive: false },
        });
        break;
    }
  }

  private async restrictEntity(entityType: string, entityId: string): Promise<void> {
    const profile = await this.getRiskProfile(entityType as any, entityId);
    profile.restrictions.push('limited_transactions', 'manual_review_required');
    
    await prisma.riskProfile.update({
      where: { entityType_entityId: { entityType: entityType as any, entityId } },
      data: { restrictions: profile.restrictions },
    });
  }

  private async alertSecurityTeam(incident: FraudIncident): Promise<void> {
    if (incident.severity === 'critical' || incident.severity === 'high') {
      // Send immediate alert
      await notificationService.sendEmail(
        process.env.SECURITY_TEAM_EMAIL!,
        'critical_fraud_alert',
        {
          incidentId: incident.id,
          type: incident.type,
          severity: incident.severity,
          riskScore: incident.riskScore,
          entity: `${incident.entityType} ${incident.entityId}`,
        }
      );

      // Send SMS for critical incidents
      if (incident.severity === 'critical') {
        await notificationService.sendSMS(
          process.env.SECURITY_TEAM_PHONE!,
          `CRITICAL FRAUD: ${incident.type} incident detected. Risk score: ${incident.riskScore}. Check dashboard immediately.`
        );
      }
    }

    // Log to security dashboard
    await notificationService.sendWebSocketEvent(
      'security_dashboard',
      'fraud_incident',
      incident
    );
  }

  private async evaluateNewAccount(account: any): Promise<void> {
    const flags: string[] = [];
    let riskScore = 0;

    // Check email domain
    const emailDomain = account.email.split('@')[1];
    const suspiciousDomains = ['tempmail.com', 'guerrillamail.com'];
    if (suspiciousDomains.includes(emailDomain)) {
      flags.push('suspicious_email_domain');
      riskScore += 30;
    }

    // Check phone number
    // In real implementation, would validate phone number format and carrier
    
    // Check device
    if (account.device) {
      const deviceCheck = await this.checkDeviceReputation(account.device);
      if (deviceCheck.suspicious) {
        flags.push('suspicious_device');
        riskScore += deviceCheck.score;
      }
    }

    if (riskScore > 50) {
      await this.createFraudIncident({
        type: 'account',
        severity: this.calculateSeverity(riskScore),
        entityType: account.type,
        entityId: account.id,
        ruleIds: [],
        riskScore,
        evidence: this.gatherEvidence(account, flags),
      });
    }
  }

  private async detectAnomalies(): Promise<void> {
    // Run anomaly detection on recent data
    const model = this.mlModels.get('anomaly_detector');
    if (!model || model.status !== 'active') return;

    // This would process recent transactions and activities
    // Looking for unusual patterns
  }

  private async updateRiskProfiles(): Promise<void> {
    // Periodically recalculate risk profiles
    for (const [key, profile] of this.riskProfiles) {
      const hoursSinceUpdate = (Date.now() - profile.lastCalculated.getTime()) / (60 * 60 * 1000);
      
      if (hoursSinceUpdate > 24) {
        // Recalculate risk factors
        await this.recalculateRiskProfile(profile);
      }
    }
  }

  private async recalculateRiskProfile(profile: RiskProfile): Promise<void> {
    // Update risk factors based on recent activity
    const factors: RiskFactor[] = [];

    // Transaction history factor
    const fraudRate = profile.history.totalTransactions > 0
      ? profile.history.confirmedFraud / profile.history.totalTransactions
      : 0;

    factors.push({
      name: 'fraud_history',
      score: fraudRate * 100,
      weight: 0.4,
      details: `${profile.history.confirmedFraud} confirmed fraud out of ${profile.history.totalTransactions} transactions`,
    });

    // Recent activity factor
    const recentIncidents = await prisma.fraudIncident.count({
      where: {
        entityId: profile.entityId,
        detectedAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
    });

    factors.push({
      name: 'recent_activity',
      score: Math.min(100, recentIncidents * 20),
      weight: 0.3,
      details: `${recentIncidents} incidents in last 30 days`,
    });

    profile.factors = factors;
    profile.overallRisk = this.calculateOverallRisk(factors);
    profile.lastCalculated = new Date();

    await prisma.riskProfile.update({
      where: {
        entityType_entityId: {
          entityType: profile.entityType,
          entityId: profile.entityId,
        },
      },
      data: profile,
    });
  }

  private async detectEmergingPatterns(): Promise<void> {
    // Analyze recent incidents for new patterns
    const recentIncidents = await prisma.fraudIncident.findMany({
      where: {
        detectedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    // Group by common attributes
    // This is simplified - real implementation would use clustering algorithms
  }
}

// Export singleton instance
export const fraudDetectionService = new FraudDetectionService();