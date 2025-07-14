import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { 
  MFASetup, 
  MFAVerification, 
  PasswordValidation, 
  SessionData 
} from '../types/security.types';
import { 
  generateSecureToken, 
  generateRandomString, 
  secureRandom 
} from '../utils/crypto';
import { validatePasswordStrength } from '../utils/validation';
import { logAuthEvent, logDataAccess } from '../utils/logger';
import { config, redis } from '@reskflow/shared';
import correlationId from 'correlation-id';

export class AuthenticationService {
  private readonly SESSION_PREFIX = 'session:';
  private readonly MFA_SECRET_PREFIX = 'mfa:secret:';
  private readonly MFA_BACKUP_PREFIX = 'mfa:backup:';
  private readonly FAILED_ATTEMPTS_PREFIX = 'failed:';
  private readonly LOCKOUT_PREFIX = 'lockout:';

  constructor() {
    this.initializeCleanupTasks();
  }

  /**
   * Setup Multi-Factor Authentication for a user
   */
  async setupMFA(userId: string): Promise<MFASetup> {
    try {
      // Generate secret for TOTP
      const secret = speakeasy.generateSecret({
        name: `ReskFlow (${userId})`,
        issuer: 'ReskFlow',
        length: 32,
      });

      // Generate backup codes
      const backupCodes = await this.generateBackupCodes();

      // Generate QR code for mobile apps
      const qrCodeUrl = speakeasy.otpauthURL({
        secret: secret.ascii,
        label: userId,
        issuer: 'ReskFlow',
        encoding: 'ascii',
      });

      const qrCode = await QRCode.toDataURL(qrCodeUrl);

      // Store MFA secret and backup codes in Redis
      const mfaData = {
        secret: secret.base32,
        backupCodes,
        createdAt: new Date(),
        verified: false,
      };

      await redis.setex(
        `${this.MFA_SECRET_PREFIX}${userId}`,
        86400 * 7, // 7 days to complete setup
        JSON.stringify(mfaData)
      );

      logAuthEvent('mfa_setup', userId, true, 'internal', 'system', {
        hasBackupCodes: backupCodes.length,
      });

      return {
        secret: secret.base32,
        qrCode,
        backupCodes,
        userId,
      };

    } catch (error) {
      logAuthEvent('mfa_setup', userId, false, 'internal', 'system', {
        error: error.message,
      });

      throw new Error(`MFA setup failed: ${error.message}`);
    }
  }

  /**
   * Verify MFA token (TOTP or backup code)
   */
  async verifyMFA(userId: string, token: string): Promise<MFAVerification> {
    try {
      const mfaDataStr = await redis.get(`${this.MFA_SECRET_PREFIX}${userId}`);
      
      if (!mfaDataStr) {
        throw new Error('MFA not set up for this user');
      }

      const mfaData = JSON.parse(mfaDataStr);

      // Check if it's a backup code first
      if (mfaData.backupCodes && mfaData.backupCodes.includes(token)) {
        // Remove used backup code
        mfaData.backupCodes = mfaData.backupCodes.filter((code: string) => code !== token);
        mfaData.verified = true;

        // Update stored data
        await redis.setex(
          `${this.MFA_SECRET_PREFIX}${userId}`,
          86400 * 365, // Keep for 1 year
          JSON.stringify(mfaData)
        );

        logAuthEvent('mfa_verify', userId, true, 'internal', 'system', {
          method: 'backup_code',
          remainingBackupCodes: mfaData.backupCodes.length,
        });

        return {
          valid: true,
          remainingBackupCodes: mfaData.backupCodes.length,
        };
      }

      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: mfaData.secret,
        encoding: 'base32',
        token,
        window: 2, // Allow 2 time steps tolerance
      });

      if (verified) {
        mfaData.verified = true;
        
        // Update stored data
        await redis.setex(
          `${this.MFA_SECRET_PREFIX}${userId}`,
          86400 * 365, // Keep for 1 year
          JSON.stringify(mfaData)
        );

        logAuthEvent('mfa_verify', userId, true, 'internal', 'system', {
          method: 'totp',
        });

        return {
          valid: true,
          remainingBackupCodes: mfaData.backupCodes.length,
        };
      }

