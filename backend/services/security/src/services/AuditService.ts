import { AuditLog, AuditQuery, SecurityEvent } from '../types/security.types';
import { generateUUID } from '../utils/crypto';
import { logAuditEvent, logSecurityEvent } from '../utils/logger';
import { connectDatabase, config } from '@reskflow/shared';
import correlationId from 'correlation-id';
import mongoose from 'mongoose';

// Audit Log Schema
const auditLogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, index: true },
  sessionId: { type: String, index: true },
  action: { type: String, required: true, index: true },
  resource: { type: String, required: true, index: true },
  method: { type: String, required: true },
  endpoint: { type: String, required: true },
  userAgent: String,
  ip: { type: String, required: true, index: true },
  success: { type: Boolean, required: true, index: true },
  error: String,
  duration: Number,
  timestamp: { type: Date, default: Date.now, index: true },
  correlationId: { type: String, required: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'audit_logs'
});

// Add compound indexes for efficient querying
auditLogSchema.index({ timestamp: -1, userId: 1 });
auditLogSchema.index({ timestamp: -1, action: 1 });
auditLogSchema.index({ timestamp: -1, success: 1 });
auditLogSchema.index({ ip: 1, timestamp: -1 });

const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);

// Security Event Schema
const securityEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, required: true, index: true },
  severity: { type: String, required: true, enum: ['info', 'warning', 'error', 'critical'], index: true },
  source: { type: String, required: true, index: true },
  target: String,
  description: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now, index: true },
  correlationId: { type: String, required: true, index: true },
  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: Date,
  resolvedBy: String,
}, {
  timestamps: true,
  collection: 'security_events'
});

securityEventSchema.index({ timestamp: -1, severity: 1 });
securityEventSchema.index({ type: 1, timestamp: -1 });
securityEventSchema.index({ resolved: 1, timestamp: -1 });

const SecurityEventModel = mongoose.model('SecurityEvent', securityEventSchema);

export class AuditService {
  private initialized = false;
  private auditMetrics: Map<string, number> = new Map();

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Initialize the audit service
   */
  async initialize(): Promise<void> {
    try {
      // Ensure database connection
      await connectDatabase();
      
      // Setup retention policies
      await this.setupRetentionPolicies();
      
      // Start cleanup tasks
      this.startCleanupTasks();
      
      this.initialized = true;
      
      await this.logAuditEvent({
        action: 'service_initialized',
        resource: 'audit_service',
        method: 'SYSTEM',
        endpoint: '/internal/audit',
        userAgent: 'system',
        ip: 'internal',
        success: true,
        duration: 0,
        metadata: { version: '1.0.0' },
      });

    } catch (error) {
      throw new Error(`Failed to initialize AuditService: ${error.message}`);
    }
  }

  /**
   * Log an audit event
   */
  async logAuditEvent(auditData: Partial<AuditLog>): Promise<string> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const auditLog: AuditLog = {
        id: generateUUID(),
        userId: auditData.userId,
        sessionId: auditData.sessionId,
        action: auditData.action || 'unknown',
        resource: auditData.resource || 'unknown',
        method: auditData.method || 'UNKNOWN',
        endpoint: auditData.endpoint || '/',
        userAgent: auditData.userAgent || 'unknown',
        ip: auditData.ip || 'unknown',
        success: auditData.success ?? true,
        error: auditData.error,
        duration: auditData.duration || 0,
        timestamp: new Date(),
        correlationId: auditData.correlationId || correlationId.getId(),
        metadata: auditData.metadata || {},
      };

      // Save to database
      await new AuditLogModel(auditLog).save();

      // Update metrics
      this.updateAuditMetrics(auditLog);

      // Log to file system as well
      logAuditEvent(
        auditLog.action,
        auditLog.resource,
        auditLog.userId,
        auditLog.ip,
        auditLog.success,
        auditLog.metadata
      );

