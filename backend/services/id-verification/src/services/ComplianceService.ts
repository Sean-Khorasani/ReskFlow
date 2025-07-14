import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface StateRequirement {
  state: string;
  productType: string;
  minimumAge: number;
  requiresIdScan: boolean;
  requiresBiometric: boolean;
  recordRetention: number; // days
  reportingRequired: boolean;
  additionalRequirements: string[];
}

interface ComplianceCheck {
  orderId: string;
  state: string;
  productTypes: string[];
  passed: boolean;
  issues: string[];
  requirements: StateRequirement[];
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId?: string;
  metadata: any;
  timestamp: Date;
}

export class ComplianceService {
  private stateRequirements: Map<string, StateRequirement[]>;

  constructor(private complianceQueue: Bull.Queue) {
    this.stateRequirements = new Map();
    this.loadStateRequirements();
  }

  private loadStateRequirements(): void {
    // Load state-specific compliance requirements
    // In production, this would be loaded from a database
    const requirements: StateRequirement[] = [
      // California
      {
        state: 'CA',
        productType: 'alcohol',
        minimumAge: 21,
        requiresIdScan: true,
        requiresBiometric: false,
        recordRetention: 365,
        reportingRequired: true,
        additionalRequirements: ['reskflow_window_restriction', 'signature_required'],
      },
      {
        state: 'CA',
        productType: 'cannabis',
        minimumAge: 21,
        requiresIdScan: true,
        requiresBiometric: true,
        recordRetention: 730,
        reportingRequired: true,
        additionalRequirements: ['medical_card_verification', 'quantity_limits'],
      },
      // Texas
      {
        state: 'TX',
        productType: 'alcohol',
        minimumAge: 21,
        requiresIdScan: true,
        requiresBiometric: false,
        recordRetention: 180,
        reportingRequired: false,
        additionalRequirements: ['no_sunday_morning_reskflow'],
      },
      // New York
      {
        state: 'NY',
        productType: 'alcohol',
        minimumAge: 21,
        requiresIdScan: true,
        requiresBiometric: false,
        recordRetention: 365,
        reportingRequired: true,
        additionalRequirements: ['licensed_reskflow_only'],
      },
      // Generic prescription requirements
      {
        state: 'ALL',
        productType: 'prescription',
        minimumAge: 18,
        requiresIdScan: true,
        requiresBiometric: false,
        recordRetention: 2555, // 7 years
        reportingRequired: true,
        additionalRequirements: ['valid_prescription', 'prescriber_verification', 'HIPAA_compliance'],
      },
    ];

    // Group by state
    for (const req of requirements) {
      const stateReqs = this.stateRequirements.get(req.state) || [];
      stateReqs.push(req);
      this.stateRequirements.set(req.state, stateReqs);
    }
  }

  async getStateRequirements(
    state: string,
    productType?: string
  ): Promise<StateRequirement[]> {
    let requirements: StateRequirement[] = [];
    
    // Get state-specific requirements
    const stateReqs = this.stateRequirements.get(state) || [];
    requirements.push(...stateReqs);
    
    // Add generic requirements
    const genericReqs = this.stateRequirements.get('ALL') || [];
    requirements.push(...genericReqs);

    // Filter by product type if specified
    if (productType) {
      requirements = requirements.filter(req => req.productType === productType);
    }

    // Remove duplicates
    const uniqueReqs = requirements.reduce((acc, req) => {
      const key = `${req.state}-${req.productType}`;
      if (!acc.has(key) || req.state !== 'ALL') {
        acc.set(key, req);
      }
      return acc;
    }, new Map<string, StateRequirement>());

    return Array.from(uniqueReqs.values());
  }

  async checkCompliance(params: {
    sessionId: string;
    orderId: string;
    state: string;
  }): Promise<ComplianceCheck> {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        orderItems: {
          include: { item: true },
        },
        verificationSession: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Identify product types requiring compliance
    const productTypes = new Set<string>();
    for (const orderItem of order.orderItems) {
      if (orderItem.item.age_restricted) {
        productTypes.add(orderItem.item.product_type || 'alcohol');
      }
      if (orderItem.item.requires_prescription) {
        productTypes.add('prescription');
      }
    }

    const requirements: StateRequirement[] = [];
    const issues: string[] = [];

    // Check each product type
    for (const productType of productTypes) {
      const reqs = await this.getStateRequirements(params.state, productType);
      requirements.push(...reqs);

      for (const req of reqs) {
        // Check ID scan requirement
        if (req.requiresIdScan && !order.verificationSession?.documents?.length) {
          issues.push(`ID scan required for ${productType} in ${params.state}`);
        }

        // Check biometric requirement
        if (req.requiresBiometric && !order.verificationSession?.biometric_verified) {
          issues.push(`Biometric verification required for ${productType} in ${params.state}`);
        }

        // Check additional requirements
        for (const additionalReq of req.additionalRequirements) {
          const meetsReq = await this.checkAdditionalRequirement(
            additionalReq,
            order,
            params.state
          );
          if (!meetsReq) {
            issues.push(`Failed to meet requirement: ${additionalReq}`);
          }
        }
      }
    }

    const passed = issues.length === 0;

    // Log compliance check
    await this.logComplianceCheck({
      orderId: params.orderId,
      state: params.state,
      productTypes: Array.from(productTypes),
      passed,
      issues,
    });

    return {
      orderId: params.orderId,
      state: params.state,
      productTypes: Array.from(productTypes),
      passed,
      issues,
      requirements,
    };
  }

