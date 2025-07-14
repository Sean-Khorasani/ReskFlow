import Bull from 'bull';
import { Server } from 'socket.io';
import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  orderId?: string;
  deviceId?: string;
  message: string;
  data?: any;
  status: 'active' | 'acknowledged' | 'resolved';
  createdAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
}

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  severity: string;
  actions: string[];
  enabled: boolean;
}

interface AlertRecipient {
  userId: string;
  role: string;
  notificationMethods: string[];
}

export class AlertService {
  private alertRules: Map<string, AlertRule> = new Map();
  private escalationChains: Map<string, AlertRecipient[]> = new Map();

  constructor(
    private alertQueue: Bull.Queue,
    private io: Server
  ) {
    this.loadAlertRules();
    this.setupEscalationChains();
  }

  private loadAlertRules(): void {
    // Default alert rules
    const rules: AlertRule[] = [
      {
        id: 'temp_critical_high',
        name: 'Critical High Temperature',
        condition: 'temperature_above',
        threshold: 10, // degrees above max
        severity: 'critical',
        actions: ['notify_all', 'stop_reskflow'],
        enabled: true,
      },
      {
        id: 'temp_critical_low',
        name: 'Critical Low Temperature',
        condition: 'temperature_below',
        threshold: -10, // degrees below min
        severity: 'critical',
        actions: ['notify_all', 'stop_reskflow'],
        enabled: true,
      },
      {
        id: 'battery_low',
        name: 'Low Battery',
        condition: 'battery_below',
        threshold: 10, // percentage
        severity: 'warning',
        actions: ['notify_driver'],
        enabled: true,
      },
      {
        id: 'device_offline',
        name: 'Device Offline',
        condition: 'no_reading_minutes',
        threshold: 15, // minutes
        severity: 'warning',
        actions: ['notify_driver', 'notify_support'],
        enabled: true,
      },
    ];

    rules.forEach(rule => this.alertRules.set(rule.id, rule));
  }

  private setupEscalationChains(): void {
    // Define escalation chains for different severity levels
    this.escalationChains.set('critical', [
      { userId: 'driver', role: 'driver', notificationMethods: ['push', 'sms'] },
      { userId: 'merchant', role: 'merchant', notificationMethods: ['push', 'email'] },
      { userId: 'customer', role: 'customer', notificationMethods: ['push', 'email'] },
      { userId: 'support', role: 'support', notificationMethods: ['push', 'sms', 'phone'] },
    ]);

    this.escalationChains.set('warning', [
      { userId: 'driver', role: 'driver', notificationMethods: ['push'] },
      { userId: 'merchant', role: 'merchant', notificationMethods: ['push'] },
    ]);

    this.escalationChains.set('info', [
      { userId: 'driver', role: 'driver', notificationMethods: ['push'] },
    ]);
  }

  async createAlert(params: {
    type: string;
    severity: 'info' | 'warning' | 'critical';
    orderId?: string;
    deviceId?: string;
    message: string;
    data?: any;
  }): Promise<Alert> {
    // Check for duplicate alerts
    const existingAlert = await prisma.temperatureAlert.findFirst({
      where: {
        type: params.type,
        order_id: params.orderId,
        device_id: params.deviceId,
        status: 'active',
        created_at: { gte: dayjs().subtract(30, 'minute').toDate() },
      },
    });

    if (existingAlert) {
      // Update existing alert instead of creating duplicate
      return this.mapToAlert(existingAlert);
    }

    // Create new alert
    const alert = await prisma.temperatureAlert.create({
      data: {
        id: uuidv4(),
        type: params.type,
        severity: params.severity,
        order_id: params.orderId,
        device_id: params.deviceId,
        message: params.message,
        data: params.data,
        status: 'active',
        created_at: new Date(),
      },
    });

    // Queue alert for processing
    await this.alertQueue.add('send-alert', {
      alertId: alert.id,
    });

    // Broadcast real-time alert
    this.broadcastAlert(this.mapToAlert(alert));

    return this.mapToAlert(alert);
  }

