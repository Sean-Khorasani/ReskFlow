import Joi from 'joi';

// Customer Registration Schema
export const customerRegistrationSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required'
  }),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required().messages({
    'string.pattern.base': 'Please provide a valid phone number',
    'any.required': 'Phone number is required'
  }),
  firstName: Joi.string().min(1).max(50).required().messages({
    'string.min': 'First name must be at least 1 character',
    'string.max': 'First name cannot exceed 50 characters',
    'any.required': 'First name is required'
  }),
  lastName: Joi.string().min(1).max(50).required().messages({
    'string.min': 'Last name must be at least 1 character',
    'string.max': 'Last name cannot exceed 50 characters',
    'any.required': 'Last name is required'
  }),
  password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required().messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    'any.required': 'Password is required'
  }),
  dateOfBirth: Joi.date().max('now').optional().messages({
    'date.max': 'Date of birth cannot be in the future'
  }),
  referralCode: Joi.string().alphanum().length(8).optional().messages({
    'string.alphanum': 'Referral code must contain only letters and numbers',
    'string.length': 'Referral code must be exactly 8 characters'
  }),
  marketingOptIn: Joi.boolean().optional().default(false),
  defaultAddress: Joi.object({
    type: Joi.string().valid('HOME', 'WORK', 'OTHER', 'BUSINESS', 'HOTEL', 'SCHOOL').required(),
    label: Joi.string().min(1).max(50).required(),
    street: Joi.string().min(1).max(200).required(),
    apartment: Joi.string().max(50).optional(),
    city: Joi.string().min(1).max(100).required(),
    state: Joi.string().min(1).max(100).required(),
    zipCode: Joi.string().min(3).max(20).required(),
    country: Joi.string().length(2).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    deliveryInstructions: Joi.string().max(500).optional(),
    accessCode: Joi.string().max(20).optional(),
    floorNumber: Joi.string().max(10).optional(),
    buildingName: Joi.string().max(100).optional(),
    landmarks: Joi.string().max(200).optional()
  }).optional()
});

// Customer Profile Update Schema
export const customerUpdateSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).optional(),
  lastName: Joi.string().min(1).max(50).optional(),
  dateOfBirth: Joi.date().max('now').optional(),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  email: Joi.string().email().optional(),
  preferences: Joi.object({
    notifications: Joi.object({
      orderUpdates: Joi.boolean().optional(),
      promotions: Joi.boolean().optional(),
      loyaltyUpdates: Joi.boolean().optional(),
      newsletter: Joi.boolean().optional(),
      driverUpdates: Joi.boolean().optional(),
      merchantUpdates: Joi.boolean().optional(),
      securityAlerts: Joi.boolean().optional(),
      marketingEmails: Joi.boolean().optional(),
      smsNotifications: Joi.boolean().optional(),
      pushNotifications: Joi.boolean().optional(),
      emailFrequency: Joi.string().valid('REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY').optional(),
      quietHours: Joi.object({
        enabled: Joi.boolean().optional(),
        start: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
        end: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional()
      }).optional()
    }).optional(),
    delivery: Joi.object({
      defaultTip: Joi.number().min(0).max(50).optional(),
      contactlessPreferred: Joi.boolean().optional(),
      leaveAtDoor: Joi.boolean().optional(),
      ringDoorbell: Joi.boolean().optional(),
      callOnArrival: Joi.boolean().optional(),
      preferredDeliveryTime: Joi.string().optional(),
      deliveryInstructions: Joi.string().max(500).optional(),
      photoConfirmation: Joi.boolean().optional(),
      signatureRequired: Joi.boolean().optional()
    }).optional(),
    dietary: Joi.object({
      restrictions: Joi.array().items(Joi.string()).optional(),
      allergens: Joi.array().items(Joi.string()).optional(),
      preferences: Joi.array().items(Joi.string()).optional(),
      healthGoals: Joi.array().items(Joi.string()).optional(),
      caloricLimit: Joi.number().min(800).max(5000).optional(),
      excludeIngredients: Joi.array().items(Joi.string()).optional(),
      preferredCuisines: Joi.array().items(Joi.string()).optional(),
      spiceLevel: Joi.string().valid('MILD', 'MEDIUM', 'HOT', 'EXTRA_HOT').optional()
    }).optional(),
    communication: Joi.object({
      preferredChannel: Joi.string().valid('EMAIL', 'SMS', 'PUSH', 'IN_APP').optional(),
      language: Joi.string().length(2).optional(),
      timezone: Joi.string().optional(),
      marketingOptIn: Joi.boolean().optional(),
      surveyParticipation: Joi.boolean().optional(),
      feedbackRequests: Joi.boolean().optional()
    }).optional()
  }).optional(),
  dietaryRestrictions: Joi.array().items(Joi.string()).optional(),
  allergens: Joi.array().items(Joi.string()).optional()
}).min(1);

