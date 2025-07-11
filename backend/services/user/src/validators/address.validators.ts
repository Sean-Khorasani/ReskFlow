import Joi from 'joi';
import { AddressType } from '@prisma/client';

export const createAddressSchema = Joi.object({
  type: Joi.string().valid(...Object.values(AddressType)).default(AddressType.OTHER),
  label: Joi.string().max(50).optional(),
  street: Joi.string().required(),
  apartment: Joi.string().optional(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  zipCode: Joi.string().required(),
  country: Joi.string().default('US'),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  instructions: Joi.string().max(500).optional(),
  isDefault: Joi.boolean().default(false)
});

export const updateAddressSchema = Joi.object({
  type: Joi.string().valid(...Object.values(AddressType)).optional(),
  label: Joi.string().max(50).optional(),
  street: Joi.string().optional(),
  apartment: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  zipCode: Joi.string().optional(),
  country: Joi.string().optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  instructions: Joi.string().max(500).optional()
}).min(1);