  async logVerification(params: {
    sessionId: string;
    orderId: string;
    customerId: string;
    result: any;
    documents: any[];
  }): Promise<void> {
    const logEntry = await prisma.complianceLog.create({
      data: {
        id: uuidv4(),
        action: 'id_verification',
        entity_type: 'verification_session',
        entity_id: params.sessionId,
        order_id: params.orderId,
        customer_id: params.customerId,
        metadata: {
          result: params.result,
          documentCount: params.documents.length,
          documentTypes: params.documents.map(d => d.type),
        },
        created_at: new Date(),
      },
    });

    logger.info('Verification logged for compliance:', {
      logId: logEntry.id,
      sessionId: params.sessionId,
    });

    // Queue for reporting if required
    const state = await this.getOrderState(params.orderId);
    const requirements = await this.getStateRequirements(state);
    
    if (requirements.some(req => req.reportingRequired)) {
      await this.complianceQueue.add('generate-report', {
        logId: logEntry.id,
        orderId: params.orderId,
        state,
      });
    }
  }

  async auditVerification(data: {
    verificationId: string;
    auditType: string;
  }): Promise<void> {
    logger.info('Auditing verification:', data);
    
    // Perform audit checks
    const verification = await prisma.verificationSession.findUnique({
      where: { id: data.verificationId },
      include: {
        documents: true,
        order: true,
      },
    });

    if (!verification) {
      logger.error('Verification not found for audit');
      return;
    }

    const auditResults = {
      documentIntegrity: await this.checkDocumentIntegrity(verification.documents),
      dataConsistency: await this.checkDataConsistency(verification),
      complianceAdherence: await this.checkComplianceAdherence(verification),
    };

    // Create audit record
    await prisma.auditRecord.create({
      data: {
        verification_id: data.verificationId,
        audit_type: data.auditType,
        results: auditResults,
        audited_at: new Date(),
      },
    });
  }

  async generateComplianceReport(data: {
    logId: string;
    orderId: string;
    state: string;
  }): Promise<void> {
    logger.info('Generating compliance report:', data);
    
    // Generate report based on state requirements
    const requirements = await this.getStateRequirements(data.state);
    const reportingReqs = requirements.filter(req => req.reportingRequired);

    for (const req of reportingReqs) {
      const report = await this.createReport(data.orderId, req);
      
      // Submit to appropriate authority
      await this.submitReport(report, req);
    }
  }

  async getAuditLog(params: {
    orderId?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    action?: string;
  }): Promise<AuditLog[]> {
    const where: any = {};

    if (params.orderId) {
      where.order_id = params.orderId;
    }
    if (params.customerId) {
      where.customer_id = params.customerId;
    }
    if (params.action) {
      where.action = params.action;
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

    const logs = await prisma.complianceLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      limit: 1000,
    });

