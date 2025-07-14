import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config';
import { logger } from './utils/logger';
import { notificationRouter } from './routes/notification.routes';
import { errorHandler } from './middleware/error';
import { setupMessageHandlers } from './utils/message-handler';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger: logger as any }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'notification-service',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/notifications', notificationRouter);

// Error handling
app.use(errorHandler);

// Start server
const server = app.listen(config.port, () => {
  logger.info(`Notification service listening on port ${config.port}`);
  
  // Setup message queue handlers
  setupMessageHandlers();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;