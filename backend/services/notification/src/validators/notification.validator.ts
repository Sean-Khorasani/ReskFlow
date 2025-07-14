import Joi from 'joi';
import { NotificationChannel, NotificationType } from '../types/notification.types';

export const notificationSchemas = {
  send: {
    body: Joi.object({
      userId: Joi.string().uuid().required(),
      type: Joi.string().valid(...Object.values(NotificationType)).required(),
      channels: Joi.array()
        .items(Joi.string().valid(...Object.values(NotificationChannel)))
        .min(1)
        .required(),
      data: Joi.object().required(),
      priority: Joi.string().valid('high', 'normal', 'low').default('normal'),
      scheduledAt: Joi.date().iso().min('now').optional()
    })
  },
  
  getInApp: {
    query: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20)
    })
  },
  
  markAsRead: {
    params: Joi.object({
      id: Joi.string().uuid().required()
    })
  },
  
  updatePreferences: {
    body: Joi.object({
      email: Joi.object({
        enabled: Joi.boolean().required(),
        types: Joi.array().items(
          Joi.string().valid(...Object.values(NotificationType), 'all', 'important')
        ).required()
      }).optional(),
      sms: Joi.object({
        enabled: Joi.boolean().required(),
        types: Joi.array().items(
          Joi.string().valid(...Object.values(NotificationType), 'all', 'important')
        ).required()
      }).optional(),
      push: Joi.object({
        enabled: Joi.boolean().required(),
        types: Joi.array().items(
          Joi.string().valid(...Object.values(NotificationType), 'all', 'important')
        ).required()
      }).optional(),
      inApp: Joi.object({
        enabled: Joi.boolean().required(),
        types: Joi.array().items(
          Joi.string().valid(...Object.values(NotificationType), 'all', 'important')
        ).required()
      }).optional()
    }).min(1)
  }
};