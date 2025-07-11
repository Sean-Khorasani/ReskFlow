import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

// Extend Express Request type to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = nanoid();
  req.requestId = requestId;

  const start = Date.now();
  
  // Log request
  logger.info({
    type: 'request',
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    res.send = originalSend;
    const duration = Date.now() - start;
    
    logger.info({
      type: 'response',
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });

    return res.send(data);
  };

  next();
};