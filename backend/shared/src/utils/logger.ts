import winston from 'winston';
import { config } from '../config';

const formats = {
  json: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  simple: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.simple()
  ),
  pretty: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`;
    })
  ),
};

class Logger {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: config.logging.level,
      format: formats[config.logging.format as keyof typeof formats] || formats.json,
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
      ],
    });

    if (config.env === 'production' && config.monitoring.sentry.dsn) {
      // Add Sentry transport in production
      // this.logger.add(new Sentry({ dsn: config.monitoring.sentry.dsn }));
    }
  }

  info(message: string, meta?: any) {
    this.logger.info(message, meta);
  }

  error(message: string, error?: Error | any, meta?: any) {
    this.logger.error(message, { error: error?.stack || error, ...meta });
  }

  warn(message: string, meta?: any) {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any) {
    this.logger.debug(message, meta);
  }

  child(meta: any) {
    return this.logger.child(meta);
  }

  profile(id: string) {
    return this.logger.profile(id);
  }
}

export const logger = new Logger();