  async sendAlert(data: { alertId: string }): Promise<void> {
    const alert = await prisma.temperatureAlert.findUnique({
      where: { id: data.alertId },
      include: {
        order: {
          include: {
            customer: true,
            merchant: true,
            reskflow: {
              include: { driver: true },
            },
          },
        },
      },
    });

    if (!alert) {
      logger.error('Alert not found:', data.alertId);
      return;
    }

    // Get escalation chain based on severity
    const recipients = this.escalationChains.get(alert.severity) || [];

    // Send notifications to each recipient
    for (const recipient of recipients) {
      await this.notifyRecipient(alert, recipient);
    }

    // Execute alert actions
    const rule = Array.from(this.alertRules.values()).find(
      r => r.condition === alert.type
    );
    
    if (rule) {
      await this.executeAlertActions(alert, rule.actions);
    }

    // Schedule escalation if critical
    if (alert.severity === 'critical') {
      await this.alertQueue.add(
        'escalate-alert',
        { alertId: alert.id },
        { delay: 5 * 60 * 1000 } // 5 minutes
      );
    }
  }

  async acknowledgeAlert(
    alertId: string,
    userId: string,
    notes?: string
  ): Promise<{ success: boolean; message: string }> {
    const alert = await prisma.temperatureAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      throw new Error('Alert not found');
    }

    if (alert.status !== 'active') {
      throw new Error('Alert already acknowledged or resolved');
    }

    // Update alert status
    await prisma.temperatureAlert.update({
      where: { id: alertId },
      data: {
        status: 'acknowledged',
        acknowledged_at: new Date(),
        acknowledged_by: userId,
        acknowledgment_notes: notes,
      },
    });

    // Cancel escalation
    const jobs = await this.alertQueue.getJobs(['delayed']);
    for (const job of jobs) {
      if (job.data.alertId === alertId && job.data.type === 'escalate-alert') {
        await job.remove();
      }
    }

    // Broadcast acknowledgment
    this.io.emit('alert:acknowledged', {
      alertId,
      acknowledgedBy: userId,
      timestamp: new Date(),
    });

