import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from './logger';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: config.env === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: config.database.url
      }
    }
  });
};

declare global {
  // eslint-disable-next-line no-var
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (config.env !== 'production') {
  globalThis.prisma = prisma;
}

// Handle Prisma connection events
prisma.$connect()
  .then(() => {
    logger.info('Successfully connected to database');
  })
  .catch((error) => {
    logger.error('Failed to connect to database:', error);
    process.exit(1);
  });