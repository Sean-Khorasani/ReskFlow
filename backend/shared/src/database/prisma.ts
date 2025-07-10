import { PrismaClient } from '@prisma/client';
import { config } from '../config';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
  log: config.env === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: config.database.url,
    },
  },
});

if (config.env !== 'production') {
  global.prisma = prisma;
}

export async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}