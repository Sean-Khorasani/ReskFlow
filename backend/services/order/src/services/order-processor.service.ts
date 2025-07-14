import { OrderStatus, PaymentStatus } from '@prisma/client';
import { consumeMessage, QUEUES } from '../config/rabbitmq';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { OrderService } from './order.service';
import { NotificationService } from './external/notification.service';

export async function startOrderProcessor() {
  const orderService = new OrderService();
  const notificationService = new NotificationService();

  // Process payment completed events
  await consumeMessage(QUEUES.PAYMENT_COMPLETED, async (message) => {
    try {
      logger.info('Processing payment completed event:', message);
      
      const { orderId, paymentId } = message;
      
      // Update order with payment info
      const order = await orderService.processPayment(orderId, paymentId);
      
      // Send notification to merchant
      await notificationService.sendOrderToMerchant(order);
      
      logger.info(`Order ${order.orderNumber} confirmed after payment`);
    } catch (error) {
      logger.error('Failed to process payment completed event:', error);
      throw error;
    }
  });

  // Process payment failed events
  await consumeMessage(QUEUES.PAYMENT_FAILED, async (message) => {
    try {
      logger.info('Processing payment failed event:', message);
      
      const { orderId, reason } = message;
      
      // Update order status
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.FAILED,
          paymentStatus: PaymentStatus.FAILED,
        },
      });
      
      logger.info(`Order ${orderId} failed due to payment failure`);
    } catch (error) {
      logger.error('Failed to process payment failed event:', error);
      throw error;
    }
  });

  // Process reskflow updates
  await consumeMessage(QUEUES.DELIVERY_UPDATED, async (message) => {
    try {
      logger.info('Processing reskflow update:', message);
      
      const { orderId, status, reskflowId } = message;
      
      // Map reskflow status to order status
      const orderStatusMap: Record<string, OrderStatus> = {
        'ASSIGNED': OrderStatus.PREPARING,
        'PICKED_UP': OrderStatus.OUT_FOR_DELIVERY,
        'DELIVERED': OrderStatus.DELIVERED,
        'FAILED': OrderStatus.FAILED,
      };
      
      const orderStatus = orderStatusMap[status];
      if (orderStatus) {
        await orderService.updateOrderStatus(orderId, orderStatus, 'system', `Delivery ${status.toLowerCase()}`);
        
        // Update reskflow ID if provided
        if (reskflowId) {
          await prisma.order.update({
            where: { id: orderId },
            data: { reskflowId },
          });
        }
      }
    } catch (error) {
      logger.error('Failed to process reskflow update:', error);
      throw error;
    }
  });

  // Process cart checkout requests
  await consumeMessage(QUEUES.CART_CHECKOUT, async (message) => {
    try {
      logger.info('Processing cart checkout:', message);
      
      const { cartId, userId, reskflowType, reskflowAddress, paymentMethodId } = message;
      
      // Create order from cart
      const order = await orderService.createOrder({
        userId,
        cartId,
        reskflowType,
        reskflowAddress,
        paymentMethodId,
      });
      
      logger.info(`Order ${order.orderNumber} created from cart ${cartId}`);
    } catch (error) {
      logger.error('Failed to process cart checkout:', error);
      // Send failure notification to user
      throw error;
    }
  });

  // Start order timeout checker
  startOrderTimeoutChecker();
  
  logger.info('Order processor started');
}

function startOrderTimeoutChecker() {
  setInterval(async () => {
    try {
      const timeoutMinutes = 30;
      const timeoutDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);
      
      // Find orders that are pending and older than timeout
      const timedOutOrders = await prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          createdAt: {
            lt: timeoutDate,
          },
        },
      });
      
      for (const order of timedOutOrders) {
        logger.info(`Cancelling timed out order: ${order.orderNumber}`);
        
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        });
        
        // TODO: Send cancellation notification
      }
    } catch (error) {
      logger.error('Error in order timeout checker:', error);
    }
  }, 60000); // Check every minute
}