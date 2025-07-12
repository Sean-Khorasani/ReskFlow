import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

interface ValidationSchema {
  body?: Joi.Schema;
  query?: Joi.Schema;
  params?: Joi.Schema;
}

export function validateRequest(schema: ValidationSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const validationOptions = {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    };

    const errors: any = {};

    // Validate body
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, validationOptions);
      if (error) {
        errors.body = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      } else {
        req.body = value;
      }
    }

    // Validate query
    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, validationOptions);
      if (error) {
        errors.query = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      } else {
        req.query = value;
      }
    }

    // Validate params
    if (schema.params) {
      const { error, value } = schema.params.validate(req.params, validationOptions);
      if (error) {
        errors.params = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));
      } else {
        req.params = value;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    next();
  };
}