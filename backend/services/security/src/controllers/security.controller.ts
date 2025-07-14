import { Request, Response } from 'express';
import { EncryptionService } from '../services/EncryptionService';
import { AuthenticationService } from '../services/AuthenticationService';
import { ThreatDetectionService } from '../services/ThreatDetectionService';
import { AuditService } from '../services/AuditService';
import { ComplianceService } from '../services/ComplianceService';
import { KeyManagementService } from '../services/KeyManagementService';
import { SecurityContext } from '../types/security.types';
import { logger } from '../utils/logger';
import correlationId from 'correlation-id';

export class SecurityController {
  constructor(
    private encryptionService: EncryptionService,
    private authService: AuthenticationService,
    private threatDetectionService: ThreatDetectionService,
    private auditService: AuditService,
    private complianceService: ComplianceService,
    private keyManagementService: KeyManagementService
  ) {}

  /**
   * Health check endpoint
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.API_VERSION || '1.0.0',
        uptime: process.uptime(),
      });
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      res.status(500).json({
        status: 'unhealthy',
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Encrypt data endpoint
   */
  async encryptData(req: Request, res: Response): Promise<void> {
    try {
      const { data, keyId } = req.body;

      if (!data) {
        res.status(400).json({
          error: 'Data is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const encrypted = await this.encryptionService.encryptData(data, keyId);

      res.status(200).json({
        encrypted: encrypted.encrypted,
        keyId: encrypted.keyId,
        algorithm: encrypted.algorithm,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Encryption failed', { error: error.message });
      res.status(500).json({
        error: 'Encryption failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Decrypt data endpoint
   */
  async decryptData(req: Request, res: Response): Promise<void> {
    try {
      const { encryptedData, keyId, iv, tag } = req.body;

      if (!encryptedData || !keyId || !iv || !tag) {
        res.status(400).json({
          error: 'Encrypted data, keyId, iv, and tag are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const decrypted = await this.encryptionService.decryptData({
        encrypted: encryptedData,
        keyId,
        iv,
        tag,
        algorithm: 'aes-256-gcm',
      });

      res.status(200).json({
        data: decrypted,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Decryption failed', { error: error.message });
      res.status(500).json({
        error: 'Decryption failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Generate secure token endpoint
   */
  async generateToken(req: Request, res: Response): Promise<void> {
    try {
      const { length = 32 } = req.body;

      const token = await this.encryptionService.generateSecureToken(length);

      res.status(200).json({
        token,
        length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Token generation failed', { error: error.message });
      res.status(500).json({
        error: 'Token generation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Hash password endpoint
   */
  async hashPassword(req: Request, res: Response): Promise<void> {
    try {
      const { password } = req.body;

      if (!password) {
        res.status(400).json({
          error: 'Password is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const hashedPassword = await this.authService.hashPassword(password);

      res.status(200).json({
        hashedPassword,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Password hashing failed', { error: error.message });
      res.status(500).json({
        error: 'Password hashing failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Verify password endpoint
   */
  async verifyPassword(req: Request, res: Response): Promise<void> {
    try {
      const { password, hashedPassword } = req.body;

      if (!password || !hashedPassword) {
        res.status(400).json({
          error: 'Password and hashedPassword are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const isValid = await this.authService.verifyPassword(password, hashedPassword);

      res.status(200).json({
        valid: isValid,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Password verification failed', { error: error.message });
      res.status(500).json({
        error: 'Password verification failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Generate MFA secret endpoint
   */
  async generateMFASecret(req: Request, res: Response): Promise<void> {
    try {
      const { userId, email } = req.body;

      if (!userId || !email) {
        res.status(400).json({
          error: 'UserId and email are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const mfaSecret = await this.authService.generateMFASecret(userId, email);

      res.status(200).json({
        secret: mfaSecret.secret,
        qrCode: mfaSecret.qrCode,
        backupCodes: mfaSecret.backupCodes,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('MFA secret generation failed', { error: error.message });
      res.status(500).json({
        error: 'MFA secret generation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Verify MFA token endpoint
   */
  async verifyMFAToken(req: Request, res: Response): Promise<void> {
    try {
      const { userId, token } = req.body;

      if (!userId || !token) {
        res.status(400).json({
          error: 'UserId and token are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const isValid = await this.authService.verifyMFAToken(userId, token);

      res.status(200).json({
        valid: isValid,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('MFA token verification failed', { error: error.message });
      res.status(500).json({
        error: 'MFA token verification failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Scan for threats endpoint
   */
  async scanForThreats(req: Request, res: Response): Promise<void> {
    try {
      const { data, type = 'generic' } = req.body;

      if (!data) {
        res.status(400).json({
          error: 'Data is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const scanResult = await this.threatDetectionService.scanForThreats(data, type);

      res.status(200).json({
        result: scanResult,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Threat scan failed', { error: error.message });
      res.status(500).json({
        error: 'Threat scan failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get security metrics endpoint
   */
  async getSecurityMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { timeRange = '24h' } = req.query;

      const metrics = await this.threatDetectionService.getSecurityMetrics(timeRange as string);

      res.status(200).json({
        metrics,
        timeRange,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to get security metrics', { error: error.message });
      res.status(500).json({
        error: 'Failed to get security metrics',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get audit logs endpoint
   */
  async getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const {
        page = 1,
        limit = 100,
        userId,
        action,
        resource,
        startDate,
        endDate,
      } = req.query;

      const filters: any = {};
      if (userId) filters.userId = userId;
      if (action) filters.action = action;
      if (resource) filters.resource = resource;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const auditLogs = await this.auditService.getAuditLogs(filters, {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      res.status(200).json({
        logs: auditLogs.logs,
        pagination: auditLogs.pagination,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to get audit logs', { error: error.message });
      res.status(500).json({
        error: 'Failed to get audit logs',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Export personal data (GDPR compliance)
   */
  async exportPersonalData(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId) {
        res.status(400).json({
          error: 'UserId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const exportedData = await this.complianceService.exportPersonalData(userId);

      res.status(200).json({
        data: exportedData,
        exportDate: new Date().toISOString(),
        userId,
      });
    } catch (error) {
      logger.error('Data export failed', { error: error.message, userId: req.params.userId });
      res.status(500).json({
        error: 'Data export failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Delete personal data (GDPR compliance)
   */
  async deletePersonalData(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      if (!userId) {
        res.status(400).json({
          error: 'UserId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await this.complianceService.deletePersonalData(userId, reason);

      res.status(200).json({
        message: 'Personal data deleted successfully',
        userId,
        deletionDate: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Data deletion failed', { error: error.message, userId: req.params.userId });
      res.status(500).json({
        error: 'Data deletion failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Generate new encryption key
   */
  async generateKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyType = 'aes-256', purpose } = req.body;

      const key = await this.keyManagementService.generateKey(keyType, purpose);

      res.status(201).json({
        keyId: key.id,
        algorithm: key.algorithm,
        purpose: key.purpose,
        createdAt: key.createdAt,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Key generation failed', { error: error.message });
      res.status(500).json({
        error: 'Key generation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Rotate encryption key
   */
  async rotateKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;

      if (!keyId) {
        res.status(400).json({
          error: 'KeyId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const newKey = await this.keyManagementService.rotateKey(keyId);

      res.status(200).json({
        oldKeyId: keyId,
        newKeyId: newKey.id,
        rotationDate: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Key rotation failed', { error: error.message, keyId: req.params.keyId });
      res.status(500).json({
        error: 'Key rotation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Revoke encryption key
   */
  async revokeKey(req: Request, res: Response): Promise<void> {
    try {
      const { keyId } = req.params;
      const { reason } = req.body;

      if (!keyId) {
        res.status(400).json({
          error: 'KeyId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await this.keyManagementService.revokeKey(keyId, reason);

      res.status(200).json({
        message: 'Key revoked successfully',
        keyId,
        reason,
        revocationDate: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Key revocation failed', { error: error.message, keyId: req.params.keyId });
      res.status(500).json({
        error: 'Key revocation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get security status
   */
  async getSecurityStatus(req: Request, res: Response): Promise<void> {
    try {
      const securityContext: SecurityContext = (req as any).securityContext || {
        ip: req.ip || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        correlationId: correlationId.getId(),
        permissions: [],
        mfaVerified: false,
        riskScore: 0,
      };

      const status = {
        systemStatus: 'operational',
        securityLevel: securityContext.riskScore < 10 ? 'low' : 
                      securityContext.riskScore < 50 ? 'medium' : 'high',
        activeThreats: await this.threatDetectionService.getActiveThreats(),
        lastSecurityScan: new Date().toISOString(),
        keyRotationStatus: await this.keyManagementService.getRotationStatus(),
        complianceStatus: await this.complianceService.getComplianceStatus(),
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(status);
    } catch (error) {
      logger.error('Failed to get security status', { error: error.message });
      res.status(500).json({
        error: 'Failed to get security status',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Validate security configuration
   */
  async validateConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const validation = {
        encryptionService: await this.encryptionService.validateConfiguration(),
        authenticationService: await this.authService.validateConfiguration(),
        threatDetectionService: await this.threatDetectionService.validateConfiguration(),
        keyManagementService: await this.keyManagementService.validateConfiguration(),
        complianceService: await this.complianceService.validateConfiguration(),
        timestamp: new Date().toISOString(),
      };

      const isValid = Object.values(validation).every(v => v === true || (typeof v === 'object' && v.valid));

      res.status(200).json({
        valid: isValid,
        validation,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Configuration validation failed', { error: error.message });
      res.status(500).json({
        error: 'Configuration validation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Emergency security lockdown
   */
  async emergencyLockdown(req: Request, res: Response): Promise<void> {
    try {
      const { reason, severity = 'high' } = req.body;
      const securityContext: SecurityContext = (req as any).securityContext;

      logger.error('Emergency security lockdown initiated', {
        reason,
        severity,
        initiatedBy: securityContext?.userId,
        ip: securityContext?.ip,
        correlationId: securityContext?.correlationId,
      });

      // In a real implementation, this would:
      // 1. Disable all non-essential services
      // 2. Revoke active sessions
      // 3. Alert security team
      // 4. Enable enhanced monitoring

      res.status(200).json({
        message: 'Emergency lockdown initiated',
        lockdownId: correlationId.getId(),
        reason,
        severity,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Emergency lockdown failed', { error: error.message });
      res.status(500).json({
        error: 'Emergency lockdown failed',
        timestamp: new Date().toISOString(),
      });
    }
  }
}