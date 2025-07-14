import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Search request validation schema
const searchRequestSchema = Joi.object({
  q: Joi.string().min(1).max(500).optional().allow(''),
  cuisineTypes: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  dietaryRestrictions: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  priceMin: Joi.number().min(0).optional(),
  priceMax: Joi.number().min(0).optional(),
  minRating: Joi.number().min(0).max(5).optional(),
  maxDeliveryTime: Joi.number().min(1).max(1440).optional(), // 1 minute to 24 hours
  availability: Joi.boolean().optional(),
  openNow: Joi.boolean().optional(),
  maxDistance: Joi.number().min(0.1).max(100).optional(), // 0.1km to 100km
  categories: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  tags: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  excludeAllergens: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  maxCalories: Joi.number().min(0).optional(),
  minProtein: Joi.number().min(0).optional(),
  maxSodium: Joi.number().min(0).optional(),
  maxSugar: Joi.number().min(0).optional(),
  maxFat: Joi.number().min(0).optional(),
  minFiber: Joi.number().min(0).optional(),
  lat: Joi.number().min(-90).max(90).optional(),
  lon: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().min(0.1).max(50).optional(),
  page: Joi.number().min(1).max(1000).optional(),
  limit: Joi.number().min(1).max(100).optional(),
  sortBy: Joi.string().valid(
    'relevance', 'price', 'rating', 'distance', 
    'deliveryTime', 'popularity', 'newest', 'alphabetical'
  ).optional(),
  sortOrder: Joi.string().valid('asc', 'desc').optional()
}).custom((value, helpers) => {
  // Custom validation: if location is provided, both lat and lon are required
  if ((value.lat && !value.lon) || (!value.lat && value.lon)) {
    return helpers.error('any.invalid', { 
      message: 'Both latitude and longitude are required when providing location' 
    });
  }

  // Price range validation
  if (value.priceMin && value.priceMax && value.priceMin > value.priceMax) {
    return helpers.error('any.invalid', { 
      message: 'Minimum price cannot be greater than maximum price' 
    });
  }

  return value;
});

// Autocomplete request validation schema
const autocompleteRequestSchema = Joi.object({
  q: Joi.string().min(1).max(100).required(),
  types: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string().valid(
      'query', 'category', 'cuisine', 'merchant', 'item', 'location'
    ))
  ).optional(),
  lat: Joi.number().min(-90).max(90).optional(),
  lon: Joi.number().min(-180).max(180).optional(),
  limit: Joi.number().min(1).max(20).optional()
}).custom((value, helpers) => {
  // Both lat and lon required if either is provided
  if ((value.lat && !value.lon) || (!value.lat && value.lon)) {
    return helpers.error('any.invalid', { 
      message: 'Both latitude and longitude are required when providing location' 
    });
  }

  return value;
});

// Index items validation schema
const indexItemsSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    type: Joi.string().valid(
      'food', 'beverage', 'dessert', 'combo', 'side', 'appetizer', 'main_course', 'alcohol'
    ).required(),
    name: Joi.string().min(1).max(200).required(),
    description: Joi.string().max(1000).optional(),
    merchant: Joi.object({
      id: Joi.string().required(),
      name: Joi.string().required(),
      type: Joi.string().valid(
        'restaurant', 'cafe', 'bar', 'bakery', 'grocery', 'convenience', 'pharmacy', 'specialty'
      ).required(),
      rating: Joi.number().min(0).max(5).required(),
      isVerified: Joi.boolean().required(),
      location: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lon: Joi.number().min(-180).max(180).required()
      }).required(),
      cuisineTypes: Joi.array().items(Joi.string()).required(),
      isOpen: Joi.boolean().required()
    }).required(),
    location: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lon: Joi.number().min(-180).max(180).required()
    }).required(),
    price: Joi.object({
      amount: Joi.number().min(0).required(),
      currency: Joi.string().length(3).required()
    }).required(),
    rating: Joi.object({
      average: Joi.number().min(0).max(5).required(),
      count: Joi.number().min(0).required()
    }).required(),
    availability: Joi.object({
      isAvailable: Joi.boolean().required(),
      stockLevel: Joi.string().valid('in_stock', 'low_stock', 'out_of_stock', 'preorder').optional()
    }).required(),
    cuisineType: Joi.string().required(),
    categories: Joi.array().items(Joi.string()).required(),
    tags: Joi.array().items(Joi.string()).required(),
    allergens: Joi.array().items(Joi.string()).required(),
    dietaryLabels: Joi.array().items(Joi.string()).required(),
    nutritionalInfo: Joi.object({
      calories: Joi.number().min(0).required(),
      protein: Joi.number().min(0).required(),
      carbohydrates: Joi.number().min(0).required(),
      fat: Joi.number().min(0).required(),
      fiber: Joi.number().min(0).optional(),
      sugar: Joi.number().min(0).optional(),
      sodium: Joi.number().min(0).optional(),
      cholesterol: Joi.number().min(0).optional(),
      servingSize: Joi.string().required()
    }).optional(),
    deliveryTime: Joi.object({
      min: Joi.number().min(1).required(),
      max: Joi.number().min(1).required()
    }).required(),
    createdAt: Joi.date().required(),
    updatedAt: Joi.date().required(),
    searchKeywords: Joi.array().items(Joi.string()).required(),
    popularity: Joi.number().min(0).max(1).required(),
    isPromoted: Joi.boolean().required()
  })).min(1).max(1000).required()
});

