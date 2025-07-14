import { Order, OrderStatus, PaymentStatus, DeliveryType, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { publishMessage, QUEUES } from '../config/rabbitmq';
import { getRedisClient } from '../config/redis';
import { 
  NotFoundError, 
  ValidationError, 
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError
} from '../utils/errors';
import { 
  generateOrderNumber, 
  calculateOrderTotal, 
  isOrderCancellable 
} from '../utils/helpers';
import { logger } from '../utils/logger';
import { config } from '../config';
import { CartService } from './external/cart.service';
import { CatalogService } from './external/catalog.service';
import { PaymentService } from './external/payment.service';
import { NotificationService } from './external/notification.service';
import { OrderTimelineService } from './order-timeline.service';

interface CreateOrderDto {
  userId: string;
  cartId: string;
  reskflowType: DeliveryType;
  reskflowAddress?: any;
  reskflowTime?: Date;
  customerNotes?: string;
  paymentMethodId?: string;
}

interface UpdateOrderDto {
  status?: OrderStatus;
  merchantNotes?: string;
  reskflowTime?: Date;
}

export class OrderService {
  private cartService: CartService;
  private catalogService: CatalogService;
  private paymentService: PaymentService;
  private notificationService: NotificationService;
  private timelineService: OrderTimelineService;
  private redis = getRedisClient();

  constructor() {
    this.cartService = new CartService();
    this.catalogService = new CatalogService();
    this.paymentService = new PaymentService();
    this.notificationService = new NotificationService();
    this.timelineService = new OrderTimelineService();
  }

  async createOrder(data: CreateOrderDto): Promise<Order> {
    // Validate cart
    const cart = await this.cartService.getCart(data.cartId, data.userId);
    if (!cart || cart.items.length === 0) {
      throw new ValidationError('Cart is empty or not found');
    }

    // Check if cart belongs to user
    if (cart.userId !== data.userId) {
      throw new ForbiddenError('Cart does not belong to user');
    }

    // Validate merchant is active
    const merchantId = cart.merchantId;
    if (!merchantId) {
      throw new ValidationError('Cart has no associated merchant');
    }

    // Validate products and prices
    const validatedItems = await this.validateOrderItems(cart.items, merchantId);

    // Calculate totals
    const { subtotal, tax, reskflowFee, serviceFee, total } = calculateOrderTotal(
      validatedItems,
      cart.tax || 0,
      cart.reskflowFee || 0,
      cart.serviceFee || 0,
      cart.discount || 0
    );

    // Create order
    const orderNumber = generateOrderNumber();
    
    try {
      const order = await prisma.$transaction(async (tx) => {
        // Create order
        const newOrder = await tx.order.create({
          data: {
            orderNumber,
            userId: data.userId,
            merchantId,
            cartId: data.cartId,
            reskflowType: data.reskflowType,
            reskflowAddress: data.reskflowAddress,
            reskflowTime: data.reskflowTime,
            customerNotes: data.customerNotes,
            subtotal,
            tax,
            reskflowFee,
            serviceFee,
            discount: cart.discount || 0,
            total,
            status: OrderStatus.PENDING,
            paymentStatus: PaymentStatus.PENDING,
            items: {
              create: validatedItems.map(item => ({
                productId: item.productId,
                productName: item.productName,
                productImage: item.productImage,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                options: item.options,
                specialRequests: item.specialRequests,
              })),
            },
          },
          include: {
            items: true,
            timeline: true,
          },
        });

        // Add timeline entry
        await this.timelineService.addEntry(tx, {
          orderId: newOrder.id,
          status: OrderStatus.PENDING,
          message: 'Order created',
          actor: data.userId,
        });

        return newOrder;
      });

      // Clear cart
      await this.cartService.clearCart(data.cartId, data.userId);

      // Cache order for quick access
      await this.cacheOrder(order);

      // Publish order created event
      await publishMessage(QUEUES.ORDER_CREATED, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        merchantId: order.merchantId,
        total: order.total,
        items: order.items,
      });

      // Send notification
      await this.notificationService.sendOrderCreated(order);

      logger.info(`Order created: ${order.orderNumber}`);
      return order;
    } catch (error) {
      logger.error('Failed to create order:', error);
      throw error;
    }
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    // Check cache first
    const cached = await this.getCachedOrder(orderId);
    if (cached) return cached;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        timeline: {
          orderBy: { createdAt: 'desc' },
        },
        rating: true,
        invoice: true,
      },
    });

    if (order) {
      await this.cacheOrder(order);
    }

    return order;
  }

  async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    return prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: true,
        timeline: {
          orderBy: { createdAt: 'desc' },
        },
        rating: true,
        invoice: true,
      },
    });
  }

  async getUserOrders(
    userId: string,
    page: number = 1,
    limit: number = 10,
    status?: OrderStatus
  ) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(status && { status }),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            take: 3, // Just show first 3 items for list view
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getMerchantOrders(
    merchantId: string,
    page: number = 1,
    limit: number = 10,
    status?: OrderStatus
  ) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.OrderWhereInput = {
      merchantId,
      ...(status && { status }),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          timeline: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    actor?: string,
    message?: string
  ): Promise<Order> {
    const order = await this.getOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Validate status transition
    this.validateStatusTransition(order.status, status);

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Update order
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status,
          ...(status === OrderStatus.COMPLETED && { completedAt: new Date() }),
          ...(status === OrderStatus.CANCELLED && { cancelledAt: new Date() }),
        },
        include: {
          items: true,
          timeline: true,
        },
      });

      // Add timeline entry
      await this.timelineService.addEntry(tx, {
        orderId,
        status,
        message: message || `Order ${status.toLowerCase()}`,
        actor,
      });

      return updated;
    });

    // Clear cache
    await this.clearOrderCache(orderId);

    // Publish status update event
    await publishMessage(QUEUES.ORDER_UPDATED, {
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      previousStatus: order.status,
    });

    // Send notification
    await this.notificationService.sendOrderStatusUpdate(updatedOrder);

    logger.info(`Order ${updatedOrder.orderNumber} status updated to ${status}`);
    return updatedOrder;
  }

  async cancelOrder(orderId: string, userId: string, reason?: string): Promise<Order> {
    const order = await this.getOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Check if user can cancel
    if (order.userId !== userId) {
      throw new ForbiddenError('Cannot cancel order');
    }

    // Check if order can be cancelled
    if (!isOrderCancellable(order.createdAt, config.order.cancellationWindowMinutes)) {
      throw new ConflictError('Order cannot be cancelled after preparation has started');
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new ConflictError('Order is already cancelled');
    }

    if ([OrderStatus.DELIVERED, OrderStatus.COMPLETED].includes(order.status)) {
      throw new ConflictError('Cannot cancel completed order');
    }

    // Cancel order
    const cancelledOrder = await this.updateOrderStatus(
      orderId,
      OrderStatus.CANCELLED,
      userId,
      reason || 'Cancelled by customer'
    );

    // Process refund if payment was made
    if (order.paymentStatus === PaymentStatus.COMPLETED && order.paymentId) {
      await this.paymentService.refundPayment(order.paymentId, order.total, reason);
    }

    // Publish cancellation event
    await publishMessage(QUEUES.ORDER_CANCELLED, {
      orderId: cancelledOrder.id,
      orderNumber: cancelledOrder.orderNumber,
      userId: cancelledOrder.userId,
      merchantId: cancelledOrder.merchantId,
      reason,
    });

    return cancelledOrder;
  }

  async processPayment(orderId: string, paymentId: string): Promise<Order> {
    const order = await this.getOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    if (order.paymentStatus !== PaymentStatus.PENDING) {
      throw new ConflictError('Payment already processed');
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        paymentId,
        paymentStatus: PaymentStatus.COMPLETED,
        status: OrderStatus.CONFIRMED,
      },
      include: {
        items: true,
        timeline: true,
      },
    });

    // Add timeline entry
    await this.timelineService.addEntry(prisma, {
      orderId,
      status: OrderStatus.CONFIRMED,
      message: 'Payment completed, order confirmed',
    });

    // Clear cache
    await this.clearOrderCache(orderId);

    // Send to merchant queue
    await publishMessage(QUEUES.ORDER_UPDATED, {
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      merchantId: updatedOrder.merchantId,
    });

    return updatedOrder;
  }

  private async validateOrderItems(items: any[], merchantId: string): Promise<any[]> {
    const validatedItems = [];

    for (const item of items) {
      // Validate product exists and is available
      const product = await this.catalogService.getProduct(item.productId);
      if (!product) {
        throw new ValidationError(`Product ${item.productId} not found`);
      }

      if (product.merchantId !== merchantId) {
        throw new ValidationError(`Product ${product.name} does not belong to merchant`);
      }

      if (!product.isAvailable) {
        throw new ValidationError(`Product ${product.name} is not available`);
      }

      // Validate price hasn't changed significantly
      const priceDiff = Math.abs(product.price - item.unitPrice);
      if (priceDiff > 0.01) {
        throw new ValidationError(`Price changed for ${product.name}`);
      }

      validatedItems.push({
        productId: item.productId,
        productName: product.name,
        productImage: product.image,
        quantity: item.quantity,
        unitPrice: product.price,
        totalPrice: product.price * item.quantity,
        options: item.options,
        specialRequests: item.specialRequests,
      });
    }

    return validatedItems;
  }

  private validateStatusTransition(currentStatus: OrderStatus, newStatus: OrderStatus): void {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.FAILED],
      [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
      [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED],
      [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED],
      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.FAILED],
      [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.FAILED]: [],
      [OrderStatus.COMPLETED]: [],
      [OrderStatus.REFUNDED]: [],
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new ValidationError(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }
  }

  private async cacheOrder(order: any): Promise<void> {
    const key = `order:${order.id}`;
    await this.redis.setex(key, 300, JSON.stringify(order)); // Cache for 5 minutes
  }

  private async getCachedOrder(orderId: string): Promise<any> {
    const key = `order:${orderId}`;
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  private async clearOrderCache(orderId: string): Promise<void> {
    const key = `order:${orderId}`;
    await this.redis.del(key);
  }
}