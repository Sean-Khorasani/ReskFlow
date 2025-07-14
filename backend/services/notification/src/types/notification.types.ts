export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
  IN_APP = 'in_app'
}

export enum NotificationType {
  ORDER_PLACED = 'order_placed',
  ORDER_ACCEPTED = 'order_accepted',
  ORDER_PREPARING = 'order_preparing',
  ORDER_READY = 'order_ready',
  ORDER_PICKED_UP = 'order_picked_up',
  ORDER_DELIVERED = 'order_delivered',
  ORDER_CANCELLED = 'order_cancelled',
  PAYMENT_SUCCESS = 'payment_success',
  PAYMENT_FAILED = 'payment_failed',
  DELIVERY_ASSIGNED = 'reskflow_assigned',
  DELIVERY_STARTED = 'reskflow_started',
  DELIVERY_NEARBY = 'reskflow_nearby',
  PROMO_OFFER = 'promo_offer',
  ACCOUNT_VERIFICATION = 'account_verification',
  PASSWORD_RESET = 'password_reset',
  TWO_FACTOR_CODE = 'two_factor_code'
}

export interface NotificationTemplate {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  subject?: string;
  template: string;
  variables: string[];
}

export interface NotificationRequest {
  userId: string;
  type: NotificationType;
  channels: NotificationChannel[];
  data: Record<string, any>;
  priority?: 'high' | 'normal' | 'low';
  scheduledAt?: Date;
}

export interface NotificationResult {
  id: string;
  channel: NotificationChannel;
  success: boolean;
  error?: string;
  sentAt?: Date;
}

export interface EmailConfig {
  provider: 'sendgrid' | 'smtp';
  from: string;
  replyTo?: string;
}

export interface SMSConfig {
  provider: 'twilio';
  from: string;
}

export interface PushConfig {
  provider: 'fcm';
  serverKey: string;
}

export interface NotificationPreferences {
  userId: string;
  email: {
    enabled: boolean;
    types: NotificationType[];
  };
  sms: {
    enabled: boolean;
    types: NotificationType[];
  };
  push: {
    enabled: boolean;
    types: NotificationType[];
  };
  inApp: {
    enabled: boolean;
    types: NotificationType[];
  };
}