import { Request, Response, NextFunction } from 'express';
import { OrderService } from '../services/order.service';
import { InvoiceService } from '../services/invoice.service';
import { OrderRatingService } from '../services/order-rating.service';
import { ReorderService } from '../services/reorder.service';
import { logger } from '../utils/logger';
import { sanitizeOrderData } from '../utils/helpers';

export class OrderController {
  private orderService: OrderService;
  private invoiceService: InvoiceService;
  private ratingService: OrderRatingService;
  private reorderService: ReorderService;

  constructor() {
    this.orderService = new OrderService();
    this.invoiceService = new InvoiceService();
    this.ratingService = new OrderRatingService();
    this.reorderService = new ReorderService();
  }

  createOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const orderData = {
        userId,
        ...req.body,
      };

      const order = await this.orderService.createOrder(orderData);
      
      res.status(201).json({
        order: sanitizeOrderData(order),
      });
    } catch (error) {
      next(error);
    }
  };

  getOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      
      const order = await this.orderService.getOrderById(orderId);
      
      res.json({
        order: order ? sanitizeOrderData(order) : null,
      });
    } catch (error) {
      next(error);
    }
  };

  getUserOrders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as any;

      const result = await this.orderService.getUserOrders(
        userId,
        page,
        limit,
        status
      );

      res.json({
        orders: result.orders.map(sanitizeOrderData),
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  getMerchantOrders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { merchantId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as any;

      // Verify merchant access
      if (req.user!.role === 'MERCHANT' && req.user!.merchantId !== merchantId) {
        return res.status(403).json({
          error: 'Access denied',
        });
      }

      const result = await this.orderService.getMerchantOrders(
        merchantId,
        page,
        limit,
        status
      );

      res.json({
        orders: result.orders.map(sanitizeOrderData),
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  updateOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const updates = req.body;

      // This would be used for merchant-specific updates
      // Implementation depends on business logic
      
      res.json({
        message: 'Order update endpoint - implementation pending',
      });
    } catch (error) {
      next(error);
    }
  };

  updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;
      const actor = req.user!.userId;

      const order = await this.orderService.updateOrderStatus(
        orderId,
        status,
        actor
      );

      res.json({
        order: sanitizeOrderData(order),
      });
    } catch (error) {
      next(error);
    }
  };

  cancelOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const { reason } = req.body;
      const userId = req.user!.userId;

      const order = await this.orderService.cancelOrder(
        orderId,
        userId,
        reason
      );

      res.json({
        order: sanitizeOrderData(order),
      });
    } catch (error) {
      next(error);
    }
  };

  rateOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const userId = req.user!.userId;
      const ratingData = req.body;

      const rating = await this.ratingService.createRating({
        orderId,
        userId,
        ...ratingData,
      });

      res.json({
        rating,
      });
    } catch (error) {
      next(error);
    }
  };

  getOrderTracking = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;

      const order = await this.orderService.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({
          error: 'Order not found',
        });
      }

      // Get tracking info based on reskflow type
      const tracking = {
        orderNumber: order.orderNumber,
        status: order.status,
        timeline: order.timeline,
        reskflowType: order.reskflowType,
        estimatedDeliveryTime: order.reskflowTime,
        reskflowAddress: order.reskflowAddress,
        // Would include real-time location for reskflow orders
      };

      res.json({
        tracking,
      });
    } catch (error) {
      next(error);
    }
  };

  requestInvoice = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;

      const invoice = await this.invoiceService.createInvoice(orderId);

      res.json({
        invoice,
      });
    } catch (error) {
      next(error);
    }
  };

  reorder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const userId = req.user!.userId;

      const newOrder = await this.reorderService.reorder(orderId, userId);

      res.json({
        order: sanitizeOrderData(newOrder),
        cartId: newOrder.cartId,
      });
    } catch (error) {
      next(error);
    }
  };
}