import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

interface ComplianceReport {
  id: string;
  orderId: string;
  reportType: string;
  complianceScore: number;
  violations: Array<{
    timestamp: Date;
    temperature: number;
    expectedRange: { min: number; max: number };
    duration: number;
    severity: string;
  }>;
  summary: {
    totalReadings: number;
    compliantReadings: number;
    averageTemperature: number;
    maxDeviation: number;
  };
  generatedAt: Date;
}

interface Violation {
  id: string;
  orderId: string;
  timestamp: Date;
  temperature: number;
  zone: string;
  severity: string;
  duration: number;
  acknowledged: boolean;
}

interface ComplianceMetrics {
  overallScore: number;
  violationRate: number;
  averageResponseTime: number;
  criticalIncidents: number;
  topViolationReasons: Array<{ reason: string; count: number }>;
}

export class ComplianceReportingService {
  private complianceThresholds = {
    excellent: 98,
    good: 95,
    acceptable: 90,
    poor: 85,
  };

  private regulatoryStandards = {
    FDA: {
      refrigerated: { min: 0, max: 5 },
      frozen: { min: -23, max: -15 },
      hot: { min: 60, max: 80 },
    },
    HACCP: {
      criticalLimit: 4, // hours in danger zone
      dangerZone: { min: 5, max: 60 },
    },
  };

  constructor() {}

  async generateReport(orderId: string): Promise<ComplianceReport> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: { include: { item: true } },
        reskflow: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Get all temperature readings
    const readings = await prisma.temperatureReading.findMany({
      where: { order_id: orderId },
      orderBy: { recorded_at: 'asc' },
    });

