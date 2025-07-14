import { prisma } from '../utils/prisma';
import { redis } from '../utils/redis';
import { logger } from '../utils/logger';
import { publishMessage } from '../utils/message-queue';
import {
  Customer,
  CustomerPreferences,
  CustomerOrderHistory,
  LoyaltyAccount,
  CustomerSupport,
  CustomerKYC,
  CustomerAnalytics,
  DeliveryAddress,
  PaymentMethod,
  OrderFeedback,
  CustomizationOptions,
  CustomerBusinessCase
} from '../types/customer.types';

export class CustomerService {
  
  // Customer Registration and Onboarding
  async registerCustomer(registrationData: {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    password: string;
    dateOfBirth?: Date;
    referralCode?: string;
    marketingOptIn?: boolean;
    defaultAddress?: DeliveryAddress;
  }): Promise<CustomerBusinessCase> {
    try {
      logger.info('Starting customer registration', { email: registrationData.email });

      // Check if customer exists
      const existingCustomer = await prisma.user.findFirst({
        where: {
          OR: [
            { email: registrationData.email },
            { phone: registrationData.phone }
          ]
        }
      });

      if (existingCustomer) {
        throw new Error('Customer already exists with this email or phone');
      }

      // Create customer account
      const customer = await prisma.user.create({
        data: {
          email: registrationData.email,
          phone: registrationData.phone,
          firstName: registrationData.firstName,
          lastName: registrationData.lastName,
          password: registrationData.password, // Should be hashed
          dateOfBirth: registrationData.dateOfBirth,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          emailVerified: false,
          phoneVerified: false,
          marketingOptIn: registrationData.marketingOptIn || false,
        }
      });

      // Create customer profile
      const customerProfile = await prisma.customerProfile.create({
        data: {
          userId: customer.id,
          totalOrders: 0,
          totalSpent: 0,
          avgOrderValue: 0,
          loyaltyPoints: 0,
          lifetimeValue: 0,
          riskScore: 0,
          satisfactionScore: 5.0,
          preferredCommunication: 'EMAIL',
          accountStatus: 'ACTIVE',
          joinedAt: new Date(),
        }
      });

      // Create loyalty account
      const loyaltyAccount = await prisma.loyaltyAccount.create({
        data: {
          customerId: customer.id,
          points: 100, // Welcome bonus
          tier: 'BRONZE',
          totalEarned: 100,
          totalRedeemed: 0,
          expiringPoints: 0,
          nextTierPoints: 900,
        }
      });

      // Handle referral if provided
      if (registrationData.referralCode) {
        await this.processReferral(customer.id, registrationData.referralCode);
      }

      // Create default address if provided
      if (registrationData.defaultAddress) {
        await this.addCustomerAddress(customer.id, {
          ...registrationData.defaultAddress,
          isDefault: true
        });
      }

      // Set up default preferences
      await this.initializeCustomerPreferences(customer.id);

      // Send welcome notifications
      await this.sendWelcomeNotifications(customer.id);

      // Track registration analytics
      await this.trackCustomerEvent(customer.id, 'REGISTRATION', {
        channel: 'WEB',
        referralCode: registrationData.referralCode,
        marketingOptIn: registrationData.marketingOptIn
      });

      logger.info('Customer registration completed', { 
        customerId: customer.id,
        email: registrationData.email 
      });

      return {
        success: true,
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          status: 'ACTIVE',
          loyaltyPoints: 100
        },
        businessCase: 'CUSTOMER_REGISTRATION',
        metadata: {
          welcomeBonus: 100,
          tier: 'BRONZE',
          referralProcessed: !!registrationData.referralCode
        }
      };

    } catch (error) {
      logger.error('Customer registration failed', {
        error: error.message,
        email: registrationData.email
      });
      throw error;
    }
  }

  // Customer Profile Management
  async updateCustomerProfile(customerId: string, updates: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: Date;
    phone?: string;
    email?: string;
    preferences?: Partial<CustomerPreferences>;
    dietaryRestrictions?: string[];
    allergens?: string[];
  }): Promise<CustomerBusinessCase> {
    try {
      logger.info('Updating customer profile', { customerId });

      // Update basic profile
      const customer = await prisma.user.update({
        where: { id: customerId },
        data: {
          firstName: updates.firstName,
          lastName: updates.lastName,
          dateOfBirth: updates.dateOfBirth,
          phone: updates.phone,
          email: updates.email,
          updatedAt: new Date(),
        }
      });

      // Update preferences if provided
      if (updates.preferences) {
        await this.updateCustomerPreferences(customerId, updates.preferences);
      }

      // Update dietary information
      if (updates.dietaryRestrictions || updates.allergens) {
        await prisma.customerProfile.update({
          where: { userId: customerId },
          data: {
            dietaryRestrictions: updates.dietaryRestrictions || undefined,
            allergens: updates.allergens || undefined,
            updatedAt: new Date(),
          }
        });
      }

      // Clear customer cache
      await redis.del(`customer:${customerId}`);

      // Track profile update
      await this.trackCustomerEvent(customerId, 'PROFILE_UPDATE', {
        fieldsUpdated: Object.keys(updates)
      });

      logger.info('Customer profile updated', { customerId });

      return {
        success: true,
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          status: customer.status
        },
        businessCase: 'PROFILE_UPDATE',
        metadata: {
          fieldsUpdated: Object.keys(updates).length
        }
      };

    } catch (error) {
      logger.error('Profile update failed', {
        error: error.message,
        customerId
      });
      throw error;
    }
  }

  // Customer Discovery and Search Behavior
  async trackCustomerDiscovery(customerId: string, discoveryData: {
    searchQuery?: string;
    location: { latitude: number; longitude: number };
    filters?: any;
    results?: any[];
    clickedItems?: string[];
    sessionId: string;
  }): Promise<CustomerBusinessCase> {
    try {
      // Store search behavior
      await prisma.customerSearchHistory.create({
        data: {
          customerId,
          query: discoveryData.searchQuery,
          location: discoveryData.location,
          filters: discoveryData.filters || {},
          resultCount: discoveryData.results?.length || 0,
          clickedItems: discoveryData.clickedItems || [],
          sessionId: discoveryData.sessionId,
          timestamp: new Date(),
        }
      });

      // Update customer preferences based on search
      await this.learnFromSearchBehavior(customerId, discoveryData);

      // Track location preferences
      await this.updateLocationPreferences(customerId, discoveryData.location);

      return {
        success: true,
        businessCase: 'DISCOVERY_TRACKING',
        metadata: {
          searchQuery: discoveryData.searchQuery,
          locationTracked: true,
          resultCount: discoveryData.results?.length || 0
        }
      };

    } catch (error) {
      logger.error('Discovery tracking failed', {
        error: error.message,
        customerId
      });
      throw error;
    }
  }

  // Order Placement Flow
  async placeOrder(customerId: string, orderData: {
    items: Array<{
      itemId: string;
      quantity: number;
      customizations?: any;
      specialInstructions?: string;
    }>;
    merchantId: string;
    deliveryAddress: DeliveryAddress;
    paymentMethod: PaymentMethod;
    scheduledDelivery?: Date;
    promoCode?: string;
    groupOrderId?: string;
    deliveryInstructions?: string;
    contactlessDelivery?: boolean;
  }): Promise<CustomerBusinessCase> {
    try {
      logger.info('Processing customer order', { customerId, merchantId: orderData.merchantId });

      // Validate customer eligibility
      await this.validateCustomerEligibility(customerId);

      // Validate order items and pricing
      const orderValidation = await this.validateOrderItems(orderData.items, orderData.merchantId);

      // Calculate order totals
      const orderTotals = await this.calculateOrderTotals(orderData, customerId);

      // Process payment authorization
      const paymentAuth = await this.authorizePayment(customerId, orderData.paymentMethod, orderTotals.total);

      // Create order record
      const order = await prisma.order.create({
        data: {
          customerId,
          merchantId: orderData.merchantId,
          status: 'CONFIRMED',
          items: orderData.items,
          deliveryAddress: orderData.deliveryAddress,
          scheduledDelivery: orderData.scheduledDelivery,
          deliveryInstructions: orderData.deliveryInstructions,
          contactlessDelivery: orderData.contactlessDelivery || false,
          subtotal: orderTotals.subtotal,
          taxes: orderTotals.taxes,
          deliveryFee: orderTotals.deliveryFee,
          serviceFee: orderTotals.serviceFee,
          discount: orderTotals.discount,
          total: orderTotals.total,
          paymentMethodId: orderData.paymentMethod.id,
          paymentAuthId: paymentAuth.id,
          promoCode: orderData.promoCode,
          groupOrderId: orderData.groupOrderId,
        }
      });

      // Update customer analytics
      await this.updateCustomerOrderAnalytics(customerId, order);

      // Process loyalty points
      await this.processLoyaltyPoints(customerId, orderTotals.total, 'EARN');

      // Send order confirmation
      await this.sendOrderConfirmation(customerId, order.id);

      // Trigger downstream services
      await this.triggerOrderWorkflow(order.id);

      logger.info('Order placed successfully', { 
        customerId, 
        orderId: order.id 
      });

      return {
        success: true,
        customer: {
          id: customerId,
          status: 'ACTIVE'
        },
        businessCase: 'ORDER_PLACEMENT',
        metadata: {
          orderId: order.id,
          total: orderTotals.total,
          loyaltyPointsEarned: Math.floor(orderTotals.total * 0.1),
          deliveryType: orderData.contactlessDelivery ? 'CONTACTLESS' : 'STANDARD'
        }
      };

    } catch (error) {
      logger.error('Order placement failed', {
        error: error.message,
        customerId,
        merchantId: orderData.merchantId
      });
      throw error;
    }
  }

  // Real-time Order Tracking
  async trackCustomerOrder(customerId: string, orderId: string): Promise<CustomerBusinessCase> {
    try {
      // Get order details
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          customerId
        },
        include: {
          delivery: true,
          driver: true,
          merchant: true
        }
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Get real-time tracking data
      const trackingData = await this.getOrderTrackingData(orderId);

      // Calculate estimated delivery time
      const estimatedDelivery = await this.calculateEstimatedDelivery(orderId);

      // Check for delivery updates
      const updates = await this.getOrderUpdates(orderId);

      // Update customer engagement metrics
      await this.trackCustomerEngagement(customerId, 'ORDER_TRACKING', { orderId });

      return {
        success: true,
        businessCase: 'ORDER_TRACKING',
        metadata: {
          orderId,
          status: order.status,
          estimatedDelivery,
          driverLocation: trackingData?.driverLocation,
          updates: updates.length
        }
      };

    } catch (error) {
      logger.error('Order tracking failed', {
        error: error.message,
        customerId,
        orderId
      });
      throw error;
    }
  }

  // Customer Support and Issue Resolution
  async createSupportTicket(customerId: string, supportData: {
    type: 'ORDER_ISSUE' | 'PAYMENT_ISSUE' | 'DELIVERY_ISSUE' | 'ACCOUNT_ISSUE' | 'GENERAL';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    subject: string;
    description: string;
    orderId?: string;
    category?: string;
    attachments?: string[];
  }): Promise<CustomerBusinessCase> {
    try {
      logger.info('Creating support ticket', { customerId, type: supportData.type });

      // Create support ticket
      const ticket = await prisma.supportTicket.create({
        data: {
          customerId,
          type: supportData.type,
          priority: supportData.priority,
          subject: supportData.subject,
          description: supportData.description,
          orderId: supportData.orderId,
          category: supportData.category,
          status: 'OPEN',
          assignedAgent: null,
          attachments: supportData.attachments || [],
          createdAt: new Date(),
        }
      });

      // Auto-assign based on type and priority
      await this.autoAssignSupportTicket(ticket.id);

      // Send confirmation to customer
      await this.sendSupportTicketConfirmation(customerId, ticket.id);

      // Track support metrics
      await this.trackCustomerEvent(customerId, 'SUPPORT_TICKET_CREATED', {
        ticketId: ticket.id,
        type: supportData.type,
        priority: supportData.priority
      });

      // Trigger urgent escalation if needed
      if (supportData.priority === 'URGENT') {
        await this.escalateUrgentTicket(ticket.id);
      }

      return {
        success: true,
        businessCase: 'SUPPORT_TICKET_CREATION',
        metadata: {
          ticketId: ticket.id,
          type: supportData.type,
          priority: supportData.priority,
          autoAssigned: true
        }
      };

    } catch (error) {
      logger.error('Support ticket creation failed', {
        error: error.message,
        customerId
      });
      throw error;
    }
  }

  // Loyalty and Rewards Management
  async manageLoyaltyProgram(customerId: string, action: {
    type: 'EARN' | 'REDEEM' | 'TRANSFER' | 'EXPIRE';
    points: number;
    orderId?: string;
    rewardId?: string;
    reason?: string;
  }): Promise<CustomerBusinessCase> {
    try {
      const loyaltyAccount = await prisma.loyaltyAccount.findUnique({
        where: { customerId }
      });

      if (!loyaltyAccount) {
        throw new Error('Loyalty account not found');
      }

      let updatedAccount;

      switch (action.type) {
        case 'EARN':
          updatedAccount = await this.earnLoyaltyPoints(customerId, action.points, action.orderId);
          break;
        case 'REDEEM':
          updatedAccount = await this.redeemLoyaltyPoints(customerId, action.points, action.rewardId);
          break;
        case 'TRANSFER':
          updatedAccount = await this.transferLoyaltyPoints(customerId, action.points, action.reason);
          break;
        case 'EXPIRE':
          updatedAccount = await this.expireLoyaltyPoints(customerId, action.points);
          break;
      }

      // Check for tier upgrade
      await this.checkLoyaltyTierUpgrade(customerId);

      return {
        success: true,
        businessCase: 'LOYALTY_MANAGEMENT',
        metadata: {
          action: action.type,
          points: action.points,
          newBalance: updatedAccount.points,
          tier: updatedAccount.tier
        }
      };

    } catch (error) {
      logger.error('Loyalty management failed', {
        error: error.message,
        customerId,
        action: action.type
      });
      throw error;
    }
  }

  // Customer Feedback and Rating
  async submitFeedback(customerId: string, feedbackData: {
    orderId?: string;
    merchantId?: string;
    driverId?: string;
    type: 'ORDER' | 'DELIVERY' | 'MERCHANT' | 'DRIVER' | 'APP';
    rating: number;
    review?: string;
    categories?: string[];
    tags?: string[];
    photos?: string[];
    isAnonymous?: boolean;
  }): Promise<CustomerBusinessCase> {
    try {
      logger.info('Processing customer feedback', { 
        customerId, 
        type: feedbackData.type,
        rating: feedbackData.rating 
      });

      // Create feedback record
      const feedback = await prisma.customerFeedback.create({
        data: {
          customerId,
          orderId: feedbackData.orderId,
          merchantId: feedbackData.merchantId,
          driverId: feedbackData.driverId,
          type: feedbackData.type,
          rating: feedbackData.rating,
          review: feedbackData.review,
          categories: feedbackData.categories || [],
          tags: feedbackData.tags || [],
          photos: feedbackData.photos || [],
          isAnonymous: feedbackData.isAnonymous || false,
          status: 'SUBMITTED',
          isVerified: false,
          helpfulCount: 0,
          createdAt: new Date(),
        }
      });

      // Update customer satisfaction score
      await this.updateCustomerSatisfaction(customerId, feedbackData.rating);

      // Process feedback for merchant/driver ratings
      if (feedbackData.merchantId) {
        await this.updateMerchantRating(feedbackData.merchantId, feedbackData.rating);
      }

      if (feedbackData.driverId) {
        await this.updateDriverRating(feedbackData.driverId, feedbackData.rating);
      }

      // Award loyalty points for feedback
      if (feedbackData.rating >= 4) {
        await this.processLoyaltyPoints(customerId, 10, 'EARN');
      }

      // Check for quality issues
      if (feedbackData.rating <= 2) {
        await this.flagQualityIssue(feedback.id);
      }

      // Send thank you message
      await this.sendFeedbackThankYou(customerId, feedback.id);

      return {
        success: true,
        businessCase: 'FEEDBACK_SUBMISSION',
        metadata: {
          feedbackId: feedback.id,
          type: feedbackData.type,
          rating: feedbackData.rating,
          loyaltyPointsAwarded: feedbackData.rating >= 4 ? 10 : 0
        }
      };

    } catch (error) {
      logger.error('Feedback submission failed', {
        error: error.message,
        customerId
      });
      throw error;
    }
  }

  // Customer Analytics and Insights
  async getCustomerAnalytics(customerId: string, timeframe: {
    start: Date;
    end: Date;
  }): Promise<CustomerAnalytics> {
    try {
      const analytics = await prisma.customerAnalytics.findFirst({
        where: {
          customerId,
          period: 'CUSTOM',
          startDate: timeframe.start,
          endDate: timeframe.end
        }
      });

      if (analytics) {
        return analytics;
      }

      // Generate analytics
      const customerAnalytics = await this.generateCustomerAnalytics(customerId, timeframe);

      // Cache analytics
      await redis.setex(
        `customer:analytics:${customerId}:${timeframe.start.getTime()}-${timeframe.end.getTime()}`,
        3600, // 1 hour
        JSON.stringify(customerAnalytics)
      );

      return customerAnalytics;

    } catch (error) {
      logger.error('Customer analytics failed', {
        error: error.message,
        customerId
      });
      throw error;
    }
  }

  // Helper Methods

  private async initializeCustomerPreferences(customerId: string): Promise<void> {
    await prisma.customerPreferences.create({
      data: {
        customerId,
        notifications: {
          orderUpdates: true,
          promotions: true,
          loyaltyUpdates: true,
          newsletter: false
        },
        delivery: {
          defaultTip: 15,
          contactlessPreferred: false,
          leaveAtDoor: false,
          ringDoorbell: true
        },
        dietary: {
          restrictions: [],
          allergens: [],
          preferences: []
        },
        communication: {
          preferredChannel: 'EMAIL',
          language: 'en',
          timezone: 'UTC'
        }
      }
    });
  }

  private async processReferral(customerId: string, referralCode: string): Promise<void> {
    const referrer = await prisma.user.findFirst({
      where: { referralCode }
    });

    if (referrer) {
      // Award referral bonus
      await this.processLoyaltyPoints(referrer.id, 500, 'EARN');
      await this.processLoyaltyPoints(customerId, 200, 'EARN');

      // Track referral
      await prisma.referral.create({
        data: {
          referrerId: referrer.id,
          referredId: customerId,
          code: referralCode,
          status: 'COMPLETED',
          referrerBonus: 500,
          referredBonus: 200,
          completedAt: new Date()
        }
      });
    }
  }

  private async trackCustomerEvent(customerId: string, event: string, metadata: any): Promise<void> {
    await publishMessage('customer.events', {
      customerId,
      event,
      metadata,
      timestamp: new Date()
    });

    // Store in analytics
    await prisma.customerEvent.create({
      data: {
        customerId,
        eventType: event,
        eventData: metadata,
        timestamp: new Date()
      }
    });
  }

  private async validateCustomerEligibility(customerId: string): Promise<void> {
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: { customerProfile: true }
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    if (customer.status !== 'ACTIVE') {
      throw new Error('Customer account is not active');
    }

    if (customer.customerProfile?.accountStatus === 'SUSPENDED') {
      throw new Error('Customer account is suspended');
    }
  }

  private async sendWelcomeNotifications(customerId: string): Promise<void> {
    await publishMessage('notifications.send', {
      customerId,
      type: 'WELCOME_EMAIL',
      template: 'customer_welcome',
      priority: 'HIGH'
    });

    await publishMessage('notifications.send', {
      customerId,
      type: 'WELCOME_SMS',
      template: 'welcome_sms',
      priority: 'MEDIUM'
    });
  }

  // Additional helper methods would continue here...
  // This is a comprehensive foundation for customer business logic
}