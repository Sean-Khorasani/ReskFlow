/**
 * Security Service
 * Handles authentication, authorization, and security features
 */

import { PrismaClient, UserRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { redisClient } from '../../config/redis';
import * as crypto from 'crypto';
import { Request } from 'express';

const prisma = new PrismaClient();

interface TokenPayload {
  userId: string;
  role: UserRole;
  type: 'access' | 'refresh';
  sessionId?: string;
}

interface Permission {
  resource: string;
  action: string;
  scope?: 'own' | 'all';
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

interface SecurityEvent {
  type: 'login' | 'logout' | 'failed_login' | 'password_reset' | 'suspicious_activity' | 'permission_denied';
  userId?: string;
  ip: string;
  userAgent?: string;
  details: any;
  timestamp: Date;
}

interface Session {
  id: string;
  userId: string;
  deviceId: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
}

class SecurityService extends EventEmitter {
  private readonly permissions: Map<UserRole, Permission[]> = new Map();
  private readonly suspiciousPatterns = [
    /sql\s*injection/i,
    /script\s*>/i,
    /union\s+select/i,
    /drop\s+table/i,
    /exec\s*\(/i
  ];

  constructor() {
    super();
    this.initializePermissions();
  }

  /**
   * Initialize role-based permissions
   */
  private initializePermissions() {
    // Customer permissions
    this.permissions.set(UserRole.CUSTOMER, [
      { resource: 'order', action: 'create', scope: 'own' },
      { resource: 'order', action: 'read', scope: 'own' },
      { resource: 'order', action: 'cancel', scope: 'own' },
      { resource: 'profile', action: '*', scope: 'own' },
      { resource: 'address', action: '*', scope: 'own' },
      { resource: 'payment', action: '*', scope: 'own' },
      { resource: 'favorite', action: '*', scope: 'own' },
      { resource: 'review', action: '*', scope: 'own' }
    ]);

    // Driver permissions
    this.permissions.set(UserRole.DRIVER, [
      { resource: 'reskflow', action: 'read', scope: 'own' },
      { resource: 'reskflow', action: 'update', scope: 'own' },
      { resource: 'earnings', action: 'read', scope: 'own' },
      { resource: 'shift', action: '*', scope: 'own' },
      { resource: 'vehicle', action: '*', scope: 'own' },
      { resource: 'route', action: 'read', scope: 'own' }
    ]);

    // Merchant permissions
    this.permissions.set(UserRole.MERCHANT, [
      { resource: 'menu', action: '*', scope: 'own' },
      { resource: 'order', action: 'read', scope: 'own' },
      { resource: 'order', action: 'update', scope: 'own' },
      { resource: 'inventory', action: '*', scope: 'own' },
      { resource: 'promotion', action: '*', scope: 'own' },
      { resource: 'analytics', action: 'read', scope: 'own' },
      { resource: 'staff', action: '*', scope: 'own' }
    ]);

    // Admin permissions
    this.permissions.set(UserRole.ADMIN, [
      { resource: '*', action: '*', scope: 'all' }
    ]);

    // Partner permissions
    this.permissions.set(UserRole.PARTNER, [
      { resource: 'analytics', action: 'read', scope: 'all' },
      { resource: 'report', action: 'read', scope: 'all' },
      { resource: 'commission', action: 'read', scope: 'own' }
    ]);
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
      
      // Check if token is blacklisted
      const isBlacklisted = await redisClient.get(`blacklist:${token}`);
      if (isBlacklisted) {
        throw new Error('Token is blacklisted');
      }

      // Check if session exists
      if (payload.sessionId) {
        const session = await this.getSession(payload.sessionId);
        if (!session) {
          throw new Error('Invalid session');
        }
      }

      return payload;
    } catch (error) {
      logger.error('Token verification failed:', error);
      throw new Error('Invalid token');
    }
  }

  /**
   * Check if user has permission
   */
  hasPermission(role: UserRole, resource: string, action: string, scope?: 'own' | 'all'): boolean {
    const rolePermissions = this.permissions.get(role) || [];
    
    return rolePermissions.some(permission => {
      // Check wildcard permissions
      if (permission.resource === '*' || permission.action === '*') {
        return true;
      }
      
      // Check exact match
      if (permission.resource === resource && permission.action === action) {
        // Check scope if specified
        if (scope && permission.scope && permission.scope !== scope) {
          return false;
        }
        return true;
      }
      
      return false;
    });
  }

  /**
   * Create session
   */
  async createSession(userId: string, deviceInfo: {
    ip: string;
    userAgent: string;
    deviceId?: string;
  }): Promise<Session> {
    try {
      const sessionId = crypto.randomBytes(32).toString('hex');
      const session: Session = {
        id: sessionId,
        userId,
        deviceId: deviceInfo.deviceId || crypto.randomBytes(16).toString('hex'),
        ip: deviceInfo.ip,
        userAgent: deviceInfo.userAgent,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };

      // Store session in Redis
      await redisClient.setex(
        `session:${sessionId}`,
        30 * 24 * 60 * 60, // 30 days
        JSON.stringify(session)
      );

      // Track active sessions for user
      await redisClient.sadd(`user_sessions:${userId}`, sessionId);

      return session;
    } catch (error) {
      logger.error('Error creating session:', error);
      throw error;
    }
  }

  /**
   * Get session
   */
  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const sessionData = await redisClient.get(`session:${sessionId}`);
      if (!sessionData) return null;

      const session = JSON.parse(sessionData) as Session;
      
      // Update last activity
      session.lastActivityAt = new Date();
      await redisClient.setex(
        `session:${sessionId}`,
        30 * 24 * 60 * 60,
        JSON.stringify(session)
      );

      return session;
    } catch (error) {
      logger.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Invalidate session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    try {
      const sessionData = await redisClient.get(`session:${sessionId}`);
      if (!sessionData) return;

      const session = JSON.parse(sessionData) as Session;
      
      // Remove session
      await redisClient.del(`session:${sessionId}`);
      
      // Remove from user's active sessions
      await redisClient.srem(`user_sessions:${session.userId}`, sessionId);
    } catch (error) {
      logger.error('Error invalidating session:', error);
      throw error;
    }
  }

  /**
   * Get all active sessions for user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    try {
      const sessionIds = await redisClient.smembers(`user_sessions:${userId}`);
      const sessions: Session[] = [];

      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          sessions.push(session);
        }
      }

      return sessions.sort((a, b) => 
        b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
      );
    } catch (error) {
      logger.error('Error getting user sessions:', error);
      throw error;
    }
  }

  /**
   * Invalidate all user sessions
   */
  async invalidateAllUserSessions(userId: string): Promise<void> {
    try {
      const sessionIds = await redisClient.smembers(`user_sessions:${userId}`);
      
      for (const sessionId of sessionIds) {
        await redisClient.del(`session:${sessionId}`);
      }
      
      await redisClient.del(`user_sessions:${userId}`);
    } catch (error) {
      logger.error('Error invalidating user sessions:', error);
      throw error;
    }
  }

  /**
   * Check rate limit
   */
  async checkRateLimit(key: string, config: RateLimitConfig): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    try {
      const redisKey = `${config.keyPrefix}:${key}`;
      const current = await redisClient.incr(redisKey);
      
      if (current === 1) {
        await redisClient.expire(redisKey, Math.ceil(config.windowMs / 1000));
      }

      const ttl = await redisClient.ttl(redisKey);
      const resetAt = new Date(Date.now() + ttl * 1000);
      
      return {
        allowed: current <= config.maxRequests,
        remaining: Math.max(0, config.maxRequests - current),
        resetAt
      };
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      // Allow request on error
      return { allowed: true, remaining: 1, resetAt: new Date() };
    }
  }

  /**
   * Log security event
   */
  async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Store in database
      await prisma.securityLog.create({
        data: {
          type: event.type,
          userId: event.userId,
          ip: event.ip,
          userAgent: event.userAgent,
          details: event.details,
          createdAt: event.timestamp
        }
      });

      // Emit event for real-time monitoring
      this.emit('security:event', event);

      // Check for suspicious activity
      if (event.type === 'failed_login' || event.type === 'suspicious_activity') {
        await this.handleSuspiciousActivity(event);
      }
    } catch (error) {
      logger.error('Error logging security event:', error);
    }
  }

  /**
   * Handle suspicious activity
   */
  private async handleSuspiciousActivity(event: SecurityEvent): Promise<void> {
    const key = `suspicious:${event.ip}`;
    const count = await redisClient.incr(key);
    
    if (count === 1) {
      await redisClient.expire(key, 3600); // 1 hour window
    }

    // Block IP after 10 suspicious activities
    if (count >= 10) {
      await this.blockIP(event.ip, 'Excessive suspicious activity');
    }

    // Alert admins for critical events
    if (count >= 5) {
      this.emit('security:alert', {
        type: 'suspicious_activity',
        ip: event.ip,
        count,
        details: event.details
      });
    }
  }

  /**
   * Block IP address
   */
  async blockIP(ip: string, reason: string): Promise<void> {
    try {
      await redisClient.setex(
        `blocked_ip:${ip}`,
        24 * 60 * 60, // 24 hours
        JSON.stringify({ reason, blockedAt: new Date() })
      );

      logger.warn(`IP blocked: ${ip}, reason: ${reason}`);
      
      this.emit('security:ip_blocked', { ip, reason });
    } catch (error) {
      logger.error('Error blocking IP:', error);
    }
  }

  /**
   * Check if IP is blocked
   */
  async isIPBlocked(ip: string): Promise<boolean> {
    const blocked = await redisClient.get(`blocked_ip:${ip}`);
    return !!blocked;
  }

  /**
   * Validate input for security threats
   */
  validateInput(input: any): { valid: boolean; threats: string[] } {
    const threats: string[] = [];
    
    // Convert to string for pattern matching
    const inputStr = JSON.stringify(input);
    
    // Check for suspicious patterns
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(inputStr)) {
        threats.push(`Suspicious pattern detected: ${pattern.source}`);
      }
    }

    // Check for excessive length
    if (inputStr.length > 10000) {
      threats.push('Input exceeds maximum allowed length');
    }

    return {
      valid: threats.length === 0,
      threats
    };
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash sensitive data
   */
  hashData(data: string): string {
    return crypto
      .createHash('sha256')
      .update(data + process.env.HASH_SALT!)
      .digest('hex');
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(text: string): string {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData: string): string {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
    
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Sanitize output to prevent XSS
   */
  sanitizeOutput(data: any): any {
    if (typeof data === 'string') {
      return data
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeOutput(item));
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {};
      for (const key in data) {
        sanitized[key] = this.sanitizeOutput(data[key]);
      }
      return sanitized;
    }
    
    return data;
  }

  /**
   * Get security statistics
   */
  async getSecurityStats(timeRange: { start: Date; end: Date }) {
    try {
      const [
        totalEvents,
        eventsByType,
        topIPs,
        blockedIPs
      ] = await Promise.all([
        prisma.securityLog.count({
          where: {
            createdAt: {
              gte: timeRange.start,
              lte: timeRange.end
            }
          }
        }),
        prisma.securityLog.groupBy({
          by: ['type'],
          where: {
            createdAt: {
              gte: timeRange.start,
              lte: timeRange.end
            }
          },
          _count: true
        }),
        prisma.securityLog.groupBy({
          by: ['ip'],
          where: {
            createdAt: {
              gte: timeRange.start,
              lte: timeRange.end
            }
          },
          _count: true,
          orderBy: {
            _count: {
              ip: 'desc'
            }
          },
          take: 10
        }),
        this.getBlockedIPCount()
      ]);

      return {
        totalEvents,
        eventsByType: eventsByType.reduce((acc, curr) => {
          acc[curr.type] = curr._count;
          return acc;
        }, {} as Record<string, number>),
        topIPs: topIPs.map(item => ({
          ip: item.ip,
          count: item._count
        })),
        blockedIPs,
        timeRange
      };
    } catch (error) {
      logger.error('Error getting security stats:', error);
      throw error;
    }
  }

  /**
   * Get blocked IP count
   */
  private async getBlockedIPCount(): Promise<number> {
    const keys = await redisClient.keys('blocked_ip:*');
    return keys.length;
  }
}

export const securityService = new SecurityService();