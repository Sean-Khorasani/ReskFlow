import { prisma, logger } from '@reskflow/shared';
import Bull from 'bull';
import dayjs from 'dayjs';

interface QualityMetrics {
  merchantId: string;
  period: { start: Date; end: Date };
  orderAccuracy: number;
  onTimeDelivery: number;
  customerSatisfaction: number;
  foodQualityScore: number;
  packagingScore: number;
  overallScore: number;
  recommendations: string[];
}

interface QualityAlert {
  id: string;
  merchantId: string;
  type: 'accuracy' | 'reskflow' | 'quality' | 'satisfaction';
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  threshold: number;
  actualValue: number;
  description: string;
  createdAt: Date;
  acknowledged: boolean;
}

interface QualityBenchmark {
  metric: string;
  merchantValue: number;
  categoryAverage: number;
  topPerformer: number;
  percentile: number;
}

export class QualityMonitoringService {
  private monitoringQueue: Bull.Queue;
  private readonly MONITORING_INTERVAL = 3600000; // 1 hour
  
  private readonly THRESHOLDS = {
    accuracy: { critical: 0.85, high: 0.90, medium: 0.93, low: 0.95 },
    onTime: { critical: 0.80, high: 0.85, medium: 0.90, low: 0.93 },
    satisfaction: { critical: 3.5, high: 4.0, medium: 4.3, low: 4.5 },
    foodQuality: { critical: 3.5, high: 4.0, medium: 4.3, low: 4.5 },
    packaging: { critical: 3.5, high: 4.0, medium: 4.3, low: 4.5 },
  };

  constructor() {
    this.monitoringQueue = new Bull('quality-monitoring', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });

