import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors';

export function validate(req: Request, res: Response, next: NextFunction) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors
      .array()
      .map((error) => `${error.type === 'field' ? error.path : error.type}: ${error.msg}`)
      .join(', ');
    
    return next(new ValidationError(errorMessages));
  }
  next();
}