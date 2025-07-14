import mongoose from 'mongoose';
import { 
  GDPRReport, 
  PersonalDataItem, 
  DataProcessingActivity,
  ConsentRecord,
  DataRetentionPolicy,
  ThirdPartySharing,
  DataDeletionRequest 
} from '../types/security.types';
import { generateUUID } from '../utils/crypto';
import { logComplianceEvent, logDataAccess } from '../utils/logger';
import { connectDatabase, config } from '@reskflow/shared';
import correlationId from 'correlation-id';

// Personal Data Schema
const personalDataSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  dataType: { type: String, required: true, index: true },
  location: { type: String, required: true },
  encrypted: { type: Boolean, default: false },
  lastAccessed: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  retention: { type: Number, required: true }, // days
  purpose: { type: String, required: true },
  legalBasis: { type: String, required: true },
  source: String,
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'personal_data_registry'
});

personalDataSchema.index({ userId: 1, dataType: 1 });
personalDataSchema.index({ createdAt: 1, retention: 1 });

const PersonalDataModel = mongoose.model('PersonalData', personalDataSchema);

// Consent Records Schema
const consentSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  purpose: { type: String, required: true, index: true },
  granted: { type: Boolean, required: true },
  timestamp: { type: Date, default: Date.now },
  version: { type: String, required: true },
  method: { type: String, required: true }, // web, api, import, etc.
  withdrawn: Date,
  withdrawnMethod: String,
  ipAddress: String,
  userAgent: String,
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'consent_records'
});

consentSchema.index({ userId: 1, purpose: 1, timestamp: -1 });

const ConsentModel = mongoose.model('Consent', consentSchema);

// Data Deletion Requests Schema
const dataDeletionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  requestType: { type: String, enum: ['full', 'partial'], required: true },
  dataTypes: [String],
  reason: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  completedAt: Date,
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'], 
    default: 'pending',
    index: true 
  },
  deletionLog: [String],
  requestedBy: String,
  processedBy: String,
  verificationRequired: { type: Boolean, default: true },
  verifiedAt: Date,
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'data_deletion_requests'
});

const DataDeletionModel = mongoose.model('DataDeletion', dataDeletionSchema);

// Processing Activity Schema
const processingActivitySchema = new mongoose.Schema({
  activity: { type: String, required: true, index: true },
  controller: { type: String, required: true },
  processor: String,
  purpose: { type: String, required: true },
  legalBasis: { type: String, required: true },
  dataTypes: [String],
  dataSubjects: [String],
  recipients: [String],
  thirdCountryTransfers: [String],
  retention: { type: Number, required: true }, // days
  securityMeasures: [String],
  dataProtectionImpactAssessment: Boolean,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'processing_activities'
});

const ProcessingActivityModel = mongoose.model('ProcessingActivity', processingActivitySchema);

export class ComplianceService {
  private initialized = false;
  private complianceMetrics: Map<string, number> = new Map();

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Initialize the compliance service
   */
  async initialize(): Promise<void> {
    try {
      // Ensure database connection
      await connectDatabase();
      
      // Setup data retention monitoring
      this.startRetentionMonitoring();
      
      // Setup consent monitoring
      this.startConsentMonitoring();
      
      this.initialized = true;
      
      logComplianceEvent('service_initialized', undefined, undefined, {
        version: '1.0.0',
        gdprCompliant: true,
      });

    } catch (error) {
      throw new Error(`Failed to initialize ComplianceService: ${error.message}`);
    }
  }

  /**
   * Register personal data processing
   */
  async registerPersonalData(data: {
    userId: string;
    dataType: string;
    location: string;
    encrypted?: boolean;
    purpose: string;
    legalBasis: string;
    retention: number;
    source?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const personalData = new PersonalDataModel({
        ...data,
        encrypted: data.encrypted || false,
        lastAccessed: new Date(),
        metadata: data.metadata || {},
      });

      await personalData.save();

      // Update metrics
      this.complianceMetrics.set('registered_data_items', 
        (this.complianceMetrics.get('registered_data_items') || 0) + 1
      );

      logComplianceEvent('personal_data_registered', data.userId, [data.dataType], {
        dataType: data.dataType,
        purpose: data.purpose,
        legalBasis: data.legalBasis,
        retention: data.retention,
      });

      return personalData._id.toString();

    } catch (error) {
      throw new Error(`Failed to register personal data: ${error.message}`);
    }
  }

