import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3008,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
  },
  
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost',
    queues: {
      notifications: 'notifications',
      emailQueue: 'email-notifications',
      smsQueue: 'sms-notifications',
      pushQueue: 'push-notifications'
    }
  },
  
  email: {
    provider: process.env.EMAIL_PROVIDER || 'smtp',
    from: process.env.EMAIL_FROM || 'noreply@reskflow.com',
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY || ''
    },
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  },
  
  sms: {
    provider: process.env.SMS_PROVIDER || 'twilio',
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      fromNumber: process.env.TWILIO_FROM_NUMBER || ''
    }
  },
  
  push: {
    provider: process.env.PUSH_PROVIDER || 'fcm',
    fcm: {
      projectId: process.env.FCM_PROJECT_ID || '',
      privateKey: process.env.FCM_PRIVATE_KEY || '',
      clientEmail: process.env.FCM_CLIENT_EMAIL || ''
    },
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY || '',
      privateKey: process.env.VAPID_PRIVATE_KEY || '',
      subject: process.env.VAPID_SUBJECT || 'mailto:admin@reskflow.com'
    }
  },
  
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
};