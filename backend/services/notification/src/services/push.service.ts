import * as admin from 'firebase-admin';
import webpush from 'web-push';
import { config } from '../config';
import { logger } from '../utils/logger';
import { NotificationResult, NotificationChannel } from '../types/notification.types';

export class PushService {
  private firebaseApp?: admin.app.App;
  
  constructor() {
    this.initialize();
  }
  
  private initialize() {
    // Initialize Firebase Admin SDK
    if (config.push.fcm.projectId) {
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.push.fcm.projectId,
          clientEmail: config.push.fcm.clientEmail,
          privateKey: config.push.fcm.privateKey.replace(/\\n/g, '\n')
        })
      });
    }
    
    // Initialize Web Push
    if (config.push.vapid.publicKey && config.push.vapid.privateKey) {
      webpush.setVapidDetails(
        config.push.vapid.subject,
        config.push.vapid.publicKey,
        config.push.vapid.privateKey
      );
    }
  }
  
  async sendFCM(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<NotificationResult> {
    try {
      if (!this.firebaseApp) {
        throw new Error('Firebase not initialized');
      }
      
      const message: admin.messaging.Message = {
        token,
        notification: {
          title,
          body
        },
        data,
        android: {
          priority: 'high'
        },
        apns: {
          headers: {
            'apns-priority': '10'
          }
        }
      };
      
      const result = await admin.messaging().send(message);
      
      logger.info('FCM notification sent', { token, messageId: result });
      
      return {
        id: result,
        channel: NotificationChannel.PUSH,
        success: true,
        sentAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send FCM notification', { error, token });
      
      return {
        id: `push-${Date.now()}`,
        channel: NotificationChannel.PUSH,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  async sendWebPush(
    subscription: webpush.PushSubscription,
    payload: any
  ): Promise<NotificationResult> {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      
      logger.info('Web push notification sent');
      
      return {
        id: `webpush-${Date.now()}`,
        channel: NotificationChannel.PUSH,
        success: true,
        sentAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to send web push notification', { error });
      
      return {
        id: `webpush-${Date.now()}`,
        channel: NotificationChannel.PUSH,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}