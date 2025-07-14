import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3007', 10),
  serviceName: process.env.SERVICE_NAME || 'reskflow-service',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/reskflow_reskflow',
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
    order: process.env.ORDER_SERVICE_URL || 'http://localhost:3005',
    user: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006',
  },

  reskflow: {
    defaultRadius: parseInt(process.env.DELIVERY_RADIUS || '10', 10), // km
    maxDeliveryTime: parseInt(process.env.MAX_DELIVERY_TIME || '60', 10), // minutes
    assignmentTimeout: parseInt(process.env.ASSIGNMENT_TIMEOUT || '5', 10), // minutes
    trackingInterval: parseInt(process.env.TRACKING_INTERVAL || '30', 10), // seconds
  },

  maps: {
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    distanceMatrixApi: 'https://maps.googleapis.com/maps/api/distancematrix/json',
    directionsApi: 'https://maps.googleapis.com/maps/api/directions/json',
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