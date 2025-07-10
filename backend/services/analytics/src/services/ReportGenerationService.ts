import Bull from 'bull';
import { prisma, logger, redis } from '@reskflow/shared';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import PDFDocument from 'pdfkit';
import { createObjectCsvWriter } from 'csv-writer';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface ReportJob {
  reportId: string;
  merchantId: string;
  type: string;
  period: string;
  format: 'pdf' | 'csv' | 'excel';
  requestedBy: string;
  parameters?: any;
}

interface ReportStatus {
  reportId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  downloadUrl?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export class ReportGenerationService {
  private reportQueue: Bull.Queue;
  private chartRenderer: ChartJSNodeCanvas;
  private reportsPath = './reports';

  constructor(reportQueue: Bull.Queue) {
    this.reportQueue = reportQueue;
    this.chartRenderer = new ChartJSNodeCanvas({
      width: 800,
      height: 400,
      backgroundColour: 'white',
    });
    this.ensureReportsDirectory();
  }

  async generateReport(params: {
    merchantId: string;
    type: string;
    period: string;
    format: string;
    requestedBy: string;
    parameters?: any;
  }): Promise<string> {
    const reportId = uuidv4();
    
    // Create report record
    await prisma.report.create({
      data: {
        id: reportId,
        merchant_id: params.merchantId,
        type: params.type,
        period: params.period,
        format: params.format,
        status: 'pending',
        requested_by: params.requestedBy,
        parameters: params.parameters || {},
        created_at: new Date(),
      },
    });

    // Queue report generation
    await this.reportQueue.add('generate-report', {
      reportId,
      ...params,
    });

    return reportId;
  }

  async processReportJob(job: ReportJob) {
    logger.info(`Processing report: ${job.reportId}`);

    try {
      // Update status
      await this.updateReportStatus(job.reportId, 'processing', 0);

      let filePath: string;

      switch (job.type) {
        case 'revenue_summary':
          filePath = await this.generateRevenueReport(job);
          break;
        case 'performance_analysis':
          filePath = await this.generatePerformanceReport(job);
          break;
        case 'customer_insights':
          filePath = await this.generateCustomerReport(job);
          break;
        case 'weekly_summary':
          filePath = await this.generateWeeklySummary(job);
          break;
        case 'monthly_statement':
          filePath = await this.generateMonthlyStatement(job);
          break;
        case 'item_performance':
          filePath = await this.generateItemPerformanceReport(job);
          break;
        default:
          throw new Error(`Unknown report type: ${job.type}`);
      }

      // Update report record
      await prisma.report.update({
        where: { id: job.reportId },
        data: {
          status: 'completed',
          file_path: filePath,
          completed_at: new Date(),
        },
      });

      await this.updateReportStatus(job.reportId, 'completed', 100, filePath);

    } catch (error) {
      logger.error(`Report generation failed: ${job.reportId}`, error);
      
      await prisma.report.update({
        where: { id: job.reportId },
        data: {
          status: 'failed',
          error: (error as Error).message,
        },
      });

      await this.updateReportStatus(
        job.reportId,
        'failed',
        0,
        undefined,
        (error as Error).message
      );

      throw error;
    }
  }

  async getReportStatus(reportId: string): Promise<ReportStatus> {
    const cached = await redis.get(`report:${reportId}:status`);
    if (cached) {
      return JSON.parse(cached);
    }

    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error('Report not found');
    }

    const status: ReportStatus = {
      reportId,
      status: report.status as any,
      progress: report.status === 'completed' ? 100 : 0,
      downloadUrl: report.file_path 
        ? `/api/reports/${reportId}/download` 
        : undefined,
      error: report.error || undefined,
      createdAt: report.created_at,
      completedAt: report.completed_at || undefined,
    };

    return status;
  }

  async downloadReport(reportId: string, userId: string) {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error('Report not found');
    }

    // Verify access
    if (report.requested_by !== userId && report.requested_by !== 'system') {
      // Check if user has access to merchant
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (user?.role !== 'ADMIN' && user?.merchant_id !== report.merchant_id) {
        throw new Error('Unauthorized');
      }
    }

    if (!report.file_path || !fs.existsSync(report.file_path)) {
      throw new Error('Report file not found');
    }

    const stream = fs.createReadStream(report.file_path);
    const contentType = this.getContentType(report.format);
    const filename = `${report.type}_${report.period}_${dayjs().format('YYYYMMDD')}.${report.format}`;

