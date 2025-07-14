import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { EncryptionService } from './services/EncryptionService';
import { AuthenticationService } from './services/AuthenticationService';
import { ThreatDetectionService } from './services/ThreatDetectionService';
import { AuditService } from './services/AuditService';
import { ComplianceService } from './services/ComplianceService';
import { KeyManagementService } from './services/KeyManagementService';
import { SecurityController } from './controllers/security.controller';
import { 
  createSecurityRoutes, 
  createAdminSecurityRoutes, 
  createInternalSecurityRoutes 
} from './routes/security.routes';
import { 
  initializeAuditMiddleware 
} from './middleware/audit';
import { 
  initializeSecurityMiddleware,
  helmetMiddleware,
  mongoSanitizeMiddleware,
  hppMiddleware,
  corsSecurityMiddleware
} from './middleware/security';
import { logger } from './utils/logger';
import correlationId from 'correlation-id';

class SecurityServiceApp {
  private app: express.Application;
  private redisClient: any;

  // Services
  private encryptionService!: EncryptionService;
  private authService!: AuthenticationService;
  private threatDetectionService!: ThreatDetectionService;
  private auditService!: AuditService;
  private complianceService!: ComplianceService;
  private keyManagementService!: KeyManagementService;

  // Controller
  private securityController!: SecurityController;

  constructor() {
    this.app = express();
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    // Correlation ID for request tracing
    this.app.use(correlationId());

    // Security middleware
    this.app.use(helmetMiddleware);
    this.app.use(mongoSanitizeMiddleware);
    this.app.use(hppMiddleware);

    // CORS configuration
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [];
    this.app.use(corsSecurityMiddleware(allowedOrigins));

    // Body parsing with size limits
    this.app.use(express.json({ 
      limit: process.env.MAX_REQUEST_SIZE || '10mb',
      verify: (req, res, buf) => {
        // Additional request validation if needed
      }
    }));
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: process.env.MAX_REQUEST_SIZE || '10mb' 
    }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        correlationId: correlationId.getId(),
      });
      next();
    });
  }

  private async connectToDatabase(): Promise<void> {
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/reskflow_security';
      
      await mongoose.connect(mongoUri, {
        retryWrites: true,
        w: 'majority',
      });

      logger.info('Connected to MongoDB', { database: process.env.DATABASE_NAME });
    } catch (error) {
      logger.error('Failed to connect to MongoDB', { error: error.message });
      throw error;
    }
  }

  private async connectToRedis(): Promise<void> {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      this.redisClient = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 500)
        }
      });

      this.redisClient.on('error', (error: Error) => {
        logger.error('Redis error', { error: error.message });
      });

      this.redisClient.on('connect', () => {
        logger.info('Connected to Redis');
      });

      await this.redisClient.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis', { error: error.message });
      throw error;
    }
  }

  private async initializeServices(): Promise<void> {
    try {
      // Initialize services
      this.encryptionService = new EncryptionService();
      this.authService = new AuthenticationService();
      this.threatDetectionService = new ThreatDetectionService(this.redisClient);
      this.auditService = new AuditService();
      this.complianceService = new ComplianceService();
      this.keyManagementService = new KeyManagementService();

      // Initialize middleware with services
      initializeAuditMiddleware(this.auditService);
      initializeSecurityMiddleware(this.threatDetectionService);

      // Create controller
      this.securityController = new SecurityController(
        this.encryptionService,
        this.authService,
        this.threatDetectionService,
        this.auditService,
        this.complianceService,
        this.keyManagementService
      );

      logger.info('All services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services', { error: error.message });
      throw error;
    }
  }

  private setupRoutes(): void {
    // API versioning
    const apiVersion = process.env.API_VERSION || 'v1';
    
    // Public security endpoints
    this.app.use(`/api/${apiVersion}/security`, createSecurityRoutes(this.securityController));
    
    // Admin security endpoints
    this.app.use(`/api/${apiVersion}/admin/security`, createAdminSecurityRoutes(this.securityController));
    
    // Internal service endpoints
    this.app.use(`/api/${apiVersion}/internal/security`, createInternalSecurityRoutes(this.securityController));

    // Health check endpoint (no versioning)
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        service: 'security',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      logger.warn('Route not found', {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        correlationId: correlationId.getId(),
      });

      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
      });
    });

    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        method: req.method,
        path: req.path,
        ip: req.ip,
        correlationId: correlationId.getId(),
      });

      res.status(500).json({
        error: 'Internal server error',
        correlationId: correlationId.getId(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      try {
        // Close Redis connection
        if (this.redisClient) {
          await this.redisClient.quit();
          logger.info('Redis connection closed');
        }

        // Close MongoDB connection
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');

        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown', { error: error.message });
        process.exit(1);
      }
    };

    // Handle different shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', { reason, promise });
      process.exit(1);
    });
  }

  public async start(): Promise<void> {
    try {
      // Connect to databases
      await this.connectToDatabase();
      await this.connectToRedis();

      // Initialize services
      await this.initializeServices();

      // Setup routes
      this.setupRoutes();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      // Start server
      const port = process.env.PORT || 3006;
      this.app.listen(port, () => {
        logger.info('Security service started', {
          port,
          nodeEnv: process.env.NODE_ENV,
          version: process.env.API_VERSION,
        });
      });
    } catch (error) {
      logger.error('Failed to start security service', { error: error.message });
      process.exit(1);
    }
  }
}

// Start the application
const app = new SecurityServiceApp();
app.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

export default SecurityServiceApp;