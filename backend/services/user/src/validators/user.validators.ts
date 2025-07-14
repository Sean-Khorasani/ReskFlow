import Joi from 'joi';

export const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
  dateOfBirth: Joi.date().max('now').optional(),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  preferences: Joi.object({
    notifications: Joi.boolean().optional(),
    newsletter: Joi.boolean().optional(),
    marketing: Joi.boolean().optional(),
    language: Joi.string().valid('en', 'es', 'fr', 'de', 'it', 'pt').optional(),
    timezone: Joi.string().optional()
  }).optional(),
  dietary: Joi.object({
    vegetarian: Joi.boolean().optional(),
    vegan: Joi.boolean().optional(),
    glutenFree: Joi.boolean().optional(),
    dairyFree: Joi.boolean().optional(),
    nutFree: Joi.boolean().optional(),
    halal: Joi.boolean().optional(),
    kosher: Joi.boolean().optional()
  }).optional()
});

export const updateEmailSchema = Joi.object({
  newEmail: Joi.string().email().required(),
  password: Joi.string().required()
});

export const updatePhoneSchema = Joi.object({
  newPhone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  password: Joi.string().required()
});

export const getUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  role: Joi.string().optional(),
  isActive: Joi.boolean().optional(),
  search: Joi.string().optional(),
  sortBy: Joi.string().valid('createdAt', 'email', 'lastLoginAt').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc')
});

export const deleteAccountSchema = Joi.object({
  password: Joi.string().required(),
  reason: Joi.string().optional()
});