import winston from 'winston';
import { config } from '../config';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ['message', 'level', 'timestamp', 'label'],
  })
);

const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, metadata }) => {
    let output = `${timestamp} [${level}]: ${message}`;
    
    if (metadata && Object.keys(metadata).length > 0) {
      output += `\n${JSON.stringify(metadata, null, 2)}`;
    }
    
    return output;
  })
);

const productionFormat = winston.format.combine(
  logFormat,
  winston.format.json()
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.env === 'development' ? developmentFormat : productionFormat,
  defaultMeta: { 
    service: config.serviceName,
    environment: config.env,
  },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

// Add file transports for production
if (config.env === 'production') {
  // Error log
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        logFormat,
        winston.format.json()
      ),
    })
  );

  // Combined log
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        logFormat,
        winston.format.json()
      ),
    })
  );

  // Delivery specific logs
  logger.add(
    new winston.transports.File({
      filename: 'logs/reskflow.log',
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      format: winston.format.combine(
        logFormat,
        winston.format.json()
      ),
    })
  );
}

// Create specialized loggers for different components
export const reskflowLogger = logger.child({
  component: 'reskflow',
});

export const driverLogger = logger.child({
  component: 'driver',
});

export const trackingLogger = logger.child({
  component: 'tracking',
});

export const routeLogger = logger.child({
  component: 'route',
});

export const websocketLogger = logger.child({
  component: 'websocket',
});

export const authLogger = logger.child({
  component: 'auth',
});

export const dbLogger = logger.child({
  component: 'database',
});

// Helper functions for structured logging
export const loggerHelpers = {
  // Log reskflow events
  logDeliveryEvent: (event: string, reskflowId: string, data?: any) => {
    reskflowLogger.info('Delivery event', {
      event,
      reskflowId,
      ...data,
    });
  },

  // Log driver events  
  logDriverEvent: (event: string, driverId: string, data?: any) => {
    driverLogger.info('Driver event', {
      event,
      driverId,
      ...data,
    });
  },

  // Log tracking events
  logTrackingEvent: (event: string, reskflowId: string, location?: any, data?: any) => {
    trackingLogger.info('Tracking event', {
      event,
      reskflowId,
      location,
      ...data,
    });
  },

  // Log route calculations
  logRouteCalculation: (reskflowId: string, origin: any, destination: any, data?: any) => {
    routeLogger.info('Route calculation', {
      reskflowId,
      origin,
      destination,
      ...data,
    });
  },

  // Log API requests
  logApiRequest: (method: string, path: string, userId?: string, data?: any) => {
    logger.info('API request', {
      method,
      path,
      userId,
      ...data,
    });
  },

  // Log API responses
  logApiResponse: (method: string, path: string, statusCode: number, duration: number, data?: any) => {
    logger.info('API response', {
      method,
      path,
      statusCode,
      duration,
      ...data,
    });
  },

  // Log errors with context
  logError: (error: Error, context?: string, data?: any) => {
    logger.error('Error occurred', {
      error: error.message,
      stack: error.stack,
      context,
      ...data,
    });
  },

  // Log performance metrics
  logPerformance: (operation: string, duration: number, data?: any) => {
    logger.info('Performance metric', {
      operation,
      duration,
      ...data,
    });
  },

  // Log business metrics
  logBusinessEvent: (event: string, data?: any) => {
    logger.info('Business event', {
      event,
      timestamp: new Date().toISOString(),
      ...data,
    });
  },

  // Log security events
  logSecurityEvent: (event: string, userId?: string, ip?: string, data?: any) => {
    logger.warn('Security event', {
      event,
      userId,
      ip,
      timestamp: new Date().toISOString(),
      ...data,
    });
  },
};

// Export default logger
export default logger;