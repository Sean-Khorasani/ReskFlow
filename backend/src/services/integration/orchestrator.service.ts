import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import axios from 'axios';
import { integrationConfig, getServiceUrl, getWebSocketEvent } from '../../config/integration.config';
import { logger } from '../../utils/logger';
import { io } from 'socket.io-client';

interface FlowContext {
  flowId: string;
  flowType: string;
  startTime: Date;
  currentStep: string;
  data: Record<string, any>;
  errors: Array<{ step: string; error: string; timestamp: Date }>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export class IntegrationOrchestrator extends EventEmitter {
  private redis: Redis;
  private flowContexts: Map<string, FlowContext> = new Map();
  private socketClients: Map<string, any> = new Map();

  constructor() {
    super();
    this.redis = new Redis(integrationConfig.messageQueue.redis.url);
    this.initializeSocketClients();
    this.setupEventListeners();
  }

  private initializeSocketClients() {
    // Initialize WebSocket clients for each namespace
    Object.entries(integrationConfig.websocket.namespaces).forEach(([key, namespace]) => {
      const client = io(`http://localhost:${integrationConfig.websocket.port}${namespace}`);
      this.socketClients.set(key, client);
    });
  }

  private setupEventListeners() {
    // Listen for order events
    this.on('order:created', this.handleOrderCreated.bind(this));
    this.on('order:accepted', this.handleOrderAccepted.bind(this));
    this.on('order:ready', this.handleOrderReady.bind(this));
    this.on('order:delivered', this.handleOrderDelivered.bind(this));
    
    // Listen for payment events
    this.on('payment:processed', this.handlePaymentProcessed.bind(this));
    this.on('payment:failed', this.handlePaymentFailed.bind(this));
    
    // Listen for reskflow events
    this.on('driver:assigned', this.handleDriverAssigned.bind(this));
    this.on('reskflow:completed', this.handleDeliveryCompleted.bind(this));
  }

  /**
   * Start a new integration flow
   */
  async startFlow(flowType: string, initialData: Record<string, any>): Promise<string> {
    const flowId = this.generateFlowId();
    const context: FlowContext = {
      flowId,
      flowType,
      startTime: new Date(),
      currentStep: 'initialized',
      data: initialData,
      errors: [],
      status: 'pending',
    };

    this.flowContexts.set(flowId, context);
    await this.saveFlowContext(context);

    // Start the appropriate flow
    switch (flowType) {
      case 'customer_order':
        await this.executeCustomerOrderFlow(context);
        break;
      case 'driver_assignment':
        await this.executeDriverAssignmentFlow(context);
        break;
      case 'payment_processing':
        await this.executePaymentFlow(context);
        break;
      case 'refund_processing':
        await this.executeRefundFlow(context);
        break;
      default:
        throw new Error(`Unknown flow type: ${flowType}`);
    }

    return flowId;
  }

  /**
   * Execute Customer Order Flow
   */
  private async executeCustomerOrderFlow(context: FlowContext) {
    try {
      context.status = 'in_progress';
      
      // Step 1: Validate order data
      await this.updateFlowStep(context, 'validating_order');
      const validationResult = await this.validateOrder(context.data);
      if (!validationResult.valid) {
        throw new Error(`Order validation failed: ${validationResult.error}`);
      }

      // Step 2: Process payment
      await this.updateFlowStep(context, 'processing_payment');
      const paymentResult = await this.processPayment(context.data);
      context.data.paymentId = paymentResult.paymentId;
      context.data.transactionId = paymentResult.transactionId;

      // Step 3: Create order
      await this.updateFlowStep(context, 'creating_order');
      const orderResult = await this.createOrder(context.data);
      context.data.orderId = orderResult.orderId;

      // Step 4: Notify merchant
      await this.updateFlowStep(context, 'notifying_merchant');
      await this.notifyMerchant(orderResult);

      // Step 5: Send customer confirmation
      await this.updateFlowStep(context, 'sending_confirmation');
      await this.sendOrderConfirmation(context.data);

      // Step 6: Record on blockchain
      if (context.data.useBlockchain) {
        await this.updateFlowStep(context, 'recording_blockchain');
        await this.recordOnBlockchain(orderResult);
      }

      // Mark flow as completed
      context.status = 'completed';
      await this.saveFlowContext(context);
      
      // Emit completion event
      this.emit('flow:completed', { flowId: context.flowId, flowType: context.flowType });

    } catch (error: any) {
      context.errors.push({
        step: context.currentStep,
        error: error.message,
        timestamp: new Date(),
      });
      context.status = 'failed';
      await this.saveFlowContext(context);
      
      // Rollback if needed
      await this.rollbackFlow(context);
      
      // Emit failure event
      this.emit('flow:failed', { flowId: context.flowId, error: error.message });
      throw error;
    }
  }

  /**
   * Execute Driver Assignment Flow
   */
  private async executeDriverAssignmentFlow(context: FlowContext) {
    try {
      context.status = 'in_progress';
      
      // Step 1: Find optimal drivers
      await this.updateFlowStep(context, 'finding_drivers');
      const drivers = await this.findOptimalDrivers(context.data);
      
      if (drivers.length === 0) {
        throw new Error('No available drivers found');
      }

      // Step 2: Send assignment requests
      await this.updateFlowStep(context, 'sending_requests');
      const assignmentResult = await this.sendDriverRequests(drivers, context.data);
      
      // Step 3: Wait for acceptance
      await this.updateFlowStep(context, 'waiting_acceptance');
      const acceptedDriver = await this.waitForDriverAcceptance(assignmentResult.requestId);
      
      if (!acceptedDriver) {
        throw new Error('No driver accepted the reskflow');
      }

      // Step 4: Confirm assignment
      await this.updateFlowStep(context, 'confirming_assignment');
      await this.confirmDriverAssignment(acceptedDriver, context.data);
      
      // Step 5: Enable tracking
      await this.updateFlowStep(context, 'enabling_tracking');
      await this.enableDeliveryTracking(context.data.orderId, acceptedDriver.driverId);
      
      // Step 6: Notify customer
      await this.updateFlowStep(context, 'notifying_customer');
      await this.notifyCustomerDriverAssigned(context.data, acceptedDriver);

      context.status = 'completed';
      await this.saveFlowContext(context);

    } catch (error: any) {
      context.errors.push({
        step: context.currentStep,
        error: error.message,
        timestamp: new Date(),
      });
      context.status = 'failed';
      await this.saveFlowContext(context);
      throw error;
    }
  }

  /**
   * Execute Payment Flow
   */
  private async executePaymentFlow(context: FlowContext) {
    try {
      context.status = 'in_progress';
      
      // Step 1: Validate payment method
      await this.updateFlowStep(context, 'validating_payment_method');
      await this.validatePaymentMethod(context.data);

      // Step 2: Check balance/authorization
      await this.updateFlowStep(context, 'checking_authorization');
      await this.checkPaymentAuthorization(context.data);

      // Step 3: Process transaction
      await this.updateFlowStep(context, 'processing_transaction');
      const transactionResult = await this.processTransaction(context.data);
      
      // Step 4: Create blockchain escrow (if applicable)
      if (context.data.useBlockchain) {
        await this.updateFlowStep(context, 'creating_escrow');
        await this.createBlockchainEscrow(transactionResult);
      }

      // Step 5: Update order status
      await this.updateFlowStep(context, 'updating_order');
      await this.updateOrderPaymentStatus(context.data.orderId, 'paid');

      // Step 6: Send receipt
      await this.updateFlowStep(context, 'sending_receipt');
      await this.sendPaymentReceipt(context.data);

      context.status = 'completed';
      await this.saveFlowContext(context);

    } catch (error: any) {
      context.errors.push({
        step: context.currentStep,
        error: error.message,
        timestamp: new Date(),
      });
      context.status = 'failed';
      await this.saveFlowContext(context);
      
      // Attempt payment reversal
      await this.reversePayment(context);
      throw error;
    }
  }

  /**
   * Event Handlers
   */
  private async handleOrderCreated(data: any) {
    logger.info('Order created event received', { orderId: data.orderId });
    
    // Broadcast to relevant WebSocket clients
    this.socketClients.get('merchant')?.emit(getWebSocketEvent('orderCreated'), data);
    this.socketClients.get('admin')?.emit(getWebSocketEvent('orderCreated'), data);
    
    // Start driver assignment flow
    await this.startFlow('driver_assignment', {
      orderId: data.orderId,
      merchantId: data.merchantId,
      reskflowLocation: data.reskflowLocation,
    });
  }

  private async handleOrderAccepted(data: any) {
    logger.info('Order accepted event received', { orderId: data.orderId });
    
    // Notify customer
    this.socketClients.get('customer')?.emit(getWebSocketEvent('orderAccepted'), data);
    
    // Update analytics
    await this.updateAnalytics('order_accepted', data);
  }

  private async handleOrderReady(data: any) {
    logger.info('Order ready event received', { orderId: data.orderId });
    
    // Notify driver
    this.socketClients.get('driver')?.emit(getWebSocketEvent('orderReady'), data);
    
    // Send push notification to driver
    await this.sendPushNotification(data.driverId, 'Order is ready for pickup!');
  }

  private async handleOrderDelivered(data: any) {
    logger.info('Order delivered event received', { orderId: data.orderId });
    
    // Process payment distribution
    await this.startFlow('payment_distribution', {
      orderId: data.orderId,
      amount: data.amount,
      merchantId: data.merchantId,
      driverId: data.driverId,
    });
    
    // Update customer loyalty points
    await this.updateLoyaltyPoints(data.customerId, data.amount);
  }

  private async handlePaymentProcessed(data: any) {
    logger.info('Payment processed event received', { paymentId: data.paymentId });
    
    // Update order status
    await this.updateOrderPaymentStatus(data.orderId, 'paid');
    
    // Record on blockchain
    if (data.useBlockchain) {
      await this.recordPaymentOnBlockchain(data);
    }
  }

  private async handlePaymentFailed(data: any) {
    logger.error('Payment failed event received', { paymentId: data.paymentId });
    
    // Cancel order
    await this.cancelOrder(data.orderId, 'Payment failed');
    
    // Notify customer
    await this.notifyCustomerPaymentFailed(data);
  }

  private async handleDriverAssigned(data: any) {
    logger.info('Driver assigned event received', { orderId: data.orderId });
    
    // Enable real-time tracking
    await this.enableDeliveryTracking(data.orderId, data.driverId);
    
    // Notify all parties
    await this.notifyDriverAssignment(data);
  }

  private async handleDeliveryCompleted(data: any) {
    logger.info('Delivery completed event received', { orderId: data.orderId });
    
    // Process final payment distribution
    await this.distributePayments(data);
    
    // Request customer feedback
    await this.requestCustomerFeedback(data);
  }

  /**
   * Helper Methods
   */
  private generateFlowId(): string {
    return `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async updateFlowStep(context: FlowContext, step: string) {
    context.currentStep = step;
    await this.saveFlowContext(context);
    logger.info(`Flow ${context.flowId} - Step: ${step}`);
  }

  private async saveFlowContext(context: FlowContext) {
    await this.redis.set(
      `flow:${context.flowId}`,
      JSON.stringify(context),
      'EX',
      86400 // 24 hours
    );
    this.flowContexts.set(context.flowId, context);
  }

  private async rollbackFlow(context: FlowContext) {
    logger.warn(`Rolling back flow ${context.flowId}`);
    
    // Implement rollback logic based on the current step
    switch (context.currentStep) {
      case 'processing_payment':
        await this.reversePayment(context);
        break;
      case 'creating_order':
        await this.cancelOrder(context.data.orderId, 'Flow failed');
        break;
      // Add more rollback cases as needed
    }
  }

  // Service integration methods
  private async validateOrder(orderData: any): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await axios.post(getServiceUrl('order', 'validate'), orderData);
      return response.data;
    } catch (error: any) {
      logger.error('Order validation failed', error);
      return { valid: false, error: error.message };
    }
  }

  private async processPayment(paymentData: any): Promise<any> {
    const response = await axios.post(getServiceUrl('payment', 'process'), paymentData);
    return response.data;
  }

  private async createOrder(orderData: any): Promise<any> {
    const response = await axios.post(getServiceUrl('order', 'create'), orderData);
    return response.data;
  }

  private async notifyMerchant(orderData: any): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendPush'), {
      userId: orderData.merchantId,
      title: 'New Order',
      message: `You have a new order #${orderData.orderId}`,
      data: orderData,
    });
  }

  private async sendOrderConfirmation(orderData: any): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendEmail'), {
      to: orderData.customerEmail,
      subject: 'Order Confirmation',
      template: 'order_confirmation',
      data: orderData,
    });
  }

  private async recordOnBlockchain(orderData: any): Promise<void> {
    await axios.post(getServiceUrl('blockchain', 'recordOrder'), orderData);
  }

  private async findOptimalDrivers(criteria: any): Promise<any[]> {
    const response = await axios.post(getServiceUrl('reskflow', 'findDrivers'), criteria);
    return response.data.drivers;
  }

  private async sendDriverRequests(drivers: any[], reskflowData: any): Promise<any> {
    const response = await axios.post(getServiceUrl('reskflow', 'sendRequests'), {
      drivers,
      reskflowData,
    });
    return response.data;
  }

  private async waitForDriverAcceptance(requestId: string): Promise<any> {
    // Implement polling or event-based waiting logic
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Driver acceptance timeout'));
      }, 60000); // 1 minute timeout

      this.once(`driver:accepted:${requestId}`, (driver) => {
        clearTimeout(timeout);
        resolve(driver);
      });
    });
  }

  private async confirmDriverAssignment(driver: any, orderData: any): Promise<void> {
    await axios.post(getServiceUrl('reskflow', 'confirm'), {
      driverId: driver.driverId,
      orderId: orderData.orderId,
    });
  }

  private async enableDeliveryTracking(orderId: string, driverId: string): Promise<void> {
    await axios.post(getServiceUrl('reskflow', 'enableTracking'), {
      orderId,
      driverId,
    });
  }

  private async notifyCustomerDriverAssigned(orderData: any, driver: any): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendPush'), {
      userId: orderData.customerId,
      title: 'Driver Assigned',
      message: `${driver.name} is on the way to pick up your order`,
      data: { orderId: orderData.orderId, driver },
    });
  }

  private async validatePaymentMethod(paymentData: any): Promise<void> {
    const response = await axios.post(getServiceUrl('payment', 'validateMethod'), paymentData);
    if (!response.data.valid) {
      throw new Error('Invalid payment method');
    }
  }

  private async checkPaymentAuthorization(paymentData: any): Promise<void> {
    const response = await axios.post(getServiceUrl('payment', 'checkAuth'), paymentData);
    if (!response.data.authorized) {
      throw new Error('Payment authorization failed');
    }
  }

  private async processTransaction(paymentData: any): Promise<any> {
    const response = await axios.post(getServiceUrl('payment', 'transaction'), paymentData);
    return response.data;
  }

  private async createBlockchainEscrow(transactionData: any): Promise<void> {
    await axios.post(getServiceUrl('blockchain', 'createEscrow'), transactionData);
  }

  private async updateOrderPaymentStatus(orderId: string, status: string): Promise<void> {
    await axios.patch(getServiceUrl('order', 'update', { id: orderId }), {
      paymentStatus: status,
    });
  }

  private async sendPaymentReceipt(paymentData: any): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendEmail'), {
      to: paymentData.customerEmail,
      subject: 'Payment Receipt',
      template: 'payment_receipt',
      data: paymentData,
    });
  }

  private async reversePayment(context: FlowContext): Promise<void> {
    if (context.data.paymentId) {
      await axios.post(getServiceUrl('payment', 'reverse'), {
        paymentId: context.data.paymentId,
        reason: 'Flow failed',
      });
    }
  }

  private async updateAnalytics(event: string, data: any): Promise<void> {
    await axios.post(getServiceUrl('analytics', 'track'), {
      event,
      data,
      timestamp: new Date(),
    });
  }

  private async sendPushNotification(userId: string, message: string): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendPush'), {
      userId,
      message,
    });
  }

  private async updateLoyaltyPoints(customerId: string, amount: number): Promise<void> {
    const points = Math.floor(amount * 0.02); // 2% cashback
    await axios.post(getServiceUrl('user', 'updateLoyalty'), {
      customerId,
      points,
    });
  }

  private async recordPaymentOnBlockchain(paymentData: any): Promise<void> {
    await axios.post(getServiceUrl('blockchain', 'recordPayment'), paymentData);
  }

  private async cancelOrder(orderId: string, reason: string): Promise<void> {
    await axios.post(getServiceUrl('order', 'cancel', { id: orderId }), {
      reason,
    });
  }

  private async notifyCustomerPaymentFailed(data: any): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendEmail'), {
      to: data.customerEmail,
      subject: 'Payment Failed',
      template: 'payment_failed',
      data,
    });
  }

  private async notifyDriverAssignment(data: any): Promise<void> {
    // Notify customer, merchant, and driver
    await Promise.all([
      this.notifyCustomerDriverAssigned(data, data.driver),
      axios.post(getServiceUrl('notification', 'sendPush'), {
        userId: data.merchantId,
        message: `Driver assigned for order #${data.orderId}`,
      }),
      axios.post(getServiceUrl('notification', 'sendPush'), {
        userId: data.driverId,
        message: `New reskflow assigned: Order #${data.orderId}`,
      }),
    ]);
  }

  private async distributePayments(data: any): Promise<void> {
    await axios.post(getServiceUrl('payment', 'distribute'), {
      orderId: data.orderId,
      amount: data.amount,
      merchantShare: data.amount * 0.85, // 85% to merchant
      driverShare: data.amount * 0.10, // 10% to driver
      platformShare: data.amount * 0.05, // 5% to platform
    });
  }

  private async requestCustomerFeedback(data: any): Promise<void> {
    await axios.post(getServiceUrl('notification', 'sendEmail'), {
      to: data.customerEmail,
      subject: 'How was your experience?',
      template: 'feedback_request',
      data,
    });
  }

  // Public methods for external access
  async getFlowStatus(flowId: string): Promise<FlowContext | null> {
    const cached = await this.redis.get(`flow:${flowId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    return this.flowContexts.get(flowId) || null;
  }

  async retryFlow(flowId: string): Promise<void> {
    const context = await this.getFlowStatus(flowId);
    if (!context) {
      throw new Error(`Flow ${flowId} not found`);
    }

    if (context.status !== 'failed') {
      throw new Error(`Flow ${flowId} is not in failed state`);
    }

    // Reset status and retry
    context.status = 'pending';
    context.errors = [];
    await this.startFlow(context.flowType, context.data);
  }
}

// Export singleton instance
export const orchestrator = new IntegrationOrchestrator();