// Discovery Tracking Schema
export const discoveryTrackingSchema = Joi.object({
  searchQuery: Joi.string().max(200).optional(),
  location: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required()
  }).required(),
  filters: Joi.object().optional(),
  results: Joi.array().optional(),
  clickedItems: Joi.array().items(Joi.string()).optional(),
  sessionId: Joi.string().uuid().required()
});

// Order Placement Schema
export const orderPlacementSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    itemId: Joi.string().uuid().required(),
    quantity: Joi.number().min(1).max(50).required(),
    customizations: Joi.object({
      size: Joi.string().optional(),
      spiceLevel: Joi.string().optional(),
      addOns: Joi.array().items(Joi.string()).optional(),
      removals: Joi.array().items(Joi.string()).optional(),
      substitutions: Joi.object().optional(),
      cookingPreference: Joi.string().optional(),
      portionSize: Joi.string().optional()
    }).optional(),
    specialInstructions: Joi.string().max(500).optional()
  })).min(1).required(),
  merchantId: Joi.string().uuid().required(),
  deliveryAddress: Joi.object({
    type: Joi.string().valid('HOME', 'WORK', 'OTHER', 'BUSINESS', 'HOTEL', 'SCHOOL').required(),
    label: Joi.string().min(1).max(50).required(),
    street: Joi.string().min(1).max(200).required(),
    apartment: Joi.string().max(50).optional(),
    city: Joi.string().min(1).max(100).required(),
    state: Joi.string().min(1).max(100).required(),
    zipCode: Joi.string().min(3).max(20).required(),
    country: Joi.string().length(2).required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    deliveryInstructions: Joi.string().max(500).optional(),
    accessCode: Joi.string().max(20).optional(),
    floorNumber: Joi.string().max(10).optional(),
    buildingName: Joi.string().max(100).optional(),
    landmarks: Joi.string().max(200).optional()
  }).required(),
  paymentMethod: Joi.object({
    id: Joi.string().uuid().required(),
    type: Joi.string().valid('CREDIT_CARD', 'DEBIT_CARD', 'WALLET', 'CRYPTO', 'BANK_TRANSFER', 'CASH', 'GIFT_CARD').required()
  }).required(),
  scheduledDelivery: Joi.date().min('now').optional(),
  promoCode: Joi.string().alphanum().max(20).optional(),
  groupOrderId: Joi.string().uuid().optional(),
  deliveryInstructions: Joi.string().max(500).optional(),
  contactlessDelivery: Joi.boolean().optional().default(false)
});

