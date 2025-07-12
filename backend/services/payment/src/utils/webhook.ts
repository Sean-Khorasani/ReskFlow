import crypto from 'crypto';
import { config } from '../config';

export const generateWebhookSignature = (payload: any): string => {
  const secret = config.webhook.secret;
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
};

export const verifyWebhookSignature = (
  payload: any,
  signature: string
): boolean => {
  if (!signature) {
    return false;
  }

  const expectedSignature = generateWebhookSignature(payload);
  
  // Use timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

export const createWebhookEvent = (
  event: string,
  data: any
): {
  id: string;
  event: string;
  data: any;
  timestamp: Date;
  signature: string;
} => {
  const webhookEvent = {
    id: crypto.randomUUID(),
    event,
    data,
    timestamp: new Date()
  };

  const signature = generateWebhookSignature(webhookEvent);

  return {
    ...webhookEvent,
    signature
  };
};