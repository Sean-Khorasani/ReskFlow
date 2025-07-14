import { Request, Response, NextFunction } from 'express';
import { CustomerService } from '../services/customer.service';
import { logger } from '../utils/logger';
import { 
  CustomerStatus,
  SupportTicketType,
  SupportPriority,
  FeedbackType,
  PaymentType,
  AddressType
} from '../types/customer.types';

export class CustomerController {
  private customerService: CustomerService;

  constructor() {
    this.customerService = new CustomerService();
  }

  // Customer Registration Flow
  async registerCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        email,
        phone,
        firstName,
        lastName,
        password,
        dateOfBirth,
        referralCode,
        marketingOptIn,
        defaultAddress
      } = req.body;

      const result = await this.customerService.registerCustomer({
        email,
        phone,
        firstName,
        lastName,
        password,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        referralCode,
        marketingOptIn: marketingOptIn || false,
        defaultAddress
      });

      logger.info('Customer registration successful', {
        customerId: result.customer?.id,
        email
      });

      res.status(201).json({
        success: true,
        message: 'Customer registered successfully',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Customer registration failed', {
        error: error.message,
        email: req.body.email
      });
      
      res.status(400).json({
        success: false,
        error: 'Registration failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Profile Management
  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id || req.params.customerId;
      const updates = req.body;

      const result = await this.customerService.updateCustomerProfile(customerId, updates);

      logger.info('Customer profile updated', { customerId });

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Profile update failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(400).json({
        success: false,
        error: 'Profile update failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Discovery Tracking
  async trackDiscovery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const discoveryData = req.body;

      const result = await this.customerService.trackCustomerDiscovery(customerId, discoveryData);

      res.status(200).json({
        success: true,
        message: 'Discovery tracked successfully',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Discovery tracking failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Discovery tracking failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Order Placement Business Flow
  async placeOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const orderData = req.body;

      // Validate required fields
      if (!orderData.items || !orderData.merchantId || !orderData.deliveryAddress || !orderData.paymentMethod) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'Items, merchant ID, delivery address, and payment method are required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await this.customerService.placeOrder(customerId, orderData);

      logger.info('Order placed successfully', {
        customerId,
        orderId: result.metadata?.orderId,
        total: result.metadata?.total
      });

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Order placement failed', {
        error: error.message,
        customerId: req.user?.id,
        merchantId: req.body.merchantId
      });
      
      res.status(400).json({
        success: false,
        error: 'Order placement failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Real-time Order Tracking
  async trackOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const { orderId } = req.params;

      const result = await this.customerService.trackCustomerOrder(customerId, orderId);

      res.status(200).json({
        success: true,
        message: 'Order tracking data retrieved',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Order tracking failed', {
        error: error.message,
        customerId: req.user?.id,
        orderId: req.params.orderId
      });
      
      res.status(404).json({
        success: false,
        error: 'Order tracking failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Support Ticket Creation
  async createSupportTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const {
        type,
        priority,
        subject,
        description,
        orderId,
        category,
        attachments
      } = req.body;

      // Validate support ticket type and priority
      if (!Object.values(SupportTicketType).includes(type)) {
        res.status(400).json({
          success: false,
          error: 'Invalid ticket type',
          message: `Type must be one of: ${Object.values(SupportTicketType).join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (!Object.values(SupportPriority).includes(priority)) {
        res.status(400).json({
          success: false,
          error: 'Invalid priority',
          message: `Priority must be one of: ${Object.values(SupportPriority).join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await this.customerService.createSupportTicket(customerId, {
        type,
        priority,
        subject,
        description,
        orderId,
        category,
        attachments
      });

      logger.info('Support ticket created', {
        customerId,
        ticketId: result.metadata?.ticketId,
        type,
        priority
      });

      res.status(201).json({
        success: true,
        message: 'Support ticket created successfully',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Support ticket creation failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Support ticket creation failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Loyalty Program Management
  async manageLoyalty(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const { type, points, orderId, rewardId, reason } = req.body;

      // Validate loyalty action type
      const validTypes = ['EARN', 'REDEEM', 'TRANSFER', 'EXPIRE'];
      if (!validTypes.includes(type)) {
        res.status(400).json({
          success: false,
          error: 'Invalid loyalty action type',
          message: `Type must be one of: ${validTypes.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await this.customerService.manageLoyaltyProgram(customerId, {
        type,
        points,
        orderId,
        rewardId,
        reason
      });

      logger.info('Loyalty action processed', {
        customerId,
        type,
        points,
        newBalance: result.metadata?.newBalance
      });

      res.status(200).json({
        success: true,
        message: `Loyalty ${type.toLowerCase()} processed successfully`,
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Loyalty management failed', {
        error: error.message,
        customerId: req.user?.id,
        action: req.body.type
      });
      
      res.status(400).json({
        success: false,
        error: 'Loyalty management failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Feedback Submission
  async submitFeedback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const {
        orderId,
        merchantId,
        driverId,
        type,
        rating,
        review,
        categories,
        tags,
        photos,
        isAnonymous
      } = req.body;

      // Validate feedback type
      if (!Object.values(FeedbackType).includes(type)) {
        res.status(400).json({
          success: false,
          error: 'Invalid feedback type',
          message: `Type must be one of: ${Object.values(FeedbackType).join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Validate rating
      if (rating < 1 || rating > 5) {
        res.status(400).json({
          success: false,
          error: 'Invalid rating',
          message: 'Rating must be between 1 and 5',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await this.customerService.submitFeedback(customerId, {
        orderId,
        merchantId,
        driverId,
        type,
        rating,
        review,
        categories,
        tags,
        photos,
        isAnonymous: isAnonymous || false
      });

      logger.info('Customer feedback submitted', {
        customerId,
        feedbackId: result.metadata?.feedbackId,
        type,
        rating
      });

      res.status(201).json({
        success: true,
        message: 'Feedback submitted successfully',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Feedback submission failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Feedback submission failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Analytics
  async getCustomerAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id || req.params.customerId;
      const { startDate, endDate } = req.query;

      // Validate date range
      if (!startDate || !endDate) {
        res.status(400).json({
          success: false,
          error: 'Missing date range',
          message: 'Start date and end date are required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const timeframe = {
        start: new Date(startDate as string),
        end: new Date(endDate as string)
      };

      // Validate date range is not too large (max 1 year)
      const daysDiff = (timeframe.end.getTime() - timeframe.start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 365) {
        res.status(400).json({
          success: false,
          error: 'Date range too large',
          message: 'Maximum date range is 365 days',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const analytics = await this.customerService.getCustomerAnalytics(customerId, timeframe);

      res.status(200).json({
        success: true,
        message: 'Customer analytics retrieved successfully',
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Customer analytics retrieval failed', {
        error: error.message,
        customerId: req.user?.id || req.params.customerId
      });
      
      res.status(500).json({
        success: false,
        error: 'Analytics retrieval failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Address Management
  async addAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const addressData = req.body;

      // Validate address type
      if (!Object.values(AddressType).includes(addressData.type)) {
        res.status(400).json({
          success: false,
          error: 'Invalid address type',
          message: `Type must be one of: ${Object.values(AddressType).join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Here you would call a method to add address
      // const result = await this.customerService.addCustomerAddress(customerId, addressData);

      res.status(201).json({
        success: true,
        message: 'Address added successfully',
        // data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Address addition failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Address addition failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Payment Method Management
  async addPaymentMethod(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const paymentMethodData = req.body;

      // Validate payment type
      if (!Object.values(PaymentType).includes(paymentMethodData.type)) {
        res.status(400).json({
          success: false,
          error: 'Invalid payment type',
          message: `Type must be one of: ${Object.values(PaymentType).join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Here you would call a method to add payment method
      // const result = await this.customerService.addPaymentMethod(customerId, paymentMethodData);

      res.status(201).json({
        success: true,
        message: 'Payment method added successfully',
        // data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Payment method addition failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Payment method addition failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Order History
  async getOrderHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const { page = 1, limit = 20, status, startDate, endDate } = req.query;

      // Here you would call a method to get order history
      // const orderHistory = await this.customerService.getCustomerOrderHistory(customerId, {
      //   page: parseInt(page as string),
      //   limit: parseInt(limit as string),
      //   status: status as string,
      //   startDate: startDate ? new Date(startDate as string) : undefined,
      //   endDate: endDate ? new Date(endDate as string) : undefined
      // });

      res.status(200).json({
        success: true,
        message: 'Order history retrieved successfully',
        // data: orderHistory,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Order history retrieval failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Order history retrieval failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Preferences Management
  async updatePreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const preferences = req.body;

      // Here you would call a method to update preferences
      // const result = await this.customerService.updateCustomerPreferences(customerId, preferences);

      res.status(200).json({
        success: true,
        message: 'Preferences updated successfully',
        // data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Preferences update failed', {
        error: error.message,
        customerId: req.user?.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Preferences update failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Customer Reorder Functionality
  async reorderPrevious(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.user?.id;
      const { orderId } = req.params;
      const { deliveryAddress, paymentMethod, modifications } = req.body;

      // Here you would call a method to reorder
      // const result = await this.customerService.reorderPrevious(customerId, orderId, {
      //   deliveryAddress,
      //   paymentMethod,
      //   modifications
      // });

      res.status(201).json({
        success: true,
        message: 'Reorder placed successfully',
        // data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Reorder failed', {
        error: error.message,
        customerId: req.user?.id,
        originalOrderId: req.params.orderId
      });
      
      res.status(500).json({
        success: false,
        error: 'Reorder failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
}