    this.setupQueueProcessors();
    this.startMonitoring();
  }

  async getQualityMetrics(
    merchantId: string,
    period?: { start: Date; end: Date }
  ): Promise<QualityMetrics> {
    const defaultPeriod = period || {
      start: dayjs().subtract(30, 'day').toDate(),
      end: new Date(),
    };

    const [
      accuracyData,
      reskflowData,
      satisfactionData,
      qualityData,
      packagingData,
    ] = await Promise.all([
      this.calculateOrderAccuracy(merchantId, defaultPeriod),
      this.calculateOnTimeDelivery(merchantId, defaultPeriod),
      this.calculateCustomerSatisfaction(merchantId, defaultPeriod),
      this.calculateFoodQualityScore(merchantId, defaultPeriod),
      this.calculatePackagingScore(merchantId, defaultPeriod),
    ]);

    const overallScore = this.calculateOverallScore({
      accuracy: accuracyData.score,
      onTime: reskflowData.score,
      satisfaction: satisfactionData.score,
      foodQuality: qualityData.score,
      packaging: packagingData.score,
    });

    const recommendations = this.generateRecommendations({
      accuracy: accuracyData,
      reskflow: reskflowData,
      satisfaction: satisfactionData,
      quality: qualityData,
      packaging: packagingData,
    });

    return {
      merchantId,
      period: defaultPeriod,
      orderAccuracy: accuracyData.score,
      onTimeDelivery: reskflowData.score,
      customerSatisfaction: satisfactionData.score,
      foodQualityScore: qualityData.score,
      packagingScore: packagingData.score,
      overallScore,
      recommendations,
    };
  }

  async getQualityAlerts(params: {
    merchantId?: string;
    severity?: string;
    acknowledged?: boolean;
    limit?: number;
  }): Promise<QualityAlert[]> {
    const where: any = {};
    
    if (params.merchantId) where.merchant_id = params.merchantId;
    if (params.severity) where.severity = params.severity;
    if (params.acknowledged !== undefined) where.acknowledged = params.acknowledged;

    const alerts = await prisma.qualityAlert.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: params.limit || 50,
    });

    return alerts.map(alert => ({
      id: alert.id,
      merchantId: alert.merchant_id,
      type: alert.type,
      severity: alert.severity,
      metric: alert.metric,
      threshold: alert.threshold,
      actualValue: alert.actual_value,
      description: alert.description,
      createdAt: alert.created_at,
      acknowledged: alert.acknowledged,
    }));
  }

  async acknowledgeAlert(alertId: string, userId: string): Promise<void> {
    await prisma.qualityAlert.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledged_by: userId,
        acknowledged_at: new Date(),
      },
    });
  }

  async getBenchmarks(
    merchantId: string,
    category?: string
  ): Promise<QualityBenchmark[]> {
    // Get merchant metrics
    const merchantMetrics = await this.getQualityMetrics(merchantId);
    
    // Get category metrics
    const categoryMetrics = await this.getCategoryAverages(category || 'all');
    
    // Calculate benchmarks
    const benchmarks: QualityBenchmark[] = [
      {
        metric: 'Order Accuracy',
        merchantValue: merchantMetrics.orderAccuracy,
        categoryAverage: categoryMetrics.accuracy,
        topPerformer: 0.98,
        percentile: this.calculatePercentile(merchantMetrics.orderAccuracy, 'accuracy'),
      },
      {
        metric: 'On-Time Delivery',
        merchantValue: merchantMetrics.onTimeDelivery,
        categoryAverage: categoryMetrics.onTime,
        topPerformer: 0.95,
        percentile: this.calculatePercentile(merchantMetrics.onTimeDelivery, 'reskflow'),
      },
      {
        metric: 'Customer Satisfaction',
        merchantValue: merchantMetrics.customerSatisfaction,
        categoryAverage: categoryMetrics.satisfaction,
        topPerformer: 4.8,
        percentile: this.calculatePercentile(merchantMetrics.customerSatisfaction, 'satisfaction'),
      },
      {
        metric: 'Food Quality',
        merchantValue: merchantMetrics.foodQualityScore,
        categoryAverage: categoryMetrics.foodQuality,
        topPerformer: 4.7,
        percentile: this.calculatePercentile(merchantMetrics.foodQualityScore, 'quality'),
      },
      {
        metric: 'Packaging',
        merchantValue: merchantMetrics.packagingScore,
        categoryAverage: categoryMetrics.packaging,
        topPerformer: 4.6,
        percentile: this.calculatePercentile(merchantMetrics.packagingScore, 'packaging'),
      },
    ];

    return benchmarks;
  }

  async generateQualityReport(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<{
    summary: QualityMetrics;
    trends: any[];
    issues: any[];
    improvements: any[];
    benchmarks: QualityBenchmark[];
  }> {
    const [summary, trends, issues, benchmarks] = await Promise.all([
      this.getQualityMetrics(merchantId, period),
      this.getQualityTrends(merchantId, period),
      this.getTopIssues(merchantId, period),
      this.getBenchmarks(merchantId),
    ]);

    const improvements = this.identifyImprovements(summary, trends, issues);

    return {
      summary,
      trends,
      issues,
      improvements,
      benchmarks,
    };
  }

  private async calculateOrderAccuracy(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<{ score: number; details: any }> {
    const result = await prisma.$queryRaw<any>`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT ar.order_id) as reported_issues,
        AVG(CASE WHEN ar.id IS NOT NULL THEN ar.accuracy_score ELSE 1 END) as avg_accuracy
      FROM orders o
      LEFT JOIN accuracy_reports ar ON o.id = ar.order_id
      WHERE o.merchant_id = ${merchantId}
        AND o.delivered_at BETWEEN ${period.start} AND ${period.end}
    `;

    const score = result[0]?.avg_accuracy || 1;
    
    return {
      score: Number(score.toFixed(3)),
      details: {
        totalOrders: result[0]?.total_orders || 0,
        reportedIssues: result[0]?.reported_issues || 0,
      },
    };
  }

  private async calculateOnTimeDelivery(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<{ score: number; details: any }> {
    const result = await prisma.$queryRaw<any>`
      SELECT 
        COUNT(*) as total_deliveries,
        COUNT(CASE WHEN 
          delivered_at <= estimated_reskflow_time + INTERVAL '10 minutes' 
          THEN 1 END) as on_time_deliveries,
        AVG(EXTRACT(EPOCH FROM (delivered_at - estimated_reskflow_time))/60) as avg_delay_minutes
      FROM orders
      WHERE merchant_id = ${merchantId}
        AND delivered_at IS NOT NULL
        AND delivered_at BETWEEN ${period.start} AND ${period.end}
    `;

    const total = result[0]?.total_deliveries || 0;
    const onTime = result[0]?.on_time_deliveries || 0;
    const score = total > 0 ? onTime / total : 1;

    return {
      score: Number(score.toFixed(3)),
      details: {
        totalDeliveries: total,
        onTimeDeliveries: onTime,
        averageDelay: result[0]?.avg_delay_minutes || 0,
      },
    };
  }

  private async calculateCustomerSatisfaction(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<{ score: number; details: any }> {
    const result = await prisma.$queryRaw<any>`
      SELECT 
        AVG(rating) as avg_rating,
        COUNT(*) as total_ratings,
        COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_ratings
      FROM reviews
      WHERE merchant_id = ${merchantId}
        AND created_at BETWEEN ${period.start} AND ${period.end}
    `;

    const score = result[0]?.avg_rating || 4.0;
    
    return {
      score: Number(score.toFixed(2)),
      details: {
        totalRatings: result[0]?.total_ratings || 0,
        positiveRatings: result[0]?.positive_ratings || 0,
      },
    };
  }

  private async calculateFoodQualityScore(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<{ score: number; details: any }> {
    const result = await prisma.$queryRaw<any>`
      SELECT 
        AVG(food_rating) as avg_food_rating,
        COUNT(CASE WHEN tags @> '["cold_food"]' THEN 1 END) as cold_food_complaints,
        COUNT(CASE WHEN tags @> '["wrong_preparation"]' THEN 1 END) as prep_complaints
      FROM reviews
      WHERE merchant_id = ${merchantId}
        AND created_at BETWEEN ${period.start} AND ${period.end}
        AND food_rating IS NOT NULL
    `;

    const score = result[0]?.avg_food_rating || 4.0;
    
    return {
      score: Number(score.toFixed(2)),
      details: {
        coldFoodComplaints: result[0]?.cold_food_complaints || 0,
        preparationComplaints: result[0]?.prep_complaints || 0,
      },
    };
  }

  private async calculatePackagingScore(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<{ score: number; details: any }> {
    const result = await prisma.$queryRaw<any>`
      SELECT 
        AVG(packaging_rating) as avg_packaging_rating,
        COUNT(CASE WHEN tags @> '["poor_packaging"]' THEN 1 END) as packaging_complaints,
        COUNT(CASE WHEN tags @> '["spilled_food"]' THEN 1 END) as spill_complaints
      FROM reviews
      WHERE merchant_id = ${merchantId}
        AND created_at BETWEEN ${period.start} AND ${period.end}
        AND packaging_rating IS NOT NULL
    `;

    const score = result[0]?.avg_packaging_rating || 4.0;
    
    return {
      score: Number(score.toFixed(2)),
      details: {
        packagingComplaints: result[0]?.packaging_complaints || 0,
        spillComplaints: result[0]?.spill_complaints || 0,
      },
    };
  }

  private calculateOverallScore(scores: {
    accuracy: number;
    onTime: number;
    satisfaction: number;
    foodQuality: number;
    packaging: number;
  }): number {
    // Weighted average with different weights for each metric
    const weights = {
      accuracy: 0.25,
      onTime: 0.20,
      satisfaction: 0.25,
      foodQuality: 0.20,
      packaging: 0.10,
    };

    const weightedSum = 
      scores.accuracy * weights.accuracy +
      scores.onTime * weights.onTime +
      (scores.satisfaction / 5) * weights.satisfaction + // Normalize to 0-1
      (scores.foodQuality / 5) * weights.foodQuality +
      (scores.packaging / 5) * weights.packaging;

    return Number((weightedSum * 5).toFixed(2)); // Convert back to 5-point scale
  }

  private generateRecommendations(data: any): string[] {
    const recommendations: string[] = [];

    // Accuracy recommendations
    if (data.accuracy.score < 0.95) {
      recommendations.push('Implement double-check system for orders before dispatch');
      if (data.accuracy.details.reportedIssues > 10) {
        recommendations.push('Provide additional training on order accuracy');
      }
    }

    // Delivery recommendations
    if (data.reskflow.score < 0.90) {
      recommendations.push('Review reskflow time estimates and adjust if needed');
      if (data.reskflow.details.averageDelay > 15) {
        recommendations.push('Consider hiring additional reskflow drivers during peak hours');
      }
    }

    // Quality recommendations
    if (data.quality.score < 4.3) {
      recommendations.push('Review food preparation standards and timing');
      if (data.quality.details.coldFoodComplaints > 5) {
        recommendations.push('Invest in better heat-retention packaging');
      }
    }

    // Packaging recommendations
    if (data.packaging.score < 4.0 || data.packaging.details.spillComplaints > 3) {
      recommendations.push('Upgrade to spill-proof packaging for liquid items');
    }

    return recommendations;
  }

  private async getCategoryAverages(category: string): Promise<any> {
    // Get average metrics for the category
    const result = await prisma.$queryRaw<any>`
      SELECT 
        AVG(accuracy_rate) as accuracy,
        AVG(on_time_rate) as on_time,
        AVG(avg_rating) as satisfaction,
        AVG(food_quality_score) as food_quality,
        AVG(packaging_score) as packaging
      FROM merchant_quality_metrics
      WHERE category = ${category} OR ${category} = 'all'
    `;

    return result[0] || {
      accuracy: 0.92,
      onTime: 0.88,
      satisfaction: 4.2,
      foodQuality: 4.1,
      packaging: 4.0,
    };
  }

  private calculatePercentile(value: number, metric: string): number {
    // In production, this would calculate actual percentile from all merchants
    // For now, return estimated percentile based on thresholds
    const thresholds = this.THRESHOLDS[metric as keyof typeof this.THRESHOLDS];
    
    if (!thresholds) return 50;

    if (metric === 'satisfaction' || metric === 'quality' || metric === 'packaging') {
      if (value >= thresholds.low) return 90;
      if (value >= thresholds.medium) return 70;
      if (value >= thresholds.high) return 40;
      return 20;
    } else {
      if (value >= thresholds.low) return 90;
      if (value >= thresholds.medium) return 70;
      if (value >= thresholds.high) return 40;
      return 20;
    }
  }

  private async getQualityTrends(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<any[]> {
    const trends = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('day', date) as date,
        accuracy_rate,
        on_time_rate,
        avg_rating,
        food_quality_score,
        packaging_score,
        overall_score
      FROM merchant_quality_daily
      WHERE merchant_id = ${merchantId}
        AND date BETWEEN ${period.start} AND ${period.end}
      ORDER BY date ASC
    `;

    return trends;
  }

  private async getTopIssues(
    merchantId: string,
    period: { start: Date; end: Date }
  ): Promise<any[]> {
    const issues = await prisma.$queryRaw`
      SELECT 
        issue_type,
        COUNT(*) as occurrences,
        AVG(severity_score) as avg_severity
      FROM quality_issues
      WHERE merchant_id = ${merchantId}
        AND created_at BETWEEN ${period.start} AND ${period.end}
      GROUP BY issue_type
      ORDER BY occurrences DESC
      LIMIT 10
    `;

    return issues;
  }

  private identifyImprovements(
    summary: QualityMetrics,
    trends: any[],
    issues: any[]
  ): any[] {
    const improvements = [];

    // Check if metrics are improving
    if (trends.length > 7) {
      const recent = trends.slice(-7);
      const previous = trends.slice(-14, -7);
      
      const recentAvg = this.averageMetrics(recent);
      const previousAvg = this.averageMetrics(previous);

      if (recentAvg.accuracy > previousAvg.accuracy) {
        improvements.push({
          metric: 'Order Accuracy',
          change: `+${((recentAvg.accuracy - previousAvg.accuracy) * 100).toFixed(1)}%`,
          period: '7 days',
        });
      }
    }

    return improvements;
  }

  private averageMetrics(data: any[]): any {
    const sum = data.reduce((acc, curr) => ({
      accuracy: acc.accuracy + curr.accuracy_rate,
      onTime: acc.onTime + curr.on_time_rate,
      rating: acc.rating + curr.avg_rating,
    }), { accuracy: 0, onTime: 0, rating: 0 });

    return {
      accuracy: sum.accuracy / data.length,
      onTime: sum.onTime / data.length,
      rating: sum.rating / data.length,
    };
  }

  private setupQueueProcessors(): void {
    this.monitoringQueue.process('monitor-quality', async (job) => {
      const { merchantId } = job.data;
      await this.monitorMerchantQuality(merchantId);
    });

    this.monitoringQueue.process('generate-alerts', async (job) => {
      const { merchantId, metrics } = job.data;
      await this.generateQualityAlerts(merchantId, metrics);
    });
  }

  private async startMonitoring(): void {
    // Schedule monitoring for all active merchants
    const merchants = await prisma.merchant.findMany({
      where: { is_active: true },
      select: { id: true },
    });

    merchants.forEach(merchant => {
      this.monitoringQueue.add(
        'monitor-quality',
        { merchantId: merchant.id },
        {
          repeat: { cron: '0 * * * *' }, // Every hour
          removeOnComplete: true,
        }
      );
    });
  }

  private async monitorMerchantQuality(merchantId: string): Promise<void> {
    try {
      const metrics = await this.getQualityMetrics(merchantId);
      
      // Check against thresholds and generate alerts
      await this.monitoringQueue.add('generate-alerts', {
        merchantId,
        metrics,
      });

      // Store metrics for trending
      await prisma.merchantQualitySnapshot.create({
        data: {
          merchant_id: merchantId,
          accuracy_rate: metrics.orderAccuracy,
          on_time_rate: metrics.onTimeDelivery,
          avg_rating: metrics.customerSatisfaction,
          food_quality_score: metrics.foodQualityScore,
          packaging_score: metrics.packagingScore,
          overall_score: metrics.overallScore,
          snapshot_at: new Date(),
        },
      });
    } catch (error) {
      logger.error(`Error monitoring quality for merchant ${merchantId}:`, error);
    }
  }

  private async generateQualityAlerts(
    merchantId: string,
    metrics: QualityMetrics
  ): Promise<void> {
    const alerts: Partial<QualityAlert>[] = [];

    // Check accuracy
    const accuracySeverity = this.getSeverity(metrics.orderAccuracy, 'accuracy');
    if (accuracySeverity) {
      alerts.push({
        merchantId,
        type: 'accuracy',
        severity: accuracySeverity,
        metric: 'Order Accuracy',
        threshold: this.THRESHOLDS.accuracy[accuracySeverity],
        actualValue: metrics.orderAccuracy,
        description: `Order accuracy (${(metrics.orderAccuracy * 100).toFixed(1)}%) is below ${accuracySeverity} threshold`,
      });
    }

    // Check on-time reskflow
    const reskflowSeverity = this.getSeverity(metrics.onTimeDelivery, 'onTime');
    if (reskflowSeverity) {
      alerts.push({
        merchantId,
        type: 'reskflow',
        severity: reskflowSeverity,
        metric: 'On-Time Delivery',
        threshold: this.THRESHOLDS.onTime[reskflowSeverity],
        actualValue: metrics.onTimeDelivery,
        description: `On-time reskflow rate (${(metrics.onTimeDelivery * 100).toFixed(1)}%) is below ${reskflowSeverity} threshold`,
      });
    }

    // Create alerts in database
    for (const alert of alerts) {
      await prisma.qualityAlert.create({
        data: {
          merchant_id: alert.merchantId!,
          type: alert.type!,
          severity: alert.severity!,
          metric: alert.metric!,
          threshold: alert.threshold!,
          actual_value: alert.actualValue!,
          description: alert.description!,
          created_at: new Date(),
          acknowledged: false,
        },
      });
    }
  }

  private getSeverity(
    value: number,
    metric: keyof typeof this.THRESHOLDS
  ): 'critical' | 'high' | 'medium' | 'low' | null {
    const thresholds = this.THRESHOLDS[metric];
    
    if (metric === 'satisfaction' || metric === 'foodQuality' || metric === 'packaging') {
      if (value < thresholds.critical) return 'critical';
      if (value < thresholds.high) return 'high';
      if (value < thresholds.medium) return 'medium';
      if (value < thresholds.low) return 'low';
    } else {
      if (value < thresholds.critical) return 'critical';
      if (value < thresholds.high) return 'high';
      if (value < thresholds.medium) return 'medium';
      if (value < thresholds.low) return 'low';
    }
    
    return null;
  }
}