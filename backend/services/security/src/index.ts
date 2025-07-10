import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import correlationId from 'correlation-id';
import { config, logger, connectDatabase } from '@reskflow/shared';
import { EncryptionService } from './services/EncryptionService';
import { AuthenticationService } from './services/AuthenticationService';
import { AuditService } from './services/AuditService';
import { ComplianceService } from './services/ComplianceService';
import { ThreatDetectionService } from './services/ThreatDetectionService';
import { KeyManagementService } from './services/KeyManagementService';
import { securityMiddleware } from './middleware/security';
import { auditMiddleware } from './middleware/audit';

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(mongoSanitize()); // Prevent MongoDB injection
app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use(correlationId.middleware); // Request correlation

// Custom security middleware
app.use(securityMiddleware);
app.use(auditMiddleware);

let encryptionService: EncryptionService;
let authenticationService: AuthenticationService;
let auditService: AuditService;
let complianceService: ComplianceService;
let threatDetectionService: ThreatDetectionService;
let keyManagementService: KeyManagementService;

async function startService() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Security service: Database connected');

    // Initialize services
    keyManagementService = new KeyManagementService();
    await keyManagementService.initialize();

    encryptionService = new EncryptionService(keyManagementService);
    authenticationService = new AuthenticationService();
    auditService = new AuditService();
    complianceService = new ComplianceService();
    threatDetectionService = new ThreatDetectionService();

    // Start threat detection monitoring
    threatDetectionService.startMonitoring();

    // API endpoints
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        service: 'security',
        timestamp: new Date().toISOString(),
      });
    });

    // Encryption endpoints
    app.post('/encrypt', async (req, res) => {
      try {
        const { data, context } = req.body;
        const encrypted = await encryptionService.encryptData(data, context);
        res.json({ encrypted });
      } catch (error) {
        logger.error('Encryption failed', error);
        res.status(500).json({ error: 'Encryption failed' });
      }
    });

    app.post('/decrypt', async (req, res) => {
      try {
        const { encryptedData, context } = req.body;
        const decrypted = await encryptionService.decryptData(encryptedData, context);
        res.json({ data: decrypted });
      } catch (error) {
        logger.error('Decryption failed', error);
        res.status(500).json({ error: 'Decryption failed' });
      }
    });

    // Multi-factor authentication
    app.post('/mfa/setup', async (req, res) => {
      try {
        const { userId } = req.body;
        const setup = await authenticationService.setupMFA(userId);
        res.json(setup);
      } catch (error) {
        logger.error('MFA setup failed', error);
        res.status(500).json({ error: 'MFA setup failed' });
      }
    });

    app.post('/mfa/verify', async (req, res) => {
      try {
        const { userId, token } = req.body;
        const valid = await authenticationService.verifyMFA(userId, token);
        res.json({ valid });
      } catch (error) {
        logger.error('MFA verification failed', error);
        res.status(500).json({ error: 'MFA verification failed' });
      }
    });

    // Password validation
    app.post('/password/validate', async (req, res) => {
      try {
        const { password } = req.body;
        const validation = authenticationService.validatePassword(password);
        res.json(validation);
      } catch (error) {
        logger.error('Password validation failed', error);
        res.status(500).json({ error: 'Password validation failed' });
      }
    });

    // Audit logs
    app.get('/audit/logs', async (req, res) => {
      try {
        const { startDate, endDate, userId, action, limit = 100 } = req.query;
        
        const logs = await auditService.getAuditLogs({
          startDate: startDate as string,
          endDate: endDate as string,
          userId: userId as string,
          action: action as string,
          limit: parseInt(limit as string),
        });

        res.json(logs);
      } catch (error) {
        logger.error('Failed to retrieve audit logs', error);
        res.status(500).json({ error: 'Failed to retrieve audit logs' });
      }
    });

    // Compliance reports
    app.get('/compliance/gdpr/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const report = await complianceService.generateGDPRReport(userId);
        res.json(report);
      } catch (error) {
        logger.error('GDPR report generation failed', error);
        res.status(500).json({ error: 'GDPR report generation failed' });
      }
    });

    app.post('/compliance/data-deletion/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const result = await complianceService.handleDataDeletionRequest(userId);
        res.json(result);
      } catch (error) {
        logger.error('Data deletion failed', error);
        res.status(500).json({ error: 'Data deletion failed' });
      }
    });

    // Security analytics
    app.get('/analytics/threats', async (req, res) => {
      try {
        const threats = await threatDetectionService.getRecentThreats();
        res.json(threats);
      } catch (error) {
        logger.error('Failed to get threat analytics', error);
        res.status(500).json({ error: 'Failed to get threat analytics' });
      }
    });

    app.get('/analytics/security-score', async (req, res) => {
      try {
        const score = await threatDetectionService.calculateSecurityScore();
        res.json(score);
      } catch (error) {
        logger.error('Failed to calculate security score', error);
        res.status(500).json({ error: 'Failed to calculate security score' });
      }
    });

    // Key rotation
    app.post('/keys/rotate', async (req, res) => {
      try {
        const { keyType } = req.body;
        const result = await keyManagementService.rotateKey(keyType);
        res.json(result);
      } catch (error) {
        logger.error('Key rotation failed', error);
        res.status(500).json({ error: 'Key rotation failed' });
      }
    });

    // IP whitelist/blacklist management
    app.post('/security/whitelist', async (req, res) => {
      try {
        const { ip, description } = req.body;
        await threatDetectionService.addToWhitelist(ip, description);
        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to add to whitelist', error);
        res.status(500).json({ error: 'Failed to add to whitelist' });
      }
    });

    app.post('/security/blacklist', async (req, res) => {
      try {
        const { ip, reason } = req.body;
        await threatDetectionService.addToBlacklist(ip, reason);
        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to add to blacklist', error);
        res.status(500).json({ error: 'Failed to add to blacklist' });
      }
    });

    // Security headers test
    app.get('/security/headers-test', (req, res) => {
      res.json({
        headers: req.headers,
        secure: req.secure,
        ip: req.ip,
        correlationId: correlationId.getId(),
      });
    });

    // Error handling
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', err);
      
      // Don't leak error details in production
      if (config.env === 'production') {
        res.status(500).json({
          error: 'Internal server error',
          correlationId: correlationId.getId(),
        });
      } else {
        res.status(err.status || 500).json({
          error: err.message,
          stack: err.stack,
          correlationId: correlationId.getId(),
        });
      }
    });

    // Start server
    const PORT = 3006;
    app.listen(PORT, () => {
      logger.info(`🔒 Security service ready at http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      await keyManagementService.cleanup();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start security service', error);
    process.exit(1);
  }
}

// Start scheduled security tasks
setInterval(async () => {
  try {
    // Run security scans
    await threatDetectionService.runSecurityScan();
    
    // Check for expired sessions
    await authenticationService.cleanupExpiredSessions();
    
    // Rotate logs
    await auditService.rotateLogs();
  } catch (error) {
    logger.error('Scheduled security task failed', error);
  }
}, 60 * 60 * 1000); // Run every hour

startService();