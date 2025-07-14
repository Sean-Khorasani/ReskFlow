import winston from 'winston';
import correlationId from 'correlation-id';
import { config } from '@reskflow/shared';
import { LogLevel, SecurityEvent } from '../types/security.types';

// Custom log format for security events
const securityFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const logEntry = {
      timestamp: info.timestamp,
      level: info.level,
      message: info.message,
      correlationId: correlationId.getId(),
      service: 'security',
      ...info.metadata,
    };
    
    // Add security-specific fields
    if (info.securityEvent) {
      logEntry.securityEvent = info.securityEvent;
    }
    
    if (info.userId) {
      logEntry.userId = info.userId;
    }
    
    if (info.ip) {
      logEntry.ip = info.ip;
    }
    
    if (info.userAgent) {
      logEntry.userAgent = info.userAgent;
    }
    
    return JSON.stringify(logEntry);
  })
);

// Create security logger
const securityLogger = winston.createLogger({
  level: config.logLevel || 'info',
  format: securityFormat,
  defaultMeta: {
    service: 'security',
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    
    // File transport for security events
    new winston.transports.File({
      filename: '/var/log/reskflow/security-error.log',
      level: 'error',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
    }),
    
    // File transport for all security logs
    new winston.transports.File({
      filename: '/var/log/reskflow/security-combined.log',
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 10,
    }),
    
    // File transport for audit trail
    new winston.transports.File({
      filename: '/var/log/reskflow/security-audit.log',
      level: 'info',
      maxsize: 200 * 1024 * 1024, // 200MB
      maxFiles: 20,
    }),
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: '/var/log/reskflow/security-exceptions.log',
    }),
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: '/var/log/reskflow/security-rejections.log',
    }),
  ],
});

/**
 * Log security events with structured data
 */
export function logSecurityEvent(event: SecurityEvent): void {
  securityLogger.info('Security event', {
    securityEvent: event,
    userId: event.metadata?.userId,
    ip: event.metadata?.ip,
    userAgent: event.metadata?.userAgent,
    metadata: event.metadata,
  });
}

/**
 * Log authentication events
 */
export function logAuthEvent(
  action: string,
  userId: string,
  success: boolean,
  ip: string,
  userAgent: string,
  details?: Record<string, any>
): void {
  const level = success ? 'info' : 'warn';
  const message = `Authentication ${action}: ${success ? 'SUCCESS' : 'FAILED'}`;
  
  securityLogger.log(level, message, {
    securityEvent: {
      type: 'authentication',
      severity: success ? 'info' : 'warning',
      source: 'auth_service',
      description: message,
      metadata: {
        action,
        userId,
        success,
        ip,
        userAgent,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
    userId,
    ip,
    userAgent,
  });
}

/**
 * Log data access events
 */
export function logDataAccess(
  resource: string,
  action: string,
  userId: string,
  ip: string,
  success: boolean,
  details?: Record<string, any>
): void {
  const level = success ? 'info' : 'error';
  const message = `Data access ${action} on ${resource}: ${success ? 'SUCCESS' : 'FAILED'}`;
  
  securityLogger.log(level, message, {
    securityEvent: {
      type: 'data_access',
      severity: success ? 'info' : 'error',
      source: 'data_service',
      target: resource,
      description: message,
      metadata: {
        resource,
        action,
        userId,
        success,
        ip,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
    userId,
    ip,
  });
}

/**
 * Log compliance events
 */
export function logComplianceEvent(
  action: string,
  userId?: string,
  dataTypes?: string[],
  details?: Record<string, any>
): void {
  const message = `Compliance action: ${action}`;
  
  securityLogger.info(message, {
    securityEvent: {
      type: 'compliance_action',
      severity: 'info',
      source: 'compliance_service',
      description: message,
      metadata: {
        action,
        userId,
        dataTypes,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
    userId,
  });
}

/**
 * Log threat detection events
 */
export function logThreatDetection(
  threatType: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  source: string,
  target?: string,
  details?: Record<string, any>
): void {
  const message = `Threat detected: ${threatType} from ${source}`;
  
  securityLogger.warn(message, {
    securityEvent: {
      type: 'threat_detected',
      severity,
      source,
      target,
      description: message,
      metadata: {
        threatType,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
  });
}

/**
 * Log key rotation events
 */
export function logKeyRotation(
  keyType: string,
  keyId: string,
  success: boolean,
  details?: Record<string, any>
): void {
  const level = success ? 'info' : 'error';
  const message = `Key rotation ${keyType}: ${success ? 'SUCCESS' : 'FAILED'}`;
  
  securityLogger.log(level, message, {
    securityEvent: {
      type: 'key_rotation',
      severity: success ? 'info' : 'error',
      source: 'key_management_service',
      description: message,
      metadata: {
        keyType,
        keyId,
        success,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
  });
}

/**
 * Log configuration changes
 */
export function logConfigChange(
  component: string,
  change: string,
  userId: string,
  details?: Record<string, any>
): void {
  const message = `Configuration change in ${component}: ${change}`;
  
  securityLogger.info(message, {
    securityEvent: {
      type: 'configuration_change',
      severity: 'info',
      source: component,
      description: message,
      metadata: {
        component,
        change,
        userId,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
    userId,
  });
}

/**
 * Log security scan results
 */
export function logSecurityScan(
  scanType: string,
  findings: number,
  duration: number,
  details?: Record<string, any>
): void {
  const message = `Security scan completed: ${scanType}, found ${findings} issues`;
  
  securityLogger.info(message, {
    securityEvent: {
      type: 'security_scan',
      severity: findings > 0 ? 'warning' : 'info',
      source: 'threat_detection_service',
      description: message,
      metadata: {
        scanType,
        findings,
        duration,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
  });
}

/**
 * Log audit trail events
 */
export function logAuditEvent(
  action: string,
  resource: string,
  userId?: string,
  ip?: string,
  success?: boolean,
  details?: Record<string, any>
): void {
  const message = `Audit: ${action} on ${resource}`;
  
  securityLogger.info(message, {
    securityEvent: {
      type: 'audit_log',
      severity: 'info',
      source: 'audit_service',
      target: resource,
      description: message,
      metadata: {
        action,
        resource,
        userId,
        ip,
        success,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
    userId,
    ip,
  });
}

/**
 * Log with custom level and metadata
 */
export function log(logData: LogLevel): void {
  securityLogger.log(logData.level, logData.message, {
    metadata: logData.metadata,
    timestamp: logData.timestamp || new Date(),
    correlationId: logData.correlationId || correlationId.getId(),
  });
}

/**
 * Log critical security alerts
 */
export function logCriticalAlert(
  message: string,
  source: string,
  details?: Record<string, any>
): void {
  securityLogger.error(`CRITICAL SECURITY ALERT: ${message}`, {
    securityEvent: {
      type: 'threat_detected',
      severity: 'critical',
      source,
      description: message,
      metadata: {
        alert: true,
        ...details,
      },
      timestamp: new Date(),
      correlationId: correlationId.getId(),
    },
  });
  
  // TODO: Integrate with alerting system (email, Slack, PagerDuty, etc.)
}

/**
 * Create child logger with additional context
 */
export function createChildLogger(context: Record<string, any>): winston.Logger {
  return securityLogger.child(context);
}

/**
 * Get logger instance for external use
 */
export function getLogger(): winston.Logger {
  return securityLogger;
}

// Export the logger as default
export default securityLogger;