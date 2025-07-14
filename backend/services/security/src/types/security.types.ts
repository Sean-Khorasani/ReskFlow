export interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  keyId: string;
  algorithm: string;
  timestamp: Date;
}

export interface EncryptionContext {
  userId?: string;
  purpose: string;
  dataType: string;
  retention?: number; // days
  compliance?: ComplianceLevel[];
}

export interface DecryptionResult {
  data: string;
  metadata: {
    keyId: string;
    algorithm: string;
    timestamp: Date;
    context: EncryptionContext;
  };
}

export interface MFASetup {
  secret: string;
  qrCode: string;
  backupCodes: string[];
  userId: string;
}

export interface MFAVerification {
  valid: boolean;
  remainingBackupCodes?: number;
}

export interface PasswordValidation {
  valid: boolean;
  score: number;
  feedback: string[];
  requirements: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumbers: boolean;
    hasSpecialChars: boolean;
    notCommon: boolean;
  };
}

export interface AuditLog {
  id: string;
  userId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  method: string;
  endpoint: string;
  userAgent: string;
  ip: string;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: Date;
  correlationId: string;
  metadata?: Record<string, any>;
}

export interface AuditQuery {
  startDate?: string;
  endDate?: string;
  userId?: string;
  action?: string;
  resource?: string;
  success?: boolean;
  ip?: string;
  limit?: number;
  offset?: number;
}

export interface GDPRReport {
  userId: string;
  personalData: PersonalDataItem[];
  dataProcessingActivities: DataProcessingActivity[];
  consentRecords: ConsentRecord[];
  dataRetentionPolicies: DataRetentionPolicy[];
  thirdPartySharing: ThirdPartySharing[];
  generatedAt: Date;
}

export interface PersonalDataItem {
  dataType: string;
  location: string;
  encrypted: boolean;
  lastAccessed: Date;
  retention: number;
  purpose: string;
}

export interface DataProcessingActivity {
  activity: string;
  legalBasis: string;
  purpose: string;
  dataTypes: string[];
  recipients: string[];
  retention: number;
  crossBorderTransfer: boolean;
}

export interface ConsentRecord {
  purpose: string;
  granted: boolean;
  timestamp: Date;
  version: string;
  method: string;
  withdrawn?: Date;
}

export interface DataRetentionPolicy {
  dataType: string;
  retention: number;
  autoDelete: boolean;
  archiveLocation?: string;
}

export interface ThirdPartySharing {
  recipient: string;
  dataTypes: string[];
  purpose: string;
  legalBasis: string;
  safeguards: string[];
}

export interface DataDeletionRequest {
  userId: string;
  requestType: 'full' | 'partial';
  dataTypes?: string[];
  reason: string;
  requestedAt: Date;
  completedAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  deletionLog: string[];
}

export interface ThreatDetection {
  id: string;
  type: ThreatType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  target?: string;
  description: string;
  indicators: string[];
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  actions: SecurityAction[];
}

export interface SecurityMetrics {
  threatCount: number;
  blockedRequests: number;
  failedLogins: number;
  suspiciousActivities: number;
  securityScore: number;
  trends: {
    daily: SecurityTrend[];
    weekly: SecurityTrend[];
    monthly: SecurityTrend[];
  };
}

export interface SecurityTrend {
  date: string;
  threats: number;
  blocked: number;
  score: number;
}

export interface IPWhitelist {
  ip: string;
  description: string;
  addedBy: string;
  addedAt: Date;
  expiresAt?: Date;
}

export interface IPBlacklist {
  ip: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  addedBy: string;
  addedAt: Date;
  expiresAt?: Date;
  permanent: boolean;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  mfaVerified: boolean;
  permissions: string[];
  metadata: Record<string, any>;
}

export interface EncryptionKey {
  id: string;
  type: KeyType;
  algorithm: string;
  keySize: number;
  purpose: string;
  createdAt: Date;
  expiresAt?: Date;
  rotatedAt?: Date;
  status: 'active' | 'rotating' | 'deprecated' | 'revoked';
  version: number;
  metadata: Record<string, any>;
}

export interface KeyRotationResult {
  oldKeyId: string;
  newKeyId: string;
  rotatedAt: Date;
  affectedData?: number;
  status: 'success' | 'partial' | 'failed';
  errors?: string[];
}

export interface SecurityConfiguration {
  encryption: {
    algorithm: string;
    keySize: number;
    rotationInterval: number; // days
  };
  authentication: {
    mfaRequired: boolean;
    sessionTimeout: number; // minutes
    maxFailedAttempts: number;
    lockoutDuration: number; // minutes
  };
  audit: {
    logRetention: number; // days
    realTimeMonitoring: boolean;
    alertThresholds: AlertThresholds;
  };
  compliance: {
    gdprEnabled: boolean;
    dataRetentionDefault: number; // days
    anonymizationDelay: number; // days
  };
  threatDetection: {
    enabled: boolean;
    scanInterval: number; // minutes
    ipBlacklistThreshold: number;
    autoBlock: boolean;
  };
}

export interface AlertThresholds {
  failedLogins: number;
  suspiciousIPs: number;
  dataAccess: number;
  apiCalls: number;
}

export interface SecurityContext {
  userId?: string;
  sessionId?: string;
  ip: string;
  userAgent: string;
  correlationId: string;
  permissions: string[];
  mfaVerified: boolean;
  riskScore: number;
}

export interface CryptoConfig {
  algorithm: string;
  keyDerivation: {
    iterations: number;
    saltLength: number;
    keyLength: number;
  };
  encryption: {
    keySize: number;
    ivLength: number;
    tagLength: number;
  };
}

export interface ValidationRule {
  type: 'required' | 'length' | 'pattern' | 'custom';
  params?: any;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface SecurityEvent {
  type: SecurityEventType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  target?: string;
  description: string;
  metadata: Record<string, any>;
  timestamp: Date;
  correlationId: string;
}

export type ThreatType = 
  | 'brute_force'
  | 'sql_injection' 
  | 'xss'
  | 'csrf'
  | 'suspicious_ip'
  | 'rate_limit_exceeded'
  | 'unauthorized_access'
  | 'data_exfiltration'
  | 'malicious_payload'
  | 'anomalous_behavior';

export type SecurityAction = 
  | 'block_ip'
  | 'rate_limit'
  | 'require_mfa'
  | 'invalidate_session'
  | 'alert_admin'
  | 'quarantine_user'
  | 'log_incident';

export type KeyType = 
  | 'master'
  | 'data_encryption'
  | 'jwt_signing'
  | 'session'
  | 'api_encryption'
  | 'backup_encryption';

export type ComplianceLevel = 
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'top_secret';

export type SecurityEventType = 
  | 'authentication'
  | 'authorization'
  | 'data_access'
  | 'configuration_change'
  | 'key_rotation'
  | 'audit_log'
  | 'compliance_action'
  | 'threat_detected'
  | 'security_scan';

export interface LogLevel {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, any>;
  timestamp?: Date;
  correlationId?: string;
}