import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import 'express-async-errors';

import { PrismaClient } from '@prisma/client';
import { Server } from 'socket.io';
import { createServer } from 'http';

import trackingRoutes from './routes/tracking.routes';
import { redisClient } from './utils/redis';
import { logger } from './utils/logger';
import { logRequest } from './middleware/auth';

class TrackingServiceApp {
  private app: express.Application;
  private server: any;
  private io: Server;
  private prisma: PrismaClient;

  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      optionsSuccessStatus: 200,
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging
    this.app.use(morgan('combined', {
      stream: {
        write: (message: string) => {
          logger.info(message.trim());
        },
      },
    }));

    // Request logging
    this.app.use(logRequest);

    // Trust proxy for rate limiting and IP extraction
    this.app.set('trust proxy', 1);
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        service: 'tracking-service',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.API_VERSION || '1.0.0',
      });
    });

    // API routes
    this.app.use('/api/v1/tracking', trackingRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      logger.warn('Route not found', {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      });

      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private setupWebSocket(): void {
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    // WebSocket authentication middleware
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      
      if (!token) {
        logger.warn('WebSocket connection attempt without token', {
          socketId: socket.id,
          ip: socket.handshake.address,
        });
        return next(new Error('Authentication required'));
      }

      // Validate token (simplified)
      // In production, use proper JWT validation
      if (token.length < 10) {
        logger.warn('WebSocket connection attempt with invalid token', {
          socketId: socket.id,
          ip: socket.handshake.address,
        });
        return next(new Error('Invalid token'));
      }

      // Attach user info to socket
      (socket as any).user = {
        id: 'user_' + Math.random().toString(36).substr(2, 9),
        role: 'user',
      };

      logger.info('WebSocket client authenticated', {
        socketId: socket.id,
        userId: (socket as any).user.id,
        ip: socket.handshake.address,
      });

      next();
    });

    this.io.on('connection', (socket) => {
      const user = (socket as any).user;
      
      logger.info('WebSocket client connected', {
        socketId: socket.id,
        userId: user?.id,
        ip: socket.handshake.address,
      });

      // Handle tracking session subscription
      socket.on('subscribe_session', (sessionId: string) => {
        if (!sessionId) {
          socket.emit('error', { message: 'Session ID is required' });
          return;
        }

        socket.join(`session:${sessionId}`);
        logger.info('Client subscribed to session updates', {
          socketId: socket.id,
          userId: user?.id,
          sessionId,
        });

        socket.emit('subscribed', { sessionId });
      });

      // Handle driver location subscription
      socket.on('subscribe_driver', (driverId: string) => {
        if (!driverId) {
          socket.emit('error', { message: 'Driver ID is required' });
          return;
        }

        socket.join(`driver:${driverId}`);
        logger.info('Client subscribed to driver updates', {
          socketId: socket.id,
          userId: user?.id,
          driverId,
        });

        socket.emit('subscribed', { driverId });
      });

      // Handle unsubscription
      socket.on('unsubscribe_session', (sessionId: string) => {
        socket.leave(`session:${sessionId}`);
        logger.info('Client unsubscribed from session updates', {
          socketId: socket.id,
          userId: user?.id,
          sessionId,
        });
      });

      socket.on('unsubscribe_driver', (driverId: string) => {
        socket.leave(`driver:${driverId}`);
        logger.info('Client unsubscribed from driver updates', {
          socketId: socket.id,
          userId: user?.id,
          driverId,
        });
      });

      // Handle real-time location updates from drivers
      socket.on('driver_location_update', async (data: {
        driverId: string;
        sessionId?: string;
        location: {
          latitude: number;
          longitude: number;
          accuracy?: number;
          speed?: number;
          heading?: number;
        };
      }) => {
        try {
          // Validate data
          if (!data.driverId || !data.location || !data.location.latitude || !data.location.longitude) {
            socket.emit('error', { message: 'Invalid location data' });
            return;
          }

          // Update location in Redis
          await redisClient.setDriverLocation(data.driverId, {
            ...data.location,
            timestamp: new Date(),
          });

          // Broadcast to subscribers
          this.io.to(`driver:${data.driverId}`).emit('driver_location', {
            driverId: data.driverId,
            location: data.location,
            timestamp: new Date().toISOString(),
          });

          if (data.sessionId) {
            this.io.to(`session:${data.sessionId}`).emit('location_update', {
              sessionId: data.sessionId,
              location: data.location,
              timestamp: new Date().toISOString(),
            });
          }

          logger.debug('Driver location update broadcasted', {
            driverId: data.driverId,
            sessionId: data.sessionId,
            subscriberCount: this.io.sockets.adapter.rooms.get(`driver:${data.driverId}`)?.size || 0,
          });

        } catch (error) {
          logger.error('Failed to process driver location update', {
            error: error.message,
            data,
            socketId: socket.id,
          });

          socket.emit('error', { message: 'Failed to process location update' });
        }
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info('WebSocket client disconnected', {
          socketId: socket.id,
          userId: user?.id,
          reason,
          ip: socket.handshake.address,
        });
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error('WebSocket error', {
          error: error.message,
          socketId: socket.id,
          userId: user?.id,
        });
      });
    });

    logger.info('WebSocket server configured');
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString(),
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack,
      });
      
      this.gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', {
        reason,
        promise,
      });
      
      this.gracefulShutdown('UNHANDLED_REJECTION');
    });

    // Handle shutdown signals
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Close WebSocket connections
      if (this.io) {
        this.io.close(() => {
          logger.info('WebSocket server closed');
        });
      }

      // Close database connections
      await this.prisma.$disconnect();
      logger.info('Database connection closed');

      // Close Redis connection
      await redisClient.disconnect();
      logger.info('Redis connection closed');

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown', {
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    }
  }

  public async start(): Promise<void> {
    try {
      // Connect to Redis
      await redisClient.connect();
      logger.info('Connected to Redis');

      // Test database connection
      await this.prisma.$connect();
      logger.info('Connected to database');

      // Start server
      const port = process.env.PORT || 3007;
      
      this.server.listen(port, () => {
        logger.info('Tracking service started', {
          port,
          nodeEnv: process.env.NODE_ENV || 'development',
          version: process.env.API_VERSION || '1.0.0',
        });
      });

    } catch (error) {
      logger.error('Failed to start tracking service', {
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    }
  }

  // Public method to broadcast events to WebSocket clients
  public broadcastToSession(sessionId: string, event: string, data: any): void {
    this.io.to(`session:${sessionId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  public broadcastToDriver(driverId: string, event: string, data: any): void {
    this.io.to(`driver:${driverId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }
}

// Start the application
const app = new TrackingServiceApp();
app.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

export default TrackingServiceApp;