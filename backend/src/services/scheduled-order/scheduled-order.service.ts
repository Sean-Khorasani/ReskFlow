/**
 * Scheduled/Advance Order Service
 * Manages pre-orders and scheduled deliveries
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { orderService } from '../order/order.service';

const prisma = new PrismaClient();

interface ScheduledOrder {
  id: string;
  customerId: string;
  merchantId: string;
  items: OrderItem[];
  reskflowAddress: string;
  reskflowInstructions?: string;
  scheduledFor: Date;
  paymentMethod: string;
  paymentMethodId?: string;
  status: 'scheduled' | 'processing' | 'placed' | 'cancelled' | 'failed';
  recurringPattern?: RecurringPattern;
  reminderSent: boolean;
  notes?: string;
}

interface OrderItem {
  productId: string;
  quantity: number;
  specialInstructions?: string;
  modifiers?: any[];
}

interface RecurringPattern {
  type: 'daily' | 'weekly' | 'monthly';
  frequency: number; // Every N days/weeks/months
  daysOfWeek?: number[]; // For weekly: 0=Sunday, 1=Monday, etc.
  dayOfMonth?: number; // For monthly
  endDate?: Date;
  maxOccurrences?: number;
  occurrenceCount: number;
}

interface TimeSlot {
  id: string;
  merchantId: string;
  dayOfWeek: number;
  startTime: string; // HH:MM format
  endTime: string;
  maxOrders: number;
  isActive: boolean;
}

export class ScheduledOrderService extends EventEmitter {
  private cronJobs: Map<string, CronJob> = new Map();

  constructor() {
    super();
    this.initializeCronJobs();
  }

  /**
   * Initialize cron jobs for scheduled orders
   */
  private initializeCronJobs() {
    // Check for orders to process every minute
    const processJob = new CronJob('* * * * *', async () => {
      await this.processScheduledOrders();
    });
    processJob.start();

    // Send reminders every 30 minutes
    const reminderJob = new CronJob('*/30 * * * *', async () => {
      await this.sendOrderReminders();
    });
    reminderJob.start();

    // Daily job to create recurring orders
    const recurringJob = new CronJob('0 6 * * *', async () => {
      await this.createRecurringOrders();
    });
    recurringJob.start();
  }

  /**
   * Create a scheduled order
   */
  async createScheduledOrder(customerId: string, orderData: {
    merchantId: string;
    items: OrderItem[];
    reskflowAddress: string;
    reskflowInstructions?: string;
    scheduledFor: Date;
    paymentMethod: string;
    paymentMethodId?: string;
    notes?: string;
    recurring?: {
      type: RecurringPattern['type'];
      frequency: number;
      daysOfWeek?: number[];
      dayOfMonth?: number;
      endDate?: Date;
      maxOccurrences?: number;
    };
  }): Promise<ScheduledOrder> {
    try {
      // Validate scheduled time
      const scheduledTime = new Date(orderData.scheduledFor);
      const now = new Date();
      const minAdvanceTime = 30 * 60 * 1000; // 30 minutes

      if (scheduledTime.getTime() - now.getTime() < minAdvanceTime) {
        throw new Error('Orders must be scheduled at least 30 minutes in advance');
      }

      // Check merchant availability
      const merchant = await prisma.merchant.findUnique({
        where: { id: orderData.merchantId },
      });

      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Validate time slot availability
      await this.validateTimeSlot(orderData.merchantId, scheduledTime);

      // Calculate order pricing
      const pricing = await this.calculateOrderPricing(orderData.items, merchant);

      // Create scheduled order
      const scheduledOrder = await prisma.scheduledOrder.create({
        data: {
          customerId,
          merchantId: orderData.merchantId,
          items: orderData.items,
          reskflowAddress: orderData.reskflowAddress,
          reskflowInstructions: orderData.reskflowInstructions,
          scheduledFor: scheduledTime,
          paymentMethod: orderData.paymentMethod,
          paymentMethodId: orderData.paymentMethodId,
          status: 'scheduled',
          notes: orderData.notes,
          subtotal: pricing.subtotal,
          reskflowFee: pricing.reskflowFee,
          taxes: pricing.taxes,
          total: pricing.total,
          recurringPattern: orderData.recurring ? {
            ...orderData.recurring,
            occurrenceCount: 0,
          } : undefined,
        },
      });

      // Send confirmation
      await this.sendScheduledOrderConfirmation(scheduledOrder);

      // Set up reminder
      this.scheduleReminder(scheduledOrder);

      // Emit event
      this.emit('scheduled_order:created', {
        scheduledOrder,
        customer: await prisma.customer.findUnique({ where: { id: customerId } }),
        merchant,
      });

      logger.info(`Scheduled order created: ${scheduledOrder.id}`, {
        customerId,
        merchantId: orderData.merchantId,
        scheduledFor: scheduledTime,
      });

      return scheduledOrder;

    } catch (error) {
      logger.error('Failed to create scheduled order', error);
      throw error;
    }
  }

  /**
   * Update scheduled order
   */
  async updateScheduledOrder(
    orderId: string,
    customerId: string,
    updates: Partial<{
      items: OrderItem[];
      reskflowAddress: string;
      reskflowInstructions: string;
      scheduledFor: Date;
      notes: string;
    }>
  ): Promise<ScheduledOrder> {
    try {
      const order = await prisma.scheduledOrder.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new Error('Scheduled order not found');
      }

      if (order.customerId !== customerId) {
        throw new Error('Unauthorized');
      }

      if (order.status !== 'scheduled') {
        throw new Error('Cannot update order that is already processing');
      }

      // If rescheduling, validate new time
      if (updates.scheduledFor) {
        const newTime = new Date(updates.scheduledFor);
        const now = new Date();
        const timeDiff = newTime.getTime() - now.getTime();

        if (timeDiff < 30 * 60 * 1000) {
          throw new Error('Orders must be scheduled at least 30 minutes in advance');
        }

        await this.validateTimeSlot(order.merchantId, newTime);
      }

      // If updating items, recalculate pricing
      let pricing;
      if (updates.items) {
        const merchant = await prisma.merchant.findUnique({
          where: { id: order.merchantId },
        });
        pricing = await this.calculateOrderPricing(updates.items, merchant!);
      }

      // Update order
      const updatedOrder = await prisma.scheduledOrder.update({
        where: { id: orderId },
        data: {
          ...updates,
          ...(pricing ? {
            subtotal: pricing.subtotal,
            reskflowFee: pricing.reskflowFee,
            taxes: pricing.taxes,
            total: pricing.total,
          } : {}),
          reminderSent: false, // Reset reminder if time changed
        },
      });

      // Reschedule reminder if time changed
      if (updates.scheduledFor) {
        this.scheduleReminder(updatedOrder);
      }

      // Send update notification
      await notificationService.sendPushNotification(
        customerId,
        'Scheduled Order Updated',
        `Your order scheduled for ${updatedOrder.scheduledFor.toLocaleString()} has been updated`,
        {
          type: 'scheduled_order_updated',
          orderId: updatedOrder.id,
        }
      );

      return updatedOrder;

    } catch (error) {
      logger.error('Failed to update scheduled order', error);
      throw error;
    }
  }

  /**
   * Cancel scheduled order
   */
  async cancelScheduledOrder(orderId: string, customerId: string, reason?: string): Promise<void> {
    try {
      const order = await prisma.scheduledOrder.findUnique({
        where: { id: orderId },
        include: {
          customer: {
            include: { user: true },
          },
          merchant: true,
        },
      });

      if (!order) {
        throw new Error('Scheduled order not found');
      }

      if (order.customerId !== customerId) {
        throw new Error('Unauthorized');
      }

      if (order.status !== 'scheduled') {
        throw new Error('Cannot cancel order that is already processing');
      }

      // Check cancellation policy
      const timeDiff = order.scheduledFor.getTime() - Date.now();
      const minCancellationTime = 60 * 60 * 1000; // 1 hour

      if (timeDiff < minCancellationTime) {
        throw new Error('Orders must be cancelled at least 1 hour before scheduled time');
      }

      // Cancel order
      await prisma.scheduledOrder.update({
        where: { id: orderId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });

      // Cancel reminder
      const cronJob = this.cronJobs.get(orderId);
      if (cronJob) {
        cronJob.stop();
        this.cronJobs.delete(orderId);
      }

      // Send notifications
      await Promise.all([
        // Customer notification
        notificationService.sendEmail(
          order.customer.user.email,
          'scheduled_order_cancelled',
          {
            customerName: order.customer.name,
            scheduledTime: order.scheduledFor,
            merchantName: order.merchant.name,
            reason,
          }
        ),
        // Merchant notification
        notificationService.sendMerchantNotification(
          order.merchantId,
          'Scheduled Order Cancelled',
          `A scheduled order for ${order.scheduledFor.toLocaleString()} has been cancelled`,
          {
            type: 'scheduled_order_cancelled',
            orderId: order.id,
          }
        ),
      ]);

      // Emit event
      this.emit('scheduled_order:cancelled', {
        order,
        reason,
      });

    } catch (error) {
      logger.error('Failed to cancel scheduled order', error);
      throw error;
    }
  }

  /**
   * Process scheduled orders that are due
   */
  private async processScheduledOrders(): Promise<void> {
    try {
      const now = new Date();
      const processingWindow = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes ahead

      // Find orders due for processing
      const dueOrders = await prisma.scheduledOrder.findMany({
        where: {
          status: 'scheduled',
          scheduledFor: {
            lte: processingWindow,
          },
        },
        include: {
          customer: true,
          merchant: true,
        },
      });

      for (const scheduledOrder of dueOrders) {
        try {
          await this.processOrder(scheduledOrder);
        } catch (error) {
          logger.error(`Failed to process scheduled order ${scheduledOrder.id}`, error);
          await this.handleOrderFailure(scheduledOrder, error);
        }
      }

    } catch (error) {
      logger.error('Error in processScheduledOrders', error);
    }
  }

  /**
   * Process a single scheduled order
   */
  private async processOrder(scheduledOrder: any): Promise<void> {
    // Update status
    await prisma.scheduledOrder.update({
      where: { id: scheduledOrder.id },
      data: { status: 'processing' },
    });

    // Check merchant availability
    if (!scheduledOrder.merchant.isOpen) {
      throw new Error('Merchant is closed');
    }

    // Create actual order
    const order = await orderService.createOrder({
      customerId: scheduledOrder.customerId,
      merchantId: scheduledOrder.merchantId,
      items: scheduledOrder.items,
      reskflowAddress: scheduledOrder.reskflowAddress,
      reskflowInstructions: scheduledOrder.reskflowInstructions,
      paymentMethod: scheduledOrder.paymentMethod,
      paymentMethodId: scheduledOrder.paymentMethodId,
      scheduledOrderId: scheduledOrder.id,
      isScheduled: true,
      scheduledFor: scheduledOrder.scheduledFor,
    });

    // Update scheduled order
    await prisma.scheduledOrder.update({
      where: { id: scheduledOrder.id },
      data: {
        status: 'placed',
        placedOrderId: order.id,
        processedAt: new Date(),
      },
    });

    // Handle recurring orders
    if (scheduledOrder.recurringPattern) {
      await this.scheduleNextRecurrence(scheduledOrder);
    }

    // Send notifications
    await notificationService.sendPushNotification(
      scheduledOrder.customerId,
      'Order Placed',
      `Your scheduled order from ${scheduledOrder.merchant.name} has been placed`,
      {
        type: 'scheduled_order_placed',
        orderId: order.id,
        scheduledOrderId: scheduledOrder.id,
      }
    );

    // Emit event
    this.emit('scheduled_order:placed', {
      scheduledOrder,
      order,
    });
  }

  /**
   * Handle order processing failure
   */
  private async handleOrderFailure(scheduledOrder: any, error: any): Promise<void> {
    await prisma.scheduledOrder.update({
      where: { id: scheduledOrder.id },
      data: {
        status: 'failed',
        failureReason: error.message,
        failedAt: new Date(),
      },
    });

    // Notify customer
    await notificationService.sendPushNotification(
      scheduledOrder.customerId,
      'Scheduled Order Failed',
      `Your scheduled order from ${scheduledOrder.merchant.name} could not be placed: ${error.message}`,
      {
        type: 'scheduled_order_failed',
        scheduledOrderId: scheduledOrder.id,
        reason: error.message,
      }
    );
  }

  /**
   * Send order reminders
   */
  private async sendOrderReminders(): Promise<void> {
    try {
      const reminderTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours ahead

      const orders = await prisma.scheduledOrder.findMany({
        where: {
          status: 'scheduled',
          scheduledFor: {
            lte: reminderTime,
            gte: new Date(),
          },
          reminderSent: false,
        },
        include: {
          customer: {
            include: { user: true },
          },
          merchant: true,
        },
      });

      for (const order of orders) {
        await notificationService.sendPushNotification(
          order.customerId,
          'Order Reminder',
          `Your order from ${order.merchant.name} is scheduled for ${order.scheduledFor.toLocaleTimeString()}`,
          {
            type: 'scheduled_order_reminder',
            orderId: order.id,
          }
        );

        await prisma.scheduledOrder.update({
          where: { id: order.id },
          data: { reminderSent: true },
        });
      }

    } catch (error) {
      logger.error('Error sending order reminders', error);
    }
  }

  /**
   * Create recurring orders for the day
   */
  private async createRecurringOrders(): Promise<void> {
    try {
      const today = new Date();
      
      const recurringOrders = await prisma.scheduledOrder.findMany({
        where: {
          recurringPattern: { not: null },
          status: 'placed',
        },
      });

      for (const order of recurringOrders) {
        if (this.shouldCreateRecurrence(order, today)) {
          await this.createRecurrenceInstance(order, today);
        }
      }

    } catch (error) {
      logger.error('Error creating recurring orders', error);
    }
  }

  /**
   * Check if recurrence should be created
   */
  private shouldCreateRecurrence(order: any, date: Date): boolean {
    const pattern = order.recurringPattern;
    
    // Check end conditions
    if (pattern.endDate && date > new Date(pattern.endDate)) {
      return false;
    }
    
    if (pattern.maxOccurrences && pattern.occurrenceCount >= pattern.maxOccurrences) {
      return false;
    }

    // Check pattern matching
    switch (pattern.type) {
      case 'daily':
        const daysSinceStart = Math.floor((date.getTime() - order.scheduledFor.getTime()) / (24 * 60 * 60 * 1000));
        return daysSinceStart % pattern.frequency === 0;

      case 'weekly':
        if (pattern.daysOfWeek && !pattern.daysOfWeek.includes(date.getDay())) {
          return false;
        }
        const weeksSinceStart = Math.floor((date.getTime() - order.scheduledFor.getTime()) / (7 * 24 * 60 * 60 * 1000));
        return weeksSinceStart % pattern.frequency === 0;

      case 'monthly':
        if (pattern.dayOfMonth && date.getDate() !== pattern.dayOfMonth) {
          return false;
        }
        return true;

      default:
        return false;
    }
  }

  /**
   * Create recurrence instance
   */
  private async createRecurrenceInstance(originalOrder: any, forDate: Date): Promise<void> {
    // Calculate scheduled time for today
    const originalTime = new Date(originalOrder.scheduledFor);
    const scheduledFor = new Date(forDate);
    scheduledFor.setHours(originalTime.getHours());
    scheduledFor.setMinutes(originalTime.getMinutes());

    // Skip if time has passed
    if (scheduledFor < new Date()) {
      return;
    }

    // Create new scheduled order
    await this.createScheduledOrder(originalOrder.customerId, {
      merchantId: originalOrder.merchantId,
      items: originalOrder.items,
      reskflowAddress: originalOrder.reskflowAddress,
      reskflowInstructions: originalOrder.reskflowInstructions,
      scheduledFor,
      paymentMethod: originalOrder.paymentMethod,
      paymentMethodId: originalOrder.paymentMethodId,
      notes: `Recurring order from ${originalOrder.id}`,
    });

    // Update occurrence count
    await prisma.scheduledOrder.update({
      where: { id: originalOrder.id },
      data: {
        recurringPattern: {
          ...originalOrder.recurringPattern,
          occurrenceCount: originalOrder.recurringPattern.occurrenceCount + 1,
        },
      },
    });
  }

  /**
   * Schedule next recurrence
   */
  private async scheduleNextRecurrence(order: any): Promise<void> {
    // Implementation for scheduling next recurrence
    // This would calculate the next occurrence date and create a new scheduled order
  }

  /**
   * Validate time slot availability
   */
  private async validateTimeSlot(merchantId: string, scheduledTime: Date): Promise<void> {
    const dayOfWeek = scheduledTime.getDay();
    const timeStr = `${scheduledTime.getHours().toString().padStart(2, '0')}:${scheduledTime.getMinutes().toString().padStart(2, '0')}`;

    // Check merchant time slots
    const timeSlot = await prisma.merchantTimeSlot.findFirst({
      where: {
        merchantId,
        dayOfWeek,
        isActive: true,
        startTime: { lte: timeStr },
        endTime: { gte: timeStr },
      },
    });

    if (!timeSlot) {
      throw new Error('Selected time slot is not available');
    }

    // Check capacity
    const existingOrders = await prisma.scheduledOrder.count({
      where: {
        merchantId,
        scheduledFor: {
          gte: new Date(scheduledTime.getTime() - 30 * 60 * 1000), // 30 min window
          lte: new Date(scheduledTime.getTime() + 30 * 60 * 1000),
        },
        status: { in: ['scheduled', 'processing'] },
      },
    });

    if (existingOrders >= timeSlot.maxOrders) {
      throw new Error('Selected time slot is fully booked');
    }
  }

  /**
   * Calculate order pricing
   */
  private async calculateOrderPricing(items: OrderItem[], merchant: any): Promise<any> {
    let subtotal = 0;

    // Get product prices
    const productIds = items.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    const productMap = new Map(products.map(p => [p.id, p]));

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }
      subtotal += product.price * item.quantity;
    }

    const reskflowFee = merchant.reskflowFee || 0;
    const taxes = subtotal * 0.08; // 8% tax
    const total = subtotal + reskflowFee + taxes;

    return { subtotal, reskflowFee, taxes, total };
  }

  /**
   * Schedule reminder for order
   */
  private scheduleReminder(order: ScheduledOrder): void {
    // Cancel existing reminder if any
    const existingJob = this.cronJobs.get(order.id);
    if (existingJob) {
      existingJob.stop();
    }

    // Schedule new reminder for 2 hours before
    const reminderTime = new Date(order.scheduledFor.getTime() - 2 * 60 * 60 * 1000);
    
    if (reminderTime > new Date()) {
      const job = new CronJob(reminderTime, async () => {
        await this.sendOrderReminder(order.id);
      });
      job.start();
      this.cronJobs.set(order.id, job);
    }
  }

  /**
   * Send reminder for specific order
   */
  private async sendOrderReminder(orderId: string): Promise<void> {
    const order = await prisma.scheduledOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        merchant: true,
      },
    });

    if (order && order.status === 'scheduled' && !order.reminderSent) {
      await notificationService.sendPushNotification(
        order.customerId,
        'Order Reminder',
        `Your order from ${order.merchant.name} is scheduled for ${order.scheduledFor.toLocaleTimeString()}`,
        {
          type: 'scheduled_order_reminder',
          orderId: order.id,
        }
      );

      await prisma.scheduledOrder.update({
        where: { id: orderId },
        data: { reminderSent: true },
      });
    }
  }

  /**
   * Send scheduled order confirmation
   */
  private async sendScheduledOrderConfirmation(order: any): Promise<void> {
    const [customer, merchant] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: order.customerId },
        include: { user: true },
      }),
      prisma.merchant.findUnique({
        where: { id: order.merchantId },
      }),
    ]);

    if (customer && merchant) {
      await notificationService.sendEmail(
        customer.user.email,
        'scheduled_order_confirmation',
        {
          customerName: customer.name,
          merchantName: merchant.name,
          scheduledTime: order.scheduledFor,
          items: order.items,
          total: order.total,
          orderId: order.id,
        }
      );
    }
  }

  /**
   * Get customer's scheduled orders
   */
  async getCustomerScheduledOrders(customerId: string, status?: string): Promise<any[]> {
    const where: any = { customerId };
    if (status) {
      where.status = status;
    }

    const orders = await prisma.scheduledOrder.findMany({
      where,
      include: {
        merchant: true,
        placedOrder: true,
      },
      orderBy: { scheduledFor: 'asc' },
    });

    return orders;
  }

  /**
   * Get merchant's scheduled orders
   */
  async getMerchantScheduledOrders(merchantId: string, date?: Date): Promise<any[]> {
    const startOfDay = date ? new Date(date) : new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const orders = await prisma.scheduledOrder.findMany({
      where: {
        merchantId,
        scheduledFor: {
          gte: startOfDay,
          lt: endOfDay,
        },
        status: { in: ['scheduled', 'processing'] },
      },
      include: {
        customer: true,
      },
      orderBy: { scheduledFor: 'asc' },
    });

    return orders;
  }

  /**
   * Get available time slots for merchant
   */
  async getAvailableTimeSlots(merchantId: string, date: Date): Promise<any[]> {
    const dayOfWeek = date.getDay();
    
    // Get merchant's time slots
    const timeSlots = await prisma.merchantTimeSlot.findMany({
      where: {
        merchantId,
        dayOfWeek,
        isActive: true,
      },
      orderBy: { startTime: 'asc' },
    });

    // Check availability for each slot
    const availableSlots = [];
    
    for (const slot of timeSlots) {
      const slotTime = new Date(date);
      const [hours, minutes] = slot.startTime.split(':');
      slotTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      // Skip past times
      if (slotTime < new Date()) {
        continue;
      }

      // Check capacity
      const bookedOrders = await prisma.scheduledOrder.count({
        where: {
          merchantId,
          scheduledFor: {
            gte: new Date(slotTime.getTime() - 30 * 60 * 1000),
            lte: new Date(slotTime.getTime() + 30 * 60 * 1000),
          },
          status: { in: ['scheduled', 'processing'] },
        },
      });

      const availableCapacity = slot.maxOrders - bookedOrders;
      
      if (availableCapacity > 0) {
        availableSlots.push({
          ...slot,
          availableCapacity,
          time: slotTime,
        });
      }
    }

    return availableSlots;
  }

  /**
   * Setup merchant time slots
   */
  async setupMerchantTimeSlots(merchantId: string, slots: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    maxOrders: number;
  }>): Promise<void> {
    // Delete existing slots
    await prisma.merchantTimeSlot.deleteMany({
      where: { merchantId },
    });

    // Create new slots
    await prisma.merchantTimeSlot.createMany({
      data: slots.map(slot => ({
        ...slot,
        merchantId,
        isActive: true,
      })),
    });
  }
}

// Export singleton instance
export const scheduledOrderService = new ScheduledOrderService();