    // Get violations
    const violations = await prisma.temperatureViolation.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: 'asc' },
    });

    // Analyze compliance
    const analysis = await this.analyzeCompliance(order, readings, violations);

    // Create report
    const report = await prisma.complianceReport.create({
      data: {
        id: uuidv4(),
        order_id: orderId,
        report_type: 'reskflow_compliance',
        compliance_score: analysis.complianceScore,
        violations: analysis.violations,
        summary: analysis.summary,
        generated_at: new Date(),
        generated_by: 'system',
      },
    });

    // Generate PDF if needed
    await this.generatePDFReport(report);

    return this.mapToComplianceReport(report);
  }

  async checkCompliance(data: {
    orderId: string;
    currentTemp: number;
    zone: string;
  }): Promise<void> {
    const standards = this.regulatoryStandards.FDA[data.zone as keyof typeof this.regulatoryStandards.FDA];
    if (!standards) return;

    const isCompliant = data.currentTemp >= standards.min && data.currentTemp <= standards.max;

    if (!isCompliant) {
      // Log compliance violation
      await prisma.complianceViolation.create({
        data: {
          order_id: data.orderId,
          standard: 'FDA',
          requirement: `Temperature must be between ${standards.min}°C and ${standards.max}°C`,
          actual_value: data.currentTemp.toString(),
          violated_at: new Date(),
        },
      });
    }
  }

  async getViolations(params: {
    startDate?: string;
    endDate?: string;
    severity?: string;
    merchantId?: string;
  }): Promise<Violation[]> {
    const where: any = {};

    if (params.startDate || params.endDate) {
      where.created_at = {};
      if (params.startDate) {
        where.created_at.gte = new Date(params.startDate);
      }
      if (params.endDate) {
        where.created_at.lte = new Date(params.endDate);
      }
    }

    if (params.severity) {
      where.severity = params.severity;
    }

    if (params.merchantId) {
      where.order = {
        merchant_id: params.merchantId,
      };
    }

    const violations = await prisma.temperatureViolation.findMany({
      where,
      include: {
        order: {
          include: {
            orderItems: { include: { item: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return violations.map(v => ({
      id: v.id,
      orderId: v.order_id,
      timestamp: v.created_at,
      temperature: v.temperature,
      zone: this.determineZone(v.expected_min, v.expected_max),
      severity: v.severity,
      duration: v.duration,
      acknowledged: v.acknowledged,
    }));
  }

  async generateDailyReports(): Promise<void> {
    const yesterday = dayjs().subtract(1, 'day');
    const startOfDay = yesterday.startOf('day').toDate();
    const endOfDay = yesterday.endOf('day').toDate();

    // Get all completed deliveries from yesterday
    const deliveries = await prisma.reskflow.findMany({
      where: {
        status: 'delivered',
        delivered_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        order: {
          include: {
            merchant: true,
          },
        },
      },
    });

    // Group by merchant
    const merchantDeliveries = new Map<string, any[]>();
    deliveries.forEach(reskflow => {
      const merchantId = reskflow.order.merchant_id;
      if (!merchantDeliveries.has(merchantId)) {
        merchantDeliveries.set(merchantId, []);
      }
      merchantDeliveries.get(merchantId)!.push(reskflow);
    });

    // Generate report for each merchant
    for (const [merchantId, merchantDelivs] of merchantDeliveries) {
      await this.generateMerchantDailyReport(merchantId, merchantDelivs, yesterday.toDate());
    }
  }

  async getComplianceMetrics(
    merchantId: string,
    period: string = '30d'
  ): Promise<ComplianceMetrics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all orders and violations
    const orders = await prisma.order.count({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
      },
    });

    const violations = await prisma.temperatureViolation.findMany({
      where: {
        order: {
          merchant_id: merchantId,
        },
        created_at: { gte: startDate },
      },
    });

    const criticalViolations = violations.filter(v => v.severity === 'critical');

    // Calculate metrics
    const violationRate = orders > 0 ? (violations.length / orders) * 100 : 0;
    
    // Average response time (time to acknowledge violations)
    const responseTimes = violations
      .filter(v => v.acknowledged_at)
      .map(v => dayjs(v.acknowledged_at).diff(v.created_at, 'minute'));
    
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    // Group violations by reason
    const violationReasons = new Map<string, number>();
    violations.forEach(v => {
      const reason = this.categorizeViolation(v);
      violationReasons.set(reason, (violationReasons.get(reason) || 0) + 1);
    });

    const topViolationReasons = Array.from(violationReasons.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate overall score
    const complianceRate = 100 - violationRate;
    const responseScore = averageResponseTime < 15 ? 100 : Math.max(0, 100 - (averageResponseTime - 15) * 2);
    const criticalScore = criticalViolations.length === 0 ? 100 : Math.max(0, 100 - criticalViolations.length * 10);
    
    const overallScore = (complianceRate * 0.5 + responseScore * 0.3 + criticalScore * 0.2);

    return {
      overallScore: Math.round(overallScore * 10) / 10,
      violationRate: Math.round(violationRate * 10) / 10,
      averageResponseTime: Math.round(averageResponseTime),
      criticalIncidents: criticalViolations.length,
      topViolationReasons,
    };
  }

  async generateComplianceCertificate(params: {
    merchantId: string;
    period: string;
  }): Promise<string> {
    const metrics = await this.getComplianceMetrics(params.merchantId, params.period);
    
    if (metrics.overallScore < this.complianceThresholds.acceptable) {
      throw new Error('Compliance score too low for certification');
    }

    const certificate = await prisma.complianceCertificate.create({
      data: {
        id: uuidv4(),
        merchant_id: params.merchantId,
        period: params.period,
        compliance_score: metrics.overallScore,
        issued_at: new Date(),
        expires_at: dayjs().add(90, 'day').toDate(),
        certificate_number: this.generateCertificateNumber(),
      },
    });

    // Generate certificate PDF
    await this.generateCertificatePDF(certificate, metrics);

    return certificate.id;
  }

  private async analyzeCompliance(
    order: any,
    readings: any[],
    violations: any[]
  ): Promise<{
    complianceScore: number;
    violations: any[];
    summary: any;
  }> {
    const totalReadings = readings.length;
    const violationReadings = violations.length;
    const compliantReadings = totalReadings - violationReadings;

    // Calculate temperature statistics
    const temperatures = readings.map(r => r.temperature);
    const averageTemperature = temperatures.length > 0
      ? temperatures.reduce((a, b) => a + b, 0) / temperatures.length
      : 0;

    // Find max deviation
    let maxDeviation = 0;
    for (const violation of violations) {
      const deviation = Math.max(
        violation.expected_min - violation.temperature,
        violation.temperature - violation.expected_max
      );
      maxDeviation = Math.max(maxDeviation, Math.abs(deviation));
    }

    // Calculate compliance score
    const baseScore = totalReadings > 0 ? (compliantReadings / totalReadings) * 100 : 100;
    const severityPenalty = violations.filter(v => v.severity === 'critical').length * 5;
    const complianceScore = Math.max(0, baseScore - severityPenalty);

    return {
      complianceScore: Math.round(complianceScore * 10) / 10,
      violations: violations.map(v => ({
        timestamp: v.created_at,
        temperature: v.temperature,
        expectedRange: { min: v.expected_min, max: v.expected_max },
        duration: v.duration,
        severity: v.severity,
      })),
      summary: {
        totalReadings,
        compliantReadings,
        averageTemperature: Math.round(averageTemperature * 10) / 10,
        maxDeviation: Math.round(maxDeviation * 10) / 10,
      },
    };
  }

  private async generatePDFReport(report: any): Promise<void> {
    const doc = new PDFDocument();
    const filename = `compliance-report-${report.order_id}-${Date.now()}.pdf`;
    const filepath = path.join(process.env.REPORTS_DIR || './reports', filename);

    doc.pipe(fs.createWriteStream(filepath));

    // Header
    doc.fontSize(20).text('Temperature Compliance Report', 50, 50);
    doc.fontSize(12).text(`Order ID: ${report.order_id}`, 50, 80);
    doc.text(`Generated: ${dayjs(report.generated_at).format('YYYY-MM-DD HH:mm')}`, 50, 100);

    // Compliance Score
    doc.fontSize(16).text(`Compliance Score: ${report.compliance_score}%`, 50, 140);
    
    // Summary
    doc.fontSize(14).text('Summary', 50, 180);
    doc.fontSize(12);
    doc.text(`Total Readings: ${report.summary.totalReadings}`, 70, 200);
    doc.text(`Compliant Readings: ${report.summary.compliantReadings}`, 70, 220);
    doc.text(`Average Temperature: ${report.summary.averageTemperature}°C`, 70, 240);
    doc.text(`Maximum Deviation: ${report.summary.maxDeviation}°C`, 70, 260);

    // Violations
    if (report.violations.length > 0) {
      doc.fontSize(14).text('Violations', 50, 300);
      let yPos = 320;
      
      report.violations.forEach((violation: any, index: number) => {
        doc.fontSize(10);
        doc.text(
          `${index + 1}. ${dayjs(violation.timestamp).format('HH:mm')} - ` +
          `${violation.temperature}°C (Expected: ${violation.expectedRange.min}-${violation.expectedRange.max}°C) - ` +
          `${violation.severity.toUpperCase()}`,
          70,
          yPos
        );
        yPos += 20;
      });
    }

    doc.end();

    // Update report with file path
    await prisma.complianceReport.update({
      where: { id: report.id },
      data: { file_path: filepath },
    });
  }

  private async generateMerchantDailyReport(
    merchantId: string,
    deliveries: any[],
    date: Date
  ): Promise<void> {
    const orderIds = deliveries.map(d => d.order_id);
    
    // Get all violations for these orders
    const violations = await prisma.temperatureViolation.findMany({
      where: { order_id: { in: orderIds } },
    });

    // Calculate daily metrics
    const totalOrders = deliveries.length;
    const ordersWithViolations = new Set(violations.map(v => v.order_id)).size;
    const complianceRate = ((totalOrders - ordersWithViolations) / totalOrders) * 100;

    // Create daily report
    await prisma.dailyComplianceReport.create({
      data: {
        merchant_id: merchantId,
        report_date: date,
        total_orders: totalOrders,
        compliant_orders: totalOrders - ordersWithViolations,
        compliance_rate: complianceRate,
        critical_violations: violations.filter(v => v.severity === 'critical').length,
        generated_at: new Date(),
      },
    });

    logger.info(`Generated daily compliance report for merchant ${merchantId}`);
  }

  private categorizeViolation(violation: any): string {
    if (violation.temperature > violation.expected_max) {
      return 'Temperature too high';
    } else if (violation.temperature < violation.expected_min) {
      return 'Temperature too low';
    } else if (violation.duration > 30) {
      return 'Extended duration violation';
    } else {
      return 'Other';
    }
  }

  private determineZone(minTemp: number, maxTemp: number): string {
    if (minTemp <= -15) return 'frozen';
    if (maxTemp <= 5) return 'refrigerated';
    if (maxTemp <= 15) return 'cold';
    if (minTemp >= 60) return 'hot';
    return 'ambient';
  }

  private generateCertificateNumber(): string {
    const prefix = 'TEMP';
    const year = dayjs().format('YY');
    const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    return `${prefix}-${year}-${random}`;
  }

  private async generateCertificatePDF(certificate: any, metrics: ComplianceMetrics): Promise<void> {
    // Generate professional certificate PDF
    const doc = new PDFDocument({ size: 'LETTER' });
    const filename = `certificate-${certificate.certificate_number}.pdf`;
    const filepath = path.join(process.env.CERTIFICATES_DIR || './certificates', filename);

    doc.pipe(fs.createWriteStream(filepath));

    // Certificate content
    doc.fontSize(24).text('Temperature Compliance Certificate', 100, 100, { align: 'center' });
    doc.fontSize(16).text(`Certificate Number: ${certificate.certificate_number}`, 100, 150, { align: 'center' });
    
    // Add more certificate details...
    
    doc.end();

    await prisma.complianceCertificate.update({
      where: { id: certificate.id },
      data: { file_path: filepath },
    });
  }

  private mapToComplianceReport(dbReport: any): ComplianceReport {
    return {
      id: dbReport.id,
      orderId: dbReport.order_id,
      reportType: dbReport.report_type,
      complianceScore: dbReport.compliance_score,
      violations: dbReport.violations,
      summary: dbReport.summary,
      generatedAt: dbReport.generated_at,
    };
  }
}