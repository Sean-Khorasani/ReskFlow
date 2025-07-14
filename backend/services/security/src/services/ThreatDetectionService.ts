import mongoose from 'mongoose';
import { 
  ThreatDetection, 
  ThreatType, 
  SecurityAction, 
  SecurityMetrics, 
  SecurityTrend,
  IPWhitelist,
  IPBlacklist 
} from '../types/security.types';
import { generateUUID } from '../utils/crypto';
import { isValidIP } from '../utils/validation';
import { logThreatDetection, logSecurityScan, logCriticalAlert } from '../utils/logger';
import { connectDatabase, config, redis } from '@reskflow/shared';
import correlationId from 'correlation-id';

// Threat Detection Schema
const threatDetectionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { 
    type: String, 
    required: true, 
    enum: [
      'brute_force', 'sql_injection', 'xss', 'csrf', 'suspicious_ip',
      'rate_limit_exceeded', 'unauthorized_access', 'data_exfiltration',
      'malicious_payload', 'anomalous_behavior'
    ],
    index: true 
  },
  severity: { 
    type: String, 
    required: true, 
    enum: ['low', 'medium', 'high', 'critical'],
    index: true 
  },
  source: { type: String, required: true, index: true },
  target: String,
  description: { type: String, required: true },
  indicators: [String],
  timestamp: { type: Date, default: Date.now, index: true },
  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: Date,
  actions: [String],
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'threat_detections'
});

threatDetectionSchema.index({ timestamp: -1, severity: 1 });
threatDetectionSchema.index({ source: 1, type: 1, timestamp: -1 });

const ThreatDetectionModel = mongoose.model('ThreatDetection', threatDetectionSchema);

// IP Whitelist Schema
const ipWhitelistSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true, index: true },
  description: String,
  addedBy: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
  expiresAt: Date,
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'ip_whitelist'
});

const IPWhitelistModel = mongoose.model('IPWhitelist', ipWhitelistSchema);

// IP Blacklist Schema
const ipBlacklistSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true, index: true },
  reason: { type: String, required: true },
  severity: { 
    type: String, 
    required: true, 
    enum: ['low', 'medium', 'high'],
    index: true 
  },
  addedBy: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
  expiresAt: Date,
  permanent: { type: Boolean, default: false },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
  collection: 'ip_blacklist'
});

ipBlacklistSchema.index({ addedAt: -1, severity: 1 });

const IPBlacklistModel = mongoose.model('IPBlacklist', ipBlacklistSchema);

export class ThreatDetectionService {
  private initialized = false;
  private threatMetrics: Map<string, number> = new Map();
  private suspiciousActivityCache: Map<string, number> = new Map();
  private monitoringActive = false;

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Initialize the threat detection service
   */
  async initialize(): Promise<void> {
    try {
      // Ensure database connection
      await connectDatabase();
      
      // Load existing blacklist/whitelist into cache
      await this.loadIPListsToCache();
      
      // Setup monitoring intervals
      this.setupMonitoringIntervals();
      
      this.initialized = true;
      
      logSecurityScan('service_initialization', 0, 0, {
        version: '1.0.0',
        features: ['ip_filtering', 'anomaly_detection', 'threat_analysis'],
      });

    } catch (error) {
      throw new Error(`Failed to initialize ThreatDetectionService: ${error.message}`);
    }
  }

  /**
   * Start monitoring for threats
   */
  async startMonitoring(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.monitoringActive = true;
    
    logSecurityScan('monitoring_started', 0, 0, {
      monitoringActive: true,
    });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.monitoringActive = false;
    
    logSecurityScan('monitoring_stopped', 0, 0, {
      monitoringActive: false,
    });
  }

  /**
   * Detect and analyze potential threats
   */
  async detectThreat(
    type: ThreatType,
    source: string,
    target?: string,
    indicators: string[] = [],
    metadata: Record<string, any> = {}
  ): Promise<string> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Determine severity based on threat type and indicators
      const severity = this.calculateThreatSeverity(type, indicators, metadata);

      // Check if source IP is whitelisted
      if (await this.isIPWhitelisted(source)) {
        // Still log but with lower severity
        severity === 'critical' ? 'high' : severity;
      }

      const threat: ThreatDetection = {
        id: generateUUID(),
        type,
        severity,
        source,
        target,
        description: this.generateThreatDescription(type, source, target, indicators),
        indicators,
        timestamp: new Date(),
        resolved: false,
        actions: [],
      };

