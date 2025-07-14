import twilio from 'twilio';
import { config } from '../config';
import { logger } from '../utils/logger';
import { NotificationResult, NotificationChannel } from '../types/notification.types';

export class SMSService {
  private twilioClient: twilio.Twilio;
  
  constructor() {
    this.twilioClient = twilio(
      config.sms.twilio.accountSid,
      config.sms.twilio.authToken
    );
  }
  
  async send(to: string, message: string): Promise<NotificationResult> {
    try {
      const result = await this.twilioClient.messages.create({
        body: message,
        from: config.sms.twilio.fromNumber,
        to
      });
      
      logger.info('SMS sent successfully', { to, messageId: result.sid });
      
      return {
        id: result.sid,
        channel: NotificationChannel.SMS,
        success: true,
        sentAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send SMS', { error, to });
      
      return {
        id: `sms-${Date.now()}`,
        channel: NotificationChannel.SMS,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  async sendBulk(
    recipients: Array<{ to: string; message: string }>
  ): Promise<NotificationResult[]> {
    const results = await Promise.all(
      recipients.map(({ to, message }) => this.send(to, message))
    );
    
    return results;
  }
}