// Support Ticket Schema
export const supportTicketSchema = Joi.object({
  type: Joi.string().valid('ORDER_ISSUE', 'PAYMENT_ISSUE', 'DELIVERY_ISSUE', 'ACCOUNT_ISSUE', 'TECHNICAL_ISSUE', 'REFUND_REQUEST', 'COMPLAINT', 'SUGGESTION', 'GENERAL').required(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL').required(),
  subject: Joi.string().min(5).max(200).required(),
  description: Joi.string().min(10).max(2000).required(),
  orderId: Joi.string().uuid().optional(),
  category: Joi.string().max(50).optional(),
  attachments: Joi.array().items(Joi.string().uri()).max(5).optional()
});

// Loyalty Action Schema
export const loyaltyActionSchema = Joi.object({
  type: Joi.string().valid('EARN', 'REDEEM', 'TRANSFER', 'EXPIRE').required(),
  points: Joi.number().min(1).max(100000).required(),
  orderId: Joi.string().uuid().optional(),
  rewardId: Joi.string().uuid().optional(),
  reason: Joi.string().max(200).optional()
});

// Feedback Schema
export const feedbackSchema = Joi.object({
  orderId: Joi.string().uuid().optional(),
  merchantId: Joi.string().uuid().optional(),
  driverId: Joi.string().uuid().optional(),
  type: Joi.string().valid('ORDER', 'DELIVERY', 'MERCHANT', 'DRIVER', 'APP', 'GENERAL').required(),
  rating: Joi.number().min(1).max(5).required(),
  review: Joi.string().max(2000).optional(),
  categories: Joi.array().items(Joi.string()).max(10).optional(),
  tags: Joi.array().items(Joi.string()).max(20).optional(),
  photos: Joi.array().items(Joi.string().uri()).max(10).optional(),
  isAnonymous: Joi.boolean().optional().default(false)
});

// Address Schema
export const addressSchema = Joi.object({
  type: Joi.string().valid('HOME', 'WORK', 'OTHER', 'BUSINESS', 'HOTEL', 'SCHOOL').required(),
  label: Joi.string().min(1).max(50).required(),
  street: Joi.string().min(1).max(200).required(),
  apartment: Joi.string().max(50).optional(),
  city: Joi.string().min(1).max(100).required(),
  state: Joi.string().min(1).max(100).required(),
  zipCode: Joi.string().min(3).max(20).required(),
  country: Joi.string().length(2).required(),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  isDefault: Joi.boolean().optional().default(false),
  deliveryInstructions: Joi.string().max(500).optional(),
  businessHours: Joi.array().items(Joi.object({
    dayOfWeek: Joi.number().min(0).max(6).required(),
    openTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    closeTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    isOpen: Joi.boolean().required()
  })).optional(),
  accessCode: Joi.string().max(20).optional(),
  floorNumber: Joi.string().max(10).optional(),
  buildingName: Joi.string().max(100).optional(),
  landmarks: Joi.string().max(200).optional()
});

// Payment Method Schema
export const paymentMethodSchema = Joi.object({
  type: Joi.string().valid('CREDIT_CARD', 'DEBIT_CARD', 'WALLET', 'CRYPTO', 'BANK_TRANSFER', 'CASH', 'GIFT_CARD').required(),
  provider: Joi.string().valid('STRIPE', 'PAYPAL', 'APPLE_PAY', 'GOOGLE_PAY', 'RESKFLOW_WALLET', 'BITCOIN', 'ETHEREUM').optional(),
  isDefault: Joi.boolean().optional().default(false),
  nickName: Joi.string().max(50).optional(),
  // Credit/Debit card specific fields
  cardNumber: Joi.when('type', {
    is: Joi.valid('CREDIT_CARD', 'DEBIT_CARD'),
    then: Joi.string().creditCard().required(),
    otherwise: Joi.forbidden()
  }),
  expiryMonth: Joi.when('type', {
    is: Joi.valid('CREDIT_CARD', 'DEBIT_CARD'),
    then: Joi.number().min(1).max(12).required(),
    otherwise: Joi.forbidden()
  }),
  expiryYear: Joi.when('type', {
    is: Joi.valid('CREDIT_CARD', 'DEBIT_CARD'),
    then: Joi.number().min(new Date().getFullYear()).max(new Date().getFullYear() + 20).required(),
    otherwise: Joi.forbidden()
  }),
  cvv: Joi.when('type', {
    is: Joi.valid('CREDIT_CARD', 'DEBIT_CARD'),
    then: Joi.string().pattern(/^[0-9]{3,4}$/).required(),
    otherwise: Joi.forbidden()
  }),
  billingAddress: Joi.when('type', {
    is: Joi.valid('CREDIT_CARD', 'DEBIT_CARD'),
    then: addressSchema.required(),
    otherwise: Joi.optional()
  }),
  // Wallet specific fields
  walletBalance: Joi.when('type', {
    is: 'WALLET',
    then: Joi.number().min(0).optional(),
    otherwise: Joi.forbidden()
  }),
  currency: Joi.when('type', {
    is: 'WALLET',
    then: Joi.string().length(3).optional(),
    otherwise: Joi.forbidden()
  })
});

// Preferences Schema
export const preferencesSchema = Joi.object({
  notifications: Joi.object({
    orderUpdates: Joi.boolean().optional(),
    promotions: Joi.boolean().optional(),
    loyaltyUpdates: Joi.boolean().optional(),
    newsletter: Joi.boolean().optional(),
    driverUpdates: Joi.boolean().optional(),
    merchantUpdates: Joi.boolean().optional(),
    securityAlerts: Joi.boolean().optional(),
    marketingEmails: Joi.boolean().optional(),
    smsNotifications: Joi.boolean().optional(),
    pushNotifications: Joi.boolean().optional(),
    emailFrequency: Joi.string().valid('REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY').optional(),
    quietHours: Joi.object({
      enabled: Joi.boolean().optional(),
      start: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
      end: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional()
    }).optional()
  }).optional(),
  delivery: Joi.object({
    defaultTip: Joi.number().min(0).max(50).optional(),
    contactlessPreferred: Joi.boolean().optional(),
    leaveAtDoor: Joi.boolean().optional(),
    ringDoorbell: Joi.boolean().optional(),
    callOnArrival: Joi.boolean().optional(),
    preferredDeliveryTime: Joi.string().optional(),
    deliveryInstructions: Joi.string().max(500).optional(),
    photoConfirmation: Joi.boolean().optional(),
    signatureRequired: Joi.boolean().optional()
  }).optional(),
  dietary: Joi.object({
    restrictions: Joi.array().items(Joi.string()).optional(),
    allergens: Joi.array().items(Joi.string()).optional(),
    preferences: Joi.array().items(Joi.string()).optional(),
    healthGoals: Joi.array().items(Joi.string()).optional(),
    caloricLimit: Joi.number().min(800).max(5000).optional(),
    excludeIngredients: Joi.array().items(Joi.string()).optional(),
    preferredCuisines: Joi.array().items(Joi.string()).optional(),
    spiceLevel: Joi.string().valid('MILD', 'MEDIUM', 'HOT', 'EXTRA_HOT').optional()
  }).optional(),
  communication: Joi.object({
    preferredChannel: Joi.string().valid('EMAIL', 'SMS', 'PUSH', 'IN_APP').optional(),
    language: Joi.string().length(2).optional(),
    timezone: Joi.string().optional(),
    marketingOptIn: Joi.boolean().optional(),
    surveyParticipation: Joi.boolean().optional(),
    feedbackRequests: Joi.boolean().optional()
  }).optional(),
  privacy: Joi.object({
    profileVisibility: Joi.string().valid('PUBLIC', 'FRIENDS', 'PRIVATE').optional(),
    locationSharing: Joi.boolean().optional(),
    dataUsageConsent: Joi.boolean().optional(),
    analyticsOptOut: Joi.boolean().optional(),
    thirdPartySharing: Joi.boolean().optional(),
    advertisingPersonalization: Joi.boolean().optional()
  }).optional(),
  accessibility: Joi.object({
    fontSize: Joi.string().valid('SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE').optional(),
    highContrast: Joi.boolean().optional(),
    screenReader: Joi.boolean().optional(),
    voiceEnabled: Joi.boolean().optional(),
    colorBlindSupport: Joi.boolean().optional(),
    rightToLeftLayout: Joi.boolean().optional()
  }).optional(),
  payment: Joi.object({
    defaultPaymentMethod: Joi.string().uuid().optional(),
    autoReloadWallet: Joi.boolean().optional(),
    reloadAmount: Joi.number().min(10).max(1000).optional(),
    reloadThreshold: Joi.number().min(5).max(100).optional(),
    preferredCurrency: Joi.string().length(3).optional(),
    splitBillDefault: Joi.boolean().optional(),
    tipCalculation: Joi.string().valid('PERCENTAGE', 'FIXED', 'CUSTOM').optional()
  }).optional(),
  ordering: Joi.object({
    defaultAddress: Joi.string().uuid().optional(),
    favoriteReorder: Joi.boolean().optional(),
    groupOrderDefault: Joi.boolean().optional(),
    scheduleOrderDefault: Joi.boolean().optional(),
    customizationSave: Joi.boolean().optional(),
    repeatLastOrder: Joi.boolean().optional(),
    bulkOrderEnabled: Joi.boolean().optional()
  }).optional()
});

// Analytics Query Schema
export const analyticsQuerySchema = Joi.object({
  startDate: Joi.date().required(),
  endDate: Joi.date().min(Joi.ref('startDate')).required(),
  granularity: Joi.string().valid('HOUR', 'DAY', 'WEEK', 'MONTH').optional().default('DAY'),
  metrics: Joi.array().items(Joi.string()).optional(),
  includeComparisons: Joi.boolean().optional().default(false)
});

// Order History Query Schema
export const orderHistoryQuerySchema = Joi.object({
  page: Joi.number().min(1).optional().default(1),
  limit: Joi.number().min(1).max(100).optional().default(20),
  status: Joi.string().valid('PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED').optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().min(Joi.ref('startDate')).optional(),
  merchantId: Joi.string().uuid().optional(),
  sortBy: Joi.string().valid('date', 'total', 'status').optional().default('date'),
  sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
});