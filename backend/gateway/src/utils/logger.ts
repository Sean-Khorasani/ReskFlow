/**
 * Logger Utility
 * Centralized logging for the API Gateway
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Create transports
const transports: winston.transport[] = [];

// Console transport
if (process.env.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleFormat
      )
    })
  );
}

// File transport with rotation
if (config.logging.file) {
  transports.push(
    new DailyRotateFile({
      filename: config.logging.file.replace('.log', '-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: combine(
        timestamp(),
        errors({ stack: true }),
        json()
      )
    })
  );
}

// Create logger instance
export const logger = winston.createLogger({
  level: config.logging.level,
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'api-gateway' },
  transports,
  exitOnError: false
});

// Add request logging middleware
export const requestLogger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp(),
    json()
  ),
  defaultMeta: { service: 'api-gateway-requests' },
  transports: [
    new DailyRotateFile({
      filename: 'logs/requests-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '7d'
    })
  ]
});

// Add error logging
export const errorLogger = winston.createLogger({
  level: 'error',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'api-gateway-errors' },
  transports: [
    new DailyRotateFile({
      filename: 'logs/errors-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d'
    })
  ]
});

// Stream for Morgan HTTP logger
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  }
};

// Log unhandled errors
if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason, promise) => {
    errorLogger.error('Unhandled Rejection at:', {
      promise,
      reason
    });
  });

  process.on('uncaughtException', (error) => {
    errorLogger.error('Uncaught Exception:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}