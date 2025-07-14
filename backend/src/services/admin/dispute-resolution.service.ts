/**
 * Dispute Resolution Service
 * Manages customer complaints, refunds, and conflict resolution
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { paymentService } from '../payment/payment.service';
import { analyticsService } from '../analytics/analytics.service';

const prisma = new PrismaClient();

interface Dispute {
  id: string;
  type: 'order_issue' | 'payment_dispute' | 'service_complaint' | 'reskflow_problem' | 'quality_issue' | 'fraud_claim';
  status: 'open' | 'investigating' | 'pending_response' | 'resolved' | 'escalated' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  orderId?: string;
  customerId: string;
  merchantId?: string;
  driverId?: string;
  amount?: number;
  description: string;
  evidence: Evidence[];
  timeline: TimelineEvent[];
  resolution?: Resolution;
  assignedTo?: string;
  escalatedTo?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date;
}

interface Evidence {
  id: string;
  type: 'text' | 'image' | 'video' | 'document' | 'screenshot' | 'receipt';
  description: string;
  url?: string;
  uploadedBy: string;
  uploadedAt: Date;
  verified: boolean;
}

interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: 'created' | 'updated' | 'message' | 'evidence_added' | 'status_changed' | 'assigned' | 'escalated' | 'resolved';
  description: string;
  performedBy: string;
  metadata?: any;
}

interface Resolution {
  type: 'refund_full' | 'refund_partial' | 'credit' | 'replacement' | 'apology' | 'no_action' | 'compensation';
  amount?: number;
  description: string;
  approvedBy: string;
  implementedAt?: Date;
  followUpRequired: boolean;
  customerSatisfied?: boolean;
}

interface DisputeTemplate {
  id: string;
  name: string;
  type: Dispute['type'];
  category: string;
  suggestedResolution: Partial<Resolution>;
  requiredEvidence: string[];
  automationRules?: AutomationRule[];
  avgResolutionTime: number; // hours
  satisfactionRate: number;
}

interface AutomationRule {
  condition: {
    field: string;
    operator: string;
    value: any;
  };
  action: {
    type: 'auto_refund' | 'auto_assign' | 'auto_escalate' | 'send_notification';
    parameters: any;
  };
}

interface Agent {
  id: string;
  name: string;
  email: string;
  role: 'support' | 'senior_support' | 'manager' | 'specialist';
  specialties: string[];
  availability: 'available' | 'busy' | 'offline';
  activeDisputes: number;
  maxCapacity: number;
  performance: {
    avgResolutionTime: number;
    satisfactionRate: number;
    disputesResolved: number;
  };
}

interface EscalationPath {
  level: number;
  role: string;
  conditions: string[];
  slaHours: number;
  notifyList: string[];
}

interface DisputeAnalytics {
  period: { start: Date; end: Date };
  summary: {
    totalDisputes: number;
    resolvedDisputes: number;
    avgResolutionTime: number;
    satisfactionRate: number;
    refundAmount: number;
  };
  byType: Record<string, { count: number; avgResolutionTime: number }>;
  byMerchant: Array<{ merchantId: string; disputes: number; refunds: number }>;
  commonIssues: Array<{ issue: string; count: number; trend: 'increasing' | 'stable' | 'decreasing' }>;
  agentPerformance: Array<{ agent: Agent; metrics: any }>;
}

export class DisputeResolutionService extends EventEmitter {
  private disputes: Map<string, Dispute> = new Map();
  private agents: Map<string, Agent> = new Map();
  private templates: Map<string, DisputeTemplate> = new Map();
  private escalationPaths: EscalationPath[] = [];
  private slaJob: CronJob;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private async initializeService() {
    // Load active disputes
    await this.loadActiveDisputes();

    // Load agents
    await this.loadAgents();

    // Load templates
    await this.loadDisputeTemplates();

    // Setup escalation paths
    this.setupEscalationPaths();

    // Setup SLA monitoring
    this.slaJob = new CronJob('*/15 * * * *', async () => {
      await this.checkSLACompliance();
    });
    this.slaJob.start();

    // Setup real-time monitoring
    this.setupRealtimeMonitoring();
  }

  /**
   * Create new dispute
   */
  async createDispute(disputeData: {
    type: Dispute['type'];
    customerId: string;
    orderId?: string;
    description: string;
    evidence?: Array<{ type: Evidence['type']; data: any }>;
    priority?: Dispute['priority'];
  }): Promise<Dispute> {
    try {
      // Get related order details if applicable
      let order;
      if (disputeData.orderId) {
        order = await prisma.order.findUnique({
          where: { id: disputeData.orderId },
          include: {
            merchant: true,
            driver: true,
          },
        });
      }

      // Determine priority if not specified
      const priority = disputeData.priority || this.calculatePriority(disputeData);

      // Calculate due date based on priority
      const dueDate = this.calculateDueDate(priority);

      // Create dispute
      const dispute: Dispute = {
        id: `dispute_${Date.now()}`,
        type: disputeData.type,
        status: 'open',
        priority,
        customerId: disputeData.customerId,
        orderId: disputeData.orderId,
        merchantId: order?.merchantId,
        driverId: order?.driverId,
        amount: order?.total,
        description: disputeData.description,
        evidence: [],
        timeline: [
          {
            id: `event_${Date.now()}`,
            timestamp: new Date(),
            type: 'created',
            description: 'Dispute created',
            performedBy: disputeData.customerId,
          },
        ],
        tags: this.generateTags(disputeData),
        createdAt: new Date(),
        updatedAt: new Date(),
        dueDate,
      };

      // Process initial evidence
      if (disputeData.evidence) {
        for (const evidence of disputeData.evidence) {
          await this.addEvidence(dispute.id, evidence);
        }
      }

      // Save to database
      await prisma.dispute.create({
        data: dispute,
      });

      this.disputes.set(dispute.id, dispute);

      // Auto-assign if possible
      await this.autoAssignDispute(dispute);

      // Check automation rules
      await this.checkAutomationRules(dispute);

      // Send notifications
      await this.sendDisputeNotifications(dispute, 'created');

      this.emit('dispute:created', dispute);

      return dispute;

    } catch (error) {
      logger.error('Failed to create dispute', error);
      throw error;
    }
  }

  /**
   * Update dispute status
   */
  async updateDisputeStatus(
    disputeId: string,
    status: Dispute['status'],
    updatedBy: string,
    notes?: string
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      const previousStatus = dispute.status;
      dispute.status = status;
      dispute.updatedAt = new Date();

      // Add timeline event
      dispute.timeline.push({
        id: `event_${Date.now()}`,
        timestamp: new Date(),
        type: 'status_changed',
        description: `Status changed from ${previousStatus} to ${status}`,
        performedBy: updatedBy,
        metadata: { previousStatus, newStatus: status, notes },
      });

      // Update database
      await prisma.dispute.update({
        where: { id: disputeId },
        data: dispute,
      });

      // Handle status-specific actions
      await this.handleStatusChange(dispute, previousStatus, status);

      // Send notifications
      await this.sendDisputeNotifications(dispute, 'status_changed');

      this.emit('dispute:status_changed', {
        disputeId,
        previousStatus,
        newStatus: status,
      });

    } catch (error) {
      logger.error('Failed to update dispute status', error);
      throw error;
    }
  }

  /**
   * Assign dispute to agent
   */
  async assignDispute(
    disputeId: string,
    agentId: string,
    assignedBy: string
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      const agent = this.agents.get(agentId);

      if (!dispute) {
        throw new Error('Dispute not found');
      }

      if (!agent) {
        throw new Error('Agent not found');
      }

      if (agent.activeDisputes >= agent.maxCapacity) {
        throw new Error('Agent at maximum capacity');
      }

      // Update dispute
      dispute.assignedTo = agentId;
      dispute.status = 'investigating';
      dispute.updatedAt = new Date();

      dispute.timeline.push({
        id: `event_${Date.now()}`,
        timestamp: new Date(),
        type: 'assigned',
        description: `Assigned to ${agent.name}`,
        performedBy: assignedBy,
      });

      // Update agent
      agent.activeDisputes += 1;

      await prisma.dispute.update({
        where: { id: disputeId },
        data: dispute,
      });

      // Send notifications
      await this.notifyAgentAssignment(dispute, agent);

      this.emit('dispute:assigned', {
        disputeId,
        agentId,
      });

    } catch (error) {
      logger.error('Failed to assign dispute', error);
      throw error;
    }
  }

  /**
   * Add message to dispute
   */
  async addMessage(
    disputeId: string,
    message: {
      sender: string;
      senderType: 'customer' | 'merchant' | 'driver' | 'agent' | 'system';
      content: string;
      attachments?: string[];
    }
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      // Add to timeline
      dispute.timeline.push({
        id: `event_${Date.now()}`,
        timestamp: new Date(),
        type: 'message',
        description: 'Message added',
        performedBy: message.sender,
        metadata: {
          senderType: message.senderType,
          content: message.content,
          attachments: message.attachments,
        },
      });

      dispute.updatedAt = new Date();

      // Update status if pending response
      if (dispute.status === 'pending_response' && message.senderType === 'customer') {
        dispute.status = 'investigating';
      }

      await prisma.dispute.update({
        where: { id: disputeId },
        data: dispute,
      });

      // Notify relevant parties
      await this.notifyNewMessage(dispute, message);

      this.emit('dispute:message_added', {
        disputeId,
        message,
      });

    } catch (error) {
      logger.error('Failed to add message', error);
      throw error;
    }
  }

  /**
   * Add evidence to dispute
   */
  async addEvidence(
    disputeId: string,
    evidence: {
      type: Evidence['type'];
      data: any;
      uploadedBy?: string;
    }
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      // Process and store evidence
      let url;
      if (evidence.type === 'image' || evidence.type === 'video' || evidence.type === 'document') {
        url = await storageService.uploadFile(
          evidence.data,
          `disputes/${disputeId}/evidence_${Date.now()}`
        );
      }

      const newEvidence: Evidence = {
        id: `evidence_${Date.now()}`,
        type: evidence.type,
        description: evidence.data.description || '',
        url,
        uploadedBy: evidence.uploadedBy || dispute.customerId,
        uploadedAt: new Date(),
        verified: false,
      };

      dispute.evidence.push(newEvidence);
      dispute.updatedAt = new Date();

      dispute.timeline.push({
        id: `event_${Date.now()}`,
        timestamp: new Date(),
        type: 'evidence_added',
        description: `${evidence.type} evidence added`,
        performedBy: newEvidence.uploadedBy,
      });

      await prisma.dispute.update({
        where: { id: disputeId },
        data: dispute,
      });

      // Analyze evidence
      await this.analyzeEvidence(dispute, newEvidence);

      this.emit('dispute:evidence_added', {
        disputeId,
        evidenceId: newEvidence.id,
      });

    } catch (error) {
      logger.error('Failed to add evidence', error);
      throw error;
    }
  }

  /**
   * Propose resolution
   */
  async proposeResolution(
    disputeId: string,
    resolution: Omit<Resolution, 'implementedAt'>,
    proposedBy: string
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      dispute.resolution = {
        ...resolution,
        approvedBy: proposedBy,
      };

      dispute.status = 'pending_response';
      dispute.updatedAt = new Date();

      dispute.timeline.push({
        id: `event_${Date.now()}`,
        timestamp: new Date(),
        type: 'updated',
        description: `Resolution proposed: ${resolution.type}`,
        performedBy: proposedBy,
        metadata: { resolution },
      });

      await prisma.dispute.update({
        where: { id: disputeId },
        data: dispute,
      });

      // Notify customer of proposed resolution
      await this.notifyResolutionProposal(dispute);

      this.emit('dispute:resolution_proposed', {
        disputeId,
        resolution,
      });

    } catch (error) {
      logger.error('Failed to propose resolution', error);
      throw error;
    }
  }

  /**
   * Implement resolution
   */
  async implementResolution(
    disputeId: string,
    approved: boolean,
    implementedBy: string
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute || !dispute.resolution) {
        throw new Error('Dispute or resolution not found');
      }

      if (!approved) {
        dispute.status = 'investigating';
        dispute.resolution = undefined;
        dispute.updatedAt = new Date();

        dispute.timeline.push({
          id: `event_${Date.now()}`,
          timestamp: new Date(),
          type: 'updated',
          description: 'Resolution rejected by customer',
          performedBy: dispute.customerId,
        });

        await prisma.dispute.update({
          where: { id: disputeId },
          data: dispute,
        });

        return;
      }

      // Implement the resolution
      try {
        await this.executeResolution(dispute);

        dispute.resolution.implementedAt = new Date();
        dispute.status = 'resolved';
        dispute.updatedAt = new Date();

        dispute.timeline.push({
          id: `event_${Date.now()}`,
          timestamp: new Date(),
          type: 'resolved',
          description: `Resolution implemented: ${dispute.resolution.type}`,
          performedBy: implementedBy,
        });

        await prisma.dispute.update({
          where: { id: disputeId },
          data: dispute,
        });

        // Schedule follow-up if required
        if (dispute.resolution.followUpRequired) {
          await this.scheduleFollowUp(dispute);
        }

        // Update agent metrics
        if (dispute.assignedTo) {
          await this.updateAgentMetrics(dispute.assignedTo, dispute);
        }

        this.emit('dispute:resolved', dispute);

      } catch (error) {
        logger.error('Failed to execute resolution', error);
        throw new Error('Failed to implement resolution');
      }

    } catch (error) {
      logger.error('Failed to implement resolution', error);
      throw error;
    }
  }

  /**
   * Escalate dispute
   */
  async escalateDispute(
    disputeId: string,
    reason: string,
    escalatedBy: string
  ): Promise<void> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      // Find next escalation level
      const currentLevel = this.getCurrentEscalationLevel(dispute);
      const nextLevel = this.escalationPaths.find(path => path.level === currentLevel + 1);

      if (!nextLevel) {
        throw new Error('No higher escalation level available');
      }

      // Find appropriate senior agent
      const seniorAgent = await this.findSeniorAgent(nextLevel.role);

      dispute.escalatedTo = seniorAgent.id;
      dispute.status = 'escalated';
      dispute.priority = 'urgent';
      dispute.updatedAt = new Date();

      dispute.timeline.push({
        id: `event_${Date.now()}`,
        timestamp: new Date(),
        type: 'escalated',
        description: `Escalated to ${seniorAgent.name}: ${reason}`,
        performedBy: escalatedBy,
        metadata: { reason, level: nextLevel.level },
      });

      await prisma.dispute.update({
        where: { id: disputeId },
        data: dispute,
      });

      // Notify escalation
      await this.notifyEscalation(dispute, seniorAgent, nextLevel);

      this.emit('dispute:escalated', {
        disputeId,
        level: nextLevel.level,
        assignedTo: seniorAgent.id,
      });

    } catch (error) {
      logger.error('Failed to escalate dispute', error);
      throw error;
    }
  }

  /**
   * Get dispute analytics
   */
  async getDisputeAnalytics(
    timeRange: { start: Date; end: Date },
    filters?: {
      merchantId?: string;
      type?: Dispute['type'];
      agentId?: string;
    }
  ): Promise<DisputeAnalytics> {
    try {
      // Get disputes in time range
      let disputes = await prisma.dispute.findMany({
        where: {
          createdAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
          ...(filters?.merchantId && { merchantId: filters.merchantId }),
          ...(filters?.type && { type: filters.type }),
          ...(filters?.agentId && { assignedTo: filters.agentId }),
        },
      });

      const resolvedDisputes = disputes.filter(d => d.status === 'resolved');

      // Calculate summary metrics
      const summary = {
        totalDisputes: disputes.length,
        resolvedDisputes: resolvedDisputes.length,
        avgResolutionTime: this.calculateAvgResolutionTime(resolvedDisputes),
        satisfactionRate: await this.calculateSatisfactionRate(resolvedDisputes),
        refundAmount: this.calculateTotalRefunds(resolvedDisputes),
      };

      // Group by type
      const byType = this.groupDisputesByType(disputes);

      // Group by merchant
      const byMerchant = await this.groupDisputesByMerchant(disputes);

      // Identify common issues
      const commonIssues = await this.identifyCommonIssues(disputes);

      // Get agent performance
      const agentPerformance = await this.getAgentPerformance(timeRange);

      return {
        period: timeRange,
        summary,
        byType,
        byMerchant,
        commonIssues,
        agentPerformance,
      };

    } catch (error) {
      logger.error('Failed to get dispute analytics', error);
      throw error;
    }
  }

  /**
   * Get suggested resolutions
   */
  async getSuggestedResolutions(disputeId: string): Promise<{
    templates: DisputeTemplate[];
    similarDisputes: Array<{
      dispute: Dispute;
      similarity: number;
      resolution: Resolution;
    }>;
    recommendedAction: Resolution;
  }> {
    try {
      const dispute = this.disputes.get(disputeId);
      if (!dispute) {
        throw new Error('Dispute not found');
      }

      // Get matching templates
      const templates = Array.from(this.templates.values())
        .filter(t => t.type === dispute.type)
        .sort((a, b) => b.satisfactionRate - a.satisfactionRate);

      // Find similar resolved disputes
      const similarDisputes = await this.findSimilarDisputes(dispute);

      // Generate recommended action
      const recommendedAction = this.generateRecommendedResolution(
        dispute,
        templates[0],
        similarDisputes
      );

      return {
        templates,
        similarDisputes,
        recommendedAction,
      };

    } catch (error) {
      logger.error('Failed to get suggested resolutions', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async loadActiveDisputes(): Promise<void> {
    const disputes = await prisma.dispute.findMany({
      where: {
        status: {
          notIn: ['resolved', 'closed'],
        },
      },
    });

    disputes.forEach(dispute => {
      this.disputes.set(dispute.id, dispute);
    });
  }

  private async loadAgents(): Promise<void> {
    // Load support agents
    const agents: Agent[] = [
      {
        id: 'agent_1',
        name: 'Sarah Johnson',
        email: 'sarah@support.reskflow.com',
        role: 'support',
        specialties: ['order_issues', 'payment_disputes'],
        availability: 'available',
        activeDisputes: 0,
        maxCapacity: 10,
        performance: {
          avgResolutionTime: 2.5,
          satisfactionRate: 0.92,
          disputesResolved: 150,
        },
      },
      {
        id: 'agent_2',
        name: 'Mike Chen',
        email: 'mike@support.reskflow.com',
        role: 'senior_support',
        specialties: ['quality_issues', 'fraud_claims'],
        availability: 'available',
        activeDisputes: 0,
        maxCapacity: 8,
        performance: {
          avgResolutionTime: 3.2,
          satisfactionRate: 0.95,
          disputesResolved: 280,
        },
      },
      {
        id: 'agent_3',
        name: 'Lisa Martinez',
        email: 'lisa@support.reskflow.com',
        role: 'manager',
        specialties: ['escalations', 'complex_cases'],
        availability: 'available',
        activeDisputes: 0,
        maxCapacity: 5,
        performance: {
          avgResolutionTime: 4.1,
          satisfactionRate: 0.98,
          disputesResolved: 120,
        },
      },
    ];

    agents.forEach(agent => {
      this.agents.set(agent.id, agent);
    });
  }

  private async loadDisputeTemplates(): Promise<void> {
    const templates: DisputeTemplate[] = [
      {
        id: 'template_wrong_order',
        name: 'Wrong Order Delivered',
        type: 'order_issue',
        category: 'reskflow',
        suggestedResolution: {
          type: 'replacement',
          description: 'Send correct order at no additional charge',
          followUpRequired: true,
        },
        requiredEvidence: ['order_photo', 'receipt'],
        automationRules: [
          {
            condition: { field: 'amount', operator: 'less_than', value: 50 },
            action: { type: 'auto_refund', parameters: { percentage: 100 } },
          },
        ],
        avgResolutionTime: 2,
        satisfactionRate: 0.88,
      },
      {
        id: 'template_missing_items',
        name: 'Missing Items',
        type: 'order_issue',
        category: 'reskflow',
        suggestedResolution: {
          type: 'refund_partial',
          description: 'Refund for missing items',
          followUpRequired: false,
        },
        requiredEvidence: ['order_photo'],
        avgResolutionTime: 1.5,
        satisfactionRate: 0.85,
      },
      {
        id: 'template_quality_issue',
        name: 'Food Quality Issue',
        type: 'quality_issue',
        category: 'merchant',
        suggestedResolution: {
          type: 'refund_full',
          description: 'Full refund for quality issues',
          followUpRequired: true,
        },
        requiredEvidence: ['food_photo', 'description'],
        avgResolutionTime: 3,
        satisfactionRate: 0.82,
      },
      {
        id: 'template_late_reskflow',
        name: 'Extremely Late Delivery',
        type: 'reskflow_problem',
        category: 'driver',
        suggestedResolution: {
          type: 'credit',
          amount: 10,
          description: 'Credit for future orders',
          followUpRequired: false,
        },
        requiredEvidence: ['order_timeline'],
        avgResolutionTime: 1,
        satisfactionRate: 0.75,
      },
    ];

    templates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  private setupEscalationPaths(): void {
    this.escalationPaths = [
      {
        level: 1,
        role: 'support',
        conditions: ['initial_assignment'],
        slaHours: 4,
        notifyList: [],
      },
      {
        level: 2,
        role: 'senior_support',
        conditions: ['unresolved_24h', 'customer_request', 'high_value'],
        slaHours: 2,
        notifyList: ['manager'],
      },
      {
        level: 3,
        role: 'manager',
        conditions: ['unresolved_48h', 'legal_threat', 'media_attention'],
        slaHours: 1,
        notifyList: ['director', 'legal'],
      },
    ];
  }

  private setupRealtimeMonitoring(): void {
    // Monitor order issues
    this.on('order:issue_reported', async (data) => {
      await this.createDispute({
        type: 'order_issue',
        customerId: data.customerId,
        orderId: data.orderId,
        description: data.issue,
      });
    });

    // Monitor payment disputes
    this.on('payment:disputed', async (data) => {
      await this.createDispute({
        type: 'payment_dispute',
        customerId: data.customerId,
        orderId: data.orderId,
        description: data.reason,
        priority: 'high',
      });
    });
  }

  private calculatePriority(disputeData: any): Dispute['priority'] {
    // High priority for fraud claims
    if (disputeData.type === 'fraud_claim') return 'urgent';

    // High priority for high-value orders
    if (disputeData.amount && disputeData.amount > 100) return 'high';

    // Medium priority for quality issues
    if (disputeData.type === 'quality_issue') return 'medium';

    return 'low';
  }

  private calculateDueDate(priority: Dispute['priority']): Date {
    const hoursToAdd = {
      urgent: 2,
      high: 12,
      medium: 24,
      low: 48,
    };

    return new Date(Date.now() + hoursToAdd[priority] * 60 * 60 * 1000);
  }

  private generateTags(disputeData: any): string[] {
    const tags: string[] = [disputeData.type];

    if (disputeData.orderId) tags.push('has_order');
    if (disputeData.amount && disputeData.amount > 50) tags.push('high_value');

    // Add keyword-based tags
    const keywords = ['refund', 'wrong', 'missing', 'cold', 'late', 'rude'];
    keywords.forEach(keyword => {
      if (disputeData.description.toLowerCase().includes(keyword)) {
        tags.push(keyword);
      }
    });

    return tags;
  }

  private async autoAssignDispute(dispute: Dispute): Promise<void> {
    // Find best available agent
    const availableAgents = Array.from(this.agents.values())
      .filter(agent => 
        agent.availability === 'available' &&
        agent.activeDisputes < agent.maxCapacity &&
        agent.specialties.includes(dispute.type)
      )
      .sort((a, b) => {
        // Sort by availability and performance
        const aScore = (1 - a.activeDisputes / a.maxCapacity) * a.performance.satisfactionRate;
        const bScore = (1 - b.activeDisputes / b.maxCapacity) * b.performance.satisfactionRate;
        return bScore - aScore;
      });

    if (availableAgents.length > 0) {
      await this.assignDispute(dispute.id, availableAgents[0].id, 'system');
    }
  }

  private async checkAutomationRules(dispute: Dispute): Promise<void> {
    // Check template automation rules
    const template = Array.from(this.templates.values())
      .find(t => t.type === dispute.type);

    if (template?.automationRules) {
      for (const rule of template.automationRules) {
        if (this.evaluateCondition(dispute, rule.condition)) {
          await this.executeAutomation(dispute, rule.action);
        }
      }
    }
  }

  private evaluateCondition(dispute: Dispute, condition: any): boolean {
    const value = dispute[condition.field as keyof Dispute];

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'less_than':
        return Number(value) < condition.value;
      case 'greater_than':
        return Number(value) > condition.value;
      default:
        return false;
    }
  }

  private async executeAutomation(dispute: Dispute, action: any): Promise<void> {
    switch (action.type) {
      case 'auto_refund':
        const refundAmount = dispute.amount! * (action.parameters.percentage / 100);
        await this.proposeResolution(dispute.id, {
          type: 'refund_full',
          amount: refundAmount,
          description: 'Automated refund based on policy',
          approvedBy: 'system',
          followUpRequired: false,
        }, 'system');
        break;

      case 'auto_assign':
        await this.autoAssignDispute(dispute);
        break;

      case 'auto_escalate':
        await this.escalateDispute(dispute.id, 'Automated escalation', 'system');
        break;
    }
  }

  private async sendDisputeNotifications(dispute: Dispute, event: string): Promise<void> {
    // Notify customer
    await notificationService.sendCustomerNotification(
      dispute.customerId,
      this.getNotificationTitle(event),
      this.getNotificationMessage(dispute, event),
      {
        type: 'dispute_update',
        disputeId: dispute.id,
        event,
      }
    );

    // Notify assigned agent
    if (dispute.assignedTo) {
      const agent = this.agents.get(dispute.assignedTo);
      if (agent) {
        await notificationService.sendEmail(
          agent.email,
          `dispute_${event}`,
          {
            disputeId: dispute.id,
            type: dispute.type,
            priority: dispute.priority,
          }
        );
      }
    }

    // Notify merchant if applicable
    if (dispute.merchantId && ['created', 'resolved'].includes(event)) {
      await notificationService.sendMerchantNotification(
        dispute.merchantId,
        this.getNotificationTitle(event),
        this.getNotificationMessage(dispute, event),
        {
          type: 'dispute_update',
          disputeId: dispute.id,
          event,
        }
      );
    }
  }

  private getNotificationTitle(event: string): string {
    const titles: Record<string, string> = {
      created: 'Dispute Created',
      status_changed: 'Dispute Status Updated',
      resolved: 'Dispute Resolved',
      escalated: 'Dispute Escalated',
    };

    return titles[event] || 'Dispute Update';
  }

  private getNotificationMessage(dispute: Dispute, event: string): string {
    const messages: Record<string, string> = {
      created: `Your dispute #${dispute.id} has been received and will be reviewed shortly.`,
      status_changed: `Your dispute #${dispute.id} status has been updated to ${dispute.status}.`,
      resolved: `Your dispute #${dispute.id} has been resolved. ${dispute.resolution?.description || ''}`,
      escalated: `Your dispute #${dispute.id} has been escalated to senior support for priority handling.`,
    };

    return messages[event] || `Update on your dispute #${dispute.id}`;
  }

  private async handleStatusChange(
    dispute: Dispute,
    previousStatus: string,
    newStatus: string
  ): Promise<void> {
    // Update agent availability when resolved
    if (newStatus === 'resolved' && dispute.assignedTo) {
      const agent = this.agents.get(dispute.assignedTo);
      if (agent) {
        agent.activeDisputes = Math.max(0, agent.activeDisputes - 1);
      }
    }

    // Schedule SLA check for investigating status
    if (newStatus === 'investigating') {
      setTimeout(async () => {
        await this.checkDisputeSLA(dispute.id);
      }, 60 * 60 * 1000); // Check after 1 hour
    }
  }

  private async notifyAgentAssignment(dispute: Dispute, agent: Agent): Promise<void> {
    await notificationService.sendEmail(
      agent.email,
      'dispute_assigned',
      {
        disputeId: dispute.id,
        type: dispute.type,
        priority: dispute.priority,
        dueDate: dispute.dueDate,
        description: dispute.description,
      }
    );

    // Send push notification for urgent disputes
    if (dispute.priority === 'urgent') {
      await notificationService.sendWebSocketEvent(
        `agent_${agent.id}`,
        'urgent_dispute_assigned',
        dispute
      );
    }
  }

  private async notifyNewMessage(dispute: Dispute, message: any): Promise<void> {
    const recipients = new Set<string>();

    // Add customer
    recipients.add(dispute.customerId);

    // Add assigned agent
    if (dispute.assignedTo) {
      recipients.add(dispute.assignedTo);
    }

    // Add merchant if applicable
    if (dispute.merchantId && ['merchant', 'agent'].includes(message.senderType)) {
      recipients.add(dispute.merchantId);
    }

    // Remove sender
    recipients.delete(message.sender);

    // Send notifications
    for (const recipientId of recipients) {
      await notificationService.sendWebSocketEvent(
        recipientId,
        'dispute_new_message',
        {
          disputeId: dispute.id,
          message,
        }
      );
    }
  }

  private async analyzeEvidence(dispute: Dispute, evidence: Evidence): Promise<void> {
    // Verify evidence authenticity
    if (evidence.type === 'image' || evidence.type === 'screenshot') {
      // In real implementation, would use image analysis
      evidence.verified = true;
    }

    // Update dispute priority based on evidence
    if (evidence.type === 'receipt' && dispute.amount && dispute.amount > 100) {
      dispute.priority = 'high';
    }
  }

  private async notifyResolutionProposal(dispute: Dispute): Promise<void> {
    await notificationService.sendCustomerNotification(
      dispute.customerId,
      'Resolution Proposed',
      `A resolution has been proposed for your dispute. Please review and respond.`,
      {
        type: 'resolution_proposed',
        disputeId: dispute.id,
        resolution: dispute.resolution,
      }
    );
  }

  private async executeResolution(dispute: Dispute): Promise<void> {
    if (!dispute.resolution) return;

    switch (dispute.resolution.type) {
      case 'refund_full':
      case 'refund_partial':
        if (dispute.orderId && dispute.resolution.amount) {
          await paymentService.processRefund(
            dispute.orderId,
            dispute.resolution.amount,
            `Dispute resolution: ${dispute.id}`
          );
        }
        break;

      case 'credit':
        if (dispute.resolution.amount) {
          await this.issueCreditToCustomer(
            dispute.customerId,
            dispute.resolution.amount
          );
        }
        break;

      case 'replacement':
        if (dispute.orderId) {
          await this.createReplacementOrder(dispute.orderId);
        }
        break;

      case 'compensation':
        // Custom compensation logic
        break;
    }
  }

  private async issueCreditToCustomer(customerId: string, amount: number): Promise<void> {
    await prisma.customerCredit.create({
      data: {
        customerId,
        amount,
        reason: 'Dispute resolution',
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      },
    });
  }

  private async createReplacementOrder(originalOrderId: string): Promise<void> {
    const originalOrder = await prisma.order.findUnique({
      where: { id: originalOrderId },
      include: { items: true },
    });

    if (!originalOrder) return;

    // Create new order with same items
    await prisma.order.create({
      data: {
        ...originalOrder,
        id: `order_${Date.now()}`,
        orderNumber: `REPLACEMENT-${originalOrder.orderNumber}`,
        total: 0, // No charge for replacement
        notes: `Replacement for order ${originalOrder.orderNumber}`,
      },
    });
  }

  private async scheduleFollowUp(dispute: Dispute): Promise<void> {
    // Schedule follow-up after 3 days
    setTimeout(async () => {
      await this.conductFollowUp(dispute.id);
    }, 3 * 24 * 60 * 60 * 1000);
  }

  private async conductFollowUp(disputeId: string): Promise<void> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute || dispute.status !== 'resolved') return;

    // Send satisfaction survey
    await notificationService.sendCustomerNotification(
      dispute.customerId,
      'How was your experience?',
      'We\'d love to hear your feedback on how we handled your recent issue.',
      {
        type: 'dispute_followup',
        disputeId: dispute.id,
        surveyLink: `${process.env.FRONTEND_URL}/survey/dispute/${dispute.id}`,
      }
    );
  }

  private async updateAgentMetrics(agentId: string, dispute: Dispute): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Calculate resolution time
    const resolutionTime = dispute.resolution?.implementedAt
      ? (dispute.resolution.implementedAt.getTime() - dispute.createdAt.getTime()) / (60 * 60 * 1000)
      : 0;

    // Update metrics
    agent.performance.disputesResolved += 1;
    agent.performance.avgResolutionTime = 
      (agent.performance.avgResolutionTime * (agent.performance.disputesResolved - 1) + resolutionTime) /
      agent.performance.disputesResolved;
  }

  private getCurrentEscalationLevel(dispute: Dispute): number {
    if (dispute.escalatedTo) {
      const escalatedAgent = this.agents.get(dispute.escalatedTo);
      if (escalatedAgent) {
        return this.escalationPaths.findIndex(p => p.role === escalatedAgent.role) + 1;
      }
    }
    return 0;
  }

  private async findSeniorAgent(role: string): Promise<Agent> {
    const seniorAgents = Array.from(this.agents.values())
      .filter(agent => agent.role === role && agent.availability === 'available')
      .sort((a, b) => b.performance.satisfactionRate - a.performance.satisfactionRate);

    if (seniorAgents.length === 0) {
      throw new Error(`No available ${role} agents`);
    }

    return seniorAgents[0];
  }

  private async notifyEscalation(
    dispute: Dispute,
    agent: Agent,
    escalationPath: EscalationPath
  ): Promise<void> {
    // Notify new agent
    await notificationService.sendEmail(
      agent.email,
      'escalated_dispute_assigned',
      {
        disputeId: dispute.id,
        escalationLevel: escalationPath.level,
        slaHours: escalationPath.slaHours,
      }
    );

    // Notify people on notify list
    for (const role of escalationPath.notifyList) {
      // Send notification to role-based email
      await notificationService.sendEmail(
        `${role}@reskflow.com`,
        'dispute_escalated',
        {
          disputeId: dispute.id,
          level: escalationPath.level,
          assignedTo: agent.name,
        }
      );
    }
  }

  private async checkSLACompliance(): Promise<void> {
    const now = new Date();

    for (const [disputeId, dispute] of this.disputes) {
      if (dispute.status === 'resolved' || dispute.status === 'closed') continue;

      const hoursSinceCreated = (now.getTime() - dispute.createdAt.getTime()) / (60 * 60 * 1000);
      const isOverdue = now > dispute.dueDate;

      // Check if needs escalation
      const currentLevel = this.getCurrentEscalationLevel(dispute);
      const currentPath = this.escalationPaths[currentLevel];

      if (currentPath && hoursSinceCreated > currentPath.slaHours && !isOverdue) {
        // Auto-escalate if SLA breached
        await this.escalateDispute(
          disputeId,
          'SLA breach - automatic escalation',
          'system'
        );
      }

      // Alert if overdue
      if (isOverdue && dispute.status !== 'escalated') {
        await this.alertOverdueDispute(dispute);
      }
    }
  }

  private async alertOverdueDispute(dispute: Dispute): Promise<void> {
    if (dispute.assignedTo) {
      const agent = this.agents.get(dispute.assignedTo);
      if (agent) {
        await notificationService.sendEmail(
          agent.email,
          'dispute_overdue',
          {
            disputeId: dispute.id,
            dueDate: dispute.dueDate,
            hoursOverdue: Math.round((Date.now() - dispute.dueDate.getTime()) / (60 * 60 * 1000)),
          }
        );
      }
    }

    // Alert manager
    await notificationService.sendWebSocketEvent(
      'support_dashboard',
      'dispute_overdue',
      dispute
    );
  }

  private async checkDisputeSLA(disputeId: string): Promise<void> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute || dispute.status === 'resolved') return;

    const hoursSinceCreated = (Date.now() - dispute.createdAt.getTime()) / (60 * 60 * 1000);

    // Check escalation conditions
    if (hoursSinceCreated > 24 && dispute.priority === 'high') {
      await this.escalateDispute(disputeId, 'High priority - 24h without resolution', 'system');
    }
  }

  private calculateAvgResolutionTime(disputes: Dispute[]): number {
    if (disputes.length === 0) return 0;

    const totalTime = disputes.reduce((sum, dispute) => {
      if (dispute.resolution?.implementedAt) {
        return sum + (dispute.resolution.implementedAt.getTime() - dispute.createdAt.getTime());
      }
      return sum;
    }, 0);

    return totalTime / disputes.length / (60 * 60 * 1000); // Convert to hours
  }

  private async calculateSatisfactionRate(disputes: Dispute[]): Promise<number> {
    if (disputes.length === 0) return 0;

    const satisfied = disputes.filter(d => 
      d.resolution?.customerSatisfied === true
    ).length;

    return satisfied / disputes.length;
  }

  private calculateTotalRefunds(disputes: Dispute[]): number {
    return disputes.reduce((sum, dispute) => {
      if (dispute.resolution && 
          ['refund_full', 'refund_partial'].includes(dispute.resolution.type) &&
          dispute.resolution.amount) {
        return sum + dispute.resolution.amount;
      }
      return sum;
    }, 0);
  }

  private groupDisputesByType(
    disputes: Dispute[]
  ): Record<string, { count: number; avgResolutionTime: number }> {
    const groups: Record<string, Dispute[]> = {};

    disputes.forEach(dispute => {
      if (!groups[dispute.type]) {
        groups[dispute.type] = [];
      }
      groups[dispute.type].push(dispute);
    });

    const result: Record<string, { count: number; avgResolutionTime: number }> = {};

    Object.entries(groups).forEach(([type, typeDisputes]) => {
      result[type] = {
        count: typeDisputes.length,
        avgResolutionTime: this.calculateAvgResolutionTime(
          typeDisputes.filter(d => d.status === 'resolved')
        ),
      };
    });

    return result;
  }

  private async groupDisputesByMerchant(
    disputes: Dispute[]
  ): Promise<Array<{ merchantId: string; disputes: number; refunds: number }>> {
    const merchantMap = new Map<string, { disputes: number; refunds: number }>();

    disputes.forEach(dispute => {
      if (dispute.merchantId) {
        const existing = merchantMap.get(dispute.merchantId) || { disputes: 0, refunds: 0 };
        existing.disputes += 1;
        
        if (dispute.resolution && 
            ['refund_full', 'refund_partial'].includes(dispute.resolution.type) &&
            dispute.resolution.amount) {
          existing.refunds += dispute.resolution.amount;
        }

        merchantMap.set(dispute.merchantId, existing);
      }
    });

    return Array.from(merchantMap.entries())
      .map(([merchantId, data]) => ({ merchantId, ...data }))
      .sort((a, b) => b.disputes - a.disputes)
      .slice(0, 10);
  }

  private async identifyCommonIssues(
    disputes: Dispute[]
  ): Promise<Array<{ issue: string; count: number; trend: 'increasing' | 'stable' | 'decreasing' }>> {
    const issueCount = new Map<string, number>();

    // Count tags
    disputes.forEach(dispute => {
      dispute.tags.forEach(tag => {
        issueCount.set(tag, (issueCount.get(tag) || 0) + 1);
      });
    });

    // Get top issues
    const topIssues = Array.from(issueCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([issue, count]) => ({
        issue,
        count,
        trend: 'stable' as const, // Would calculate actual trend from historical data
      }));

    return topIssues;
  }

  private async getAgentPerformance(
    timeRange: { start: Date; end: Date }
  ): Promise<Array<{ agent: Agent; metrics: any }>> {
    const agentMetrics = [];

    for (const agent of this.agents.values()) {
      const agentDisputes = await prisma.dispute.findMany({
        where: {
          assignedTo: agent.id,
          createdAt: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
      });

      const resolved = agentDisputes.filter(d => d.status === 'resolved');
      const avgResolutionTime = this.calculateAvgResolutionTime(resolved);
      const satisfactionRate = await this.calculateSatisfactionRate(resolved);

      agentMetrics.push({
        agent,
        metrics: {
          totalHandled: agentDisputes.length,
          resolved: resolved.length,
          avgResolutionTime,
          satisfactionRate,
          currentLoad: agent.activeDisputes,
          capacity: agent.maxCapacity,
        },
      });
    }

    return agentMetrics.sort((a, b) => b.metrics.resolved - a.metrics.resolved);
  }

  private async findSimilarDisputes(dispute: Dispute): Promise<Array<{
    dispute: Dispute;
    similarity: number;
    resolution: Resolution;
  }>> {
    // Find resolved disputes of same type
    const similarDisputes = await prisma.dispute.findMany({
      where: {
        type: dispute.type,
        status: 'resolved',
        id: { not: dispute.id },
        resolution: { not: null },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 10,
    });

    // Calculate similarity based on tags and description
    return similarDisputes
      .map(similar => {
        const commonTags = dispute.tags.filter(tag => similar.tags.includes(tag)).length;
        const similarity = commonTags / Math.max(dispute.tags.length, similar.tags.length);

        return {
          dispute: similar,
          similarity,
          resolution: similar.resolution!,
        };
      })
      .filter(item => item.similarity > 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  private generateRecommendedResolution(
    dispute: Dispute,
    template: DisputeTemplate | undefined,
    similarDisputes: Array<any>
  ): Resolution {
    // Use template if available
    if (template) {
      return {
        ...template.suggestedResolution,
        approvedBy: 'system',
      } as Resolution;
    }

    // Use most common resolution from similar disputes
    if (similarDisputes.length > 0) {
      const resolutionTypes = similarDisputes.map(s => s.resolution.type);
      const mostCommon = this.getMostCommonElement(resolutionTypes);

      return {
        type: mostCommon,
        description: `Based on similar cases`,
        approvedBy: 'system',
        followUpRequired: true,
      };
    }

    // Default resolution
    return {
      type: 'credit',
      amount: 10,
      description: 'Credit for inconvenience',
      approvedBy: 'system',
      followUpRequired: true,
    };
  }

  private getMostCommonElement<T>(arr: T[]): T {
    const counts = new Map<T, number>();
    arr.forEach(item => {
      counts.set(item, (counts.get(item) || 0) + 1);
    });

    let maxCount = 0;
    let mostCommon = arr[0];

    counts.forEach((count, item) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    });

    return mostCommon;
  }
}

// Export singleton instance
export const disputeResolutionService = new DisputeResolutionService();