    return logs.map(log => ({
      id: log.id,
      action: log.action,
      entityType: log.entity_type,
      entityId: log.entity_id,
      userId: log.user_id,
      metadata: log.metadata,
      timestamp: log.created_at,
    }));
  }

  async getComplianceMetrics(
    merchantId: string,
    period: string = '30d'
  ): Promise<{
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    complianceRate: number;
    commonIssues: Array<{ issue: string; count: number }>;
    stateBreakdown: Array<{ state: string; rate: number }>;
  }> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get compliance checks for merchant
    const checks = await prisma.$queryRaw`
      SELECT 
        cl.*,
        o.reskflow_state as state
      FROM compliance_logs cl
      JOIN orders o ON cl.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND cl.action = 'compliance_check'
        AND cl.created_at >= ${startDate}
    ` as any[];

    const totalChecks = checks.length;
    const passedChecks = checks.filter(c => c.metadata?.passed === true).length;
    const failedChecks = totalChecks - passedChecks;
    const complianceRate = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 100;

    // Analyze common issues
    const issueCount = new Map<string, number>();
    checks.forEach(check => {
      const issues = check.metadata?.issues || [];
      issues.forEach((issue: string) => {
        issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
      });
    });

    const commonIssues = Array.from(issueCount.entries())
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // State breakdown
    const stateStats = new Map<string, { passed: number; total: number }>();
    checks.forEach(check => {
      const state = check.state;
      const stats = stateStats.get(state) || { passed: 0, total: 0 };
      stats.total++;
      if (check.metadata?.passed) {
        stats.passed++;
      }
      stateStats.set(state, stats);
    });

    const stateBreakdown = Array.from(stateStats.entries())
      .map(([state, stats]) => ({
        state,
        rate: stats.total > 0 ? (stats.passed / stats.total) * 100 : 0,
      }))
      .sort((a, b) => b.rate - a.rate);

    return {
      totalChecks,
      passedChecks,
      failedChecks,
      complianceRate,
      commonIssues,
      stateBreakdown,
    };
  }

  private async checkAdditionalRequirement(
    requirement: string,
    order: any,
    state: string
  ): Promise<boolean> {
    switch (requirement) {
      case 'reskflow_window_restriction':
        return this.checkDeliveryWindow(order, state);
      
      case 'signature_required':
        return !!order.reskflow?.signature_captured;
      
      case 'no_sunday_morning_reskflow':
        const reskflowTime = dayjs(order.reskflow?.delivered_at || new Date());
        return !(reskflowTime.day() === 0 && reskflowTime.hour() < 12);
      
      case 'licensed_reskflow_only':
        return !!order.reskflow?.driver?.license_verified;
      
      case 'medical_card_verification':
        return !!order.medical_card_verified;
      
      case 'quantity_limits':
        return this.checkQuantityLimits(order, state);
      
      case 'valid_prescription':
        return !!order.prescription_verified;
      
      case 'prescriber_verification':
        return !!order.prescriber_verified;
      
      case 'HIPAA_compliance':
        return true; // Assume HIPAA compliance is built into the system
      
      default:
        logger.warn(`Unknown additional requirement: ${requirement}`);
        return true;
    }
  }

  private async checkDeliveryWindow(order: any, state: string): Promise<boolean> {
    const restrictions = {
      'CA': { start: 6, end: 22 }, // 6 AM to 10 PM
      'TX': { start: 7, end: 24 }, // 7 AM to midnight
      'NY': { start: 8, end: 23 }, // 8 AM to 11 PM
    };

    const restriction = restrictions[state as keyof typeof restrictions];
    if (!restriction) return true;

    const reskflowTime = dayjs(order.reskflow?.delivered_at || new Date());
    const hour = reskflowTime.hour();

    return hour >= restriction.start && hour < restriction.end;
  }

  private async checkQuantityLimits(order: any, state: string): Promise<boolean> {
    // Check state-specific quantity limits
    // This would be more complex in production
    return true;
  }

  private async checkDocumentIntegrity(documents: any[]): Promise<boolean> {
    // Verify documents haven't been tampered with
    for (const doc of documents) {
      if (!doc.checksum || !doc.verified) {
        return false;
      }
    }
    return true;
  }

  private async checkDataConsistency(verification: any): Promise<boolean> {
    // Check that verification data is consistent
    if (!verification.result || !verification.completed_at) {
      return false;
    }
    
    // Verify timestamps are logical
    const created = dayjs(verification.created_at);
    const completed = dayjs(verification.completed_at);
    
    return completed.isAfter(created);
  }

  private async checkComplianceAdherence(verification: any): Promise<boolean> {
    // Check that all compliance requirements were met
    const state = verification.order?.reskflow_state;
    if (!state) return false;

    const requirements = await this.getStateRequirements(state);
    
    // Check each requirement
    for (const req of requirements) {
      if (req.requiresIdScan && !verification.documents?.length) {
        return false;
      }
      if (req.requiresBiometric && !verification.biometric_verified) {
        return false;
      }
    }

    return true;
  }

  private async createReport(orderId: string, requirement: StateRequirement): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        orderItems: { include: { item: true } },
        verificationSession: { include: { documents: true } },
      },
    });

    return {
      reportId: uuidv4(),
      orderId,
      state: requirement.state,
      productType: requirement.productType,
      reportDate: new Date(),
      customerInfo: {
        id: order?.customer.id,
        verified: order?.id_verified,
        age: order?.verificationSession?.result?.age,
      },
      items: order?.orderItems.map(item => ({
        name: item.item.name,
        quantity: item.quantity,
        category: item.item.product_type,
      })),
      verificationDetails: {
        method: order?.verificationSession?.verification_type,
        documentsProvided: order?.verificationSession?.documents.map(d => d.type),
        biometricUsed: order?.verificationSession?.biometric_verified,
      },
    };
  }

  private async submitReport(report: any, requirement: StateRequirement): Promise<void> {
    // Submit to appropriate authority based on state and product type
    logger.info('Submitting compliance report:', {
      reportId: report.reportId,
      state: requirement.state,
      productType: requirement.productType,
    });

    // In production, this would submit to actual regulatory APIs
    await prisma.complianceReport.create({
      data: {
        report_id: report.reportId,
        order_id: report.orderId,
        state: report.state,
        product_type: report.productType,
        report_data: report,
        submitted_at: new Date(),
      },
    });
  }

  private async getOrderState(orderId: string): Promise<string> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { reskflow_state: true },
    });
    
    return order?.reskflow_state || 'CA';
  }

  private async logComplianceCheck(check: ComplianceCheck): Promise<void> {
    await prisma.complianceLog.create({
      data: {
        id: uuidv4(),
        action: 'compliance_check',
        entity_type: 'order',
        entity_id: check.orderId,
        order_id: check.orderId,
        metadata: check,
        created_at: new Date(),
      },
    });
  }
}