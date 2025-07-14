import { Order } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { CartService } from './external/cart.service';
import { CatalogService } from './external/catalog.service';
import { OrderService } from './order.service';

export class ReorderService {
  private cartService: CartService;
  private catalogService: CatalogService;
  private orderService: OrderService;

  constructor() {
    this.cartService = new CartService();
    this.catalogService = new CatalogService();
    this.orderService = new OrderService();
  }

  async reorder(orderId: string, userId: string): Promise<Order> {
    // Get original order
    const originalOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });

    if (!originalOrder) {
      throw new NotFoundError('Order not found');
    }

    if (originalOrder.userId !== userId) {
      throw new ValidationError('Cannot reorder from another user\'s order');
    }

    // Create new cart with same items
    const cart = await this.createCartFromOrder(originalOrder);

    // Create new order
    const newOrder = await this.orderService.createOrder({
      userId,
      cartId: cart.id,
      reskflowType: originalOrder.reskflowType,
      reskflowAddress: originalOrder.reskflowAddress as any,
      customerNotes: 'Reorder from #' + originalOrder.orderNumber,
    });

    logger.info(`Reorder created: ${newOrder.orderNumber} from ${originalOrder.orderNumber}`);
    return newOrder;
  }

  private async createCartFromOrder(order: any): Promise<any> {
    // Check if all products are still available
    const productIds = order.items.map((item: any) => item.productId);
    const products = await this.catalogService.validateProducts(productIds);

    const availableItems = order.items.filter((item: any) => {
      const product = products.get(item.productId);
      return product && product.isAvailable;
    });

    if (availableItems.length === 0) {
      throw new ValidationError('None of the items from the original order are available');
    }

    // Create cart (this would normally call cart service API)
    // For now, returning a mock cart
    return {
      id: 'cart-' + Date.now(),
      userId: order.userId,
      merchantId: order.merchantId,
      items: availableItems,
      subtotal: order.subtotal,
      tax: order.tax,
      reskflowFee: order.reskflowFee,
      serviceFee: order.serviceFee,
      total: order.total,
    };
  }
}