      // Save threat to database
      await new ThreatDetectionModel({
        ...threat,
        metadata,
      }).save();

      // Take automatic actions based on severity
      const actions = await this.takeAutomaticActions(threat);
      threat.actions = actions;

      // Update metrics
      this.updateThreatMetrics(threat);

      // Log the threat
      logThreatDetection(type, severity, source, target, {
        indicators,
        actions,
        ...metadata,
      });

      // Send critical alerts
      if (severity === 'critical') {
        logCriticalAlert(
          `Critical threat detected: ${type} from ${source}`,
          'threat_detection_service',
          { threatId: threat.id, ...metadata }
        );
      }

      return threat.id;

    } catch (error) {
      throw new Error(`Failed to detect threat: ${error.message}`);
    }
  }

  /**
   * Add IP to whitelist
   */
  async addToWhitelist(ip: string, description: string, addedBy = 'system', expiresAt?: Date): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!isValidIP(ip)) {
        throw new Error('Invalid IP address format');
      }

      const whitelist: IPWhitelist = {
        ip,
        description,
        addedBy,
        addedAt: new Date(),
        expiresAt,
      };

      await new IPWhitelistModel(whitelist).save();

      // Add to Redis cache for fast lookup
      await redis.setex(`whitelist:${ip}`, 86400, 'true'); // 24 hours cache

      logThreatDetection('ip_whitelisted', 'info', ip, undefined, {
        description,
        addedBy,
        expiresAt,
      });

    } catch (error) {
      if (error.code === 11000) {
        throw new Error('IP address is already whitelisted');
      }
      throw new Error(`Failed to add IP to whitelist: ${error.message}`);
    }
  }

  /**
   * Add IP to blacklist
   */
  async addToBlacklist(
    ip: string, 
    reason: string, 
    severity: 'low' | 'medium' | 'high' = 'medium',
    addedBy = 'system',
    permanent = false,
    expiresAt?: Date
  ): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!isValidIP(ip)) {
        throw new Error('Invalid IP address format');
      }

      // Don't blacklist whitelisted IPs
      if (await this.isIPWhitelisted(ip)) {
        throw new Error('Cannot blacklist a whitelisted IP address');
      }

      const blacklist: IPBlacklist = {
        ip,
        reason,
        severity,
        addedBy,
        addedAt: new Date(),
        expiresAt: permanent ? undefined : (expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000)), // Default 24h
        permanent,
      };

      await new IPBlacklistModel(blacklist).save();

      // Add to Redis cache for fast lookup
      const cacheExpiry = permanent ? 0 : Math.floor((blacklist.expiresAt!.getTime() - Date.now()) / 1000);
      if (cacheExpiry > 0) {
        await redis.setex(`blacklist:${ip}`, cacheExpiry, JSON.stringify({ severity, reason }));
      } else if (permanent) {
        await redis.set(`blacklist:${ip}`, JSON.stringify({ severity, reason }));
      }

      logThreatDetection('ip_blacklisted', severity, ip, undefined, {
        reason,
        addedBy,
        permanent,
        expiresAt,
      });

    } catch (error) {
      if (error.code === 11000) {
        throw new Error('IP address is already blacklisted');
      }
      throw new Error(`Failed to add IP to blacklist: ${error.message}`);
    }
  }

  /**
   * Check if IP is whitelisted
   */
  async isIPWhitelisted(ip: string): Promise<boolean> {
    try {
      // Check Redis cache first
      const cached = await redis.get(`whitelist:${ip}`);
      if (cached) {
        return true;
      }

      // Check database
      const whitelist = await IPWhitelistModel.findOne({
        ip,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      if (whitelist) {
        // Cache the result
        await redis.setex(`whitelist:${ip}`, 3600, 'true'); // 1 hour cache
        return true;
      }

      return false;

    } catch (error) {
      return false;
    }
  }

  /**
   * Check if IP is blacklisted
   */
  async isIPBlacklisted(ip: string): Promise<{ blacklisted: boolean; severity?: string; reason?: string }> {
    try {
      // Check Redis cache first
      const cached = await redis.get(`blacklist:${ip}`);
      if (cached) {
        const data = JSON.parse(cached);
        return { blacklisted: true, severity: data.severity, reason: data.reason };
      }

      // Check database
      const blacklist = await IPBlacklistModel.findOne({
        ip,
        $or: [
          { permanent: true },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      if (blacklist) {
        // Cache the result
        const cacheExpiry = blacklist.permanent ? 0 : Math.floor((blacklist.expiresAt!.getTime() - Date.now()) / 1000);
        const data = { severity: blacklist.severity, reason: blacklist.reason };
        
        if (cacheExpiry > 0) {
          await redis.setex(`blacklist:${ip}`, cacheExpiry, JSON.stringify(data));
        } else if (blacklist.permanent) {
          await redis.set(`blacklist:${ip}`, JSON.stringify(data));
        }

        return { blacklisted: true, severity: blacklist.severity, reason: blacklist.reason };
      }

      return { blacklisted: false };

    } catch (error) {
      return { blacklisted: false };
    }
  }

  /**
   * Remove IP from whitelist
   */
  async removeFromWhitelist(ip: string): Promise<void> {
    try {
      await IPWhitelistModel.deleteOne({ ip });
      await redis.del(`whitelist:${ip}`);

      logThreatDetection('ip_whitelist_removed', 'info', ip, undefined, {});

    } catch (error) {
      throw new Error(`Failed to remove IP from whitelist: ${error.message}`);
    }
  }

  /**
   * Remove IP from blacklist
   */
  async removeFromBlacklist(ip: string): Promise<void> {
    try {
      await IPBlacklistModel.deleteOne({ ip });
      await redis.del(`blacklist:${ip}`);

      logThreatDetection('ip_blacklist_removed', 'info', ip, undefined, {});

    } catch (error) {
      throw new Error(`Failed to remove IP from blacklist: ${error.message}`);
    }
  }

  /**
   * Analyze request for suspicious patterns
   */
  async analyzeRequest(req: {
    ip: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
    userAgent?: string;
  }): Promise<{ suspicious: boolean; threats: string[]; riskScore: number }> {
    const threats: string[] = [];
    let riskScore = 0;

    // Check IP blacklist
    const ipCheck = await this.isIPBlacklisted(req.ip);
    if (ipCheck.blacklisted) {
      threats.push('blacklisted_ip');
      riskScore += ipCheck.severity === 'high' ? 50 : ipCheck.severity === 'medium' ? 30 : 10;
    }

    // SQL Injection detection
    if (this.detectSQLInjection(req.url, req.body)) {
      threats.push('sql_injection');
      riskScore += 40;
    }

    // XSS detection
    if (this.detectXSS(req.url, req.body)) {
      threats.push('xss');
      riskScore += 35;
    }

    // Suspicious headers
    if (this.detectSuspiciousHeaders(req.headers)) {
      threats.push('suspicious_headers');
      riskScore += 20;
    }

    // Rate limiting check
    if (await this.checkRateLimit(req.ip)) {
      threats.push('rate_limit_exceeded');
      riskScore += 25;
    }

    // User agent analysis
    if (this.analyzeUserAgent(req.userAgent || '')) {
      threats.push('suspicious_user_agent');
      riskScore += 15;
    }

    // Path traversal detection
    if (this.detectPathTraversal(req.url)) {
      threats.push('path_traversal');
      riskScore += 30;
    }

    const suspicious = riskScore > 25; // Threshold for suspicious activity

    if (suspicious) {
      // Track suspicious activity
      await this.trackSuspiciousActivity(req.ip, threats, riskScore);
    }

    return { suspicious, threats, riskScore };
  }

  /**
   * Run comprehensive security scan
   */
  async runSecurityScan(): Promise<{ findings: number; threats: ThreatDetection[] }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const startTime = Date.now();
      const findings: ThreatDetection[] = [];

      // Scan for anomalous IP activity
      const ipAnomalies = await this.scanIPAnomalies();
      findings.push(...ipAnomalies);

      // Scan for expired blacklist entries
      await this.cleanupExpiredEntries();

      // Scan for suspicious patterns in recent activity
      const patternAnomalies = await this.scanPatternAnomalies();
      findings.push(...patternAnomalies);

      const duration = Date.now() - startTime;

      logSecurityScan('comprehensive_scan', findings.length, duration, {
        ipAnomalies: ipAnomalies.length,
        patternAnomalies: patternAnomalies.length,
      });

      return { findings: findings.length, threats: findings };

    } catch (error) {
      throw new Error(`Security scan failed: ${error.message}`);
    }
  }

  /**
   * Get recent threats
   */
  async getRecentThreats(hours = 24, limit = 100): Promise<ThreatDetection[]> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const threats = await ThreatDetectionModel
        .find({ timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();

      return threats.map(threat => ({
        id: threat.id,
        type: threat.type,
        severity: threat.severity,
        source: threat.source,
        target: threat.target,
        description: threat.description,
        indicators: threat.indicators,
        timestamp: threat.timestamp,
        resolved: threat.resolved,
        resolvedAt: threat.resolvedAt,
        actions: threat.actions,
      }));

    } catch (error) {
      throw new Error(`Failed to get recent threats: ${error.message}`);
    }
  }

  /**
   * Calculate security score (0-100)
   */
  async calculateSecurityScore(): Promise<{ score: number; factors: Record<string, number> }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const factors: Record<string, number> = {};
      let score = 100; // Start with perfect score

      // Recent threat count (last 24 hours)
      const recentThreats = await this.getRecentThreats(24);
      const threatPenalty = Math.min(recentThreats.length * 2, 30);
      factors.threat_penalty = threatPenalty;
      score -= threatPenalty;

      // Critical threats penalty
      const criticalThreats = recentThreats.filter(t => t.severity === 'critical').length;
      const criticalPenalty = criticalThreats * 10;
      factors.critical_penalty = criticalPenalty;
      score -= criticalPenalty;

      // Unresolved threats penalty
      const unresolvedThreats = recentThreats.filter(t => !t.resolved).length;
      const unresolvedPenalty = unresolvedThreats * 3;
      factors.unresolved_penalty = unresolvedPenalty;
      score -= unresolvedPenalty;

      // IP blacklist size factor
      const blacklistSize = await IPBlacklistModel.countDocuments();
      const blacklistPenalty = Math.min(blacklistSize * 0.5, 15);
      factors.blacklist_penalty = blacklistPenalty;
      score -= blacklistPenalty;

      // Active monitoring bonus
      if (this.monitoringActive) {
        factors.monitoring_bonus = 5;
        score += 5;
      }

      // Ensure score is between 0 and 100
      score = Math.max(0, Math.min(100, Math.round(score)));

      return { score, factors };

    } catch (error) {
      return { score: 50, factors: { error: 1 } }; // Default moderate score on error
    }
  }

  /**
   * Get security metrics and trends
   */
  async getSecurityMetrics(): Promise<SecurityMetrics> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        threatCount,
        blockedRequests,
        failedLogins,
        suspiciousActivities
      ] = await Promise.all([
        ThreatDetectionModel.countDocuments({ timestamp: { $gte: yesterday } }),
        this.getBlockedRequestsCount(),
        this.getFailedLoginsCount(),
        this.getSuspiciousActivitiesCount(),
      ]);

      const securityScore = await this.calculateSecurityScore();

      // Generate trends
      const trends = await this.generateSecurityTrends();

      return {
        threatCount,
        blockedRequests,
        failedLogins,
        suspiciousActivities,
        securityScore: securityScore.score,
        trends,
      };

    } catch (error) {
      throw new Error(`Failed to get security metrics: ${error.message}`);
    }
  }

  /**
   * Initialize metrics tracking
   */
  private initializeMetrics(): void {
    this.threatMetrics.set('total_threats', 0);
    this.threatMetrics.set('critical_threats', 0);
    this.threatMetrics.set('resolved_threats', 0);
    this.threatMetrics.set('blocked_ips', 0);
    this.threatMetrics.set('whitelisted_ips', 0);
  }

  /**
   * Calculate threat severity based on type and indicators
   */
  private calculateThreatSeverity(
    type: ThreatType, 
    indicators: string[], 
    metadata: Record<string, any>
  ): 'low' | 'medium' | 'high' | 'critical' {
    let baseScore = 0;

    // Base scores by threat type
    const typeScores: Record<ThreatType, number> = {
      'brute_force': 30,
      'sql_injection': 60,
      'xss': 50,
      'csrf': 40,
      'suspicious_ip': 20,
      'rate_limit_exceeded': 25,
      'unauthorized_access': 70,
      'data_exfiltration': 90,
      'malicious_payload': 80,
      'anomalous_behavior': 35,
    };

    baseScore = typeScores[type] || 25;

    // Increase score based on indicators
    baseScore += indicators.length * 5;

    // Metadata-based adjustments
    if (metadata.frequency && metadata.frequency > 10) {
      baseScore += 20; // Repeated attempts
    }

    if (metadata.payload_size && metadata.payload_size > 1000000) {
      baseScore += 15; // Large payloads
    }

    // Determine severity
    if (baseScore >= 80) return 'critical';
    if (baseScore >= 60) return 'high';
    if (baseScore >= 40) return 'medium';
    return 'low';
  }

  /**
   * Generate threat description
   */
  private generateThreatDescription(
    type: ThreatType,
    source: string,
    target?: string,
    indicators: string[] = []
  ): string {
    const descriptions: Record<ThreatType, string> = {
      'brute_force': `Brute force attack detected from ${source}`,
      'sql_injection': `SQL injection attempt from ${source}`,
      'xss': `Cross-site scripting attempt from ${source}`,
      'csrf': `Cross-site request forgery detected from ${source}`,
      'suspicious_ip': `Suspicious activity from IP ${source}`,
      'rate_limit_exceeded': `Rate limit exceeded from ${source}`,
      'unauthorized_access': `Unauthorized access attempt from ${source}`,
      'data_exfiltration': `Potential data exfiltration from ${source}`,
      'malicious_payload': `Malicious payload detected from ${source}`,
      'anomalous_behavior': `Anomalous behavior pattern from ${source}`,
    };

    let description = descriptions[type] || `Security threat from ${source}`;

    if (target) {
      description += ` targeting ${target}`;
    }

    if (indicators.length > 0) {
      description += `. Indicators: ${indicators.join(', ')}`;
    }

    return description;
  }

  /**
   * Take automatic actions based on threat
   */
  private async takeAutomaticActions(threat: ThreatDetection): Promise<SecurityAction[]> {
    const actions: SecurityAction[] = [];

    // Automatic IP blocking for high/critical threats
    if (threat.severity === 'critical' || threat.severity === 'high') {
      try {
        await this.addToBlacklist(
          threat.source,
          `Automatic blocking: ${threat.type}`,
          threat.severity === 'critical' ? 'high' : 'medium',
          'auto_threat_detection'
        );
        actions.push('block_ip');
      } catch (error) {
        // IP might already be blacklisted
      }
    }

    // Rate limiting for certain threat types
    if (['brute_force', 'rate_limit_exceeded'].includes(threat.type)) {
      actions.push('rate_limit');
    }

    // Alert admin for critical threats
    if (threat.severity === 'critical') {
      actions.push('alert_admin');
    }

    // Log incident for audit trail
    actions.push('log_incident');

    return actions;
  }

  /**
   * Update threat metrics
   */
  private updateThreatMetrics(threat: ThreatDetection): void {
    this.threatMetrics.set('total_threats', (this.threatMetrics.get('total_threats') || 0) + 1);
    
    if (threat.severity === 'critical') {
      this.threatMetrics.set('critical_threats', (this.threatMetrics.get('critical_threats') || 0) + 1);
    }
  }

  /**
   * Load IP lists to cache
   */
  private async loadIPListsToCache(): Promise<void> {
    try {
      // Load whitelist
      const whitelist = await IPWhitelistModel.find({
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      for (const entry of whitelist) {
        await redis.setex(`whitelist:${entry.ip}`, 86400, 'true');
      }

      // Load blacklist
      const blacklist = await IPBlacklistModel.find({
        $or: [
          { permanent: true },
          { expiresAt: { $gt: new Date() } }
        ]
      });

      for (const entry of blacklist) {
        const data = { severity: entry.severity, reason: entry.reason };
        const cacheExpiry = entry.permanent ? 0 : Math.floor((entry.expiresAt!.getTime() - Date.now()) / 1000);
        
        if (cacheExpiry > 0) {
          await redis.setex(`blacklist:${entry.ip}`, cacheExpiry, JSON.stringify(data));
        } else if (entry.permanent) {
          await redis.set(`blacklist:${entry.ip}`, JSON.stringify(data));
        }
      }

    } catch (error) {
      console.warn('Failed to load IP lists to cache:', error.message);
    }
  }

  /**
   * Setup monitoring intervals
   */
  private setupMonitoringIntervals(): void {
    // Clean up expired entries every hour
    setInterval(() => {
      this.cleanupExpiredEntries().catch(console.error);
    }, 60 * 60 * 1000);

    // Run security scans every 4 hours
    setInterval(() => {
      if (this.monitoringActive) {
        this.runSecurityScan().catch(console.error);
      }
    }, 4 * 60 * 60 * 1000);
  }

  // Threat detection methods
  private detectSQLInjection(url: string, body: any): boolean {
    const sqlPatterns = [
      /(\b(select|insert|update|delete|drop|create|alter|exec|union|script)\b)/i,
      /(or\s+1\s*=\s*1)/i,
      /(union\s+select)/i,
      /('|\"|;|--|\*|\|)/,
    ];

    const content = `${url} ${JSON.stringify(body || {})}`;
    return sqlPatterns.some(pattern => pattern.test(content));
  }

  private detectXSS(url: string, body: any): boolean {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript\s*:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /eval\s*\(/i,
    ];

    const content = `${url} ${JSON.stringify(body || {})}`;
    return xssPatterns.some(pattern => pattern.test(content));
  }

  private detectSuspiciousHeaders(headers: Record<string, string>): boolean {
    const suspiciousHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-cluster-client-ip',
    ];

    const suspiciousValues = [
      /127\.0\.0\.1/,
      /localhost/,
      /192\.168\./,
      /10\./,
      /172\.(1[6-9]|2[0-9]|3[01])\./,
    ];

    for (const header of suspiciousHeaders) {
      const value = headers[header];
      if (value && suspiciousValues.some(pattern => pattern.test(value))) {
        return true;
      }
    }

    return false;
  }

  private async checkRateLimit(ip: string): Promise<boolean> {
    try {
      const key = `rate_limit:${ip}`;
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, 60); // 1 minute window
      }

      return current > (config.rateLimitThreshold || 100);

    } catch (error) {
      return false;
    }
  }

  private analyzeUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /bot|crawler|spider/i,
      /curl|wget|python|java/i,
      /scanner|security|test/i,
      /^$/,
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  private detectPathTraversal(url: string): boolean {
    const patterns = [
      /\.\.\//,
      /\.\.\\/,
      /%2e%2e%2f/i,
      /%2e%2e%5c/i,
      /etc\/passwd/i,
      /windows\/system32/i,
    ];

    return patterns.some(pattern => pattern.test(url));
  }

  private async trackSuspiciousActivity(ip: string, threats: string[], riskScore: number): Promise<void> {
    const key = `suspicious:${ip}`;
    const current = this.suspiciousActivityCache.get(key) || 0;
    this.suspiciousActivityCache.set(key, current + riskScore);

    // Auto-blacklist if score exceeds threshold
    if (current + riskScore > 100) {
      await this.addToBlacklist(
        ip,
        `Suspicious activity threshold exceeded: ${threats.join(', ')}`,
        'medium',
        'auto_threat_detection'
      );
    }
  }

  private async scanIPAnomalies(): Promise<ThreatDetection[]> {
    // This would implement IP-based anomaly detection
    // For now, return empty array
    return [];
  }

  private async cleanupExpiredEntries(): Promise<void> {
    try {
      const now = new Date();

      // Remove expired whitelist entries
      await IPWhitelistModel.deleteMany({
        expiresAt: { $exists: true, $lt: now }
      });

      // Remove expired blacklist entries
      await IPBlacklistModel.deleteMany({
        permanent: false,
        expiresAt: { $lt: now }
      });

    } catch (error) {
      console.error('Failed to cleanup expired entries:', error.message);
    }
  }

  private async scanPatternAnomalies(): Promise<ThreatDetection[]> {
    // This would implement pattern-based anomaly detection
    // For now, return empty array
    return [];
  }

  private async getBlockedRequestsCount(): Promise<number> {
    return IPBlacklistModel.countDocuments();
  }

  private async getFailedLoginsCount(): Promise<number> {
    // This would integrate with authentication service
    return 0;
  }

  private async getSuspiciousActivitiesCount(): Promise<number> {
    return this.suspiciousActivityCache.size;
  }

  private async generateSecurityTrends(): Promise<{
    daily: SecurityTrend[];
    weekly: SecurityTrend[];
    monthly: SecurityTrend[];
  }> {
    // This would generate actual trend data from historical records
    return {
      daily: [],
      weekly: [],
      monthly: [],
    };
  }
}