    return { stream, contentType, filename };
  }

  private async generateRevenueReport(job: ReportJob): Promise<string> {
    const { merchantId, period, format } = job;

    // Get revenue data
    const revenueData = await this.getRevenueData(merchantId, period);

    if (format === 'pdf') {
      return this.generateRevenuePDF(job, revenueData);
    } else if (format === 'csv') {
      return this.generateRevenueCSV(job, revenueData);
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  private async generateRevenuePDF(job: ReportJob, data: any): Promise<string> {
    const filePath = path.join(this.reportsPath, `${job.reportId}.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);
    
    doc.pipe(stream);

    // Header
    doc.fontSize(24).text('Revenue Report', 50, 50);
    doc.fontSize(12).text(`Period: ${job.period}`, 50, 90);
    doc.fontSize(12).text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`, 50, 110);

    // Summary
    doc.moveDown(2);
    doc.fontSize(16).text('Summary', 50, doc.y);
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Total Revenue: $${data.totalRevenue.toFixed(2)}`);
    doc.text(`Total Orders: ${data.totalOrders}`);
    doc.text(`Average Order Value: $${data.averageOrderValue.toFixed(2)}`);
    doc.text(`Growth Rate: ${data.growthRate.toFixed(1)}%`);

    // Revenue chart
    doc.moveDown(2);
    const chartBuffer = await this.generateRevenueChart(data.dailyRevenue);
    doc.image(chartBuffer, 50, doc.y, { width: 500 });

    // Daily breakdown table
    doc.addPage();
    doc.fontSize(16).text('Daily Breakdown', 50, 50);
    doc.moveDown();
    
    // Table headers
    doc.fontSize(10);
    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 150;
    const col3 = 250;
    const col4 = 350;
    const col5 = 450;

    doc.text('Date', col1, tableTop);
    doc.text('Orders', col2, tableTop);
    doc.text('Revenue', col3, tableTop);
    doc.text('Avg Order', col4, tableTop);
    doc.text('Growth', col5, tableTop);

    // Table rows
    let y = tableTop + 20;
    data.dailyRevenue.forEach((day: any) => {
      doc.text(dayjs(day.date).format('MMM DD'), col1, y);
      doc.text(day.orders.toString(), col2, y);
      doc.text(`$${day.revenue.toFixed(2)}`, col3, y);
      doc.text(`$${day.avgOrderValue.toFixed(2)}`, col4, y);
      doc.text(`${day.growth.toFixed(1)}%`, col5, y);
      y += 20;
    });

    doc.end();

    return new Promise((resolve) => {
      stream.on('finish', () => resolve(filePath));
    });
  }

  private async generateRevenueCSV(job: ReportJob, data: any): Promise<string> {
    const filePath = path.join(this.reportsPath, `${job.reportId}.csv`);
    
    const csvWriter = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'date', title: 'Date' },
        { id: 'orders', title: 'Orders' },
        { id: 'revenue', title: 'Revenue' },
        { id: 'avgOrderValue', title: 'Average Order Value' },
        { id: 'growth', title: 'Growth %' },
      ],
    });

    const records = data.dailyRevenue.map((day: any) => ({
      date: dayjs(day.date).format('YYYY-MM-DD'),
      orders: day.orders,
      revenue: day.revenue.toFixed(2),
      avgOrderValue: day.avgOrderValue.toFixed(2),
      growth: day.growth.toFixed(1),
    }));

    await csvWriter.writeRecords(records);
    return filePath;
  }

  private async generateRevenueChart(dailyData: any[]): Promise<Buffer> {
    const configuration = {
      type: 'line' as const,
      data: {
        labels: dailyData.map(d => dayjs(d.date).format('MMM DD')),
        datasets: [{
          label: 'Revenue',
          data: dailyData.map(d => d.revenue),
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          tension: 0.1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'top' as const,
          },
          title: {
            display: true,
            text: 'Daily Revenue Trend',
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value: any) {
                return '$' + value;
              },
            },
          },
        },
      },
    };

    return await this.chartRenderer.renderToBuffer(configuration);
  }

  private async generatePerformanceReport(job: ReportJob): Promise<string> {
    // Similar implementation for performance reports
    const filePath = path.join(this.reportsPath, `${job.reportId}.${job.format}`);
    
    // Implementation details...
    
    return filePath;
  }

  private async generateCustomerReport(job: ReportJob): Promise<string> {
    // Similar implementation for customer reports
    const filePath = path.join(this.reportsPath, `${job.reportId}.${job.format}`);
    
    // Implementation details...
    
    return filePath;
  }

  private async generateWeeklySummary(job: ReportJob): Promise<string> {
    const { merchantId, format } = job;
    const filePath = path.join(this.reportsPath, `${job.reportId}.pdf`);
    
    // Get merchant details
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // Get weekly data
    const weekStart = dayjs().startOf('week');
    const weekEnd = dayjs().endOf('week');
    
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(24).text(`Weekly Summary - ${merchant.name}`, 50, 50);
    doc.fontSize(12).text(`Week of ${weekStart.format('MMM DD')} - ${weekEnd.format('MMM DD, YYYY')}`, 50, 90);

    // Key metrics
    doc.moveDown(2);
    doc.fontSize(16).text('Key Metrics', 50, doc.y);
    
    // Implementation continues...

    doc.end();

    return new Promise((resolve) => {
      stream.on('finish', () => resolve(filePath));
    });
  }

  private async generateMonthlyStatement(job: ReportJob): Promise<string> {
    // Similar implementation for monthly statements
    const filePath = path.join(this.reportsPath, `${job.reportId}.${job.format}`);
    
    // Implementation details...
    
    return filePath;
  }

  private async generateItemPerformanceReport(job: ReportJob): Promise<string> {
    // Similar implementation for item performance reports
    const filePath = path.join(this.reportsPath, `${job.reportId}.${job.format}`);
    
    // Implementation details...
    
    return filePath;
  }

  private async getRevenueData(merchantId: string, period: string) {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').startOf('day');
    const endDate = dayjs().endOf('day');

    // Get daily revenue data
    const dailyRevenue = [];
    let current = startDate;
    let previousRevenue = 0;

    while (current.isBefore(endDate)) {
      const dayStart = current.toDate();
      const dayEnd = current.endOf('day').toDate();

      const result = await prisma.order.aggregate({
        where: {
          merchant_id: merchantId,
          status: 'delivered',
          delivered_at: {
            gte: dayStart,
            lte: dayEnd,
          },
        },
        _sum: { total: true },
        _count: true,
      });

      const revenue = result._sum.total || 0;
      const orders = result._count;
      const avgOrderValue = orders > 0 ? revenue / orders : 0;
      const growth = previousRevenue > 0 
        ? ((revenue - previousRevenue) / previousRevenue) * 100 
        : 0;

      dailyRevenue.push({
        date: current.toDate(),
        revenue,
        orders,
        avgOrderValue,
        growth,
      });

      previousRevenue = revenue;
      current = current.add(1, 'day');
    }

    // Calculate totals
    const totalRevenue = dailyRevenue.reduce((sum, day) => sum + day.revenue, 0);
    const totalOrders = dailyRevenue.reduce((sum, day) => sum + day.orders, 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    // Calculate growth rate
    const firstDayRevenue = dailyRevenue[0]?.revenue || 0;
    const lastDayRevenue = dailyRevenue[dailyRevenue.length - 1]?.revenue || 0;
    const growthRate = firstDayRevenue > 0 
      ? ((lastDayRevenue - firstDayRevenue) / firstDayRevenue) * 100 
      : 0;

    return {
      totalRevenue,
      totalOrders,
      averageOrderValue,
      growthRate,
      dailyRevenue,
    };
  }

  private async updateReportStatus(
    reportId: string,
    status: string,
    progress: number,
    filePath?: string,
    error?: string
  ) {
    const statusData: ReportStatus = {
      reportId,
      status: status as any,
      progress,
      downloadUrl: filePath ? `/api/reports/${reportId}/download` : undefined,
      error,
      createdAt: new Date(),
      completedAt: status === 'completed' ? new Date() : undefined,
    };

    await redis.setex(
      `report:${reportId}:status`,
      3600, // 1 hour
      JSON.stringify(statusData)
    );
  }

  private getContentType(format: string): string {
    switch (format) {
      case 'pdf':
        return 'application/pdf';
      case 'csv':
        return 'text/csv';
      case 'excel':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default:
        return 'application/octet-stream';
    }
  }

  private async ensureReportsDirectory() {
    if (!fs.existsSync(this.reportsPath)) {
      fs.mkdirSync(this.reportsPath, { recursive: true });
    }
  }
}