import express from 'express';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { RevenueAnalyticsService } from './services/RevenueAnalyticsService';
import { PerformanceAnalyticsService } from './services/PerformanceAnalyticsService';
import { CustomerAnalyticsService } from './services/CustomerAnalyticsService';
import { ReportGenerationService } from './services/ReportGenerationService';
import { DashboardService } from './services/DashboardService';
import { authenticate } from '@reskflow/shared';
import Bull from 'bull';
import * as cron from 'node-cron';

const app = express();
app.use(express.json());

let revenueAnalytics: RevenueAnalyticsService;
let performanceAnalytics: PerformanceAnalyticsService;
let customerAnalytics: CustomerAnalyticsService;
let reportGeneration: ReportGenerationService;
let dashboardService: DashboardService;

// Initialize queues
const reportQueue = new Bull('report-generation', {
  redis: config.redis.url,
});

const analyticsQueue = new Bull('analytics-processing', {
  redis: config.redis.url,
});

async function startService() {
  try {
    await connectDatabase();
    logger.info('Analytics service: Database connected');

    // Initialize services
    revenueAnalytics = new RevenueAnalyticsService();
    performanceAnalytics = new PerformanceAnalyticsService();
    customerAnalytics = new CustomerAnalyticsService();
    reportGeneration = new ReportGenerationService(reportQueue);
    dashboardService = new DashboardService(
      revenueAnalytics,
      performanceAnalytics,
      customerAnalytics
    );

    // Process queues
    reportQueue.process(async (job) => {
      return reportGeneration.processReportJob(job.data);
    });

    analyticsQueue.process(async (job) => {
      return processAnalyticsJob(job.data);
    });

    // Schedule daily analytics aggregation
    cron.schedule('0 1 * * *', async () => {
      logger.info('Running daily analytics aggregation');
      await aggregateDailyAnalytics();
    });

    // Schedule weekly reports
    cron.schedule('0 9 * * 1', async () => {
      logger.info('Generating weekly reports');
      await generateWeeklyReports();
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'analytics' });
    });

    // Revenue endpoints
    app.get('/merchants/:merchantId/revenue', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { startDate, endDate, granularity = 'day' } = req.query;

        // Verify merchant access
        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const revenue = await revenueAnalytics.getMerchantRevenue(
          merchantId,
          startDate as string,
          endDate as string,
          granularity as string
        );

        res.json(revenue);
      } catch (error) {
        logger.error('Failed to get merchant revenue', error);
        res.status(500).json({ error: 'Failed to get revenue' });
      }
    });

    app.get('/merchants/:merchantId/revenue/breakdown', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { period = '30d' } = req.query;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const breakdown = await revenueAnalytics.getRevenueBreakdown(
          merchantId,
          period as string
        );

        res.json(breakdown);
      } catch (error) {
        logger.error('Failed to get revenue breakdown', error);
        res.status(500).json({ error: 'Failed to get breakdown' });
      }
    });

    // Performance endpoints
    app.get('/merchants/:merchantId/performance', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { period = '7d' } = req.query;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const performance = await performanceAnalytics.getMerchantPerformance(
          merchantId,
          period as string
        );

        res.json(performance);
      } catch (error) {
        logger.error('Failed to get merchant performance', error);
        res.status(500).json({ error: 'Failed to get performance' });
      }
    });

    app.get('/merchants/:merchantId/performance/items', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { period = '30d', limit = 10 } = req.query;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const items = await performanceAnalytics.getTopPerformingItems(
          merchantId,
          period as string,
          parseInt(limit as string)
        );

        res.json(items);
      } catch (error) {
        logger.error('Failed to get top items', error);
        res.status(500).json({ error: 'Failed to get items' });
      }
    });

    // Customer analytics endpoints
    app.get('/merchants/:merchantId/customers', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { period = '30d' } = req.query;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const customers = await customerAnalytics.getCustomerMetrics(
          merchantId,
          period as string
        );

        res.json(customers);
      } catch (error) {
        logger.error('Failed to get customer metrics', error);
        res.status(500).json({ error: 'Failed to get customers' });
      }
    });

    app.get('/merchants/:merchantId/customers/segments', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const segments = await customerAnalytics.getCustomerSegments(merchantId);
        res.json(segments);
      } catch (error) {
        logger.error('Failed to get customer segments', error);
        res.status(500).json({ error: 'Failed to get segments' });
      }
    });

    // Dashboard endpoints
    app.get('/merchants/:merchantId/dashboard', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { period = 'today' } = req.query;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const dashboard = await dashboardService.getMerchantDashboard(
          merchantId,
          period as string
        );

        res.json(dashboard);
      } catch (error) {
        logger.error('Failed to get dashboard', error);
        res.status(500).json({ error: 'Failed to get dashboard' });
      }
    });

    app.get('/merchants/:merchantId/dashboard/realtime', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const realtime = await dashboardService.getRealtimeMetrics(merchantId);
        res.json(realtime);
      } catch (error) {
        logger.error('Failed to get realtime metrics', error);
        res.status(500).json({ error: 'Failed to get realtime' });
      }
    });

    // Report generation endpoints
    app.post('/merchants/:merchantId/reports/generate', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { type, period, format = 'pdf' } = req.body;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const reportId = await reportGeneration.generateReport({
          merchantId,
          type,
          period,
          format,
          requestedBy: req.user!.id,
        });

        res.json({ reportId, status: 'processing' });
      } catch (error) {
        logger.error('Failed to generate report', error);
        res.status(500).json({ error: 'Failed to generate report' });
      }
    });

    app.get('/reports/:reportId/status', authenticate, async (req, res) => {
      try {
        const { reportId } = req.params;
        const status = await reportGeneration.getReportStatus(reportId);
        res.json(status);
      } catch (error) {
        logger.error('Failed to get report status', error);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

    app.get('/reports/:reportId/download', authenticate, async (req, res) => {
      try {
        const { reportId } = req.params;
        const { stream, contentType, filename } = await reportGeneration.downloadReport(
          reportId,
          req.user!.id
        );

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        stream.pipe(res);
      } catch (error) {
        logger.error('Failed to download report', error);
        res.status(500).json({ error: 'Failed to download report' });
      }
    });

    // Insights and recommendations
    app.get('/merchants/:merchantId/insights', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;

        if (req.user!.role !== 'ADMIN' && req.user!.merchant_id !== merchantId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const insights = await dashboardService.getBusinessInsights(merchantId);
        res.json(insights);
      } catch (error) {
        logger.error('Failed to get insights', error);
        res.status(500).json({ error: 'Failed to get insights' });
      }
    });

    // Comparison endpoints
    app.get('/merchants/:merchantId/compare', authenticate, async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { compareWith, period = '30d' } = req.query;

        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const comparison = await performanceAnalytics.compareMerchants(
          merchantId,
          compareWith as string,
          period as string
        );

        res.json(comparison);
      } catch (error) {
        logger.error('Failed to compare merchants', error);
        res.status(500).json({ error: 'Failed to compare' });
      }
    });

    // Admin analytics endpoints
    app.get('/admin/platform-metrics', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { period = '30d' } = req.query;
        const metrics = await dashboardService.getPlatformMetrics(period as string);
        res.json(metrics);
      } catch (error) {
        logger.error('Failed to get platform metrics', error);
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    const PORT = 3017;
    app.listen(PORT, () => {
      logger.info(`📊 Analytics service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start analytics service', error);
    process.exit(1);
  }
}

async function processAnalyticsJob(job: any) {
  logger.info(`Processing analytics job: ${job.type}`);

  switch (job.type) {
    case 'aggregate_daily':
      await aggregateDailyAnalytics();
      break;
    case 'calculate_merchant_scores':
      await performanceAnalytics.calculateMerchantScores();
      break;
    case 'update_customer_segments':
      await customerAnalytics.updateAllCustomerSegments();
      break;
    default:
      logger.warn(`Unknown analytics job type: ${job.type}`);
  }
}

async function aggregateDailyAnalytics() {
  try {
    // Aggregate revenue data
    await revenueAnalytics.aggregateDailyRevenue();
    
    // Update performance metrics
    await performanceAnalytics.aggregateDailyPerformance();
    
    // Update customer metrics
    await customerAnalytics.aggregateDailyCustomerMetrics();
    
    logger.info('Daily analytics aggregation completed');
  } catch (error) {
    logger.error('Failed to aggregate daily analytics', error);
  }
}

async function generateWeeklyReports() {
  try {
    // Get all active merchants
    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
    });

    for (const merchant of merchants) {
      await reportQueue.add('weekly-report', {
        merchantId: merchant.id,
        type: 'weekly_summary',
        period: '7d',
        format: 'pdf',
        requestedBy: 'system',
      });
    }

    logger.info(`Queued weekly reports for ${merchants.length} merchants`);
  } catch (error) {
    logger.error('Failed to generate weekly reports', error);
  }
}

startService();