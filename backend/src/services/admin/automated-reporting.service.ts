/**
 * Automated Reporting Service
 * Generates and distributes various reports for platform stakeholders
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { storageService } from '../storage/storage.service';
import { analyticsService } from '../analytics/analytics.service';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import * as nodemailer from 'nodemailer';

const prisma = new PrismaClient();

interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  type: 'operational' | 'financial' | 'performance' | 'compliance' | 'custom';
  format: 'pdf' | 'excel' | 'csv' | 'json';
  schedule: ReportSchedule;
  recipients: ReportRecipient[];
  filters: ReportFilter[];
  sections: ReportSection[];
  status: 'active' | 'inactive' | 'draft';
  lastGenerated?: Date;
  nextScheduled?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ReportSchedule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
  time: string; // HH:MM format
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  customCron?: string; // For custom schedules
  timezone: string;
}

interface ReportRecipient {
  id: string;
  type: 'email' | 'webhook' | 'dashboard' | 's3';
  destination: string; // email address, webhook URL, etc.
  role?: string; // Filter by recipient role
  includeAttachment: boolean;
  includeLink: boolean;
}

interface ReportFilter {
  field: string;
  operator: 'equals' | 'contains' | 'between' | 'in' | 'greater_than' | 'less_than';
  value: any;
  dynamic?: boolean; // If true, value is calculated at runtime
}

interface ReportSection {
  id: string;
  title: string;
  type: 'summary' | 'table' | 'chart' | 'text' | 'metric';
  dataSource: string;
  query?: any; // Database query or aggregation
  visualization?: VisualizationConfig;
  order: number;
}

interface VisualizationConfig {
  chartType: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  colors?: string[];
  showLegend: boolean;
  showGrid: boolean;
}

interface GeneratedReport {
  id: string;
  definitionId: string;
  generatedAt: Date;
  generatedBy: string; // 'system' or user ID
  fileUrl?: string;
  fileName: string;
  fileSize: number;
  format: string;
  status: 'generating' | 'completed' | 'failed' | 'delivered';
  error?: string;
  metrics: {
    generationTime: number; // ms
    dataPoints: number;
    recipients: number;
  };
  reskflowStatus: DeliveryStatus[];
}

interface DeliveryStatus {
  recipientId: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: Date;
  error?: string;
}

interface ReportTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  thumbnail?: string;
  sections: ReportSection[];
  defaultFilters: ReportFilter[];
  sampleData?: any;
  popularity: number;
}

interface ReportData {
  metadata: {
    reportName: string;
    generatedAt: Date;
    period: { start: Date; end: Date };
    filters: any;
  };
  sections: Array<{
    title: string;
    data: any;
    summary?: any;
  }>;
}

export class AutomatedReportingService extends EventEmitter {
  private reportDefinitions: Map<string, ReportDefinition> = new Map();
  private scheduledJobs: Map<string, CronJob> = new Map();
  private templates: Map<string, ReportTemplate> = new Map();
  private emailTransporter: nodemailer.Transporter;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private async initializeService() {
    // Setup email transporter
    this.emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Load report definitions
    await this.loadReportDefinitions();

    // Load report templates
    await this.loadReportTemplates();

    // Schedule reports
    await this.scheduleReports();
  }

  /**
   * Create report definition
   */
  async createReportDefinition(
    report: Omit<ReportDefinition, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ReportDefinition> {
    try {
      const definition: ReportDefinition = {
        id: `report_${Date.now()}`,
        ...report,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await prisma.reportDefinition.create({
        data: definition,
      });

      this.reportDefinitions.set(definition.id, definition);

      // Schedule if active
      if (definition.status === 'active') {
        await this.scheduleReport(definition);
      }

      this.emit('report:created', {
        reportId: definition.id,
        name: definition.name,
      });

      return definition;

    } catch (error) {
      logger.error('Failed to create report definition', error);
      throw error;
    }
  }

  /**
   * Generate report manually
   */
  async generateReport(
    reportId: string,
    requestedBy: string,
    customFilters?: ReportFilter[]
  ): Promise<GeneratedReport> {
    try {
      const definition = this.reportDefinitions.get(reportId);
      if (!definition) {
        throw new Error('Report definition not found');
      }

      const startTime = Date.now();

      // Create generated report record
      const generatedReport: GeneratedReport = {
        id: `gen_${Date.now()}`,
        definitionId: reportId,
        generatedAt: new Date(),
        generatedBy: requestedBy,
        fileName: this.generateFileName(definition),
        fileSize: 0,
        format: definition.format,
        status: 'generating',
        metrics: {
          generationTime: 0,
          dataPoints: 0,
          recipients: definition.recipients.length,
        },
        reskflowStatus: definition.recipients.map(r => ({
          recipientId: r.id,
          status: 'pending' as const,
        })),
      };

      await prisma.generatedReport.create({
        data: generatedReport,
      });

      try {
        // Gather report data
        const reportData = await this.gatherReportData(
          definition,
          customFilters || definition.filters
        );

        // Generate report file
        const file = await this.generateReportFile(definition, reportData);

        // Upload to storage
        const fileUrl = await storageService.uploadFile(
          file,
          `reports/${definition.id}/${generatedReport.fileName}`
        );

        // Update report record
        generatedReport.fileUrl = fileUrl;
        generatedReport.fileSize = file.length;
        generatedReport.status = 'completed';
        generatedReport.metrics.generationTime = Date.now() - startTime;
        generatedReport.metrics.dataPoints = this.countDataPoints(reportData);

        await prisma.generatedReport.update({
          where: { id: generatedReport.id },
          data: generatedReport,
        });

        // Deliver report
        await this.deliverReport(generatedReport, definition);

        this.emit('report:generated', {
          reportId: generatedReport.id,
          definitionId: reportId,
        });

        return generatedReport;

      } catch (error) {
        // Update status on error
        generatedReport.status = 'failed';
        generatedReport.error = error.message;

        await prisma.generatedReport.update({
          where: { id: generatedReport.id },
          data: generatedReport,
        });

        throw error;
      }

    } catch (error) {
      logger.error('Failed to generate report', error);
      throw error;
    }
  }

  /**
   * Create report from template
   */
  async createFromTemplate(
    templateId: string,
    customization: {
      name: string;
      recipients: ReportRecipient[];
      schedule: ReportSchedule;
      filters?: ReportFilter[];
    },
    createdBy: string
  ): Promise<ReportDefinition> {
    try {
      const template = this.templates.get(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      const report: Omit<ReportDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
        name: customization.name,
        description: `Based on ${template.name} template`,
        type: 'custom',
        format: 'pdf',
        schedule: customization.schedule,
        recipients: customization.recipients,
        filters: customization.filters || template.defaultFilters,
        sections: template.sections,
        status: 'active',
        createdBy,
      };

      return await this.createReportDefinition(report);

    } catch (error) {
      logger.error('Failed to create report from template', error);
      throw error;
    }
  }

  /**
   * Get report analytics
   */
  async getReportAnalytics(
    reportId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<{
    totalGenerated: number;
    successRate: number;
    averageGenerationTime: number;
    reskflowStats: {
      total: number;
      successful: number;
      failed: number;
    };
    popularSections: Array<{ sectionId: string; views: number }>;
    recipientEngagement: Array<{
      recipientId: string;
      opened: number;
      downloaded: number;
    }>;
  }> {
    try {
      const generatedReports = await prisma.generatedReport.findMany({
        where: {
          definitionId: reportId,
          generatedAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
      });

      const totalGenerated = generatedReports.length;
      const successfulReports = generatedReports.filter(r => r.status === 'completed').length;
      const successRate = totalGenerated > 0 ? (successfulReports / totalGenerated) * 100 : 0;

      const totalGenerationTime = generatedReports.reduce((sum, r) => 
        sum + (r.metrics?.generationTime || 0), 0
      );
      const averageGenerationTime = totalGenerated > 0 ? totalGenerationTime / totalGenerated : 0;

      // Delivery statistics
      let totalDeliveries = 0;
      let successfulDeliveries = 0;
      let failedDeliveries = 0;

      generatedReports.forEach(report => {
        report.reskflowStatus?.forEach(reskflow => {
          totalDeliveries++;
          if (reskflow.status === 'sent') successfulDeliveries++;
          if (reskflow.status === 'failed') failedDeliveries++;
        });
      });

      // Get engagement data (simplified - would track actual opens/downloads)
      const recipientEngagement = await this.getRecipientEngagement(reportId, timeRange);

      return {
        totalGenerated,
        successRate,
        averageGenerationTime,
        reskflowStats: {
          total: totalDeliveries,
          successful: successfulDeliveries,
          failed: failedDeliveries,
        },
        popularSections: [], // Would track section views
        recipientEngagement,
      };

    } catch (error) {
      logger.error('Failed to get report analytics', error);
      throw error;
    }
  }

  /**
   * Get available report templates
   */
  async getReportTemplates(category?: string): Promise<ReportTemplate[]> {
    const templates = Array.from(this.templates.values());
    
    if (category) {
      return templates.filter(t => t.category === category);
    }

    return templates.sort((a, b) => b.popularity - a.popularity);
  }

  /**
   * Preview report
   */
  async previewReport(
    reportId: string,
    sampleSize: number = 10
  ): Promise<{
    metadata: any;
    sampleData: any;
    estimatedSize: number;
    estimatedGenerationTime: number;
  }> {
    try {
      const definition = this.reportDefinitions.get(reportId);
      if (!definition) {
        throw new Error('Report definition not found');
      }

      // Gather sample data
      const sampleFilters = definition.filters.map(f => ({
        ...f,
        // Add limit for preview
      }));

      const sampleData = await this.gatherReportData(definition, sampleFilters, sampleSize);

      // Estimate full report size
      const estimatedSize = this.estimateReportSize(definition, sampleData);
      const estimatedGenerationTime = this.estimateGenerationTime(definition);

      return {
        metadata: {
          name: definition.name,
          format: definition.format,
          sections: definition.sections.length,
          recipients: definition.recipients.length,
        },
        sampleData,
        estimatedSize,
        estimatedGenerationTime,
      };

    } catch (error) {
      logger.error('Failed to preview report', error);
      throw error;
    }
  }

  /**
   * Update report schedule
   */
  async updateReportSchedule(
    reportId: string,
    schedule: ReportSchedule
  ): Promise<void> {
    try {
      const definition = this.reportDefinitions.get(reportId);
      if (!definition) {
        throw new Error('Report definition not found');
      }

      definition.schedule = schedule;
      definition.updatedAt = new Date();

      await prisma.reportDefinition.update({
        where: { id: reportId },
        data: {
          schedule,
          updatedAt: definition.updatedAt,
        },
      });

      // Reschedule job
      await this.rescheduleReport(definition);

      this.emit('report:schedule_updated', {
        reportId,
        schedule,
      });

    } catch (error) {
      logger.error('Failed to update report schedule', error);
      throw error;
    }
  }

  /**
   * Add report recipient
   */
  async addRecipient(
    reportId: string,
    recipient: ReportRecipient
  ): Promise<void> {
    try {
      const definition = this.reportDefinitions.get(reportId);
      if (!definition) {
        throw new Error('Report definition not found');
      }

      recipient.id = `recipient_${Date.now()}`;
      definition.recipients.push(recipient);

      await prisma.reportDefinition.update({
        where: { id: reportId },
        data: {
          recipients: definition.recipients,
          updatedAt: new Date(),
        },
      });

      this.emit('report:recipient_added', {
        reportId,
        recipientId: recipient.id,
      });

    } catch (error) {
      logger.error('Failed to add recipient', error);
      throw error;
    }
  }

  /**
   * Get report history
   */
  async getReportHistory(
    reportId: string,
    limit: number = 10
  ): Promise<GeneratedReport[]> {
    const reports = await prisma.generatedReport.findMany({
      where: { definitionId: reportId },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    });

    return reports;
  }

  /**
   * Private helper methods
   */

  private async loadReportDefinitions(): Promise<void> {
    // Load active report definitions
    const definitions = await prisma.reportDefinition.findMany({
      where: { status: 'active' },
    });

    definitions.forEach(def => {
      this.reportDefinitions.set(def.id, def);
    });

    // Create default reports if none exist
    if (definitions.length === 0) {
      await this.createDefaultReports();
    }
  }

  private async loadReportTemplates(): Promise<void> {
    // Load report templates
    this.templates.set('daily_operations', {
      id: 'daily_operations',
      name: 'Daily Operations Report',
      category: 'operational',
      description: 'Comprehensive daily operations summary',
      sections: [
        {
          id: 'summary',
          title: 'Executive Summary',
          type: 'summary',
          dataSource: 'orders',
          order: 1,
        },
        {
          id: 'orders',
          title: 'Order Statistics',
          type: 'table',
          dataSource: 'orders',
          order: 2,
        },
        {
          id: 'revenue',
          title: 'Revenue Analysis',
          type: 'chart',
          dataSource: 'transactions',
          visualization: {
            chartType: 'line',
            xAxis: 'date',
            yAxis: 'revenue',
            showLegend: true,
            showGrid: true,
          },
          order: 3,
        },
      ],
      defaultFilters: [
        {
          field: 'date',
          operator: 'between',
          value: null,
          dynamic: true,
        },
      ],
      popularity: 95,
    });

    this.templates.set('financial_summary', {
      id: 'financial_summary',
      name: 'Financial Summary Report',
      category: 'financial',
      description: 'Financial performance and metrics',
      sections: [
        {
          id: 'revenue',
          title: 'Revenue Overview',
          type: 'metric',
          dataSource: 'transactions',
          order: 1,
        },
        {
          id: 'expenses',
          title: 'Expense Breakdown',
          type: 'chart',
          dataSource: 'expenses',
          visualization: {
            chartType: 'pie',
            showLegend: true,
            showGrid: false,
          },
          order: 2,
        },
        {
          id: 'profit',
          title: 'Profit Analysis',
          type: 'table',
          dataSource: 'financial',
          order: 3,
        },
      ],
      defaultFilters: [],
      popularity: 90,
    });

    this.templates.set('merchant_performance', {
      id: 'merchant_performance',
      name: 'Merchant Performance Report',
      category: 'performance',
      description: 'Merchant metrics and rankings',
      sections: [
        {
          id: 'top_merchants',
          title: 'Top Performing Merchants',
          type: 'table',
          dataSource: 'merchants',
          order: 1,
        },
        {
          id: 'merchant_growth',
          title: 'Growth Trends',
          type: 'chart',
          dataSource: 'merchants',
          visualization: {
            chartType: 'bar',
            xAxis: 'merchant',
            yAxis: 'growth',
            showLegend: false,
            showGrid: true,
          },
          order: 2,
        },
      ],
      defaultFilters: [],
      popularity: 85,
    });
  }

  private async createDefaultReports(): Promise<void> {
    // Daily Operations Report
    await this.createReportDefinition({
      name: 'Daily Operations Summary',
      description: 'Automated daily summary of platform operations',
      type: 'operational',
      format: 'pdf',
      schedule: {
        frequency: 'daily',
        time: '06:00',
        timezone: 'UTC',
      },
      recipients: [
        {
          id: 'admin_email',
          type: 'email',
          destination: process.env.ADMIN_EMAIL!,
          includeAttachment: true,
          includeLink: true,
        },
      ],
      filters: [
        {
          field: 'date',
          operator: 'equals',
          value: 'yesterday',
          dynamic: true,
        },
      ],
      sections: [
        {
          id: 'summary',
          title: 'Executive Summary',
          type: 'summary',
          dataSource: 'multiple',
          order: 1,
        },
        {
          id: 'metrics',
          title: 'Key Metrics',
          type: 'metric',
          dataSource: 'analytics',
          order: 2,
        },
      ],
      status: 'active',
      createdBy: 'system',
    });

    // Weekly Financial Report
    await this.createReportDefinition({
      name: 'Weekly Financial Report',
      description: 'Weekly financial performance summary',
      type: 'financial',
      format: 'excel',
      schedule: {
        frequency: 'weekly',
        time: '09:00',
        dayOfWeek: 1, // Monday
        timezone: 'UTC',
      },
      recipients: [
        {
          id: 'finance_webhook',
          type: 'webhook',
          destination: process.env.FINANCE_WEBHOOK_URL!,
          includeAttachment: false,
          includeLink: true,
        },
      ],
      filters: [
        {
          field: 'date',
          operator: 'between',
          value: 'last_week',
          dynamic: true,
        },
      ],
      sections: [
        {
          id: 'revenue',
          title: 'Revenue Analysis',
          type: 'table',
          dataSource: 'transactions',
          order: 1,
        },
        {
          id: 'expenses',
          title: 'Expense Report',
          type: 'table',
          dataSource: 'expenses',
          order: 2,
        },
      ],
      status: 'active',
      createdBy: 'system',
    });
  }

  private async scheduleReports(): Promise<void> {
    for (const [reportId, definition] of this.reportDefinitions) {
      if (definition.status === 'active') {
        await this.scheduleReport(definition);
      }
    }
  }

  private async scheduleReport(definition: ReportDefinition): Promise<void> {
    // Cancel existing job
    const existingJob = this.scheduledJobs.get(definition.id);
    if (existingJob) {
      existingJob.stop();
    }

    // Create cron pattern
    const cronPattern = this.getCronPattern(definition.schedule);

    // Create new job
    const job = new CronJob(cronPattern, async () => {
      try {
        await this.generateReport(definition.id, 'system');
      } catch (error) {
        logger.error(`Failed to generate scheduled report ${definition.id}`, error);
      }
    }, null, true, definition.schedule.timezone);

    this.scheduledJobs.set(definition.id, job);

    // Calculate next scheduled time
    definition.nextScheduled = job.nextDates(1)[0].toDate();

    await prisma.reportDefinition.update({
      where: { id: definition.id },
      data: { nextScheduled: definition.nextScheduled },
    });
  }

  private async rescheduleReport(definition: ReportDefinition): Promise<void> {
    const existingJob = this.scheduledJobs.get(definition.id);
    if (existingJob) {
      existingJob.stop();
      this.scheduledJobs.delete(definition.id);
    }

    if (definition.status === 'active') {
      await this.scheduleReport(definition);
    }
  }

  private getCronPattern(schedule: ReportSchedule): string {
    const [hour, minute] = schedule.time.split(':');

    switch (schedule.frequency) {
      case 'daily':
        return `${minute} ${hour} * * *`;
      
      case 'weekly':
        return `${minute} ${hour} * * ${schedule.dayOfWeek || 0}`;
      
      case 'monthly':
        return `${minute} ${hour} ${schedule.dayOfMonth || 1} * *`;
      
      case 'quarterly':
        // First day of each quarter
        return `${minute} ${hour} 1 */3 *`;
      
      case 'yearly':
        return `${minute} ${hour} 1 1 *`;
      
      case 'custom':
        return schedule.customCron || '0 0 * * *';
      
      default:
        return '0 0 * * *';
    }
  }

  private async gatherReportData(
    definition: ReportDefinition,
    filters: ReportFilter[],
    limit?: number
  ): Promise<ReportData> {
    const reportData: ReportData = {
      metadata: {
        reportName: definition.name,
        generatedAt: new Date(),
        period: this.getReportPeriod(filters),
        filters: this.processFilters(filters),
      },
      sections: [],
    };

    // Process each section
    for (const section of definition.sections) {
      const sectionData = await this.getSectionData(section, filters, limit);
      
      reportData.sections.push({
        title: section.title,
        data: sectionData.data,
        summary: sectionData.summary,
      });
    }

    return reportData;
  }

  private getReportPeriod(filters: ReportFilter[]): { start: Date; end: Date } {
    const dateFilter = filters.find(f => f.field === 'date');
    
    if (dateFilter) {
      if (dateFilter.dynamic) {
        return this.getDynamicDateRange(dateFilter.value);
      }
      
      if (dateFilter.operator === 'between' && Array.isArray(dateFilter.value)) {
        return {
          start: new Date(dateFilter.value[0]),
          end: new Date(dateFilter.value[1]),
        };
      }
    }

    // Default to last 7 days
    return {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      end: new Date(),
    };
  }

  private getDynamicDateRange(value: string): { start: Date; end: Date } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (value) {
      case 'today':
        return { start: today, end: now };
      
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { start: yesterday, end: today };
      
      case 'last_week':
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - (today.getDay() || 7));
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekStart.getDate() - 6);
        return { start: lastWeekStart, end: lastWeekEnd };
      
      case 'last_month':
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return { start: lastMonthStart, end: lastMonthEnd };
      
      default:
        return { start: today, end: now };
    }
  }

  private processFilters(filters: ReportFilter[]): any {
    const processed: any = {};

    filters.forEach(filter => {
      if (filter.dynamic) {
        processed[filter.field] = this.processDynamicFilter(filter);
      } else {
        processed[filter.field] = filter.value;
      }
    });

    return processed;
  }

  private processDynamicFilter(filter: ReportFilter): any {
    if (filter.field === 'date') {
      return this.getDynamicDateRange(filter.value);
    }

    return filter.value;
  }

  private async getSectionData(
    section: ReportSection,
    filters: ReportFilter[],
    limit?: number
  ): Promise<{ data: any; summary?: any }> {
    switch (section.dataSource) {
      case 'orders':
        return await this.getOrderData(section, filters, limit);
      
      case 'transactions':
        return await this.getTransactionData(section, filters, limit);
      
      case 'merchants':
        return await this.getMerchantData(section, filters, limit);
      
      case 'customers':
        return await this.getCustomerData(section, filters, limit);
      
      case 'analytics':
        return await this.getAnalyticsData(section, filters);
      
      default:
        return { data: [], summary: null };
    }
  }

  private async getOrderData(
    section: ReportSection,
    filters: ReportFilter[],
    limit?: number
  ): Promise<{ data: any; summary?: any }> {
    const period = this.getReportPeriod(filters);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: period.start,
          lte: period.end,
        },
      },
      include: {
        customer: true,
        merchant: true,
        driver: true,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const summary = {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, order) => sum + order.total, 0),
      averageOrderValue: orders.length > 0 ? 
        orders.reduce((sum, order) => sum + order.total, 0) / orders.length : 0,
      completedOrders: orders.filter(o => o.status === 'delivered').length,
    };

    if (section.type === 'summary') {
      return { data: summary, summary };
    }

    if (section.type === 'table') {
      return {
        data: orders.map(order => ({
          orderNumber: order.orderNumber,
          customer: order.customer.name,
          merchant: order.merchant.name,
          driver: order.driver?.user?.name || 'Unassigned',
          total: order.total,
          status: order.status,
          createdAt: order.createdAt,
        })),
        summary,
      };
    }

    if (section.type === 'chart' && section.visualization) {
      // Group by date for chart
      const dailyData = new Map<string, { date: string; orders: number; revenue: number }>();

      orders.forEach(order => {
        const dateKey = order.createdAt.toISOString().split('T')[0];
        const existing = dailyData.get(dateKey) || { date: dateKey, orders: 0, revenue: 0 };
        existing.orders += 1;
        existing.revenue += order.total;
        dailyData.set(dateKey, existing);
      });

      return {
        data: Array.from(dailyData.values()),
        summary,
      };
    }

    return { data: orders, summary };
  }

  private async getTransactionData(
    section: ReportSection,
    filters: ReportFilter[],
    limit?: number
  ): Promise<{ data: any; summary?: any }> {
    const period = this.getReportPeriod(filters);

    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: period.start,
          lte: period.end,
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const summary = {
      totalTransactions: transactions.length,
      totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
      successfulTransactions: transactions.filter(t => t.status === 'completed').length,
      failedTransactions: transactions.filter(t => t.status === 'failed').length,
    };

    return { data: transactions, summary };
  }

  private async getMerchantData(
    section: ReportSection,
    filters: ReportFilter[],
    limit?: number
  ): Promise<{ data: any; summary?: any }> {
    const period = this.getReportPeriod(filters);

    // Get merchant performance data
    const merchants = await prisma.merchant.findMany({
      where: { isActive: true },
      include: {
        orders: {
          where: {
            createdAt: {
              gte: period.start,
              lte: period.end,
            },
          },
        },
      },
      take: limit,
    });

    const merchantData = merchants.map(merchant => ({
      id: merchant.id,
      name: merchant.name,
      orders: merchant.orders.length,
      revenue: merchant.orders.reduce((sum, order) => sum + order.total, 0),
      averageOrderValue: merchant.orders.length > 0 ?
        merchant.orders.reduce((sum, order) => sum + order.total, 0) / merchant.orders.length : 0,
      rating: merchant.rating,
    }));

    // Sort by revenue
    merchantData.sort((a, b) => b.revenue - a.revenue);

    const summary = {
      totalMerchants: merchants.length,
      activeMerchants: merchants.filter(m => m.orders.length > 0).length,
      totalRevenue: merchantData.reduce((sum, m) => sum + m.revenue, 0),
    };

    return { data: merchantData, summary };
  }

  private async getCustomerData(
    section: ReportSection,
    filters: ReportFilter[],
    limit?: number
  ): Promise<{ data: any; summary?: any }> {
    const period = this.getReportPeriod(filters);

    const customers = await prisma.customer.findMany({
      include: {
        orders: {
          where: {
            createdAt: {
              gte: period.start,
              lte: period.end,
            },
          },
        },
      },
      take: limit,
    });

    const customerData = customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      orders: customer.orders.length,
      totalSpent: customer.orders.reduce((sum, order) => sum + order.total, 0),
      joinedAt: customer.createdAt,
    }));

    const summary = {
      totalCustomers: customers.length,
      activeCustomers: customers.filter(c => c.orders.length > 0).length,
      newCustomers: customers.filter(c => c.createdAt >= period.start).length,
    };

    return { data: customerData, summary };
  }

  private async getAnalyticsData(
    section: ReportSection,
    filters: ReportFilter[]
  ): Promise<{ data: any; summary?: any }> {
    const period = this.getReportPeriod(filters);

    // Get key metrics
    const metrics = await analyticsService.getKeyMetrics(period);

    return { data: metrics, summary: metrics };
  }

  private async generateReportFile(
    definition: ReportDefinition,
    data: ReportData
  ): Promise<Buffer> {
    switch (definition.format) {
      case 'pdf':
        return await this.generatePDF(definition, data);
      
      case 'excel':
        return await this.generateExcel(definition, data);
      
      case 'csv':
        return await this.generateCSV(definition, data);
      
      case 'json':
        return Buffer.from(JSON.stringify(data, null, 2));
      
      default:
        throw new Error(`Unsupported format: ${definition.format}`);
    }
  }

  private async generatePDF(
    definition: ReportDefinition,
    data: ReportData
  ): Promise<Buffer> {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    // Header
    doc.fontSize(20).text(data.metadata.reportName, { align: 'center' });
    doc.fontSize(12).text(`Generated: ${data.metadata.generatedAt.toLocaleString()}`, { align: 'center' });
    doc.moveDown();

    // Sections
    for (const section of data.sections) {
      doc.fontSize(16).text(section.title);
      doc.moveDown();

      if (section.summary) {
        // Summary metrics
        Object.entries(section.summary).forEach(([key, value]) => {
          doc.fontSize(10).text(`${this.formatKey(key)}: ${this.formatValue(value)}`);
        });
        doc.moveDown();
      }

      if (Array.isArray(section.data) && section.data.length > 0) {
        // Table data
        this.addPDFTable(doc, section.data);
      }

      doc.moveDown();
    }

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
  }

  private async generateExcel(
    definition: ReportDefinition,
    data: ReportData
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ReskFlow Platform';
    workbook.created = new Date();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow([data.metadata.reportName]);
    summarySheet.addRow([`Generated: ${data.metadata.generatedAt.toLocaleString()}`]);
    summarySheet.addRow([]);

    // Add sections as separate sheets
    for (const section of data.sections) {
      const sheet = workbook.addWorksheet(section.title);

      if (section.summary) {
        // Add summary
        Object.entries(section.summary).forEach(([key, value]) => {
          sheet.addRow([this.formatKey(key), value]);
        });
        sheet.addRow([]);
      }

      if (Array.isArray(section.data) && section.data.length > 0) {
        // Add headers
        const headers = Object.keys(section.data[0]);
        sheet.addRow(headers.map(h => this.formatKey(h)));

        // Add data
        section.data.forEach(row => {
          sheet.addRow(headers.map(h => row[h]));
        });

        // Auto-fit columns
        sheet.columns.forEach(column => {
          column.width = 15;
        });
      }
    }

    return await workbook.xlsx.writeBuffer() as Buffer;
  }

  private async generateCSV(
    definition: ReportDefinition,
    data: ReportData
  ): Promise<Buffer> {
    let csv = '';

    // Add metadata
    csv += `${data.metadata.reportName}\n`;
    csv += `Generated: ${data.metadata.generatedAt.toISOString()}\n\n`;

    // Add sections
    for (const section of data.sections) {
      csv += `${section.title}\n`;

      if (Array.isArray(section.data) && section.data.length > 0) {
        // Headers
        const headers = Object.keys(section.data[0]);
        csv += headers.join(',') + '\n';

        // Data
        section.data.forEach(row => {
          csv += headers.map(h => this.escapeCSV(row[h])).join(',') + '\n';
        });
      }

      csv += '\n';
    }

    return Buffer.from(csv);
  }

  private addPDFTable(doc: PDFKit.PDFDocument, data: any[]): void {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const columnWidth = 500 / headers.length;

    // Headers
    let x = doc.x;
    headers.forEach(header => {
      doc.fontSize(10).text(this.formatKey(header), x, doc.y, { width: columnWidth });
      x += columnWidth;
    });
    doc.moveDown();

    // Data rows (limited for PDF)
    data.slice(0, 20).forEach(row => {
      x = doc.x;
      headers.forEach(header => {
        doc.fontSize(8).text(String(row[header] || ''), x, doc.y, { width: columnWidth });
        x += columnWidth;
      });
      doc.moveDown(0.5);
    });

    if (data.length > 20) {
      doc.fontSize(8).text(`... and ${data.length - 20} more rows`);
    }
  }

  private formatKey(key: string): string {
    return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private formatValue(value: any): string {
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    if (value instanceof Date) {
      return value.toLocaleDateString();
    }
    return String(value);
  }

  private escapeCSV(value: any): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private generateFileName(definition: ReportDefinition): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = definition.name.replace(/[^a-zA-Z0-9]/g, '_');
    return `${safeName}_${timestamp}.${definition.format}`;
  }

  private countDataPoints(data: ReportData): number {
    let count = 0;
    
    data.sections.forEach(section => {
      if (Array.isArray(section.data)) {
        count += section.data.length;
      } else if (typeof section.data === 'object') {
        count += Object.keys(section.data).length;
      }
    });

    return count;
  }

  private async deliverReport(
    generatedReport: GeneratedReport,
    definition: ReportDefinition
  ): Promise<void> {
    for (const recipient of definition.recipients) {
      try {
        switch (recipient.type) {
          case 'email':
            await this.deliverViaEmail(generatedReport, recipient);
            break;
          
          case 'webhook':
            await this.deliverViaWebhook(generatedReport, recipient);
            break;
          
          case 'dashboard':
            await this.deliverViaDashboard(generatedReport, recipient);
            break;
          
          case 's3':
            await this.deliverViaS3(generatedReport, recipient);
            break;
        }

        // Update reskflow status
        const reskflowStatus = generatedReport.reskflowStatus.find(
          d => d.recipientId === recipient.id
        );
        if (reskflowStatus) {
          reskflowStatus.status = 'sent';
          reskflowStatus.sentAt = new Date();
        }

      } catch (error) {
        logger.error(`Failed to deliver report to recipient ${recipient.id}`, error);
        
        const reskflowStatus = generatedReport.reskflowStatus.find(
          d => d.recipientId === recipient.id
        );
        if (reskflowStatus) {
          reskflowStatus.status = 'failed';
          reskflowStatus.error = error.message;
        }
      }
    }

    // Update reskflow status in database
    await prisma.generatedReport.update({
      where: { id: generatedReport.id },
      data: {
        status: 'delivered',
        reskflowStatus: generatedReport.reskflowStatus,
      },
    });
  }

  private async deliverViaEmail(
    report: GeneratedReport,
    recipient: ReportRecipient
  ): Promise<void> {
    const definition = this.reportDefinitions.get(report.definitionId);
    if (!definition) return;

    const attachments = [];
    
    if (recipient.includeAttachment && report.fileUrl) {
      // Download file for attachment
      const fileBuffer = await storageService.downloadFile(report.fileUrl);
      attachments.push({
        filename: report.fileName,
        content: fileBuffer,
      });
    }

    const emailContent = {
      from: process.env.REPORT_EMAIL_FROM,
      to: recipient.destination,
      subject: `${definition.name} - ${new Date().toLocaleDateString()}`,
      html: this.generateEmailHTML(definition, report, recipient.includeLink),
      attachments,
    };

    await this.emailTransporter.sendMail(emailContent);
  }

  private async deliverViaWebhook(
    report: GeneratedReport,
    recipient: ReportRecipient
  ): Promise<void> {
    const definition = this.reportDefinitions.get(report.definitionId);
    if (!definition) return;

    const payload = {
      reportId: report.id,
      definitionId: report.definitionId,
      reportName: definition.name,
      generatedAt: report.generatedAt,
      fileUrl: recipient.includeLink ? report.fileUrl : undefined,
      metrics: report.metrics,
    };

    await axios.post(recipient.destination, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Report-ID': report.id,
      },
    });
  }

  private async deliverViaDashboard(
    report: GeneratedReport,
    recipient: ReportRecipient
  ): Promise<void> {
    // Send notification to dashboard
    await notificationService.sendWebSocketEvent(
      recipient.destination,
      'report_ready',
      {
        reportId: report.id,
        fileUrl: report.fileUrl,
        generatedAt: report.generatedAt,
      }
    );
  }

  private async deliverViaS3(
    report: GeneratedReport,
    recipient: ReportRecipient
  ): Promise<void> {
    // Copy to S3 destination
    // Implementation depends on S3 configuration
  }

  private generateEmailHTML(
    definition: ReportDefinition,
    report: GeneratedReport,
    includeLink: boolean
  ): string {
    return `
      <h2>${definition.name}</h2>
      <p>Your report has been generated successfully.</p>
      <ul>
        <li>Generated at: ${report.generatedAt.toLocaleString()}</li>
        <li>Report size: ${(report.fileSize / 1024).toFixed(2)} KB</li>
        <li>Data points: ${report.metrics.dataPoints}</li>
      </ul>
      ${includeLink ? `<p><a href="${report.fileUrl}">Download Report</a></p>` : ''}
      <hr>
      <p style="font-size: 12px; color: #666;">
        This is an automated report from ReskFlow Platform.
      </p>
    `;
  }

  private async getRecipientEngagement(
    reportId: string,
    timeRange: { start: Date; end: Date }
  ): Promise<Array<{ recipientId: string; opened: number; downloaded: number }>> {
    // This would track actual engagement metrics
    // For now, return simulated data
    const definition = this.reportDefinitions.get(reportId);
    if (!definition) return [];

    return definition.recipients.map(recipient => ({
      recipientId: recipient.id,
      opened: Math.floor(Math.random() * 10),
      downloaded: Math.floor(Math.random() * 5),
    }));
  }

  private estimateReportSize(definition: ReportDefinition, sampleData: any): number {
    // Estimate based on format and data
    const dataSize = JSON.stringify(sampleData).length;
    const multiplier = {
      pdf: 2.5,
      excel: 1.8,
      csv: 1.2,
      json: 1.1,
    };

    return Math.round(dataSize * (multiplier[definition.format] || 1.5));
  }

  private estimateGenerationTime(definition: ReportDefinition): number {
    // Estimate based on sections and data sources
    const baseTime = 1000; // 1 second base
    const sectionTime = definition.sections.length * 500;
    const complexityMultiplier = definition.format === 'pdf' ? 2 : 1;

    return (baseTime + sectionTime) * complexityMultiplier;
  }
}

// Export singleton instance
export const automatedReportingService = new AutomatedReportingService();