    return {
      success: true,
      message: 'Alert acknowledged successfully',
    };
  }

  async resolveAlert(
    alertId: string,
    resolution: string
  ): Promise<void> {
    await prisma.temperatureAlert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolved_at: new Date(),
        resolution,
      },
    });

    // Broadcast resolution
    this.io.emit('alert:resolved', {
      alertId,
      timestamp: new Date(),
    });
  }

  async escalateAlert(data: { alertId: string }): Promise<void> {
    const alert = await prisma.temperatureAlert.findUnique({
      where: { id: data.alertId },
    });

    if (!alert || alert.status !== 'active') {
      return; // Alert resolved or acknowledged
    }

    logger.warn('Escalating unacknowledged alert:', alert.id);

    // Send to emergency contacts
    await this.notifyEmergencyContacts(alert);

    // Create escalation record
    await prisma.alertEscalation.create({
      data: {
        alert_id: alert.id,
        escalated_at: new Date(),
        escalation_level: 1,
      },
    });
  }

  async getActiveAlerts(params: {
    orderId?: string;
    deviceId?: string;
    severity?: string;
  }): Promise<Alert[]> {
    const where: any = { status: 'active' };

    if (params.orderId) {
      where.order_id = params.orderId;
    }
    if (params.deviceId) {
      where.device_id = params.deviceId;
    }
    if (params.severity) {
      where.severity = params.severity;
    }

    const alerts = await prisma.temperatureAlert.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    return alerts.map(a => this.mapToAlert(a));
  }

  async getAlertHistory(params: {
    orderId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<Alert[]> {
    const where: any = {};

    if (params.orderId) {
      where.order_id = params.orderId;
    }
    if (params.startDate || params.endDate) {
      where.created_at = {};
      if (params.startDate) {
        where.created_at.gte = new Date(params.startDate);
      }
      if (params.endDate) {
        where.created_at.lte = new Date(params.endDate);
      }
    }

    const alerts = await prisma.temperatureAlert.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: params.limit || 100,
    });

    return alerts.map(a => this.mapToAlert(a));
  }

  async createCustomRule(rule: {
    name: string;
    condition: string;
    threshold: number;
    severity: string;
    actions: string[];
  }): Promise<AlertRule> {
    const newRule: AlertRule = {
      id: uuidv4(),
      ...rule,
      enabled: true,
    };

    // Save to database
    await prisma.alertRule.create({
      data: newRule,
    });

    // Add to memory
    this.alertRules.set(newRule.id, newRule);

    return newRule;
  }

  private async notifyRecipient(alert: any, recipient: AlertRecipient): Promise<void> {
    let userId: string;

    // Determine actual user ID based on role
    switch (recipient.role) {
      case 'driver':
        userId = alert.order?.reskflow?.driver_id;
        break;
      case 'merchant':
        userId = alert.order?.merchant_id;
        break;
      case 'customer':
        userId = alert.order?.customer_id;
        break;
      case 'support':
        userId = 'support-team'; // Would be actual support user
        break;
      default:
        return;
    }

    if (!userId) return;

    // Send notifications through each method
    for (const method of recipient.notificationMethods) {
      await this.sendNotification(userId, alert, method);
    }
  }

  private async sendNotification(
    userId: string,
    alert: any,
    method: string
  ): Promise<void> {
    logger.info(`Sending ${method} notification to ${userId} for alert ${alert.id}`);

    switch (method) {
      case 'push':
        await this.sendPushNotification(userId, alert);
        break;
      case 'sms':
        await this.sendSMSNotification(userId, alert);
        break;
      case 'email':
        await this.sendEmailNotification(userId, alert);
        break;
      case 'phone':
        await this.initiatePhoneCall(userId, alert);
        break;
    }
  }

  private async sendPushNotification(userId: string, alert: any): Promise<void> {
    // Send through push notification service
    this.io.to(`user:${userId}`).emit('alert:new', {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.created_at,
    });
  }

  private async sendSMSNotification(userId: string, alert: any): Promise<void> {
    // Integrate with SMS service (Twilio, etc.)
    logger.info(`SMS notification queued for user ${userId}`);
  }

  private async sendEmailNotification(userId: string, alert: any): Promise<void> {
    // Queue email notification
    await prisma.emailQueue.create({
      data: {
        to_user_id: userId,
        subject: `Temperature Alert: ${alert.severity.toUpperCase()}`,
        template: 'temperature_alert',
        data: {
          alertId: alert.id,
          message: alert.message,
          severity: alert.severity,
          orderId: alert.order_id,
        },
        queued_at: new Date(),
      },
    });
  }

  private async initiatePhoneCall(userId: string, alert: any): Promise<void> {
    // Integrate with phone service for critical alerts
    logger.warn(`Phone call initiated for critical alert ${alert.id} to user ${userId}`);
  }

  private async executeAlertActions(alert: any, actions: string[]): Promise<void> {
    for (const action of actions) {
      switch (action) {
        case 'stop_reskflow':
          if (alert.order?.reskflow) {
            await this.stopDelivery(alert.order.reskflow.id);
          }
          break;
        case 'notify_all':
          // Already handled by escalation chain
          break;
        case 'disable_device':
          if (alert.device_id) {
            await this.disableDevice(alert.device_id);
          }
          break;
      }
    }
  }

  private async stopDelivery(reskflowId: string): Promise<void> {
    await prisma.reskflow.update({
      where: { id: reskflowId },
      data: {
        status: 'on_hold',
        hold_reason: 'Temperature violation',
        held_at: new Date(),
      },
    });

    logger.warn(`Delivery ${reskflowId} put on hold due to temperature violation`);
  }

  private async disableDevice(deviceId: string): Promise<void> {
    await prisma.temperatureDevice.update({
      where: { id: deviceId },
      data: {
        is_active: false,
        status: 'disabled',
        disabled_reason: 'Alert threshold exceeded',
      },
    });
  }

  private async notifyEmergencyContacts(alert: any): Promise<void> {
    // Get emergency contacts
    const contacts = await prisma.emergencyContact.findMany({
      where: {
        merchant_id: alert.order?.merchant_id,
        active: true,
      },
    });

    for (const contact of contacts) {
      await this.sendNotification(contact.user_id, alert, 'phone');
      await this.sendNotification(contact.user_id, alert, 'sms');
    }
  }

  private broadcastAlert(alert: Alert): void {
    // Broadcast to relevant rooms
    if (alert.orderId) {
      this.io.to(`order:${alert.orderId}`).emit('alert:new', alert);
    }
    if (alert.deviceId) {
      this.io.to(`device:${alert.deviceId}`).emit('alert:new', alert);
    }
    
    // Broadcast to monitoring dashboard
    this.io.to('monitoring:dashboard').emit('alert:new', alert);
  }

  private mapToAlert(dbAlert: any): Alert {
    return {
      id: dbAlert.id,
      type: dbAlert.type,
      severity: dbAlert.severity,
      orderId: dbAlert.order_id,
      deviceId: dbAlert.device_id,
      message: dbAlert.message,
      data: dbAlert.data,
      status: dbAlert.status,
      createdAt: dbAlert.created_at,
      acknowledgedAt: dbAlert.acknowledged_at,
      acknowledgedBy: dbAlert.acknowledged_by,
      resolvedAt: dbAlert.resolved_at,
    };
  }
}