import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service';
import { logger } from '../utils/logger';

const notificationService = new NotificationService();

export class NotificationController {
  async send(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationService.send(req.body);
      
      res.status(202).json({
        success: true,
        message: 'Notification queued for reskflow',
        data: result
      });
    } catch (error) {
      logger.error('Error sending notification', { error, body: req.body });
      next(error);
    }
  }
  
  async getInAppNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const userId = req.user?.id || req.body.userId; // Get from auth middleware
      
      const result = await notificationService.getInAppNotifications(
        userId,
        Number(page),
        Number(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Error getting notifications', { error });
      next(error);
    }
  }
  
  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user?.id || req.body.userId;
      
      await notificationService.markAsRead(userId, id);
      
      res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (error) {
      logger.error('Error marking notification as read', { error });
      next(error);
    }
  }
  
  async getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      // This would fetch from database
      const userId = req.user?.id || req.body.userId;
      
      // Mock response for now
      res.json({
        success: true,
        data: {
          userId,
          email: { enabled: true, types: ['all'] },
          sms: { enabled: true, types: ['important'] },
          push: { enabled: true, types: ['all'] },
          inApp: { enabled: true, types: ['all'] }
        }
      });
    } catch (error) {
      next(error);
    }
  }
  
  async updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
      // This would update in database
      const userId = req.user?.id || req.body.userId;
      const preferences = req.body;
      
      res.json({
        success: true,
        message: 'Preferences updated successfully',
        data: preferences
      });
    } catch (error) {
      next(error);
    }
  }
}