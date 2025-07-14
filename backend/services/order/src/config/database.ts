import { PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log: config.env === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export async function connectDatabase() {
  try {
    // Connect to PostgreSQL via Prisma
    await prisma.$connect();
    logger.info('Connected to PostgreSQL database');

    // Connect to MongoDB
    await mongoose.connect(config.mongodb.uri);
    logger.info('Connected to MongoDB');

    // Handle MongoDB connection events
    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    return true;
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
}

export async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
    await mongoose.disconnect();
    logger.info('Disconnected from databases');
  } catch (error) {
    logger.error('Error disconnecting from databases:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await disconnectDatabase();
});