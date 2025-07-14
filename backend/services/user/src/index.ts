import express from 'express';
import 'express-async-errors';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/logger.middleware';
import { rateLimiter } from './middleware/rate-limit.middleware';
import { authRouter } from './routes/auth.routes';
import { userRouter } from './routes/user.routes';
import { profileRouter } from './routes/profile.routes';
import { sessionRouter } from './routes/session.routes';
import { addressRouter } from './routes/address.routes';
import { healthRouter } from './routes/health.routes';
import customerRouter from './routes/customer.routes';
import { prisma } from './utils/prisma';
import { redis } from './utils/redis';
import { logger } from './utils/logger';
import { MessageQueue } from './utils/message-queue';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(rateLimiter);

// Routes
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/users', userRouter);
app.use('/profile', profileRouter);
app.use('/sessions', sessionRouter);
app.use('/addresses', addressRouter);
app.use('/api/v1/customers', customerRouter);

// Error handling
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Graceful shutdown initiated');
  
  try {
    await prisma.$disconnect();
    await redis.quit();
    await MessageQueue.getInstance().close();
    
    logger.info('All connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
app.listen(config.port, () => {
  logger.info(`User service running on port ${config.port}`);
});

export default app;