/**
 * Integration Configuration
 * Defines all the service endpoints and integration points
 */

export const integrationConfig = {
  // Microservices Internal Communication
  services: {
    auth: {
      url: process.env.AUTH_SERVICE_URL || 'http://localhost:5001',
      endpoints: {
        validateToken: '/api/auth/validate',
        refreshToken: '/api/auth/refresh',
        getUserPermissions: '/api/auth/permissions',
      },
    },
    user: {
      url: process.env.USER_SERVICE_URL || 'http://localhost:5002',
      endpoints: {
        getProfile: '/api/users/profile',
        updateProfile: '/api/users/profile',
        getPreferences: '/api/users/preferences',
      },
    },
    merchant: {
      url: process.env.MERCHANT_SERVICE_URL || 'http://localhost:5003',
      endpoints: {
        getMenu: '/api/merchants/:id/menu',
        updateAvailability: '/api/merchants/:id/availability',
        getOrders: '/api/merchants/:id/orders',
      },
    },
    order: {
      url: process.env.ORDER_SERVICE_URL || 'http://localhost:5004',
      endpoints: {
        create: '/api/orders',
        update: '/api/orders/:id',
        getStatus: '/api/orders/:id/status',
        cancel: '/api/orders/:id/cancel',
      },
    },
    reskflow: {
      url: process.env.DELIVERY_SERVICE_URL || 'http://localhost:5005',
      endpoints: {
        assign: '/api/deliveries/assign',
        track: '/api/deliveries/:id/track',
        complete: '/api/deliveries/:id/complete',
      },
    },
    payment: {
      url: process.env.PAYMENT_SERVICE_URL || 'http://localhost:5006',
      endpoints: {
        process: '/api/payments/process',
        refund: '/api/payments/:id/refund',
        getStatus: '/api/payments/:id/status',
      },
    },
    notification: {
      url: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:5007',
      endpoints: {
        sendEmail: '/api/notifications/email',
        sendSMS: '/api/notifications/sms',
        sendPush: '/api/notifications/push',
      },
    },
    blockchain: {
      url: process.env.BLOCKCHAIN_SERVICE_URL || 'http://localhost:5008',
      endpoints: {
        recordOrder: '/api/blockchain/orders',
        processPayment: '/api/blockchain/payments',
        distributeRewards: '/api/blockchain/rewards',
      },
    },
    // Customer Services
    loyalty: {
      url: process.env.LOYALTY_SERVICE_URL || 'http://localhost:5009',
      endpoints: {
        getProgram: '/api/loyalty/program',
        getStatus: '/api/loyalty/status/:userId',
        awardPoints: '/api/loyalty/points/award',
        redeemReward: '/api/loyalty/rewards/redeem',
      },
    },
    subscription: {
      url: process.env.SUBSCRIPTION_SERVICE_URL || 'http://localhost:5010',
      endpoints: {
        getPlans: '/api/subscriptions/plans',
        subscribe: '/api/subscriptions/subscribe',
        cancel: '/api/subscriptions/:id/cancel',
        getStatus: '/api/subscriptions/:userId/status',
      },
    },
    groupOrder: {
      url: process.env.GROUP_ORDER_SERVICE_URL || 'http://localhost:5011',
      endpoints: {
        create: '/api/group-orders/create',
        join: '/api/group-orders/:id/join',
        addItems: '/api/group-orders/:id/items',
        finalize: '/api/group-orders/:id/finalize',
      },
    },
    scheduledOrder: {
      url: process.env.SCHEDULED_ORDER_SERVICE_URL || 'http://localhost:5012',
      endpoints: {
        create: '/api/scheduled-orders/create',
        list: '/api/scheduled-orders/:userId',
        cancel: '/api/scheduled-orders/:id/cancel',
        modify: '/api/scheduled-orders/:id/modify',
      },
    },
    favorites: {
      url: process.env.FAVORITES_SERVICE_URL || 'http://localhost:5013',
      endpoints: {
        addFavorite: '/api/favorites/add',
        removeFavorite: '/api/favorites/remove',
        getFavorites: '/api/favorites/:userId',
        reorder: '/api/favorites/reorder',
      },
    },
    splitPayment: {
      url: process.env.SPLIT_PAYMENT_SERVICE_URL || 'http://localhost:5014',
      endpoints: {
        create: '/api/split-payments/create',
        collect: '/api/split-payments/:id/collect',
        getStatus: '/api/split-payments/:id/status',
        finalize: '/api/split-payments/:id/finalize',
      },
    },
    dietary: {
      url: process.env.DIETARY_SERVICE_URL || 'http://localhost:5015',
      endpoints: {
        getPreferences: '/api/dietary/:userId/preferences',
        updatePreferences: '/api/dietary/:userId/preferences',
        analyze: '/api/dietary/analyze',
        getRecommendations: '/api/dietary/:userId/recommendations',
      },
    },
    // Driver Services
    earnings: {
      url: process.env.EARNINGS_SERVICE_URL || 'http://localhost:5016',
      endpoints: {
        getEarnings: '/api/earnings/:driverId',
        getIncentives: '/api/earnings/:driverId/incentives',
        setGoals: '/api/earnings/:driverId/goals',
        getMilestones: '/api/earnings/:driverId/milestones',
      },
    },
    routeOptimization: {
      url: process.env.ROUTE_SERVICE_URL || 'http://localhost:5017',
      endpoints: {
        optimize: '/api/routes/optimize',
        getRoute: '/api/routes/:driverId/current',
        updateRoute: '/api/routes/:driverId/update',
        getAlternatives: '/api/routes/:driverId/alternatives',
      },
    },
    shiftScheduling: {
      url: process.env.SHIFT_SERVICE_URL || 'http://localhost:5018',
      endpoints: {
        getSchedule: '/api/shifts/:driverId/schedule',
        requestShift: '/api/shifts/request',
        swapShift: '/api/shifts/swap',
        clockIn: '/api/shifts/:driverId/clock-in',
      },
    },
    vehicleInspection: {
      url: process.env.VEHICLE_SERVICE_URL || 'http://localhost:5019',
      endpoints: {
        getChecklists: '/api/vehicles/checklists',
        submitInspection: '/api/vehicles/inspections/submit',
        getHistory: '/api/vehicles/:driverId/history',
        reportIssue: '/api/vehicles/issues/report',
      },
    },
    emergency: {
      url: process.env.EMERGENCY_SERVICE_URL || 'http://localhost:5020',
      endpoints: {
        triggerSOS: '/api/emergency/sos',
        updateStatus: '/api/emergency/:incidentId/update',
        getContacts: '/api/emergency/:driverId/contacts',
        checkIn: '/api/emergency/:driverId/check-in',
      },
    },
    // Merchant Services
    inventory: {
      url: process.env.INVENTORY_SERVICE_URL || 'http://localhost:5021',
      endpoints: {
        getStock: '/api/inventory/:merchantId/stock',
        updateStock: '/api/inventory/stock/update',
        getLowStock: '/api/inventory/:merchantId/low-stock',
        createPO: '/api/inventory/purchase-orders/create',
      },
    },
    promotions: {
      url: process.env.PROMOTIONS_SERVICE_URL || 'http://localhost:5022',
      endpoints: {
        getCampaigns: '/api/promotions/:merchantId/campaigns',
        createCampaign: '/api/promotions/campaigns/create',
        updateCampaign: '/api/promotions/campaigns/:id/update',
        getPerformance: '/api/promotions/campaigns/:id/performance',
      },
    },
    menuScheduling: {
      url: process.env.MENU_SCHEDULING_SERVICE_URL || 'http://localhost:5023',
      endpoints: {
        getSchedules: '/api/menu-scheduling/:merchantId/schedules',
        createSchedule: '/api/menu-scheduling/schedules/create',
        updateSchedule: '/api/menu-scheduling/schedules/:id/update',
        getActive: '/api/menu-scheduling/:merchantId/active',
      },
    },
    ingredients: {
      url: process.env.INGREDIENTS_SERVICE_URL || 'http://localhost:5024',
      endpoints: {
        getIngredients: '/api/ingredients/:merchantId',
        updateUsage: '/api/ingredients/usage/update',
        getBatches: '/api/ingredients/:merchantId/batches',
        getAlerts: '/api/ingredients/:merchantId/alerts',
      },
    },
    multiLocation: {
      url: process.env.MULTI_LOCATION_SERVICE_URL || 'http://localhost:5025',
      endpoints: {
        getLocations: '/api/multi-location/:brandId/locations',
        updateLocation: '/api/multi-location/locations/:id/update',
        getPerformance: '/api/multi-location/:brandId/performance',
        syncMenus: '/api/multi-location/:brandId/sync-menus',
      },
    },
    // Admin Services
    fraudDetection: {
      url: process.env.FRAUD_SERVICE_URL || 'http://localhost:5026',
      endpoints: {
        getRules: '/api/fraud/rules',
        checkTransaction: '/api/fraud/transactions/check',
        getIncidents: '/api/fraud/incidents',
        updateRisk: '/api/fraud/risk/:entityId/update',
      },
    },
    reporting: {
      url: process.env.REPORTING_SERVICE_URL || 'http://localhost:5027',
      endpoints: {
        getReports: '/api/reports',
        generateReport: '/api/reports/generate',
        scheduleReport: '/api/reports/schedule',
        getTemplates: '/api/reports/templates',
      },
    },
    dispute: {
      url: process.env.DISPUTE_SERVICE_URL || 'http://localhost:5028',
      endpoints: {
        getDisputes: '/api/disputes',
        createDispute: '/api/disputes/create',
        updateDispute: '/api/disputes/:id/update',
        resolve: '/api/disputes/:id/resolve',
      },
    },
    platformHealth: {
      url: process.env.HEALTH_SERVICE_URL || 'http://localhost:5029',
      endpoints: {
        getStatus: '/api/health/status',
        getMetrics: '/api/health/metrics',
        getIncidents: '/api/health/incidents',
        runDiagnostic: '/api/health/diagnostics/run',
      },
    },
    dynamicPricing: {
      url: process.env.PRICING_SERVICE_URL || 'http://localhost:5030',
      endpoints: {
        getRules: '/api/pricing/rules',
        calculatePrice: '/api/pricing/calculate',
        updateRule: '/api/pricing/rules/:id/update',
        getExperiments: '/api/pricing/experiments',
      },
    },
    // Core Services
    analytics: {
      url: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:5031',
      endpoints: {
        trackEvent: '/api/analytics/events',
        getMetrics: '/api/analytics/metrics',
        getDashboard: '/api/analytics/dashboard/:type',
        export: '/api/analytics/export',
      },
    },
    search: {
      url: process.env.SEARCH_SERVICE_URL || 'http://localhost:5032',
      endpoints: {
        search: '/api/search',
        suggest: '/api/search/suggest',
        index: '/api/search/index',
        trending: '/api/search/trending',
      },
    },
    catalog: {
      url: process.env.CATALOG_SERVICE_URL || 'http://localhost:5033',
      endpoints: {
        getItems: '/api/catalog/items',
        getCategories: '/api/catalog/categories',
        getDetails: '/api/catalog/items/:id',
        bulkUpdate: '/api/catalog/bulk-update',
      },
    },
  },

  // External Service Integrations
  external: {
    maps: {
      provider: 'google',
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      endpoints: {
        geocode: 'https://maps.googleapis.com/maps/api/geocode/json',
        directions: 'https://maps.googleapis.com/maps/api/directions/json',
        distanceMatrix: 'https://maps.googleapis.com/maps/api/distancematrix/json',
      },
    },
    payment: {
      stripe: {
        publicKey: process.env.STRIPE_PUBLIC_KEY,
        secretKey: process.env.STRIPE_SECRET_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      },
      paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID,
        secretKey: process.env.PAYPAL_SECRET_KEY,
        mode: process.env.PAYPAL_MODE || 'sandbox',
      },
    },
    communication: {
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY,
        fromEmail: process.env.SENDGRID_FROM_EMAIL,
      },
      firebase: {
        serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      },
    },
    analytics: {
      googleAnalytics: {
        trackingId: process.env.GA_TRACKING_ID,
      },
      mixpanel: {
        token: process.env.MIXPANEL_TOKEN,
      },
      sentry: {
        dsn: process.env.SENTRY_DSN,
      },
    },
  },

  // WebSocket Configuration
  websocket: {
    port: process.env.WEBSOCKET_PORT || 3001,
    namespaces: {
      customer: '/customer',
      merchant: '/merchant',
      driver: '/driver',
      admin: '/admin',
      partner: '/partner',
    },
    events: {
      // Order Events
      orderCreated: 'order:created',
      orderUpdated: 'order:updated',
      orderAccepted: 'order:accepted',
      orderPreparing: 'order:preparing',
      orderReady: 'order:ready',
      orderPickedUp: 'order:picked_up',
      orderDelivered: 'order:delivered',
      orderCancelled: 'order:cancelled',
      
      // Delivery Events
      driverAssigned: 'reskflow:driver_assigned',
      driverLocation: 'reskflow:driver_location',
      reskflowStarted: 'reskflow:started',
      reskflowCompleted: 'reskflow:completed',
      
      // Payment Events
      paymentProcessed: 'payment:processed',
      paymentFailed: 'payment:failed',
      refundProcessed: 'payment:refund_processed',
      splitPaymentCreated: 'payment:split_created',
      splitPaymentCompleted: 'payment:split_completed',
      
      // Customer Events
      loyaltyPointsEarned: 'loyalty:points_earned',
      loyaltyTierUpgrade: 'loyalty:tier_upgrade',
      loyaltyRewardRedeemed: 'loyalty:reward_redeemed',
      subscriptionActivated: 'subscription:activated',
      subscriptionCancelled: 'subscription:cancelled',
      groupOrderUpdated: 'group_order:updated',
      groupOrderFinalized: 'group_order:finalized',
      scheduledOrderReminder: 'scheduled_order:reminder',
      favoriteAdded: 'favorite:added',
      dietaryAlert: 'dietary:alert',
      
      // Driver Events
      earningsUpdated: 'earnings:updated',
      incentiveEarned: 'incentive:earned',
      routeOptimized: 'route:optimized',
      shiftStarted: 'shift:started',
      shiftEnded: 'shift:ended',
      shiftSwapRequest: 'shift:swap_request',
      vehicleInspectionDue: 'vehicle:inspection_due',
      emergencySOS: 'emergency:sos_triggered',
      
      // Merchant Events
      inventoryLow: 'inventory:low_stock',
      inventoryDepleted: 'inventory:out_of_stock',
      campaignStarted: 'campaign:started',
      campaignEnded: 'campaign:ended',
      menuScheduleActive: 'menu:schedule_active',
      ingredientAlert: 'ingredient:alert',
      
      // Admin Events
      fraudDetected: 'fraud:detected',
      fraudResolved: 'fraud:resolved',
      reportGenerated: 'report:generated',
      disputeCreated: 'dispute:created',
      disputeResolved: 'dispute:resolved',
      platformAlert: 'platform:alert',
      pricingRuleActive: 'pricing:rule_active',
      
      // System Events
      systemNotification: 'system:notification',
      systemMaintenance: 'system:maintenance',
    },
  },

  // Message Queue Configuration
  messageQueue: {
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      queues: {
        orderProcessing: 'order:processing',
        reskflowAssignment: 'reskflow:assignment',
        paymentProcessing: 'payment:processing',
        notificationSending: 'notification:sending',
        analyticsProcessing: 'analytics:processing',
        blockchainRecording: 'blockchain:recording',
      },
    },
  },

  // API Gateway Configuration
  apiGateway: {
    port: process.env.API_GATEWAY_PORT || 4000,
    routes: {
      '/api/auth': 'auth',
      '/api/users': 'user',
      '/api/merchants': 'merchant',
      '/api/orders': 'order',
      '/api/deliveries': 'reskflow',
      '/api/payments': 'payment',
      '/api/notifications': 'notification',
      '/api/blockchain': 'blockchain',
      '/api/analytics': 'analytics',
      '/api/admin': 'admin',
      '/api/partners': 'partner',
    },
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP',
    },
    cors: {
      origins: [
        'http://localhost:3000', // Customer Web
        'http://localhost:3001', // Merchant Portal
        'http://localhost:3002', // Admin Portal
        'http://localhost:3003', // Partner Portal
        'http://localhost:19000', // Mobile App (Expo)
      ],
      credentials: true,
    },
  },

  // Service Discovery
  serviceDiscovery: {
    consul: {
      host: process.env.CONSUL_HOST || 'localhost',
      port: process.env.CONSUL_PORT || 8500,
      serviceName: 'reskflow',
      healthCheck: {
        interval: '10s',
        timeout: '5s',
        deregisterAfter: '1m',
      },
    },
  },

  // Circuit Breaker Configuration
  circuitBreaker: {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
  },

  // Retry Configuration
  retry: {
    retries: 3,
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 60000,
    randomize: true,
  },

  // Monitoring and Logging
  monitoring: {
    elasticsearch: {
      url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'reskflow-logs',
    },
    prometheus: {
      port: process.env.PROMETHEUS_PORT || 9090,
      path: '/metrics',
    },
    grafana: {
      url: process.env.GRAFANA_URL || 'http://localhost:3000',
    },
  },
};

