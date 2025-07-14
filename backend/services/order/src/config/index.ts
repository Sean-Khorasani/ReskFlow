import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3005', 10),
  serviceName: process.env.SERVICE_NAME || 'order-service',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/reskflow_orders',
  },

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/reskflow_orders',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'your-jwt-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  services: {
    cart: process.env.CART_SERVICE_URL || 'http://localhost:3002',
    catalog: process.env.CATALOG_SERVICE_URL || 'http://localhost:3004',
    payment: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006',
    reskflow: process.env.DELIVERY_SERVICE_URL || 'http://localhost:3007',
    merchant: process.env.MERCHANT_SERVICE_URL || 'http://localhost:3008',
  },

  order: {
    timeoutMinutes: parseInt(process.env.ORDER_TIMEOUT_MINUTES || '30', 10),
    maxItems: parseInt(process.env.MAX_ORDER_ITEMS || '50', 10),
    cancellationWindowMinutes: parseInt(process.env.ORDER_CANCELLATION_WINDOW_MINUTES || '5', 10),
  },

  invoice: {
    storagePath: process.env.INVOICE_STORAGE_PATH || '/tmp/invoices',
    company: {
      name: process.env.COMPANY_NAME || 'ReskFlow',
      address: process.env.COMPANY_ADDRESS || '123 Main St, City, Country',
      taxId: process.env.COMPANY_TAX_ID || '123456789',
    },
  },

  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    format: process.env.LOG_FORMAT || 'json',
  },
};