  /**
   * Record user consent
   */
  async recordConsent(data: {
    userId: string;
    purpose: string;
    granted: boolean;
    version: string;
    method: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const consent = new ConsentModel({
        ...data,
        timestamp: new Date(),
        metadata: data.metadata || {},
      });

      await consent.save();

      // Update metrics
      const metricKey = data.granted ? 'consents_granted' : 'consents_denied';
      this.complianceMetrics.set(metricKey, 
        (this.complianceMetrics.get(metricKey) || 0) + 1
      );

      logComplianceEvent('consent_recorded', data.userId, [data.purpose], {
        purpose: data.purpose,
        granted: data.granted,
        method: data.method,
        version: data.version,
      });

      return consent._id.toString();

    } catch (error) {
      throw new Error(`Failed to record consent: ${error.message}`);
    }
  }

  /**
   * Withdraw user consent
   */
  async withdrawConsent(userId: string, purpose: string, method: string): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Find the most recent consent for this purpose
      const consent = await ConsentModel.findOne({
        userId,
        purpose,
        granted: true,
        withdrawn: { $exists: false }
      }).sort({ timestamp: -1 });

      if (!consent) {
        throw new Error('No active consent found for this purpose');
      }

      // Mark as withdrawn
      consent.withdrawn = new Date();
      consent.withdrawnMethod = method;
      await consent.save();

      // Update metrics
      this.complianceMetrics.set('consents_withdrawn', 
        (this.complianceMetrics.get('consents_withdrawn') || 0) + 1
      );

