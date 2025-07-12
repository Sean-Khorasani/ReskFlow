import sgMail from '@sendgrid/mail';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../utils/logger';
import { NotificationResult, NotificationChannel } from '../types/notification.types';

export class EmailService {
  private transporter?: Transporter;
  
  constructor() {
    this.initialize();
  }
  
  private initialize() {
    if (config.email.provider === 'sendgrid') {
      sgMail.setApiKey(config.email.sendgrid.apiKey);
    } else {
      this.transporter = nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        auth: {
          user: config.email.smtp.user,
          pass: config.email.smtp.pass
        }
      });
    }
  }
  
  async send(
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<NotificationResult> {
    try {
      if (config.email.provider === 'sendgrid') {
        await sgMail.send({
          to,
          from: config.email.from,
          subject,
          html,
          text: text || ''
        });
      } else {
        await this.transporter!.sendMail({
          to,
          from: config.email.from,
          subject,
          html,
          text
        });
      }
      
      logger.info('Email sent successfully', { to, subject });
      
      return {
        id: `email-${Date.now()}`,
        channel: NotificationChannel.EMAIL,
        success: true,
        sentAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send email', { error, to, subject });
      
      return {
        id: `email-${Date.now()}`,
        channel: NotificationChannel.EMAIL,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  async sendBulk(
    recipients: Array<{ to: string; subject: string; html: string; text?: string }>
  ): Promise<NotificationResult[]> {
    const results = await Promise.all(
      recipients.map(({ to, subject, html, text }) =>
        this.send(to, subject, html, text)
      )
    );
    
    return results;
  }
}