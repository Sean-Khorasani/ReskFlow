// Export all shared modules
export * from './config';
export * from './database/prisma';
export * from './database/redis';
export * from './utils/logger';
export * from './blockchain';
export * from './middleware/auth';
export * from './types';

// Export services
export { S3Service } from './services/S3Service';
export { NotificationService } from './services/NotificationService';

// Export blockchain service instance
export { blockchain } from './blockchain';

// Export database instances
export { prisma } from './database/prisma';
export { redis } from './database/redis';

// Export logger instance
export { logger } from './utils/logger';

// Export EventEmitter
export { EventEmitter } from 'events';