import { prisma, logger, redis, EventEmitter } from '@reskflow/shared';
import { Order, OrderStatus } from '@prisma/client';
import { NotificationService } from '@reskflow/shared';

interface GetMerchantOrdersParams {
  merchantId: string;
  status?: string;
  date?: string;
  page: number;
  limit: number;
}

interface OrderUpdateEvent {
  orderId: string;
  merchantId: string;
  status: OrderStatus;
  timestamp: Date;
}

export class OrderManagementService {
  private eventEmitter: EventEmitter;
  private notificationService: NotificationService;
  private orderProcessingInterval?: NodeJS.Timeout;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.notificationService = new NotificationService();
  }

  async getMerchantOrders(params: GetMerchantOrdersParams) {
    const { merchantId, status, date, page, limit } = params;
    const skip = (page - 1) * limit;

    const where: any = { merchantId };

    if (status) {
      where.status = status as OrderStatus;
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      
      where.createdAt = {
        gte: startDate,
        lt: endDate,
      };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          items: {
            include: {
              menuItem: true,
            },
          },
          location: true,
        },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async acceptOrder(
    orderId: string,
    merchantId: string,
    estimatedTime: number
  ): Promise<Order> {
    try {
      // Verify order belongs to merchant and is pending
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          merchantId,
          status: OrderStatus.PENDING,
        },
        include: {
          customer: true,
          items: {
            include: { menuItem: true },
          },
        },
      });

      if (!order) {
        throw new Error('Order not found or already processed');
      }

      // Calculate estimated ready time
      const estimatedReadyTime = new Date();
      estimatedReadyTime.setMinutes(estimatedReadyTime.getMinutes() + estimatedTime);

      // Update order status
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.ACCEPTED,
          acceptedAt: new Date(),
          estimatedReadyTime,
        },
      });

      // Update inventory if tracking is enabled
      await this.updateInventory(order);

      // Send notifications
      await this.notificationService.sendOrderAcceptedNotification(
        order.customerId,
        order.orderNumber,
        estimatedTime
      );

      // Emit event for real-time updates
      this.emitOrderUpdate({
        orderId: order.id,
        merchantId,
        status: OrderStatus.ACCEPTED,
        timestamp: new Date(),
      });

      // Start preparation timer
      await this.schedulePreparationReminder(orderId, estimatedTime);

      logger.info(`Order ${orderId} accepted by merchant ${merchantId}`);
      return updatedOrder;
    } catch (error) {
      logger.error('Failed to accept order', error);
      throw error;
    }
  }

  async rejectOrder(
    orderId: string,
    merchantId: string,
    reason: string
  ): Promise<Order> {
    try {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          merchantId,
          status: OrderStatus.PENDING,
        },
        include: { customer: true },
      });

      if (!order) {
        throw new Error('Order not found or already processed');
      }

      // Update order status
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          rejectionReason: reason,
        },
      });

      // Process refund
      await this.processRefund(order);

      // Send notifications
      await this.notificationService.sendOrderRejectedNotification(
        order.customerId,
        order.orderNumber,
        reason
      );

      // Emit event
      this.emitOrderUpdate({
        orderId: order.id,
        merchantId,
        status: OrderStatus.CANCELLED,
        timestamp: new Date(),
      });

      logger.info(`Order ${orderId} rejected by merchant ${merchantId}: ${reason}`);
      return updatedOrder;
    } catch (error) {
      logger.error('Failed to reject order', error);
      throw error;
    }
  }

  async markOrderReady(orderId: string, merchantId: string): Promise<Order> {
    try {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          merchantId,
          status: OrderStatus.PREPARING,
        },
        include: { customer: true },
      });

      if (!order) {
        throw new Error('Order not found or not in preparing status');
      }

      // Update order status
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.READY_FOR_PICKUP,
          readyAt: new Date(),
        },
      });

      // Send notifications
      await this.notificationService.sendOrderReadyNotification(
        order.customerId,
        order.orderNumber
      );

      // Notify assigned driver if exists
      if (order.reskflowId) {
        await this.notifyDriverOrderReady(order.reskflowId);
      }

      // Emit event
      this.emitOrderUpdate({
        orderId: order.id,
        merchantId,
        status: OrderStatus.READY_FOR_PICKUP,
        timestamp: new Date(),
      });

      logger.info(`Order ${orderId} marked as ready by merchant ${merchantId}`);
      return updatedOrder;
    } catch (error) {
      logger.error('Failed to mark order as ready', error);
      throw error;
    }
  }

  startOrderProcessing(): void {
    // Process order status updates every 30 seconds
    this.orderProcessingInterval = setInterval(async () => {
      try {
        // Auto-update orders to preparing status
        const acceptedOrders = await prisma.order.findMany({
          where: {
            status: OrderStatus.ACCEPTED,
            acceptedAt: {
              lte: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
            },
          },
        });

        for (const order of acceptedOrders) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PREPARING,
              preparingAt: new Date(),
            },
          });

          this.emitOrderUpdate({
            orderId: order.id,
            merchantId: order.merchantId,
            status: OrderStatus.PREPARING,
            timestamp: new Date(),
          });
        }

        // Check for delayed orders
        await this.checkDelayedOrders();

      } catch (error) {
        logger.error('Order processing error', error);
      }
    }, 30000); // 30 seconds

    logger.info('Order processing started');
  }

  stopOrderProcessing(): void {
    if (this.orderProcessingInterval) {
      clearInterval(this.orderProcessingInterval);
      logger.info('Order processing stopped');
    }
  }

  subscribeToOrders(
    merchantId: string,
    callback: (order: OrderUpdateEvent) => void
  ): { unsubscribe: () => void } {
    const handler = (event: OrderUpdateEvent) => {
      if (event.merchantId === merchantId) {
        callback(event);
      }
    };

    this.eventEmitter.on('order-update', handler);

    return {
      unsubscribe: () => {
        this.eventEmitter.off('order-update', handler);
      },
    };
  }

  private async updateInventory(order: any): Promise<void> {
    for (const item of order.items) {
      if (item.menuItem.trackInventory) {
        await prisma.menuItem.update({
          where: { id: item.menuItemId },
          data: {
            quantity: {
              decrement: item.quantity,
            },
          },
        });

        // Check low stock threshold
        const updatedItem = await prisma.menuItem.findUnique({
          where: { id: item.menuItemId },
        });

        if (updatedItem && updatedItem.quantity <= updatedItem.lowStockThreshold) {
          await this.notifyLowStock(updatedItem);
        }
      }
    }
  }

  private async processRefund(order: any): Promise<void> {
    // TODO: Integrate with payment service
    logger.info(`Processing refund for order ${order.id}`);
  }

  private async notifyDriverOrderReady(reskflowId: string): Promise<void> {
    const reskflow = await prisma.reskflow.findUnique({
      where: { id: reskflowId },
      include: { driver: true },
    });

    if (reskflow && reskflow.driver) {
      await this.notificationService.sendDriverNotification(
        reskflow.driverId!,
        'Order Ready for Pickup',
        'The order is ready for pickup at the merchant.'
      );
    }
  }

  private async schedulePreparationReminder(
    orderId: string,
    estimatedMinutes: number
  ): Promise<void> {
    const reminderTime = estimatedMinutes * 0.75; // Remind at 75% of time
    
    setTimeout(async () => {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { merchant: true },
      });

      if (order && order.status === OrderStatus.PREPARING) {
        await this.notificationService.sendMerchantNotification(
          order.merchantId,
          'Preparation Reminder',
          `Order ${order.orderNumber} should be ready soon.`
        );
      }
    }, reminderTime * 60 * 1000);
  }

  private async checkDelayedOrders(): Promise<void> {
    const delayedOrders = await prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.ACCEPTED, OrderStatus.PREPARING],
        },
        estimatedReadyTime: {
          lt: new Date(),
        },
      },
      include: {
        merchant: true,
        customer: true,
      },
    });

    for (const order of delayedOrders) {
      // Notify merchant about delay
      await this.notificationService.sendMerchantNotification(
        order.merchantId,
        'Order Delayed',
        `Order ${order.orderNumber} is delayed. Please update the customer.`
      );

      // Update order with delay flag
      await prisma.order.update({
        where: { id: order.id },
        data: {
          metadata: {
            ...((order as any).metadata || {}),
            isDelayed: true,
            delayNotificationSent: new Date(),
          },
        },
      });
    }
  }

  private async notifyLowStock(menuItem: any): Promise<void> {
    await this.notificationService.sendMerchantNotification(
      menuItem.merchantId,
      'Low Stock Alert',
      `${menuItem.name} is running low on stock (${menuItem.quantity} remaining).`
    );

    // Cache notification to prevent spam
    await redis.set(
      `low-stock-notified:${menuItem.id}`,
      '1',
      'EX',
      3600 // 1 hour
    );
  }

  private emitOrderUpdate(event: OrderUpdateEvent): void {
    this.eventEmitter.emit('order-update', event);
    
    // Also publish to Redis for cross-service communication
    redis.publish('order-updates', JSON.stringify(event));
  }
}