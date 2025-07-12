import mongoose from 'mongoose';
import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { redis } from './utils/redis';
import { CryptoService } from './services';

const startServer = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.database.uri);
    logger.info('Connected to MongoDB');

    // Test Redis connection
    await redis.ping();
    logger.info('Redis connection verified');

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.app.port, () => {
      logger.info(`Payment service running on port ${config.app.port}`);
    });

    // Start background jobs
    startBackgroundJobs();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      
      server.close(() => {
        logger.info('HTTP server closed');
      });

      await mongoose.connection.close();
      logger.info('MongoDB connection closed');

      await redis.quit();
      logger.info('Redis connection closed');

      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

const startBackgroundJobs = () => {
  const cryptoService = new CryptoService();

  // Check pending crypto transactions every 5 minutes
  setInterval(async () => {
    try {
      await cryptoService.checkPendingTransactions();
    } catch (error) {
      logger.error('Error in crypto transaction check job:', error);
    }
  }, 5 * 60 * 1000);

  logger.info('Background jobs started');
};

// Start the server
startServer();