      logComplianceEvent('consent_withdrawn', userId, [purpose], {
        purpose,
        method,
        originalConsentDate: consent.timestamp,
      });

    } catch (error) {
      throw new Error(`Failed to withdraw consent: ${error.message}`);
    }
  }

  /**
   * Generate GDPR compliance report for a user
   */
  async generateGDPRReport(userId: string): Promise<GDPRReport> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Get personal data items
      const personalDataItems = await PersonalDataModel.find({ userId }).lean();
      
      const personalData: PersonalDataItem[] = personalDataItems.map(item => ({
        dataType: item.dataType,
        location: item.location,
        encrypted: item.encrypted,
        lastAccessed: item.lastAccessed,
        retention: item.retention,
        purpose: item.purpose,
      }));

      // Get processing activities
      const processingActivities = await ProcessingActivityModel.find({}).lean();
      
      const dataProcessingActivities: DataProcessingActivity[] = processingActivities.map(activity => ({
        activity: activity.activity,
        legalBasis: activity.legalBasis,
        purpose: activity.purpose,
        dataTypes: activity.dataTypes,
        recipients: activity.recipients,
        retention: activity.retention,
        crossBorderTransfer: activity.thirdCountryTransfers?.length > 0,
      }));

      // Get consent records
      const consentRecords = await ConsentModel.find({ userId }).lean();
      
      const consents: ConsentRecord[] = consentRecords.map(consent => ({
        purpose: consent.purpose,
        granted: consent.granted,
        timestamp: consent.timestamp,
        version: consent.version,
        method: consent.method,
        withdrawn: consent.withdrawn,
      }));

      // Get data retention policies
      const dataRetentionPolicies: DataRetentionPolicy[] = await this.getDataRetentionPolicies();

      // Get third party sharing information
      const thirdPartySharing: ThirdPartySharing[] = await this.getThirdPartySharing(userId);

      const report: GDPRReport = {
        userId,
        personalData,
        dataProcessingActivities,
        consentRecords: consents,
        dataRetentionPolicies,
        thirdPartySharing,
        generatedAt: new Date(),
      };

      logComplianceEvent('gdpr_report_generated', userId, undefined, {
        personalDataItems: personalData.length,
        consentRecords: consents.length,
        processingActivities: dataProcessingActivities.length,
      });

      return report;

    } catch (error) {
      throw new Error(`Failed to generate GDPR report: ${error.message}`);
    }
  }

  /**
   * Handle data deletion request
   */
  async handleDataDeletionRequest(
    userId: string,
    requestType: 'full' | 'partial' = 'full',
    dataTypes?: string[],
    reason = 'user_request'
  ): Promise<DataDeletionRequest> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const deletionRequest: DataDeletionRequest = {
        id: generateUUID(),
        userId,
        requestType,
        dataTypes: dataTypes || [],
        reason,
        requestedAt: new Date(),
        status: 'pending',
        deletionLog: [],
      };

      // Save deletion request
      await new DataDeletionModel(deletionRequest).save();

      // Start processing the deletion
      await this.processDataDeletion(deletionRequest.id);

      logComplianceEvent('data_deletion_requested', userId, dataTypes, {
        requestId: deletionRequest.id,
        requestType,
        reason,
      });

      return deletionRequest;

    } catch (error) {
      throw new Error(`Failed to handle data deletion request: ${error.message}`);
    }
  }

  /**
   * Process data deletion request
   */
  async processDataDeletion(requestId: string): Promise<void> {
    try {
      const request = await DataDeletionModel.findOne({ id: requestId });
      
      if (!request) {
        throw new Error('Deletion request not found');
      }

      // Update status to processing
      request.status = 'processing';
      await request.save();

      const deletionLog: string[] = [];

      try {
        if (request.requestType === 'full') {
          // Full deletion - remove all user data
          await this.performFullDataDeletion(request.userId, deletionLog);
        } else {
          // Partial deletion - remove specific data types
          await this.performPartialDataDeletion(request.userId, request.dataTypes || [], deletionLog);
        }

        // Mark as completed
        request.status = 'completed';
        request.completedAt = new Date();
        request.deletionLog = deletionLog;
        await request.save();

        logComplianceEvent('data_deletion_completed', request.userId, request.dataTypes, {
          requestId,
          deletedItems: deletionLog.length,
        });

      } catch (error) {
        // Mark as failed
        request.status = 'failed';
        request.deletionLog = [...deletionLog, `Error: ${error.message}`];
        await request.save();

        logComplianceEvent('data_deletion_failed', request.userId, request.dataTypes, {
          requestId,
          error: error.message,
        });

        throw error;
      }

    } catch (error) {
      throw new Error(`Failed to process data deletion: ${error.message}`);
    }
  }

  /**
   * Perform full data deletion for a user
   */
  private async performFullDataDeletion(userId: string, deletionLog: string[]): Promise<void> {
    // Remove personal data registry entries
    const personalDataResult = await PersonalDataModel.deleteMany({ userId });
    deletionLog.push(`Deleted ${personalDataResult.deletedCount} personal data entries`);

    // Remove consent records
    const consentResult = await ConsentModel.deleteMany({ userId });
    deletionLog.push(`Deleted ${consentResult.deletedCount} consent records`);

    // TODO: In a real implementation, you would also:
    // - Delete user data from all application databases
    // - Remove cached data from Redis
    // - Delete files from storage systems
    // - Notify third-party services to delete shared data
    // - Update backup systems to exclude deleted data

    deletionLog.push('Full user data deletion completed');
  }

  /**
   * Perform partial data deletion for specific data types
   */
  private async performPartialDataDeletion(userId: string, dataTypes: string[], deletionLog: string[]): Promise<void> {
    for (const dataType of dataTypes) {
      // Remove specific data type entries
      const result = await PersonalDataModel.deleteMany({ userId, dataType });
      deletionLog.push(`Deleted ${result.deletedCount} entries for data type: ${dataType}`);

      // TODO: Delete actual data from application databases based on data type
    }

    deletionLog.push(`Partial data deletion completed for types: ${dataTypes.join(', ')}`);
  }

  /**
   * Check data retention compliance
   */
  async checkDataRetentionCompliance(): Promise<{
    expiredItems: number;
    deletedItems: number;
    errors: string[];
  }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const now = new Date();
      const errors: string[] = [];
      let deletedItems = 0;

      // Find expired personal data
      const expiredData = await PersonalDataModel.find({
        $expr: {
          $lt: [
            { $add: ['$createdAt', { $multiply: ['$retention', 24 * 60 * 60 * 1000] }] },
            now
          ]
        }
      });

      const expiredItems = expiredData.length;

      // Delete expired data
      for (const item of expiredData) {
        try {
          await PersonalDataModel.deleteOne({ _id: item._id });
          deletedItems++;

          logComplianceEvent('data_retention_deletion', item.userId, [item.dataType], {
            dataType: item.dataType,
            retentionPeriod: item.retention,
            age: Math.floor((now.getTime() - item.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
          });

        } catch (error) {
          errors.push(`Failed to delete expired data ${item._id}: ${error.message}`);
        }
      }

      // Update metrics
      this.complianceMetrics.set('retention_checks_performed', 
        (this.complianceMetrics.get('retention_checks_performed') || 0) + 1
      );

      logComplianceEvent('retention_compliance_check', undefined, undefined, {
        expiredItems,
        deletedItems,
        errors: errors.length,
      });

      return { expiredItems, deletedItems, errors };

    } catch (error) {
      throw new Error(`Failed to check data retention compliance: ${error.message}`);
    }
  }

  /**
   * Get data retention policies
   */
  async getDataRetentionPolicies(): Promise<DataRetentionPolicy[]> {
    // In a real implementation, this would come from a configuration database
    return [
      {
        dataType: 'user_profile',
        retention: 2555, // 7 years
        autoDelete: true,
      },
      {
        dataType: 'transaction_data',
        retention: 2555, // 7 years
        autoDelete: true,
      },
      {
        dataType: 'marketing_data',
        retention: 730, // 2 years
        autoDelete: true,
      },
      {
        dataType: 'analytics_data',
        retention: 1095, // 3 years
        autoDelete: true,
      },
      {
        dataType: 'support_tickets',
        retention: 1825, // 5 years
        autoDelete: false,
        archiveLocation: 'cold_storage',
      },
    ];
  }

  /**
   * Get third party sharing information
   */
  async getThirdPartySharing(userId: string): Promise<ThirdPartySharing[]> {
    // In a real implementation, this would track actual third-party data sharing
    return [
      {
        recipient: 'Payment Processor',
        dataTypes: ['payment_data', 'transaction_history'],
        purpose: 'payment_processing',
        legalBasis: 'contract',
        safeguards: ['encryption', 'contractual_clauses'],
      },
      {
        recipient: 'Analytics Provider',
        dataTypes: ['usage_analytics', 'user_behavior'],
        purpose: 'service_improvement',
        legalBasis: 'legitimate_interest',
        safeguards: ['pseudonymization', 'data_minimization'],
      },
    ];
  }

  /**
   * Get user consent status
   */
  async getUserConsentStatus(userId: string): Promise<Record<string, boolean>> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const consents = await ConsentModel.find({
        userId,
        withdrawn: { $exists: false }
      }).sort({ timestamp: -1 });

      const consentStatus: Record<string, boolean> = {};
      
      // Get the most recent consent for each purpose
      for (const consent of consents) {
        if (!(consent.purpose in consentStatus)) {
          consentStatus[consent.purpose] = consent.granted;
        }
      }

      return consentStatus;

    } catch (error) {
      throw new Error(`Failed to get user consent status: ${error.message}`);
    }
  }

  /**
   * Get compliance metrics
   */
  getMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {};
    
    for (const [key, value] of this.complianceMetrics) {
      metrics[key] = value;
    }

    return metrics;
  }

  /**
   * Get data deletion requests
   */
  async getDataDeletionRequests(status?: string): Promise<DataDeletionRequest[]> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const filter = status ? { status } : {};
      const requests = await DataDeletionModel.find(filter).sort({ requestedAt: -1 }).lean();

      return requests.map(req => ({
        id: req.id,
        userId: req.userId,
        requestType: req.requestType,
        dataTypes: req.dataTypes,
        reason: req.reason,
        requestedAt: req.requestedAt,
        completedAt: req.completedAt,
        status: req.status,
        deletionLog: req.deletionLog,
      }));

    } catch (error) {
      throw new Error(`Failed to get data deletion requests: ${error.message}`);
    }
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): void {
    this.complianceMetrics.set('registered_data_items', 0);
    this.complianceMetrics.set('consents_granted', 0);
    this.complianceMetrics.set('consents_denied', 0);
    this.complianceMetrics.set('consents_withdrawn', 0);
    this.complianceMetrics.set('deletion_requests', 0);
    this.complianceMetrics.set('retention_checks_performed', 0);
  }

  /**
   * Start data retention monitoring
   */
  private startRetentionMonitoring(): void {
    // Check retention compliance daily
    setInterval(() => {
      this.checkDataRetentionCompliance().catch(console.error);
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Start consent monitoring
   */
  private startConsentMonitoring(): void {
    // Monitor consent expiration and renewal needs
    setInterval(async () => {
      try {
        // Check for consents that need renewal (older than 2 years)
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

        const oldConsents = await ConsentModel.find({
          timestamp: { $lt: twoYearsAgo },
          granted: true,
          withdrawn: { $exists: false }
        });

        if (oldConsents.length > 0) {
          logComplianceEvent('consent_renewal_required', undefined, undefined, {
            consentCount: oldConsents.length,
            oldestConsent: Math.min(...oldConsents.map(c => c.timestamp.getTime())),
          });
        }

      } catch (error) {
        console.error('Consent monitoring failed:', error.message);
      }
    }, 24 * 60 * 60 * 1000);
  }
}