      return auditLog.id;

    } catch (error) {
      console.error('Failed to log audit event:', error.message);
      
      // Fallback to file logging only
      logAuditEvent(
        auditData.action || 'unknown',
        auditData.resource || 'unknown',
        auditData.userId,
        auditData.ip,
        auditData.success,
        { error: error.message, ...auditData.metadata }
      );

      throw new Error(`Audit logging failed: ${error.message}`);
    }
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(eventData: SecurityEvent): Promise<string> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const securityEvent = {
        id: generateUUID(),
        ...eventData,
        timestamp: eventData.timestamp || new Date(),
        correlationId: eventData.correlationId || correlationId.getId(),
      };

      // Save to database
      await new SecurityEventModel(securityEvent).save();

      // Update metrics
      this.updateSecurityEventMetrics(securityEvent);

      // Log to file system
      logSecurityEvent(securityEvent);

      // Send alerts for critical events
      if (securityEvent.severity === 'critical') {
        await this.sendCriticalAlert(securityEvent);
      }

      return securityEvent.id;

    } catch (error) {
      console.error('Failed to log security event:', error.message);
      
      // Fallback to file logging
      logSecurityEvent(eventData);

      throw new Error(`Security event logging failed: ${error.message}`);
    }
  }

  /**
   * Retrieve audit logs based on query criteria
   */
  async getAuditLogs(query: AuditQuery): Promise<{
    logs: AuditLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const filters: any = {};
      
      // Date range filter
      if (query.startDate || query.endDate) {
        filters.timestamp = {};
        if (query.startDate) {
          filters.timestamp.$gte = new Date(query.startDate);
        }
        if (query.endDate) {
          filters.timestamp.$lte = new Date(query.endDate);
        }
      }

      // Other filters
      if (query.userId) filters.userId = query.userId;
      if (query.action) filters.action = new RegExp(query.action, 'i');
      if (query.resource) filters.resource = new RegExp(query.resource, 'i');
      if (query.success !== undefined) filters.success = query.success;
      if (query.ip) filters.ip = query.ip;

      const limit = Math.min(query.limit || 100, 1000); // Max 1000 records
      const offset = query.offset || 0;

      // Get total count
      const total = await AuditLogModel.countDocuments(filters);

      // Get logs
      const logs = await AuditLogModel
        .find(filters)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(offset)
        .lean()
        .exec();

      return {
        logs: logs as AuditLog[],
        total,
        page: Math.floor(offset / limit) + 1,
        pageSize: limit,
      };

    } catch (error) {
      throw new Error(`Failed to retrieve audit logs: ${error.message}`);
    }
  }

  /**
   * Get security events
   */
  async getSecurityEvents(filters: {
    startDate?: string;
    endDate?: string;
    type?: string;
    severity?: string;
    resolved?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    events: SecurityEvent[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const queryFilters: any = {};
      
      // Date range filter
      if (filters.startDate || filters.endDate) {
        queryFilters.timestamp = {};
        if (filters.startDate) {
          queryFilters.timestamp.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          queryFilters.timestamp.$lte = new Date(filters.endDate);
        }
      }

      // Other filters
      if (filters.type) queryFilters.type = filters.type;
      if (filters.severity) queryFilters.severity = filters.severity;
      if (filters.resolved !== undefined) queryFilters.resolved = filters.resolved;

      const limit = Math.min(filters.limit || 100, 1000);
      const offset = filters.offset || 0;

      // Get total count
      const total = await SecurityEventModel.countDocuments(queryFilters);

      // Get events
      const events = await SecurityEventModel
        .find(queryFilters)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(offset)
        .lean()
        .exec();

      return {
        events: events as SecurityEvent[],
        total,
        page: Math.floor(offset / limit) + 1,
        pageSize: limit,
      };

    } catch (error) {
      throw new Error(`Failed to retrieve security events: ${error.message}`);
    }
  }

  /**
   * Resolve a security event
   */
  async resolveSecurityEvent(eventId: string, resolvedBy: string, notes?: string): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      await SecurityEventModel.updateOne(
        { id: eventId },
        {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy,
          'metadata.resolutionNotes': notes,
        }
      );

      await this.logAuditEvent({
        action: 'security_event_resolved',
        resource: 'security_event',
        userId: resolvedBy,
        ip: 'internal',
        userAgent: 'system',
        method: 'PATCH',
        endpoint: `/security/events/${eventId}/resolve`,
        success: true,
        duration: 0,
        metadata: { eventId, notes },
      });

    } catch (error) {
      throw new Error(`Failed to resolve security event: ${error.message}`);
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(timeframe: 'hour' | 'day' | 'week' | 'month' = 'day'): Promise<{
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    uniqueUsers: number;
    uniqueIPs: number;
    topActions: Array<{ action: string; count: number }>;
    topResources: Array<{ resource: string; count: number }>;
    topFailures: Array<{ action: string; count: number }>;
  }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const now = new Date();
      let startDate: Date;

      switch (timeframe) {
        case 'hour':
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }

      const [
        totalEvents,
        successfulEvents,
        failedEvents,
        uniqueUsers,
        uniqueIPs,
        topActions,
        topResources,
        topFailures
      ] = await Promise.all([
        AuditLogModel.countDocuments({ timestamp: { $gte: startDate } }),
        AuditLogModel.countDocuments({ timestamp: { $gte: startDate }, success: true }),
        AuditLogModel.countDocuments({ timestamp: { $gte: startDate }, success: false }),
        AuditLogModel.distinct('userId', { timestamp: { $gte: startDate }, userId: { $exists: true } }).then(users => users.length),
        AuditLogModel.distinct('ip', { timestamp: { $gte: startDate } }).then(ips => ips.length),
        
        // Top actions
        AuditLogModel.aggregate([
          { $match: { timestamp: { $gte: startDate } } },
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { action: '$_id', count: 1, _id: 0 } }
        ]),
        
        // Top resources
        AuditLogModel.aggregate([
          { $match: { timestamp: { $gte: startDate } } },
          { $group: { _id: '$resource', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { resource: '$_id', count: 1, _id: 0 } }
        ]),
        
        // Top failures
        AuditLogModel.aggregate([
          { $match: { timestamp: { $gte: startDate }, success: false } },
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { action: '$_id', count: 1, _id: 0 } }
        ])
      ]);

      return {
        totalEvents,
        successfulEvents,
        failedEvents,
        uniqueUsers,
        uniqueIPs,
        topActions,
        topResources,
        topFailures,
      };

    } catch (error) {
      throw new Error(`Failed to get audit statistics: ${error.message}`);
    }
  }

  /**
   * Export audit logs for compliance
   */
  async exportAuditLogs(
    query: AuditQuery,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    try {
      const result = await this.getAuditLogs({
        ...query,
        limit: 10000, // Large export limit
      });

      if (format === 'csv') {
        return this.convertToCSV(result.logs);
      }

      return JSON.stringify(result, null, 2);

    } catch (error) {
      throw new Error(`Failed to export audit logs: ${error.message}`);
    }
  }

  /**
   * Rotate logs (archive old logs)
   */
  async rotateLogs(): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const retentionPeriod = config.auditRetentionDays || 365; // Default 1 year
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionPeriod);

      // Archive old audit logs
      const archivedAuditLogs = await AuditLogModel.find({
        timestamp: { $lt: cutoffDate }
      }).lean();

      if (archivedAuditLogs.length > 0) {
        // In production, you would archive to cold storage (S3, etc.)
        console.log(`Archiving ${archivedAuditLogs.length} audit logs`);
        
        // Delete archived logs from main collection
        await AuditLogModel.deleteMany({
          timestamp: { $lt: cutoffDate }
        });
      }

      // Archive old security events
      const archivedSecurityEvents = await SecurityEventModel.find({
        timestamp: { $lt: cutoffDate },
        resolved: true
      }).lean();

      if (archivedSecurityEvents.length > 0) {
        console.log(`Archiving ${archivedSecurityEvents.length} security events`);
        
        await SecurityEventModel.deleteMany({
          timestamp: { $lt: cutoffDate },
          resolved: true
        });
      }

      await this.logAuditEvent({
        action: 'logs_rotated',
        resource: 'audit_service',
        ip: 'internal',
        userAgent: 'system',
        method: 'SYSTEM',
        endpoint: '/internal/audit/rotate',
        success: true,
        duration: 0,
        metadata: {
          archivedAuditLogs: archivedAuditLogs.length,
          archivedSecurityEvents: archivedSecurityEvents.length,
          retentionPeriod,
        },
      });

    } catch (error) {
      console.error('Log rotation failed:', error.message);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {};
    
    for (const [key, value] of this.auditMetrics) {
      metrics[key] = value;
    }

    return metrics;
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): void {
    this.auditMetrics.set('total_audit_logs', 0);
    this.auditMetrics.set('successful_operations', 0);
    this.auditMetrics.set('failed_operations', 0);
    this.auditMetrics.set('security_events', 0);
    this.auditMetrics.set('critical_events', 0);
  }

  /**
   * Update audit metrics
   */
  private updateAuditMetrics(auditLog: AuditLog): void {
    this.auditMetrics.set('total_audit_logs', (this.auditMetrics.get('total_audit_logs') || 0) + 1);
    
    if (auditLog.success) {
      this.auditMetrics.set('successful_operations', (this.auditMetrics.get('successful_operations') || 0) + 1);
    } else {
      this.auditMetrics.set('failed_operations', (this.auditMetrics.get('failed_operations') || 0) + 1);
    }
  }

  /**
   * Update security event metrics
   */
  private updateSecurityEventMetrics(securityEvent: SecurityEvent): void {
    this.auditMetrics.set('security_events', (this.auditMetrics.get('security_events') || 0) + 1);
    
    if (securityEvent.severity === 'critical') {
      this.auditMetrics.set('critical_events', (this.auditMetrics.get('critical_events') || 0) + 1);
    }
  }

  /**
   * Setup retention policies in database
   */
  private async setupRetentionPolicies(): Promise<void> {
    try {
      // Create TTL index for automatic cleanup
      const retentionDays = config.auditRetentionDays || 365;
      const retentionSeconds = retentionDays * 24 * 60 * 60;

      await AuditLogModel.collection.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: retentionSeconds }
      );

      await SecurityEventModel.collection.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: retentionSeconds }
      );

    } catch (error) {
      console.warn('Failed to setup retention policies:', error.message);
    }
  }

  /**
   * Start cleanup tasks
   */
  private startCleanupTasks(): void {
    // Run log rotation daily
    setInterval(() => {
      this.rotateLogs().catch(console.error);
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Convert logs to CSV format
   */
  private convertToCSV(logs: AuditLog[]): string {
    if (logs.length === 0) return '';

    const headers = [
      'id', 'timestamp', 'userId', 'action', 'resource', 'method', 
      'endpoint', 'ip', 'success', 'duration', 'error', 'correlationId'
    ];

    const csvRows = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.id,
        log.timestamp.toISOString(),
        log.userId || '',
        log.action,
        log.resource,
        log.method,
        log.endpoint,
        log.ip,
        log.success.toString(),
        log.duration.toString(),
        log.error || '',
        log.correlationId,
      ];

      csvRows.push(row.map(field => `"${field}"`).join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * Send critical security alerts
   */
  private async sendCriticalAlert(securityEvent: SecurityEvent): Promise<void> {
    try {
      // In production, integrate with alerting systems like:
      // - Email notifications
      // - Slack webhooks
      // - PagerDuty
      // - SMS alerts
      
      console.error('CRITICAL SECURITY ALERT:', {
        id: securityEvent.id,
        type: securityEvent.type,
        description: securityEvent.description,
        source: securityEvent.source,
        timestamp: securityEvent.timestamp,
      });

      // Log the alert
      await this.logAuditEvent({
        action: 'critical_alert_sent',
        resource: 'security_alert',
        ip: 'internal',
        userAgent: 'system',
        method: 'SYSTEM',
        endpoint: '/internal/alerts/critical',
        success: true,
        duration: 0,
        metadata: {
          securityEventId: securityEvent.id,
          alertType: 'critical',
        },
      });

    } catch (error) {
      console.error('Failed to send critical alert:', error.message);
    }
  }
}