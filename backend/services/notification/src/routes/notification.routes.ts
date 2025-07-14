import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { validateRequest } from '../middleware/validate';
import { notificationSchemas } from '../validators/notification.validator';

const router = Router();
const controller = new NotificationController();

// Send notification
router.post(
  '/send',
  validateRequest(notificationSchemas.send),
  controller.send
);

// Get in-app notifications
router.get(
  '/in-app',
  validateRequest(notificationSchemas.getInApp),
  controller.getInAppNotifications
);

// Mark notification as read
router.patch(
  '/:id/read',
  validateRequest(notificationSchemas.markAsRead),
  controller.markAsRead
);

// Get notification preferences
router.get(
  '/preferences',
  controller.getPreferences
);

// Update notification preferences
router.put(
  '/preferences',
  validateRequest(notificationSchemas.updatePreferences),
  controller.updatePreferences
);

export { router as notificationRouter };