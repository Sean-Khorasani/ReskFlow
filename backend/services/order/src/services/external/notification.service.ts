import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { Order } from '@prisma/client';

export class NotificationService {
  private baseUrl = config.services.notification;

  async sendOrderCreated(order: Order): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/api/v1/notifications/send`, {
        userId: order.userId,
        type: 'ORDER_CREATED',
        title: 'Order Placed Successfully',
        message: `Your order #${order.orderNumber} has been placed and is being processed.`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: order.total,
        },
      });
    } catch (error) {
      logger.error('Failed to send order created notification:', error);
      // Don't throw - notification failure shouldn't fail order
    }
  }

  async sendOrderStatusUpdate(order: Order): Promise<void> {
    try {
      const statusMessages: Record<string, string> = {
        CONFIRMED: 'Your order has been confirmed and is being prepared.',
        PREPARING: 'Your order is being prepared.',
        READY_FOR_PICKUP: 'Your order is ready for pickup!',
        OUT_FOR_DELIVERY: 'Your order is out for reskflow.',
        DELIVERED: 'Your order has been delivered. Enjoy!',
        CANCELLED: 'Your order has been cancelled.',
        FAILED: 'Your order could not be completed.',
        REFUNDED: 'Your order has been refunded.',
      };

      const message = statusMessages[order.status] || `Order status: ${order.status}`;

      await axios.post(`${this.baseUrl}/api/v1/notifications/send`, {
        userId: order.userId,
        type: 'ORDER_STATUS_UPDATE',
        title: `Order #${order.orderNumber} Update`,
        message,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
        },
      });
    } catch (error) {
      logger.error('Failed to send order status notification:', error);
    }
  }

  async sendOrderToMerchant(order: Order): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/api/v1/notifications/merchant`, {
        merchantId: order.merchantId,
        type: 'NEW_ORDER',
        title: 'New Order Received',
        message: `New order #${order.orderNumber} received for $${order.total}`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: order.total,
          itemCount: order.items?.length || 0,
        },
        priority: 'high',
      });
    } catch (error) {
      logger.error('Failed to send merchant notification:', error);
    }
  }
}