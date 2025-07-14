/**
 * Gateway Configuration
 * Central configuration for the API Gateway
 */

export const config = {
  port: process.env.GATEWAY_PORT || 4000,
  env: process.env.NODE_ENV || 'development',
  
  // Service URLs
  services: {
    auth: {
      url: process.env.AUTH_SERVICE_URL || 'http://localhost:5001',
      endpoints: {
        login: '/auth/login',
        signup: '/auth/signup',
        refresh: '/auth/refresh',
        logout: '/auth/logout',
        verify: '/auth/verify'
      }
    },
    user: {
      url: process.env.USER_SERVICE_URL || 'http://localhost:5002',
      endpoints: {
        profile: '/users/profile',
        update: '/users/update',
        delete: '/users/delete',
        search: '/users/search'
      }
    },
    payment: {
      url: process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003',
      endpoints: {
        process: '/payments/process',
        refund: '/payments/refund',
        methods: '/payments/methods',
        history: '/payments/history'
      }
    },
    reskflow: {
      url: process.env.DELIVERY_SERVICE_URL || 'http://localhost:5004',
      endpoints: {
        create: '/deliveries/create',
        track: '/deliveries/track',
        update: '/deliveries/update',
        assign: '/deliveries/assign'
      }
    },
    tracking: {
      url: process.env.TRACKING_SERVICE_URL || 'http://localhost:5005',
      endpoints: {
        location: '/tracking/location',
        history: '/tracking/history',
        eta: '/tracking/eta'
      }
    },
    merchant: {
      url: process.env.MERCHANT_SERVICE_URL || 'http://localhost:5006',
      endpoints: {
        menu: '/merchants/menu',
        orders: '/merchants/orders',
        stats: '/merchants/stats'
      }
    },
    order: {
      url: process.env.ORDER_SERVICE_URL || 'http://localhost:5007',
      endpoints: {
        create: '/orders/create',
        status: '/orders/status',
        cancel: '/orders/cancel',
        history: '/orders/history'
      }
    },
    notification: {
      url: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5008',
      endpoints: {
        send: '/notifications/send',
        preferences: '/notifications/preferences',
        history: '/notifications/history'
      }
    },
    analytics: {
      url: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:5009',
      endpoints: {
        track: '/analytics/track',
        report: '/analytics/report',
        dashboard: '/analytics/dashboard'
      }
    },
    loyalty: {
      url: process.env.LOYALTY_SERVICE_URL || 'http://localhost:5010'
    },
    subscription: {
      url: process.env.SUBSCRIPTION_SERVICE_URL || 'http://localhost:5011'
    },
    groupOrder: {
      url: process.env.GROUP_ORDER_SERVICE_URL || 'http://localhost:5012'
    },
    scheduledOrder: {
      url: process.env.SCHEDULED_ORDER_SERVICE_URL || 'http://localhost:5013'
    },
    favorites: {
      url: process.env.FAVORITES_SERVICE_URL || 'http://localhost:5014'
    },
    splitPayment: {
      url: process.env.SPLIT_PAYMENT_SERVICE_URL || 'http://localhost:5015'
    },
    dietary: {
      url: process.env.DIETARY_SERVICE_URL || 'http://localhost:5016'
    },
    earnings: {
      url: process.env.EARNINGS_SERVICE_URL || 'http://localhost:5017'
    },
    routeOptimization: {
      url: process.env.ROUTE_SERVICE_URL || 'http://localhost:5018'
    },
    shiftScheduling: {
      url: process.env.SHIFT_SERVICE_URL || 'http://localhost:5019'
    },
    vehicleInspection: {
      url: process.env.VEHICLE_SERVICE_URL || 'http://localhost:5020'
    },
    emergency: {
      url: process.env.EMERGENCY_SERVICE_URL || 'http://localhost:5021'
    },
    inventory: {
      url: process.env.INVENTORY_SERVICE_URL || 'http://localhost:5022'
    },
    promotions: {
      url: process.env.PROMOTIONS_SERVICE_URL || 'http://localhost:5023'
    },
    menuScheduling: {
      url: process.env.MENU_SCHEDULING_SERVICE_URL || 'http://localhost:5024'
    },
    ingredients: {
      url: process.env.INGREDIENTS_SERVICE_URL || 'http://localhost:5025'
    },
    multiLocation: {
      url: process.env.MULTI_LOCATION_SERVICE_URL || 'http://localhost:5026'
    },
    fraudDetection: {
      url: process.env.FRAUD_SERVICE_URL || 'http://localhost:5027'
    },
    reporting: {
      url: process.env.REPORTING_SERVICE_URL || 'http://localhost:5028'
    },
    dispute: {
      url: process.env.DISPUTE_SERVICE_URL || 'http://localhost:5029'
    },
    platformHealth: {
      url: process.env.HEALTH_SERVICE_URL || 'http://localhost:5030'
    },
    dynamicPricing: {
      url: process.env.PRICING_SERVICE_URL || 'http://localhost:5031'
    }
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:19000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Count']
  },

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  },

  // Authentication
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret',
    tokenExpiry: '1h',
    refreshTokenExpiry: '30d'
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0')
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    file: process.env.LOG_FILE || 'logs/gateway.log'
  },

  // Security
  security: {
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      }
    },
    encryption: {
      algorithm: 'aes-256-gcm',
      key: process.env.ENCRYPTION_KEY || 'your-32-byte-encryption-key-here'
    }
  },

  // File upload
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/json',
      'text/csv'
    ],
    uploadDir: process.env.UPLOAD_DIR || 'uploads/'
  },

  // WebSocket
  websocket: {
    cors: {
      origin: process.env.WS_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    },
    pingInterval: 25000,
    pingTimeout: 60000
  },

  // Monitoring
  monitoring: {
    prometheus: {
      enabled: process.env.PROMETHEUS_ENABLED === 'true',
      port: parseInt(process.env.PROMETHEUS_PORT || '9090')
    },
    healthCheck: {
      interval: 30000, // 30 seconds
      timeout: 5000 // 5 seconds
    }
  },

  // Circuit breaker
  circuitBreaker: {
    threshold: 5,
    timeout: 60000, // 1 minute
    resetTimeout: 30000 // 30 seconds
  },

  // Cache
  cache: {
    ttl: 300, // 5 minutes
    checkPeriod: 60, // 1 minute
    maxKeys: 1000
  }
};

// Validate required environment variables
export function validateConfig(): void {
  const requiredEnvVars = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'REDIS_URL'
  ];

  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate encryption key length
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
  }
}

// Export validated config
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}