import { prisma, logger } from '@reskflow/shared';
import { EventEmitter } from 'events';
import dayjs from 'dayjs';
import Bull from 'bull';

interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: string;
  condition: {
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq';
    threshold: number;
    duration?: number; // Duration in seconds for which condition must be true
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  channels: string[]; // Notification channels
  cooldown: number; // Cooldown period in seconds
  enabled: boolean;
  metadata?: any;
}

interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'resolved' | 'acknowledged';
  message: string;
  metadata?: any;
  createdAt: Date;
  resolvedAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

interface AlertNotification {
  alertId: string;
  channel: string;
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: Date;
  error?: string;
}

export class AlertManager extends EventEmitter {
  private rules: Map<string, AlertRule>;
  private activeAlerts: Map<string, Alert>;
  private cooldowns: Map<string, Date>;
  private alertQueue: Bull.Queue;
  private evaluationInterval: NodeJS.Timer | null = null;

  constructor() {
    super();
    this.rules = new Map();
    this.activeAlerts = new Map();
    this.cooldowns = new Map();
    
    this.alertQueue = new Bull('alert-queue', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });

    this.loadDefaultRules();
    this.setupQueueProcessors();
    this.startEvaluation();
  }

  async createRule(rule: Omit<AlertRule, 'id'>): Promise<AlertRule> {
    const newRule: AlertRule = {
      ...rule,
      id: this.generateRuleId(),
    };

    // Validate rule
    this.validateRule(newRule);

    // Store rule
    await prisma.alertRule.create({
      data: {
        id: newRule.id,
        name: newRule.name,
        description: newRule.description,
        metric: newRule.metric,
        condition: newRule.condition,
        severity: newRule.severity,
        channels: newRule.channels,
        cooldown: newRule.cooldown,
        enabled: newRule.enabled,
        metadata: newRule.metadata,
        created_at: new Date(),
      },
    });

    this.rules.set(newRule.id, newRule);
    
    logger.info(`Alert rule created: ${newRule.name}`);
    
    return newRule;
  }

  async updateRule(ruleId: string, updates: Partial<AlertRule>): Promise<AlertRule> {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new Error('Rule not found');
    }

    const updatedRule = { ...rule, ...updates };
    
    // Validate updated rule
    this.validateRule(updatedRule);

    // Update in database
    await prisma.alertRule.update({
      where: { id: ruleId },
      data: {
        name: updatedRule.name,
        description: updatedRule.description,
        metric: updatedRule.metric,
        condition: updatedRule.condition,
        severity: updatedRule.severity,
        channels: updatedRule.channels,
        cooldown: updatedRule.cooldown,
        enabled: updatedRule.enabled,
        metadata: updatedRule.metadata,
        updated_at: new Date(),
      },
    });

    this.rules.set(ruleId, updatedRule);
    
    return updatedRule;
  }

  async deleteRule(ruleId: string): Promise<void> {
    await prisma.alertRule.delete({
      where: { id: ruleId },
    });

    this.rules.delete(ruleId);
    
    // Resolve any active alerts for this rule
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.ruleId === ruleId) {
        await this.resolveAlert(alertId, 'Rule deleted');
      }
    }
  }

  async evaluateMetric(metric: string, value: number, metadata?: any): Promise<void> {
    // Find all rules for this metric
    const applicableRules = Array.from(this.rules.values()).filter(
      rule => rule.enabled && rule.metric === metric
    );

    for (const rule of applicableRules) {
      await this.evaluateRule(rule, value, metadata);
    }
  }

  async triggerAlert(params: {
    title: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    metric?: string;
    value?: number;
    metadata?: any;
  }): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      ruleId: 'manual',
      ruleName: params.title,
      metric: params.metric || 'manual',
      value: params.value || 0,
      threshold: 0,
      severity: params.severity,
      status: 'active',
      message: params.message,
      metadata: params.metadata,
      createdAt: new Date(),
    };

    await this.createAlert(alert);
    
    return alert;
  }

  async acknowledgeAlert(alertId: string, userId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      throw new Error('Alert not found or already resolved');
    }

    alert.status = 'acknowledged';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = userId;

    await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'acknowledged',
        acknowledged_at: alert.acknowledgedAt,
        acknowledged_by: userId,
      },
    });

    this.emit('alert-acknowledged', alert);
  }

  async resolveAlert(alertId: string, reason?: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status === 'resolved') {
      return;
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();

    await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolved_at: alert.resolvedAt,
        resolution_reason: reason,
      },
    });

    this.activeAlerts.delete(alertId);
    this.emit('alert-resolved', alert);
  }

  async getActiveAlerts(filters?: {
    severity?: string;
    metric?: string;
    status?: string;
  }): Promise<Alert[]> {
    let alerts = Array.from(this.activeAlerts.values());

    if (filters) {
      if (filters.severity) {
        alerts = alerts.filter(a => a.severity === filters.severity);
      }
      if (filters.metric) {
        alerts = alerts.filter(a => a.metric === filters.metric);
      }
      if (filters.status) {
        alerts = alerts.filter(a => a.status === filters.status);
      }
    }

    return alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getAlertHistory(params: {
    startTime: Date;
    endTime: Date;
    ruleId?: string;
    severity?: string;
    limit?: number;
  }): Promise<Alert[]> {
    const where: any = {
      created_at: {
        gte: params.startTime,
        lte: params.endTime,
      },
    };

    if (params.ruleId) where.rule_id = params.ruleId;
    if (params.severity) where.severity = params.severity;

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: params.limit || 100,
    });

    return alerts.map(this.formatAlert);
  }

  async getAlertStatistics(period: { start: Date; end: Date }): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
    byMetric: Record<string, number>;
    averageResolutionTime: number;
    topRules: Array<{ ruleId: string; ruleName: string; count: number }>;
  }> {
    const alerts = await prisma.alert.findMany({
      where: {
        created_at: {
          gte: period.start,
          lte: period.end,
        },
      },
    });

    const stats = {
      total: alerts.length,
      bySeverity: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      byMetric: {} as Record<string, number>,
      averageResolutionTime: 0,
      topRules: [] as Array<{ ruleId: string; ruleName: string; count: number }>,
    };

    const resolutionTimes: number[] = [];
    const ruleCounts = new Map<string, { name: string; count: number }>();

    alerts.forEach(alert => {
      // Count by severity
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      
      // Count by status
      stats.byStatus[alert.status] = (stats.byStatus[alert.status] || 0) + 1;
      
      // Count by metric
      stats.byMetric[alert.metric] = (stats.byMetric[alert.metric] || 0) + 1;
      
      // Calculate resolution time
      if (alert.resolved_at) {
        const resolutionTime = new Date(alert.resolved_at).getTime() - 
                             new Date(alert.created_at).getTime();
        resolutionTimes.push(resolutionTime);
      }
      
      // Count by rule
      if (!ruleCounts.has(alert.rule_id)) {
        ruleCounts.set(alert.rule_id, { name: alert.rule_name, count: 0 });
      }
      ruleCounts.get(alert.rule_id)!.count++;
    });

    // Calculate average resolution time
    if (resolutionTimes.length > 0) {
      stats.averageResolutionTime = 
        resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length / 1000 / 60; // in minutes
    }

    // Get top rules
    stats.topRules = Array.from(ruleCounts.entries())
      .map(([ruleId, data]) => ({ ruleId, ruleName: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return stats;
  }

  private loadDefaultRules(): void {
    const defaultRules: Omit<AlertRule, 'id'>[] = [
      {
        name: 'High Error Rate',
        description: 'Alert when error rate exceeds 5%',
        metric: 'error_rate',
        condition: { operator: 'gt', threshold: 0.05, duration: 300 },
        severity: 'high',
        channels: ['email', 'slack'],
        cooldown: 3600,
        enabled: true,
      },
      {
        name: 'Low Driver Availability',
        description: 'Alert when driver availability drops below 80%',
        metric: 'driver_availability',
        condition: { operator: 'lt', threshold: 0.8, duration: 600 },
        severity: 'medium',
        channels: ['slack'],
        cooldown: 1800,
        enabled: true,
      },
      {
        name: 'High Order Volume',
        description: 'Alert when order volume exceeds capacity',
        metric: 'order_volume',
        condition: { operator: 'gt', threshold: 1000, duration: 300 },
        severity: 'medium',
        channels: ['email'],
        cooldown: 3600,
        enabled: true,
      },
      {
        name: 'Payment Gateway Failure',
        description: 'Alert on payment gateway failures',
        metric: 'payment_failures',
        condition: { operator: 'gt', threshold: 10, duration: 60 },
        severity: 'critical',
        channels: ['email', 'slack', 'sms'],
        cooldown: 300,
        enabled: true,
      },
      {
        name: 'Database Connection Pool Exhausted',
        description: 'Alert when database connections are exhausted',
        metric: 'db_connection_pool',
        condition: { operator: 'gte', threshold: 0.9, duration: 120 },
        severity: 'critical',
        channels: ['email', 'slack'],
        cooldown: 600,
        enabled: true,
      },
      {
        name: 'High Memory Usage',
        description: 'Alert when memory usage exceeds 85%',
        metric: 'memory_usage',
        condition: { operator: 'gt', threshold: 0.85, duration: 300 },
        severity: 'high',
        channels: ['slack'],
        cooldown: 1800,
        enabled: true,
      },
      {
        name: 'API Response Time',
        description: 'Alert when API response time is high',
        metric: 'api_response_time',
        condition: { operator: 'gt', threshold: 2000, duration: 300 },
        severity: 'medium',
        channels: ['slack'],
        cooldown: 1800,
        enabled: true,
      },
      {
        name: 'Order Cancellation Rate',
        description: 'Alert when cancellation rate is high',
        metric: 'cancellation_rate',
        condition: { operator: 'gt', threshold: 0.15, duration: 600 },
        severity: 'medium',
        channels: ['email'],
        cooldown: 3600,
        enabled: true,
      },
    ];

    // In production, these would be loaded from database
    defaultRules.forEach((rule, index) => {
      const ruleWithId = { ...rule, id: `default-${index}` };
      this.rules.set(ruleWithId.id, ruleWithId);
    });
  }

  private async evaluateRule(rule: AlertRule, value: number, metadata?: any): Promise<void> {
    // Check if in cooldown
    const cooldownExpiry = this.cooldowns.get(rule.id);
    if (cooldownExpiry && cooldownExpiry > new Date()) {
      return;
    }

    // Evaluate condition
    const conditionMet = this.evaluateCondition(value, rule.condition);

    if (conditionMet) {
      // Check if alert already exists
      const existingAlert = Array.from(this.activeAlerts.values()).find(
        alert => alert.ruleId === rule.id && alert.status === 'active'
      );

      if (!existingAlert) {
        // Create new alert
        const alert: Alert = {
          id: this.generateAlertId(),
          ruleId: rule.id,
          ruleName: rule.name,
          metric: rule.metric,
          value,
          threshold: rule.condition.threshold,
          severity: rule.severity,
          status: 'active',
          message: this.generateAlertMessage(rule, value),
          metadata,
          createdAt: new Date(),
        };

        await this.createAlert(alert);
        
        // Set cooldown
        this.cooldowns.set(
          rule.id,
          dayjs().add(rule.cooldown, 'second').toDate()
        );
      }
    } else {
      // Check if we should resolve existing alert
      const existingAlert = Array.from(this.activeAlerts.values()).find(
        alert => alert.ruleId === rule.id && alert.status === 'active'
      );

      if (existingAlert) {
        await this.resolveAlert(existingAlert.id, 'Condition no longer met');
      }
    }
  }

  private evaluateCondition(value: number, condition: AlertRule['condition']): boolean {
    switch (condition.operator) {
      case 'gt': return value > condition.threshold;
      case 'lt': return value < condition.threshold;
      case 'gte': return value >= condition.threshold;
      case 'lte': return value <= condition.threshold;
      case 'eq': return value === condition.threshold;
      case 'neq': return value !== condition.threshold;
      default: return false;
    }
  }

  private async createAlert(alert: Alert): Promise<void> {
    // Store in database
    await prisma.alert.create({
      data: {
        id: alert.id,
        rule_id: alert.ruleId,
        rule_name: alert.ruleName,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        metadata: alert.metadata,
        created_at: alert.createdAt,
      },
    });

    // Add to active alerts
    this.activeAlerts.set(alert.id, alert);

    // Queue notifications
    const rule = this.rules.get(alert.ruleId);
    if (rule) {
      for (const channel of rule.channels) {
        await this.alertQueue.add('send-notification', {
          alertId: alert.id,
          channel,
          alert,
        });
      }
    }

    // Emit event
    this.emit('alert-created', alert);
    
    logger.warn(`Alert created: ${alert.message}`, {
      alertId: alert.id,
      severity: alert.severity,
      metric: alert.metric,
      value: alert.value,
    });
  }

  private generateAlertMessage(rule: AlertRule, value: number): string {
    const operator = rule.condition.operator;
    const threshold = rule.condition.threshold;
    
    return `${rule.name}: ${rule.metric} is ${value} (${operator} ${threshold})`;
  }

  private validateRule(rule: AlertRule): void {
    if (!rule.name || rule.name.trim().length === 0) {
      throw new Error('Rule name is required');
    }

    if (!rule.metric || rule.metric.trim().length === 0) {
      throw new Error('Metric is required');
    }

    if (!rule.condition || !rule.condition.operator || 
        rule.condition.threshold === undefined) {
      throw new Error('Valid condition is required');
    }

    if (!rule.channels || rule.channels.length === 0) {
      throw new Error('At least one notification channel is required');
    }

    if (rule.cooldown < 0) {
      throw new Error('Cooldown must be positive');
    }
  }

  private setupQueueProcessors(): void {
    this.alertQueue.process('send-notification', async (job) => {
      const { alertId, channel, alert } = job.data;
      
      try {
        await this.sendNotification(alertId, channel, alert);
      } catch (error) {
        logger.error('Failed to send alert notification:', error);
        throw error;
      }
    });
  }

  private async sendNotification(
    alertId: string,
    channel: string,
    alert: Alert
  ): Promise<void> {
    // In production, this would integrate with various notification services
    logger.info(`Sending ${channel} notification for alert ${alertId}`);
    
    // Record notification
    await prisma.alertNotification.create({
      data: {
        alert_id: alertId,
        channel,
        recipient: 'configured-recipient',
        status: 'sent',
        sent_at: new Date(),
      },
    });

    // Emit event for other services to handle
    this.emit('notification-sent', {
      alertId,
      channel,
      alert,
    });
  }

  private startEvaluation(): void {
    // Periodic evaluation of metrics
    this.evaluationInterval = setInterval(async () => {
      try {
        // This would be replaced with actual metric collection
        await this.evaluateAllRules();
      } catch (error) {
        logger.error('Error during alert evaluation:', error);
      }
    }, 60000); // Every minute
  }

  private async evaluateAllRules(): Promise<void> {
    // In production, this would fetch current metric values
    // and evaluate all active rules
    logger.debug('Evaluating all alert rules');
  }

  private generateRuleId(): string {
    return `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private formatAlert(dbAlert: any): Alert {
    return {
      id: dbAlert.id,
      ruleId: dbAlert.rule_id,
      ruleName: dbAlert.rule_name,
      metric: dbAlert.metric,
      value: dbAlert.value,
      threshold: dbAlert.threshold,
      severity: dbAlert.severity,
      status: dbAlert.status,
      message: dbAlert.message,
      metadata: dbAlert.metadata,
      createdAt: dbAlert.created_at,
      resolvedAt: dbAlert.resolved_at,
      acknowledgedAt: dbAlert.acknowledged_at,
      acknowledgedBy: dbAlert.acknowledged_by,
    };
  }

  async shutdown(): Promise<void> {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
    }
    await this.alertQueue.close();
  }
}