// Integration Flow Definitions
export const integrationFlows = {
  // Customer Order Flow
  customerOrderFlow: [
    'customer:browse_menu',
    'customer:add_to_cart',
    'customer:checkout',
    'payment:process',
    'order:create',
    'notification:send_confirmation',
    'merchant:notify_new_order',
    'merchant:accept_order',
    'kitchen:prepare_order',
    'reskflow:find_driver',
    'driver:accept_reskflow',
    'driver:pickup_order',
    'driver:deliver_order',
    'payment:distribute',
    'blockchain:record',
    'analytics:track',
  ],

  // Driver Assignment Flow
  driverAssignmentFlow: [
    'order:ready_for_pickup',
    'reskflow:calculate_optimal_driver',
    'driver:send_request',
    'driver:accept/reject',
    'reskflow:confirm_assignment',
    'notification:notify_merchant',
    'notification:notify_customer',
    'tracking:enable',
  ],

  // Payment Processing Flow
  paymentFlow: [
    'payment:validate_method',
    'payment:check_balance',
    'payment:process_transaction',
    'blockchain:escrow_funds',
    'payment:confirm',
    'order:update_payment_status',
    'notification:send_receipt',
  ],

  // Refund Flow
  refundFlow: [
    'order:request_refund',
    'payment:validate_refund',
    'merchant:approve_refund',
    'payment:process_refund',
    'blockchain:release_escrow',
    'notification:send_refund_confirmation',
    'analytics:track_refund',
  ],
};

// Export helper functions
export const getServiceUrl = (service: string, endpoint: string, params?: Record<string, string>) => {
  const config = integrationConfig.services[service as keyof typeof integrationConfig.services];
  if (!config) throw new Error(`Service ${service} not found`);
  
  let url = config.url + config.endpoints[endpoint as keyof typeof config.endpoints];
  
  // Replace params in URL
  if (params) {
    Object.keys(params).forEach(key => {
      url = url.replace(`:${key}`, params[key]);
    });
  }
  
  return url;
};

export const getWebSocketEvent = (event: string) => {
  return integrationConfig.websocket.events[event as keyof typeof integrationConfig.websocket.events];
};

export const getRedisQueue = (queue: string) => {
  return integrationConfig.messageQueue.redis.queues[queue as keyof typeof integrationConfig.messageQueue.redis.queues];
};