// Update item validation schema
const updateItemSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  description: Joi.string().max(1000).optional(),
  price: Joi.object({
    amount: Joi.number().min(0).optional(),
    currency: Joi.string().length(3).optional()
  }).optional(),
  rating: Joi.object({
    average: Joi.number().min(0).max(5).optional(),
    count: Joi.number().min(0).optional()
  }).optional(),
  availability: Joi.object({
    isAvailable: Joi.boolean().optional(),
    stockLevel: Joi.string().valid('in_stock', 'low_stock', 'out_of_stock', 'preorder').optional()
  }).optional(),
  categories: Joi.array().items(Joi.string()).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  allergens: Joi.array().items(Joi.string()).optional(),
  dietaryLabels: Joi.array().items(Joi.string()).optional(),
  nutritionalInfo: Joi.object({
    calories: Joi.number().min(0).optional(),
    protein: Joi.number().min(0).optional(),
    carbohydrates: Joi.number().min(0).optional(),
    fat: Joi.number().min(0).optional(),
    fiber: Joi.number().min(0).optional(),
    sugar: Joi.number().min(0).optional(),
    sodium: Joi.number().min(0).optional(),
    cholesterol: Joi.number().min(0).optional(),
    servingSize: Joi.string().optional()
  }).optional(),
  deliveryTime: Joi.object({
    min: Joi.number().min(1).optional(),
    max: Joi.number().min(1).optional()
  }).optional(),
  searchKeywords: Joi.array().items(Joi.string()).optional(),
  popularity: Joi.number().min(0).max(1).optional(),
  isPromoted: Joi.boolean().optional(),
  updatedAt: Joi.date().optional()
}).min(1); // At least one field must be provided for update

// Validation middleware factory
function createValidationMiddleware(schema: Joi.ObjectSchema, target: 'query' | 'body' | 'params' = 'query') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const dataToValidate = req[target];
    
    const { error, value } = schema.validate(dataToValidate, {
      allowUnknown: target === 'query', // Allow unknown query parameters for flexibility
      stripUnknown: true,
      abortEarly: false
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      logger.warn('Validation error', {
        target,
        errors: errorDetails,
        originalData: dataToValidate
      });

      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: errorDetails,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Replace the original data with validated and sanitized data
    req[target] = value;
    next();
  };
}

// Export validation middleware functions
export const validateSearchRequest = createValidationMiddleware(searchRequestSchema, 'query');
export const validateAutocompleteRequest = createValidationMiddleware(autocompleteRequestSchema, 'query');
export const validateIndexItems = createValidationMiddleware(indexItemsSchema, 'body');
export const validateUpdateItem = createValidationMiddleware(updateItemSchema, 'body');

// Parameter validation for item ID
export const validateItemId = (req: Request, res: Response, next: NextFunction): void => {
  const itemIdSchema = Joi.string().required().pattern(/^[a-zA-Z0-9_-]+$/).min(1).max(50);
  
  const { error } = itemIdSchema.validate(req.params.itemId);
  
  if (error) {
    logger.warn('Item ID validation error', {
      itemId: req.params.itemId,
      error: error.message
    });

    res.status(400).json({
      success: false,
      error: 'Invalid item ID',
      message: 'Item ID must be alphanumeric with optional hyphens and underscores',
      timestamp: new Date().toISOString()
    });
    return;
  }

  next();
};

// Analytics filters validation
export const validateAnalyticsFilters = (req: Request, res: Response, next: NextFunction): void => {
  const analyticsSchema = Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    userId: Joi.string().optional()
  });

  const { error, value } = analyticsSchema.validate(req.query, {
    stripUnknown: true
  });

  if (error) {
    logger.warn('Analytics filters validation error', {
      error: error.message,
      query: req.query
    });

    res.status(400).json({
      success: false,
      error: 'Invalid analytics filters',
      message: error.message,
      timestamp: new Date().toISOString()
    });
    return;
  }

  req.query = value;
  next();
};

// Rate limiting validation helper
export const validateRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  // Check if user is making too many requests
  const userId = req.user?.id;
  const ip = req.ip;
  
  // Add rate limiting logic here if needed
  // For now, just pass through
  next();
};