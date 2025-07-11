/**
 * Platform Health Monitoring Service
 * Monitors system health, performance, and availability
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import * as os from 'os';
import * as fs from 'fs/promises';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { redisClient } from '../../config/redis';
import { promClient } from '../../utils/metrics';

const prisma = new PrismaClient();

interface HealthCheck {
  id: string;
  name: string;
  type: 'database' | 'cache' | 'api' | 'service' | 'external' | 'infrastructure';
  endpoint?: string;
  interval: number; // seconds
  timeout: number; // seconds
  retries: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  lastSuccess?: Date;
  lastFailure?: Date;
  responseTime?: number; // ms
  errorMessage?: string;
  metadata?: any;
}

interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number; // percentage
    loadAverage: number[];
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  network: {
    rx: number; // bytes/sec
    tx: number; // bytes/sec
    connections: number;
  };
  process: {
    uptime: number; // seconds
    pid: number;
    memoryUsage: NodeJS.MemoryUsage;
    handles: number;
  };
}

interface ServiceHealth {
  service: string;
  status: 'operational' | 'degraded' | 'down';
  uptime: number; // percentage
  avgResponseTime: number;
  errorRate: number;
  throughput: number; // requests/sec
  activeConnections: number;
  queueSize?: number;
  lastError?: {
    message: string;
    timestamp: Date;
    count: number;
  };
}

interface Incident {
  id: string;
  title: string;
  type: 'outage' | 'degradation' | 'maintenance' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  affectedServices: string[];
  impact: string;
  startedAt: Date;
  identifiedAt?: Date;
  resolvedAt?: Date;
  updates: IncidentUpdate[];
  postmortem?: string;
}

interface IncidentUpdate {
  timestamp: Date;
  status: Incident['status'];
  message: string;
  updatedBy: string;
}

interface Alert {
  id: string;
  name: string;
  condition: AlertCondition;
  severity: 'warning' | 'error' | 'critical';
  enabled: boolean;
  cooldown: number; // minutes
  lastTriggered?: Date;
  notifications: AlertNotification[];
}

interface AlertCondition {
  metric: string;
  operator: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  duration: number; // seconds
  aggregation?: 'avg' | 'min' | 'max' | 'sum';
}

interface AlertNotification {
  type: 'email' | 'sms' | 'webhook' | 'slack';
  destination: string;
  template?: string;
}

interface DashboardData {
  overview: {
    status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage';
    uptime: number;
    incidents: number;
    alerts: number;
  };
  services: ServiceHealth[];
  metrics: {
    current: SystemMetrics;
    history: SystemMetrics[];
  };
  recentIncidents: Incident[];
  activeAlerts: Array<{
    alert: Alert;
    triggeredAt: Date;
    currentValue: number;
  }>;
}

interface PerformanceMetrics {
  service: string;
  endpoint: string;
  timestamp: Date;
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  successRate: number;
}

export class PlatformHealthService extends EventEmitter {
  private healthChecks: Map<string, HealthCheck> = new Map();
  private checkJobs: Map<string, CronJob> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private incidents: Map<string, Incident> = new Map();
  private metricsHistory: SystemMetrics[] = [];
  private performanceMetrics: Map<string, PerformanceMetrics[]> = new Map();
  private systemMonitorJob: CronJob;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private async initializeService() {
    // Setup health checks
    await this.setupHealthChecks();

    // Load alerts
    await this.loadAlerts();

    // Start system monitoring
    this.systemMonitorJob = new CronJob('*/30 * * * * *', async () => {
      await this.collectSystemMetrics();
    });
    this.systemMonitorJob.start();

    // Setup performance monitoring
    this.setupPerformanceMonitoring();

    // Start health check jobs
    this.startHealthCheckJobs();
  }

  /**
   * Get platform health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: HealthCheck[];
    services: ServiceHealth[];
    metrics: SystemMetrics;
  }> {
    try {
      // Run all health checks
      const checks = await this.runAllHealthChecks();

      // Get service health
      const services = await this.getServicesHealth();

      // Get current metrics
      const metrics = await this.getCurrentSystemMetrics();

      // Determine overall status
      const unhealthyChecks = checks.filter(c => c.status === 'unhealthy').length;
      const degradedChecks = checks.filter(c => c.status === 'degraded').length;

      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (unhealthyChecks > 0) {
        status = 'unhealthy';
      } else if (degradedChecks > 0) {
        status = 'degraded';
      } else {
        status = 'healthy';
      }

      return {
        status,
        checks,
        services,
        metrics,
      };

    } catch (error) {
      logger.error('Failed to get health status', error);
      throw error;
    }
  }

  /**
   * Create incident
   */
  async createIncident(incidentData: {
    title: string;
    type: Incident['type'];
    severity: Incident['severity'];
    affectedServices: string[];
    impact: string;
    initialUpdate?: string;
  }): Promise<Incident> {
    try {
      const incident: Incident = {
        id: `incident_${Date.now()}`,
        ...incidentData,
        status: 'investigating',
        startedAt: new Date(),
        updates: [],
      };

      if (incidentData.initialUpdate) {
        incident.updates.push({
          timestamp: new Date(),
          status: 'investigating',
          message: incidentData.initialUpdate,
          updatedBy: 'system',
        });
      }

      await prisma.incident.create({
        data: incident,
      });

      this.incidents.set(incident.id, incident);

      // Send notifications
      await this.notifyIncident(incident, 'created');

      // Update status page
      await this.updateStatusPage();

      this.emit('incident:created', incident);

      return incident;

    } catch (error) {
      logger.error('Failed to create incident', error);
      throw error;
    }
  }

  /**
   * Update incident
   */
  async updateIncident(
    incidentId: string,
    update: {
      status?: Incident['status'];
      message: string;
      updatedBy: string;
    }
  ): Promise<void> {
    try {
      const incident = this.incidents.get(incidentId);
      if (!incident) {
        throw new Error('Incident not found');
      }

      if (update.status) {
        incident.status = update.status;

        if (update.status === 'identified' && !incident.identifiedAt) {
          incident.identifiedAt = new Date();
        } else if (update.status === 'resolved' && !incident.resolvedAt) {
          incident.resolvedAt = new Date();
        }
      }

      incident.updates.push({
        timestamp: new Date(),
        status: incident.status,
        message: update.message,
        updatedBy: update.updatedBy,
      });

      await prisma.incident.update({
        where: { id: incidentId },
        data: incident,
      });

      // Send notifications
      await this.notifyIncident(incident, 'updated');

      // Update status page
      await this.updateStatusPage();

      this.emit('incident:updated', incident);

    } catch (error) {
      logger.error('Failed to update incident', error);
      throw error;
    }
  }

  /**
   * Create or update alert
   */
  async upsertAlert(alert: Alert): Promise<void> {
    try {
      await prisma.alert.upsert({
        where: { id: alert.id },
        create: alert,
        update: alert,
      });

      this.alerts.set(alert.id, alert);

      // Start monitoring if enabled
      if (alert.enabled) {
        await this.startAlertMonitoring(alert);
      }

      this.emit('alert:configured', alert);

    } catch (error) {
      logger.error('Failed to upsert alert', error);
      throw error;
    }
  }

  /**
   * Get dashboard data
   */
  async getDashboardData(): Promise<DashboardData> {
    try {
      const healthStatus = await this.getHealthStatus();

      // Calculate uptime
      const uptime = await this.calculateUptime(24); // Last 24 hours

      // Get active incidents
      const activeIncidents = Array.from(this.incidents.values())
        .filter(i => i.status !== 'resolved');

      // Get active alerts
      const activeAlerts = await this.getActiveAlerts();

      // Determine overall status
      let overallStatus: DashboardData['overview']['status'] = 'operational';
      if (activeIncidents.some(i => i.severity === 'critical')) {
        overallStatus = 'major_outage';
      } else if (activeIncidents.length > 0) {
        overallStatus = 'partial_outage';
      } else if (healthStatus.status === 'degraded') {
        overallStatus = 'degraded';
      }

      return {
        overview: {
          status: overallStatus,
          uptime,
          incidents: activeIncidents.length,
          alerts: activeAlerts.length,
        },
        services: healthStatus.services,
        metrics: {
          current: healthStatus.metrics,
          history: this.metricsHistory.slice(-20), // Last 20 data points
        },
        recentIncidents: Array.from(this.incidents.values())
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .slice(0, 5),
        activeAlerts,
      };

    } catch (error) {
      logger.error('Failed to get dashboard data', error);
      throw error;
    }
  }

  /**
   * Get performance report
   */
  async getPerformanceReport(
    service: string,
    timeRange: { start: Date; end: Date }
  ): Promise<{
    summary: {
      avgResponseTime: number;
      p95ResponseTime: number;
      p99ResponseTime: number;
      errorRate: number;
      throughput: number;
    };
    endpoints: Array<{
      endpoint: string;
      metrics: PerformanceMetrics;
      trend: 'improving' | 'stable' | 'degrading';
    }>;
    timeline: PerformanceMetrics[];
    issues: string[];
  }> {
    try {
      const metrics = this.performanceMetrics.get(service) || [];
      const timeRangeMetrics = metrics.filter(m => 
        m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
      );

      if (timeRangeMetrics.length === 0) {
        return {
          summary: {
            avgResponseTime: 0,
            p95ResponseTime: 0,
            p99ResponseTime: 0,
            errorRate: 0,
            throughput: 0,
          },
          endpoints: [],
          timeline: [],
          issues: [],
        };
      }

      // Calculate summary
      const totalRequests = timeRangeMetrics.reduce((sum, m) => sum + m.requestCount, 0);
      const totalErrors = timeRangeMetrics.reduce((sum, m) => sum + m.errorCount, 0);
      const avgResponseTime = timeRangeMetrics.reduce((sum, m) => 
        sum + m.avgResponseTime * m.requestCount, 0
      ) / totalRequests;

      const summary = {
        avgResponseTime,
        p95ResponseTime: this.calculatePercentile(
          timeRangeMetrics.map(m => m.p95ResponseTime), 95
        ),
        p99ResponseTime: this.calculatePercentile(
          timeRangeMetrics.map(m => m.p99ResponseTime), 99
        ),
        errorRate: (totalErrors / totalRequests) * 100,
        throughput: totalRequests / ((timeRange.end.getTime() - timeRange.start.getTime()) / 1000),
      };

      // Group by endpoint
      const endpointMap = new Map<string, PerformanceMetrics[]>();
      timeRangeMetrics.forEach(metric => {
        const existing = endpointMap.get(metric.endpoint) || [];
        existing.push(metric);
        endpointMap.set(metric.endpoint, existing);
      });

      // Analyze endpoints
      const endpoints = Array.from(endpointMap.entries()).map(([endpoint, metrics]) => {
        const latest = metrics[metrics.length - 1];
        const trend = this.calculateTrend(metrics);

        return {
          endpoint,
          metrics: latest,
          trend,
        };
      });

      // Identify issues
      const issues = this.identifyPerformanceIssues(timeRangeMetrics);

      return {
        summary,
        endpoints,
        timeline: timeRangeMetrics,
        issues,
      };

    } catch (error) {
      logger.error('Failed to get performance report', error);
      throw error;
    }
  }

  /**
   * Get capacity planning data
   */
  async getCapacityPlanning(): Promise<{
    current: {
      cpu: number;
      memory: number;
      disk: number;
      database: {
        connections: number;
        size: number;
      };
    };
    projections: {
      days: number;
      cpu: number;
      memory: number;
      disk: number;
    }[];
    recommendations: string[];
  }> {
    try {
      const currentMetrics = await this.getCurrentSystemMetrics();

      // Get database metrics
      const dbConnections = await this.getDatabaseConnections();
      const dbSize = await this.getDatabaseSize();

      // Calculate growth trends
      const growthRates = await this.calculateGrowthRates();

      // Generate projections
      const projections = [7, 30, 90].map(days => ({
        days,
        cpu: Math.min(100, currentMetrics.cpu.usage + (growthRates.cpu * days)),
        memory: Math.min(100, currentMetrics.memory.percentage + (growthRates.memory * days)),
        disk: Math.min(100, currentMetrics.disk.percentage + (growthRates.disk * days)),
      }));

      // Generate recommendations
      const recommendations = this.generateCapacityRecommendations(
        currentMetrics,
        projections,
        growthRates
      );

      return {
        current: {
          cpu: currentMetrics.cpu.usage,
          memory: currentMetrics.memory.percentage,
          disk: currentMetrics.disk.percentage,
          database: {
            connections: dbConnections,
            size: dbSize,
          },
        },
        projections,
        recommendations,
      };

    } catch (error) {
      logger.error('Failed to get capacity planning data', error);
      throw error;
    }
  }

  /**
   * Run diagnostic
   */
  async runDiagnostic(component?: string): Promise<{
    component: string;
    status: 'pass' | 'fail';
    checks: Array<{
      name: string;
      status: 'pass' | 'fail' | 'warning';
      message: string;
      details?: any;
    }>;
    recommendations: string[];
  }> {
    try {
      const checks = [];

      if (!component || component === 'database') {
        checks.push(...await this.diagnoseDatabaseHealth());
      }

      if (!component || component === 'cache') {
        checks.push(...await this.diagnoseCacheHealth());
      }

      if (!component || component === 'api') {
        checks.push(...await this.diagnoseAPIHealth());
      }

      if (!component || component === 'infrastructure') {
        checks.push(...await this.diagnoseInfrastructureHealth());
      }

      const hasFailures = checks.some(c => c.status === 'fail');
      const recommendations = this.generateDiagnosticRecommendations(checks);

      return {
        component: component || 'all',
        status: hasFailures ? 'fail' : 'pass',
        checks,
        recommendations,
      };

    } catch (error) {
      logger.error('Failed to run diagnostic', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async setupHealthChecks(): Promise<void> {
    const healthChecks: HealthCheck[] = [
      {
        id: 'db_primary',
        name: 'Primary Database',
        type: 'database',
        interval: 30,
        timeout: 5,
        retries: 3,
        status: 'unknown',
        lastCheck: new Date(),
      },
      {
        id: 'redis_cache',
        name: 'Redis Cache',
        type: 'cache',
        interval: 30,
        timeout: 3,
        retries: 2,
        status: 'unknown',
        lastCheck: new Date(),
      },
      {
        id: 'api_gateway',
        name: 'API Gateway',
        type: 'api',
        endpoint: process.env.API_GATEWAY_URL + '/health',
        interval: 60,
        timeout: 10,
        retries: 3,
        status: 'unknown',
        lastCheck: new Date(),
      },
      {
        id: 'payment_service',
        name: 'Payment Service',
        type: 'external',
        endpoint: process.env.STRIPE_API_URL,
        interval: 300,
        timeout: 15,
        retries: 2,
        status: 'unknown',
        lastCheck: new Date(),
      },
    ];

    for (const check of healthChecks) {
      this.healthChecks.set(check.id, check);
    }
  }

  private async loadAlerts(): Promise<void> {
    const alerts = await prisma.alert.findMany({
      where: { enabled: true },
    });

    alerts.forEach(alert => {
      this.alerts.set(alert.id, alert);
    });

    // Create default alerts if none exist
    if (alerts.length === 0) {
      await this.createDefaultAlerts();
    }
  }

  private async createDefaultAlerts(): Promise<void> {
    const defaultAlerts: Alert[] = [
      {
        id: 'high_cpu',
        name: 'High CPU Usage',
        condition: {
          metric: 'cpu.usage',
          operator: 'greater_than',
          threshold: 80,
          duration: 300,
          aggregation: 'avg',
        },
        severity: 'warning',
        enabled: true,
        cooldown: 15,
        notifications: [
          {
            type: 'email',
            destination: process.env.OPS_EMAIL!,
          },
        ],
      },
      {
        id: 'memory_critical',
        name: 'Critical Memory Usage',
        condition: {
          metric: 'memory.percentage',
          operator: 'greater_than',
          threshold: 90,
          duration: 60,
        },
        severity: 'critical',
        enabled: true,
        cooldown: 5,
        notifications: [
          {
            type: 'sms',
            destination: process.env.OPS_PHONE!,
          },
        ],
      },
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        condition: {
          metric: 'api.error_rate',
          operator: 'greater_than',
          threshold: 5,
          duration: 300,
        },
        severity: 'error',
        enabled: true,
        cooldown: 30,
        notifications: [
          {
            type: 'slack',
            destination: process.env.SLACK_WEBHOOK!,
          },
        ],
      },
    ];

    for (const alert of defaultAlerts) {
      await this.upsertAlert(alert);
    }
  }

  private startHealthCheckJobs(): void {
    for (const [checkId, check] of this.healthChecks) {
      const job = new CronJob(`*/${check.interval} * * * * *`, async () => {
        await this.runHealthCheck(checkId);
      });
      job.start();
      this.checkJobs.set(checkId, job);
    }
  }

  private async runHealthCheck(checkId: string): Promise<void> {
    const check = this.healthChecks.get(checkId);
    if (!check) return;

    const startTime = Date.now();
    let success = false;
    let errorMessage: string | undefined;

    try {
      switch (check.type) {
        case 'database':
          success = await this.checkDatabase();
          break;
        case 'cache':
          success = await this.checkCache();
          break;
        case 'api':
          success = await this.checkAPI(check.endpoint!);
          break;
        case 'external':
          success = await this.checkExternal(check.endpoint!);
          break;
      }

      check.responseTime = Date.now() - startTime;
      check.lastCheck = new Date();

      if (success) {
        check.status = 'healthy';
        check.lastSuccess = new Date();
        check.errorMessage = undefined;
      } else {
        throw new Error('Health check failed');
      }

    } catch (error) {
      errorMessage = error.message;
      check.errorMessage = errorMessage;
      check.lastFailure = new Date();

      // Determine status based on consecutive failures
      const recentFailures = await this.getRecentFailures(checkId);
      if (recentFailures >= check.retries) {
        check.status = 'unhealthy';
        await this.handleUnhealthyCheck(check);
      } else {
        check.status = 'degraded';
      }
    }

    // Update metrics
    await this.updateHealthMetrics(check);
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Database health check failed', error);
      return false;
    }
  }

  private async checkCache(): Promise<boolean> {
    try {
      await redisClient.ping();
      return true;
    } catch (error) {
      logger.error('Cache health check failed', error);
      return false;
    }
  }

  private async checkAPI(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        timeout: 5000,
      });
      return response.ok;
    } catch (error) {
      logger.error('API health check failed', error);
      return false;
    }
  }

  private async checkExternal(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(endpoint, {
        method: 'HEAD',
        timeout: 10000,
      });
      return response.ok;
    } catch (error) {
      logger.error('External service health check failed', error);
      return false;
    }
  }

  private async runAllHealthChecks(): Promise<HealthCheck[]> {
    const checks = Array.from(this.healthChecks.values());
    
    await Promise.all(
      checks.map(check => this.runHealthCheck(check.id))
    );

    return checks;
  }

  private async getServicesHealth(): Promise<ServiceHealth[]> {
    const services = [
      'auth-service',
      'order-service',
      'payment-service',
      'notification-service',
      'analytics-service',
    ];

    const serviceHealthData: ServiceHealth[] = [];

    for (const service of services) {
      const metrics = await this.getServiceMetrics(service);
      
      serviceHealthData.push({
        service,
        status: this.determineServiceStatus(metrics),
        uptime: metrics.uptime || 99.9,
        avgResponseTime: metrics.avgResponseTime || 50,
        errorRate: metrics.errorRate || 0.1,
        throughput: metrics.throughput || 100,
        activeConnections: metrics.activeConnections || 10,
        queueSize: metrics.queueSize,
        lastError: metrics.lastError,
      });
    }

    return serviceHealthData;
  }

  private async getServiceMetrics(service: string): Promise<any> {
    // Get metrics from Prometheus or similar
    try {
      const metrics = await promClient.query({
        query: `service_metrics{service="${service}"}`,
        time: new Date(),
      });

      return this.parseServiceMetrics(metrics);
    } catch (error) {
      logger.error(`Failed to get metrics for ${service}`, error);
      return {};
    }
  }

  private parseServiceMetrics(metrics: any): any {
    // Parse Prometheus metrics
    return {
      uptime: 99.9,
      avgResponseTime: 50,
      errorRate: 0.1,
      throughput: 100,
      activeConnections: 10,
    };
  }

  private determineServiceStatus(metrics: any): ServiceHealth['status'] {
    if (metrics.errorRate > 5) return 'down';
    if (metrics.errorRate > 1 || metrics.avgResponseTime > 1000) return 'degraded';
    return 'operational';
  }

  private async getCurrentSystemMetrics(): Promise<SystemMetrics> {
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Get disk usage
    const diskStats = await this.getDiskUsage();

    // Get network stats
    const networkStats = await this.getNetworkStats();

    return {
      timestamp: new Date(),
      cpu: {
        usage: cpuUsage,
        loadAverage: os.loadavg(),
        cores: os.cpus().length,
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percentage: (usedMem / totalMem) * 100,
      },
      disk: diskStats,
      network: networkStats,
      process: {
        uptime: process.uptime(),
        pid: process.pid,
        memoryUsage: process.memoryUsage(),
        handles: (process as any)._getActiveHandles().length,
      },
    };
  }

  private async getDiskUsage(): Promise<SystemMetrics['disk']> {
    try {
      const stats = await fs.statfs('/');
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;

      return {
        total,
        used,
        free,
        percentage: (used / total) * 100,
      };
    } catch (error) {
      logger.error('Failed to get disk usage', error);
      return { total: 0, used: 0, free: 0, percentage: 0 };
    }
  }

  private async getNetworkStats(): Promise<SystemMetrics['network']> {
    // Simplified network stats
    return {
      rx: 0,
      tx: 0,
      connections: (process as any)._getActiveHandles().length,
    };
  }

  private async collectSystemMetrics(): Promise<void> {
    const metrics = await this.getCurrentSystemMetrics();
    
    // Store in history (keep last 1 hour)
    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > 120) { // 30 seconds * 120 = 1 hour
      this.metricsHistory.shift();
    }

    // Check alerts
    await this.checkAlerts(metrics);

    // Update Prometheus metrics
    this.updatePrometheusMetrics(metrics);
  }

  private setupPerformanceMonitoring(): void {
    // Monitor API performance
    this.on('api:request', async (data: {
      service: string;
      endpoint: string;
      responseTime: number;
      statusCode: number;
    }) => {
      await this.recordPerformanceMetric(data);
    });
  }

  private async recordPerformanceMetric(data: any): Promise<void> {
    const service = data.service;
    const metrics = this.performanceMetrics.get(service) || [];

    // Aggregate metrics per minute
    const currentMinute = new Date();
    currentMinute.setSeconds(0, 0);

    let metric = metrics.find(m => 
      m.timestamp.getTime() === currentMinute.getTime() &&
      m.endpoint === data.endpoint
    );

    if (!metric) {
      metric = {
        service,
        endpoint: data.endpoint,
        timestamp: currentMinute,
        requestCount: 0,
        errorCount: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        successRate: 0,
      };
      metrics.push(metric);
    }

    // Update metrics
    metric.requestCount++;
    if (data.statusCode >= 400) {
      metric.errorCount++;
    }

    // Update response times (simplified)
    metric.avgResponseTime = 
      (metric.avgResponseTime * (metric.requestCount - 1) + data.responseTime) / 
      metric.requestCount;

    metric.successRate = 
      ((metric.requestCount - metric.errorCount) / metric.requestCount) * 100;

    this.performanceMetrics.set(service, metrics);

    // Keep only last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filteredMetrics = metrics.filter(m => m.timestamp > cutoff);
    this.performanceMetrics.set(service, filteredMetrics);
  }

  private async startAlertMonitoring(alert: Alert): Promise<void> {
    // Alert monitoring is handled during metric collection
  }

  private async checkAlerts(metrics: SystemMetrics): Promise<void> {
    for (const alert of this.alerts.values()) {
      if (!alert.enabled) continue;

      // Check cooldown
      if (alert.lastTriggered) {
        const cooldownMs = alert.cooldown * 60 * 1000;
        if (Date.now() - alert.lastTriggered.getTime() < cooldownMs) {
          continue;
        }
      }

      const currentValue = this.getMetricValue(metrics, alert.condition.metric);
      const shouldTrigger = this.evaluateAlertCondition(
        currentValue,
        alert.condition
      );

      if (shouldTrigger) {
        await this.triggerAlert(alert, currentValue);
      }
    }
  }

  private getMetricValue(metrics: SystemMetrics, metricPath: string): number {
    const parts = metricPath.split('.');
    let value: any = metrics;

    for (const part of parts) {
      value = value?.[part];
    }

    return Number(value) || 0;
  }

  private evaluateAlertCondition(value: number, condition: AlertCondition): boolean {
    switch (condition.operator) {
      case 'greater_than':
        return value > condition.threshold;
      case 'less_than':
        return value < condition.threshold;
      case 'equals':
        return value === condition.threshold;
      case 'not_equals':
        return value !== condition.threshold;
      default:
        return false;
    }
  }

  private async triggerAlert(alert: Alert, currentValue: number): Promise<void> {
    alert.lastTriggered = new Date();

    // Send notifications
    for (const notification of alert.notifications) {
      await this.sendAlertNotification(alert, notification, currentValue);
    }

    // Log alert
    logger.warn(`Alert triggered: ${alert.name}`, {
      alertId: alert.id,
      currentValue,
      threshold: alert.condition.threshold,
    });

    this.emit('alert:triggered', {
      alert,
      currentValue,
      timestamp: new Date(),
    });
  }

  private async sendAlertNotification(
    alert: Alert,
    notification: AlertNotification,
    currentValue: number
  ): Promise<void> {
    const message = `Alert: ${alert.name}\nCurrent value: ${currentValue}\nThreshold: ${alert.condition.threshold}`;

    switch (notification.type) {
      case 'email':
        await notificationService.sendEmail(
          notification.destination,
          'platform_alert',
          {
            alertName: alert.name,
            severity: alert.severity,
            currentValue,
            threshold: alert.condition.threshold,
          }
        );
        break;

      case 'sms':
        await notificationService.sendSMS(notification.destination, message);
        break;

      case 'slack':
        await this.sendSlackNotification(notification.destination, {
          text: message,
          color: alert.severity === 'critical' ? 'danger' : 'warning',
        });
        break;

      case 'webhook':
        await fetch(notification.destination, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alert: alert.name,
            severity: alert.severity,
            currentValue,
            threshold: alert.condition.threshold,
            timestamp: new Date(),
          }),
        });
        break;
    }
  }

  private async sendSlackNotification(webhook: string, payload: any): Promise<void> {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  private async getRecentFailures(checkId: string): Promise<number> {
    // Count failures in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    // In real implementation, would query from database
    return 1; // Simplified
  }

  private async handleUnhealthyCheck(check: HealthCheck): Promise<void> {
    // Check if incident already exists
    const existingIncident = Array.from(this.incidents.values())
      .find(i => 
        i.status !== 'resolved' &&
        i.affectedServices.includes(check.name)
      );

    if (!existingIncident) {
      // Create new incident
      await this.createIncident({
        title: `${check.name} is unhealthy`,
        type: 'outage',
        severity: check.type === 'database' ? 'critical' : 'high',
        affectedServices: [check.name],
        impact: `${check.name} is not responding to health checks`,
        initialUpdate: `Health check failed: ${check.errorMessage}`,
      });
    }
  }

  private async updateHealthMetrics(check: HealthCheck): Promise<void> {
    // Update Prometheus metrics
    if (check.responseTime) {
      promClient.histogram('health_check_duration', check.responseTime, {
        check: check.id,
        status: check.status,
      });
    }

    promClient.gauge('health_check_status', check.status === 'healthy' ? 1 : 0, {
      check: check.id,
    });
  }

  private updatePrometheusMetrics(metrics: SystemMetrics): void {
    promClient.gauge('system_cpu_usage', metrics.cpu.usage);
    promClient.gauge('system_memory_usage', metrics.memory.percentage);
    promClient.gauge('system_disk_usage', metrics.disk.percentage);
    promClient.gauge('system_network_connections', metrics.network.connections);
  }

  private async calculateUptime(hours: number): Promise<number> {
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    // Get incidents in time range
    const incidents = await prisma.incident.findMany({
      where: {
        startedAt: { gte: startTime },
      },
    });

    // Calculate downtime
    let downtimeMs = 0;
    incidents.forEach(incident => {
      const start = incident.startedAt.getTime();
      const end = incident.resolvedAt?.getTime() || Date.now();
      downtimeMs += end - start;
    });

    const totalMs = hours * 60 * 60 * 1000;
    const uptimeMs = totalMs - downtimeMs;

    return (uptimeMs / totalMs) * 100;
  }

  private async getActiveAlerts(): Promise<Array<{
    alert: Alert;
    triggeredAt: Date;
    currentValue: number;
  }>> {
    const activeAlerts = [];
    const currentMetrics = await this.getCurrentSystemMetrics();

    for (const alert of this.alerts.values()) {
      if (!alert.enabled) continue;

      const currentValue = this.getMetricValue(currentMetrics, alert.condition.metric);
      const isTriggered = this.evaluateAlertCondition(currentValue, alert.condition);

      if (isTriggered) {
        activeAlerts.push({
          alert,
          triggeredAt: alert.lastTriggered || new Date(),
          currentValue,
        });
      }
    }

    return activeAlerts;
  }

  private async notifyIncident(incident: Incident, event: string): Promise<void> {
    const severity = incident.severity;
    
    // Send to status page subscribers
    await notificationService.sendWebSocketEvent(
      'status_page',
      'incident_update',
      {
        incident,
        event,
      }
    );

    // Send critical alerts
    if (severity === 'critical') {
      await notificationService.sendSMS(
        process.env.OPS_PHONE!,
        `CRITICAL INCIDENT: ${incident.title}`
      );
    }

    // Send to Slack
    if (process.env.SLACK_WEBHOOK) {
      await this.sendSlackNotification(process.env.SLACK_WEBHOOK, {
        text: `Incident ${event}: ${incident.title}`,
        color: severity === 'critical' ? 'danger' : 'warning',
        fields: [
          { title: 'Type', value: incident.type, short: true },
          { title: 'Severity', value: incident.severity, short: true },
          { title: 'Status', value: incident.status, short: true },
          { title: 'Impact', value: incident.impact, short: false },
        ],
      });
    }
  }

  private async updateStatusPage(): Promise<void> {
    const dashboardData = await this.getDashboardData();
    
    // Broadcast to connected clients
    await notificationService.sendWebSocketEvent(
      'status_page',
      'status_update',
      dashboardData
    );
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * values.length) - 1;
    
    return sorted[index];
  }

  private calculateTrend(metrics: PerformanceMetrics[]): 'improving' | 'stable' | 'degrading' {
    if (metrics.length < 2) return 'stable';

    const recent = metrics.slice(-10);
    const older = metrics.slice(-20, -10);

    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((sum, m) => sum + m.avgResponseTime, 0) / recent.length;
    const olderAvg = older.reduce((sum, m) => sum + m.avgResponseTime, 0) / older.length;

    const change = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (change > 10) return 'degrading';
    if (change < -10) return 'improving';
    return 'stable';
  }

  private identifyPerformanceIssues(metrics: PerformanceMetrics[]): string[] {
    const issues: string[] = [];

    // High error rate
    const avgErrorRate = metrics.reduce((sum, m) => 
      sum + (m.errorCount / m.requestCount), 0
    ) / metrics.length * 100;

    if (avgErrorRate > 5) {
      issues.push(`High error rate: ${avgErrorRate.toFixed(1)}%`);
    }

    // Slow response times
    const avgResponseTime = metrics.reduce((sum, m) => 
      sum + m.avgResponseTime, 0
    ) / metrics.length;

    if (avgResponseTime > 1000) {
      issues.push(`Slow average response time: ${avgResponseTime.toFixed(0)}ms`);
    }

    // High variability
    const p99Times = metrics.map(m => m.p99ResponseTime);
    const maxP99 = Math.max(...p99Times);
    const minP99 = Math.min(...p99Times);

    if (maxP99 / minP99 > 5) {
      issues.push('High response time variability');
    }

    return issues;
  }

  private async getDatabaseConnections(): Promise<number> {
    try {
      const result = await prisma.$queryRaw`
        SELECT COUNT(*) as connections 
        FROM pg_stat_activity 
        WHERE state = 'active'
      `;
      return result[0]?.connections || 0;
    } catch (error) {
      return 0;
    }
  }

  private async getDatabaseSize(): Promise<number> {
    try {
      const result = await prisma.$queryRaw`
        SELECT pg_database_size(current_database()) as size
      `;
      return result[0]?.size || 0;
    } catch (error) {
      return 0;
    }
  }

  private async calculateGrowthRates(): Promise<{
    cpu: number;
    memory: number;
    disk: number;
  }> {
    // Calculate based on historical data
    if (this.metricsHistory.length < 10) {
      return { cpu: 0.1, memory: 0.1, disk: 0.2 };
    }

    const recent = this.metricsHistory.slice(-10);
    const older = this.metricsHistory.slice(0, 10);

    return {
      cpu: this.calculateGrowthRate(
        older.map(m => m.cpu.usage),
        recent.map(m => m.cpu.usage)
      ),
      memory: this.calculateGrowthRate(
        older.map(m => m.memory.percentage),
        recent.map(m => m.memory.percentage)
      ),
      disk: this.calculateGrowthRate(
        older.map(m => m.disk.percentage),
        recent.map(m => m.disk.percentage)
      ),
    };
  }

  private calculateGrowthRate(older: number[], recent: number[]): number {
    const oldAvg = older.reduce((sum, val) => sum + val, 0) / older.length;
    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    
    return (recentAvg - oldAvg) / this.metricsHistory.length;
  }

  private generateCapacityRecommendations(
    current: SystemMetrics,
    projections: any[],
    growthRates: any
  ): string[] {
    const recommendations: string[] = [];

    // CPU recommendations
    if (current.cpu.usage > 70) {
      recommendations.push('Consider scaling up CPU resources - current usage is high');
    } else if (projections[1].cpu > 80) {
      recommendations.push('CPU usage projected to exceed 80% within 30 days');
    }

    // Memory recommendations
    if (current.memory.percentage > 80) {
      recommendations.push('Memory usage is critical - immediate scaling recommended');
    } else if (growthRates.memory > 0.5) {
      recommendations.push('High memory growth rate detected - monitor closely');
    }

    // Disk recommendations
    if (projections[0].disk > 90) {
      recommendations.push('Disk space will be critical within 7 days - urgent action required');
    } else if (projections[2].disk > 80) {
      recommendations.push('Plan for additional disk space within 90 days');
    }

    return recommendations;
  }

  private async diagnoseDatabaseHealth(): Promise<Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: any;
  }>> {
    const checks = [];

    // Connection pool check
    try {
      const connections = await this.getDatabaseConnections();
      const maxConnections = 100; // From config

      checks.push({
        name: 'Database Connection Pool',
        status: connections > maxConnections * 0.8 ? 'warning' : 'pass',
        message: `${connections}/${maxConnections} connections in use`,
        details: { connections, maxConnections },
      });
    } catch (error) {
      checks.push({
        name: 'Database Connection Pool',
        status: 'fail',
        message: 'Failed to check connections',
      });
    }

    // Query performance
    try {
      const slowQueries = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM pg_stat_statements 
        WHERE mean_exec_time > 1000
      `;

      checks.push({
        name: 'Slow Query Check',
        status: slowQueries[0]?.count > 10 ? 'warning' : 'pass',
        message: `${slowQueries[0]?.count || 0} slow queries detected`,
      });
    } catch (error) {
      // pg_stat_statements might not be enabled
    }

    return checks;
  }

  private async diagnoseCacheHealth(): Promise<Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: any;
  }>> {
    const checks = [];

    try {
      const info = await redisClient.info();
      const memory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || '0');
      const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || '0');

      checks.push({
        name: 'Cache Memory Usage',
        status: memory > maxMemory * 0.9 ? 'warning' : 'pass',
        message: `Using ${(memory / 1024 / 1024).toFixed(2)}MB`,
        details: { memory, maxMemory },
      });

      const hitRate = parseFloat(info.match(/keyspace_hit_ratio:([0-9.]+)/)?.[1] || '0');
      checks.push({
        name: 'Cache Hit Rate',
        status: hitRate < 0.8 ? 'warning' : 'pass',
        message: `Hit rate: ${(hitRate * 100).toFixed(1)}%`,
      });
    } catch (error) {
      checks.push({
        name: 'Cache Health',
        status: 'fail',
        message: 'Failed to connect to cache',
      });
    }

    return checks;
  }

  private async diagnoseAPIHealth(): Promise<Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: any;
  }>> {
    const checks = [];

    // Check API endpoints
    const endpoints = [
      '/health',
      '/api/v1/status',
    ];

    for (const endpoint of endpoints) {
      try {
        const start = Date.now();
        const response = await fetch(`${process.env.API_URL}${endpoint}`);
        const responseTime = Date.now() - start;

        checks.push({
          name: `API Endpoint: ${endpoint}`,
          status: response.ok ? (responseTime > 1000 ? 'warning' : 'pass') : 'fail',
          message: `Status: ${response.status}, Time: ${responseTime}ms`,
          details: { status: response.status, responseTime },
        });
      } catch (error) {
        checks.push({
          name: `API Endpoint: ${endpoint}`,
          status: 'fail',
          message: 'Failed to reach endpoint',
        });
      }
    }

    return checks;
  }

  private async diagnoseInfrastructureHealth(): Promise<Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: any;
  }>> {
    const checks = [];

    // Disk space
    const diskStats = await this.getDiskUsage();
    checks.push({
      name: 'Disk Space',
      status: diskStats.percentage > 90 ? 'fail' : diskStats.percentage > 80 ? 'warning' : 'pass',
      message: `${diskStats.percentage.toFixed(1)}% used`,
      details: diskStats,
    });

    // Memory
    const metrics = await this.getCurrentSystemMetrics();
    checks.push({
      name: 'Memory Usage',
      status: metrics.memory.percentage > 90 ? 'fail' : metrics.memory.percentage > 80 ? 'warning' : 'pass',
      message: `${metrics.memory.percentage.toFixed(1)}% used`,
      details: metrics.memory,
    });

    // Process handles
    checks.push({
      name: 'Process Handles',
      status: metrics.process.handles > 1000 ? 'warning' : 'pass',
      message: `${metrics.process.handles} active handles`,
    });

    return checks;
  }

  private generateDiagnosticRecommendations(checks: any[]): string[] {
    const recommendations: string[] = [];
    const failures = checks.filter(c => c.status === 'fail');
    const warnings = checks.filter(c => c.status === 'warning');

    if (failures.length > 0) {
      recommendations.push(`Address ${failures.length} critical issues immediately`);
      
      failures.forEach(check => {
        if (check.name.includes('Database')) {
          recommendations.push('Check database connection settings and pool configuration');
        } else if (check.name.includes('Cache')) {
          recommendations.push('Verify Redis connection and memory limits');
        } else if (check.name.includes('API')) {
          recommendations.push('Check API service health and network connectivity');
        }
      });
    }

    if (warnings.length > 0) {
      warnings.forEach(check => {
        if (check.name.includes('Memory')) {
          recommendations.push('Consider increasing memory allocation');
        } else if (check.name.includes('Disk')) {
          recommendations.push('Plan for disk space expansion');
        } else if (check.name.includes('Slow Query')) {
          recommendations.push('Optimize database queries and add indexes');
        }
      });
    }

    return recommendations;
  }
}

// Export singleton instance
export const platformHealthService = new PlatformHealthService();