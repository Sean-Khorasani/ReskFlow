import { NotificationService } from '../notification.service';
import { NotificationChannel, NotificationType } from '../../types/notification.types';

describe('NotificationService', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    notificationService = new NotificationService();
  });

  describe('send', () => {
    it('should queue notification for processing', async () => {
      const request = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        type: NotificationType.ORDER_PLACED,
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        data: {
          orderId: 'ORD-123',
          customerName: 'John Doe',
          restaurantName: 'Pizza Palace',
          total: '25.99',
          estimatedTime: '30-45 minutes'
        }
      };

      const result = await notificationService.send(request);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getInAppNotifications', () => {
    it('should return paginated notifications', async () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      
      const result = await notificationService.getInAppNotifications(userId, 1, 10);
      
      expect(result).toHaveProperty('notifications');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination).toHaveProperty('page', 1);
      expect(result.pagination).toHaveProperty('limit', 10);
    });
  });
});