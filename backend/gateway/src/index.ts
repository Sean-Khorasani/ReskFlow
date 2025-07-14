import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config, logger, connectDatabase } from '@reskflow/shared';
import { schema } from './graphql/schema';
import { createContext } from './graphql/context';
import { setupWebSocketServer } from './websocket';
import { setupRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';

async function startServer() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Database connected');

    // Create Express app
    const app = express();

    // Security middleware
    app.use(helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    }));
    app.use(cors({
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://reskflow.com', 'https://app.reskflow.com']
        : true,
      credentials: true,
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.security.rateLimitWindow,
      max: config.security.rateLimitMax,
      message: 'Too many requests from this IP',
    });
    app.use('/api/', limiter);

    // General middleware
    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(morgan('combined'));

    // Health check
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version,
      });
    });
    
    // Service-specific health endpoints for performance tests
    app.get('/api/auth/health', (req, res) => res.json({ status: 'healthy', service: 'auth' }));
    app.get('/api/users/health', (req, res) => res.json({ status: 'healthy', service: 'user' }));
    app.get('/api/orders/health', (req, res) => res.json({ status: 'healthy', service: 'order' }));
    app.get('/api/payments/health', (req, res) => res.json({ status: 'healthy', service: 'payment' }));
    app.get('/api/notifications/health', (req, res) => res.json({ status: 'healthy', service: 'notification' }));
    app.get('/api/catalog/health', (req, res) => res.json({ status: 'healthy', service: 'catalog' }));
    app.get('/api/merchants/health', (req, res) => res.json({ status: 'healthy', service: 'merchant' }));

    // REST API routes
    setupRoutes(app);

    // Create HTTP server
    const httpServer = createServer(app);

    // Setup WebSocket server
    const io = new Server(httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? ['https://reskflow.com', 'https://app.reskflow.com']
          : true,
        credentials: true,
      },
    });
    setupWebSocketServer(io);

    // Create Apollo Server
    const apolloServer = new ApolloServer({
      schema,
      context: createContext,
      csrfPrevention: true,
      cache: 'bounded',
      plugins: [
        {
          async serverWillStart() {
            logger.info('GraphQL server starting');
          },
        },
      ],
    });

    // Start Apollo Server
    await apolloServer.start();
    apolloServer.applyMiddleware({ 
      app, 
      path: '/graphql',
      cors: false, // We're handling CORS at the app level
    });

    // Error handling
    app.use(errorHandler);

    // Start server
    const PORT = config.port;
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server ready at http://localhost:${PORT}`);
      logger.info(`🚀 GraphQL ready at http://localhost:${PORT}${apolloServer.graphqlPath}`);
      logger.info(`🚀 WebSocket ready at ws://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      httpServer.close(async () => {
        await apolloServer.stop();
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

startServer();