      logAuthEvent('mfa_verify', userId, false, 'internal', 'system', {
        method: 'invalid_token',
      });

      return { valid: false };

    } catch (error) {
      logAuthEvent('mfa_verify', userId, false, 'internal', 'system', {
        error: error.message,
      });

      throw new Error(`MFA verification failed: ${error.message}`);
    }
  }

  /**
   * Check if user has MFA enabled
   */
  async isMFAEnabled(userId: string): Promise<boolean> {
    try {
      const mfaDataStr = await redis.get(`${this.MFA_SECRET_PREFIX}${userId}`);
      
      if (!mfaDataStr) {
        return false;
      }

      const mfaData = JSON.parse(mfaDataStr);
      return mfaData.verified === true;

    } catch (error) {
      return false;
    }
  }

  /**
   * Disable MFA for a user
   */
  async disableMFA(userId: string): Promise<void> {
    try {
      await redis.del(`${this.MFA_SECRET_PREFIX}${userId}`);

      logAuthEvent('mfa_disable', userId, true, 'internal', 'system');

    } catch (error) {
      logAuthEvent('mfa_disable', userId, false, 'internal', 'system', {
        error: error.message,
      });

      throw new Error(`Failed to disable MFA: ${error.message}`);
    }
  }

  /**
   * Generate new backup codes
   */
  async generateNewBackupCodes(userId: string): Promise<string[]> {
    try {
      const mfaDataStr = await redis.get(`${this.MFA_SECRET_PREFIX}${userId}`);
      
      if (!mfaDataStr) {
        throw new Error('MFA not set up for this user');
      }

      const mfaData = JSON.parse(mfaDataStr);
      const newBackupCodes = await this.generateBackupCodes();

      mfaData.backupCodes = newBackupCodes;
      mfaData.backupCodesGeneratedAt = new Date();

      await redis.setex(
        `${this.MFA_SECRET_PREFIX}${userId}`,
        86400 * 365, // Keep for 1 year
        JSON.stringify(mfaData)
      );

      logAuthEvent('mfa_backup_codes_regenerated', userId, true, 'internal', 'system');

      return newBackupCodes;

    } catch (error) {
      logAuthEvent('mfa_backup_codes_regenerated', userId, false, 'internal', 'system', {
        error: error.message,
      });

      throw new Error(`Failed to generate backup codes: ${error.message}`);
    }
  }

  /**
   * Validate password strength
   */
  validatePassword(password: string): PasswordValidation {
    return validatePasswordStrength(password);
  }

  /**
   * Hash password using Argon2
   */
  async hashPassword(password: string): Promise<string> {
    try {
      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16, // 64 MB
        timeCost: 3,
        parallelism: 1,
      });

      return hash;

    } catch (error) {
      throw new Error(`Password hashing failed: ${error.message}`);
    }
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);

    } catch (error) {
      return false;
    }
  }

  /**
   * Create authenticated session
   */
  async createSession(
    userId: string,
    ip: string,
    userAgent: string,
    permissions: string[] = [],
    mfaVerified = false
  ): Promise<string> {
    try {
      const sessionId = await generateSecureToken(32);
      
      const sessionData: SessionData = {
        sessionId,
        userId,
        ip,
        userAgent,
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + (config.sessionTimeout || 24 * 60 * 60 * 1000)), // 24 hours default
        mfaVerified,
        permissions,
        metadata: {
          correlationId: correlationId.getId(),
          loginMethod: 'password',
        },
      };

      // Store session in Redis
      await redis.setex(
        `${this.SESSION_PREFIX}${sessionId}`,
        config.sessionTimeout || 86400, // 24 hours
        JSON.stringify(sessionData)
      );

      // Track active sessions for user
      await redis.sadd(`user:${userId}:sessions`, sessionId);
      await redis.expire(`user:${userId}:sessions`, config.sessionTimeout || 86400);

      logAuthEvent('session_created', userId, true, ip, userAgent, {
        sessionId,
        mfaVerified,
        permissions: permissions.length,
      });

      return sessionId;

    } catch (error) {
      logAuthEvent('session_created', userId, false, ip, userAgent, {
        error: error.message,
      });

      throw new Error(`Session creation failed: ${error.message}`);
    }
  }

  /**
   * Validate and refresh session
   */
  async validateSession(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionDataStr = await redis.get(`${this.SESSION_PREFIX}${sessionId}`);
      
      if (!sessionDataStr) {
        return null;
      }

      const sessionData: SessionData = JSON.parse(sessionDataStr);

      // Check if session is expired
      if (new Date() > sessionData.expiresAt) {
        await this.destroySession(sessionId);
        return null;
      }

      // Update last activity
      sessionData.lastActivity = new Date();

      // Refresh session in Redis
      await redis.setex(
        `${this.SESSION_PREFIX}${sessionId}`,
        config.sessionTimeout || 86400,
        JSON.stringify(sessionData)
      );

      return sessionData;

    } catch (error) {
      return null;
    }
  }

  /**
   * Destroy session
   */
  async destroySession(sessionId: string): Promise<void> {
    try {
      const sessionDataStr = await redis.get(`${this.SESSION_PREFIX}${sessionId}`);
      
      if (sessionDataStr) {
        const sessionData: SessionData = JSON.parse(sessionDataStr);
        
        // Remove from user's active sessions
        await redis.srem(`user:${sessionData.userId}:sessions`, sessionId);
        
        logAuthEvent('session_destroyed', sessionData.userId, true, sessionData.ip, sessionData.userAgent, {
          sessionId,
          duration: Date.now() - sessionData.createdAt.getTime(),
        });
      }

      // Remove session from Redis
      await redis.del(`${this.SESSION_PREFIX}${sessionId}`);

    } catch (error) {
      console.error('Failed to destroy session:', error.message);
    }
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyAllUserSessions(userId: string): Promise<void> {
    try {
      const sessionIds = await redis.smembers(`user:${userId}:sessions`);
      
      for (const sessionId of sessionIds) {
        await this.destroySession(sessionId);
      }

      await redis.del(`user:${userId}:sessions`);

      logAuthEvent('all_sessions_destroyed', userId, true, 'internal', 'system', {
        destroyedSessions: sessionIds.length,
      });

    } catch (error) {
      logAuthEvent('all_sessions_destroyed', userId, false, 'internal', 'system', {
        error: error.message,
      });

      throw new Error(`Failed to destroy all sessions: ${error.message}`);
    }
  }

  /**
   * Track failed login attempts
   */
  async trackFailedAttempt(identifier: string, ip: string): Promise<void> {
    try {
      const key = `${this.FAILED_ATTEMPTS_PREFIX}${identifier}`;
      const attempts = await redis.incr(key);
      
      if (attempts === 1) {
        await redis.expire(key, 3600); // Reset after 1 hour
      }

      // Check if account should be locked
      const maxAttempts = config.maxFailedAttempts || 5;
      if (attempts >= maxAttempts) {
        await this.lockAccount(identifier, 'max_failed_attempts', ip);
      }

      logAuthEvent('failed_attempt', identifier, false, ip, 'unknown', {
        attempts,
        maxAttempts,
      });

    } catch (error) {
      console.error('Failed to track failed attempt:', error.message);
    }
  }

  /**
   * Clear failed attempts counter
   */
  async clearFailedAttempts(identifier: string): Promise<void> {
    try {
      await redis.del(`${this.FAILED_ATTEMPTS_PREFIX}${identifier}`);

    } catch (error) {
      console.error('Failed to clear failed attempts:', error.message);
    }
  }

  /**
   * Lock account temporarily
   */
  async lockAccount(identifier: string, reason: string, ip: string): Promise<void> {
    try {
      const lockKey = `${this.LOCKOUT_PREFIX}${identifier}`;
      const lockDuration = config.lockoutDuration || 900; // 15 minutes default
      
      const lockData = {
        reason,
        lockedAt: new Date(),
        lockedBy: ip,
        expiresAt: new Date(Date.now() + lockDuration * 1000),
      };

      await redis.setex(lockKey, lockDuration, JSON.stringify(lockData));

      logAuthEvent('account_locked', identifier, true, ip, 'system', {
        reason,
        duration: lockDuration,
      });

    } catch (error) {
      console.error('Failed to lock account:', error.message);
    }
  }

  /**
   * Check if account is locked
   */
  async isAccountLocked(identifier: string): Promise<boolean> {
    try {
      const lockData = await redis.get(`${this.LOCKOUT_PREFIX}${identifier}`);
      return lockData !== null;

    } catch (error) {
      return false;
    }
  }

  /**
   * Unlock account manually
   */
  async unlockAccount(identifier: string, unlockedBy: string): Promise<void> {
    try {
      await redis.del(`${this.LOCKOUT_PREFIX}${identifier}`);
      await redis.del(`${this.FAILED_ATTEMPTS_PREFIX}${identifier}`);

      logAuthEvent('account_unlocked', identifier, true, 'internal', 'system', {
        unlockedBy,
      });

    } catch (error) {
      logAuthEvent('account_unlocked', identifier, false, 'internal', 'system', {
        error: error.message,
      });

      throw new Error(`Failed to unlock account: ${error.message}`);
    }
  }

  /**
   * Generate JWT token
   */
  generateJWT(payload: object, expiresIn = '1h'): string {
    try {
      const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
      
      return jwt.sign(payload, secret, {
        expiresIn,
        issuer: 'reskflow-security',
        algorithm: 'HS256',
      });

    } catch (error) {
      throw new Error(`JWT generation failed: ${error.message}`);
    }
  }

  /**
   * Verify JWT token
   */
  verifyJWT(token: string): any {
    try {
      const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
      
      return jwt.verify(token, secret, {
        issuer: 'reskflow-security',
        algorithms: ['HS256'],
      });

    } catch (error) {
      throw new Error(`JWT verification failed: ${error.message}`);
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(userId: string): Promise<SessionData[]> {
    try {
      const sessionIds = await redis.smembers(`user:${userId}:sessions`);
      const sessions: SessionData[] = [];

      for (const sessionId of sessionIds) {
        const sessionDataStr = await redis.get(`${this.SESSION_PREFIX}${sessionId}`);
        if (sessionDataStr) {
          const sessionData: SessionData = JSON.parse(sessionDataStr);
          sessions.push(sessionData);
        }
      }

      return sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    } catch (error) {
      throw new Error(`Failed to get user sessions: ${error.message}`);
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // This would be called periodically to clean up expired sessions
      // In a production environment, you might want to use Redis key expiration
      // or a more sophisticated cleanup mechanism
      
      const pattern = `${this.SESSION_PREFIX}*`;
      const keys = await redis.keys(pattern);
      
      let cleanedCount = 0;
      
      for (const key of keys) {
        const sessionDataStr = await redis.get(key);
        if (sessionDataStr) {
          const sessionData: SessionData = JSON.parse(sessionDataStr);
          
          if (new Date() > sessionData.expiresAt) {
            const sessionId = key.replace(this.SESSION_PREFIX, '');
            await this.destroySession(sessionId);
            cleanedCount++;
          }
        }
      }

      console.log(`Cleaned up ${cleanedCount} expired sessions`);

    } catch (error) {
      console.error('Session cleanup failed:', error.message);
    }
  }

  /**
   * Generate backup codes for MFA
   */
  private async generateBackupCodes(): Promise<string[]> {
    const codes: string[] = [];
    
    for (let i = 0; i < 10; i++) {
      const code = await generateRandomString(8);
      codes.push(code.toUpperCase());
    }
    
    return codes;
  }

  /**
   * Initialize cleanup tasks
   */
  private initializeCleanupTasks(): void {
    // Run session cleanup every hour
    setInterval(() => {
      this.cleanupExpiredSessions().catch(console.error);
    }, 60 * 60 * 1000);
  }
}