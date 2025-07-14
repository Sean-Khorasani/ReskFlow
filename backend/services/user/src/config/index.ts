import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  
  database: {
    url: process.env.DATABASE_URL || 'postgresql://reskflow:reskflow123@localhost:5432/reskflow'
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://:reskflow123@localhost:6379'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'your-super-secret-refresh-token-key',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'
  },
  
  twoFactor: {
    appName: process.env.TWO_FACTOR_APP_NAME || 'ReskFlow'
  },
  
  cors: {
    origins: process.env.CORS_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3100',
      'http://localhost:3200',
      'http://localhost:3300',
      'http://localhost:3400'
    ]
  },
  
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false
  },
  
  rabbitMq: {
    url: process.env.RABBITMQ_URL || 'amqp://reskflow:reskflow123@localhost:5672'
  },
  
  services: {
    gateway: process.env.GATEWAY_URL || 'http://localhost:3000',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3012'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'debug'
  }
};

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0 && config.env === 'production') {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}