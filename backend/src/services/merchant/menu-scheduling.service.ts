/**
 * Menu Scheduling Service
 * Manages time-based menu availability, seasonal items, and special menus
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();

interface MenuSchedule {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  type: 'regular' | 'breakfast' | 'lunch' | 'dinner' | 'late_night' | 'weekend' | 'seasonal' | 'special_event';
  status: 'active' | 'scheduled' | 'inactive' | 'archived';
  priority: number; // Higher priority overrides lower when schedules overlap
  startDate?: Date;
  endDate?: Date;
  recurrence?: RecurrencePattern;
  timeSlots: TimeSlot[];
  menuItems: ScheduledMenuItem[];
  overrides?: MenuOverride[];
  createdAt: Date;
  updatedAt: Date;
}

interface RecurrencePattern {
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  daysOfWeek?: number[]; // 0-6, Sunday-Saturday
  datesOfMonth?: number[]; // 1-31
  exceptions?: Date[]; // Dates to skip
}

interface TimeSlot {
  id: string;
  dayOfWeek?: number; // 0-6, null for all days
  startTime: string; // HH:MM format
  endTime: string;
  isActive: boolean;
}

interface ScheduledMenuItem {
  id: string;
  menuItemId: string;
  categoryId: string;
  availabilityStatus: 'available' | 'limited' | 'sold_out' | 'coming_soon';
  price?: number; // Override regular price
  maxQuantity?: number; // Daily limit
  currentQuantity?: number;
  customizations?: MenuCustomization[];
  tags?: string[]; // e.g., 'breakfast-special', 'happy-hour'
}

interface MenuCustomization {
  id: string;
  name: string;
  options: CustomizationOption[];
  required: boolean;
  maxSelections?: number;
}

interface CustomizationOption {
  id: string;
  name: string;
  price?: number;
  available: boolean;
  maxQuantity?: number;
}

interface MenuOverride {
  id: string;
  date: Date;
  reason: string; // e.g., 'holiday', 'special_event', 'maintenance'
  action: 'closed' | 'limited_menu' | 'special_menu';
  affectedItems?: string[]; // Item IDs if limited_menu
  specialMenuId?: string; // If special_menu
}

interface MenuTransition {
  id: string;
  merchantId: string;
  fromScheduleId: string;
  toScheduleId: string;
  transitionTime: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  affectedOrders: string[];
  notifications: TransitionNotification[];
}

interface TransitionNotification {
  type: 'customer' | 'driver' | 'kitchen';
  recipientId: string;
  message: string;
  sentAt: Date;
}

interface MenuPerformance {
  scheduleId: string;
  period: { start: Date; end: Date };
  metrics: {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    topItems: Array<{ itemId: string; quantity: number; revenue: number }>;
    customerSatisfaction: number;
    itemAvailabilityRate: number;
  };
}

export class MenuSchedulingService extends EventEmitter {
  private activeSchedules: Map<string, MenuSchedule> = new Map();
  private scheduleCron: CronJob;

  constructor() {
    super();
    this.initializeScheduler();
  }

  /**
   * Initialize the scheduler
   */
  private initializeScheduler() {
    // Check for menu transitions every minute
    this.scheduleCron = new CronJob('* * * * *', async () => {
      await this.checkAndProcessTransitions();
    });
    this.scheduleCron.start();

    // Load active schedules
    this.loadActiveSchedules();
  }

  /**
   * Create a new menu schedule
   */
  async createMenuSchedule(
    merchantId: string,
    schedule: Omit<MenuSchedule, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MenuSchedule> {
    try {
      // Validate time slots
      this.validateTimeSlots(schedule.timeSlots);

      // Check for conflicts
      const conflicts = await this.checkScheduleConflicts(merchantId, schedule);
      if (conflicts.length > 0) {
        throw new Error(`Schedule conflicts detected: ${conflicts.join(', ')}`);
      }

      // Create schedule
      const newSchedule: MenuSchedule = {
        id: `schedule_${Date.now()}`,
        ...schedule,
        merchantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save to database
      await prisma.menuSchedule.create({
        data: newSchedule,
      });

      // Add to active schedules if applicable
      if (schedule.status === 'active' || schedule.status === 'scheduled') {
        this.activeSchedules.set(newSchedule.id, newSchedule);
      }

      // Emit event
      this.emit('schedule:created', {
        merchantId,
        scheduleId: newSchedule.id,
        type: schedule.type,
      });

      return newSchedule;

    } catch (error) {
      logger.error('Failed to create menu schedule', error);
      throw error;
    }
  }

  /**
   * Update menu schedule
   */
  async updateMenuSchedule(
    scheduleId: string,
    updates: Partial<MenuSchedule>
  ): Promise<MenuSchedule> {
    try {
      const schedule = await prisma.menuSchedule.findUnique({
        where: { id: scheduleId },
      });

      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Validate updates
      if (updates.timeSlots) {
        this.validateTimeSlots(updates.timeSlots);
      }

      // Update schedule
      const updatedSchedule = {
        ...schedule,
        ...updates,
        updatedAt: new Date(),
      };

      await prisma.menuSchedule.update({
        where: { id: scheduleId },
        data: updatedSchedule,
      });

      // Update active schedules
      if (this.activeSchedules.has(scheduleId)) {
        this.activeSchedules.set(scheduleId, updatedSchedule);
      }

      // Notify affected parties if schedule is active
      if (schedule.status === 'active') {
        await this.notifyScheduleUpdate(updatedSchedule);
      }

      return updatedSchedule;

    } catch (error) {
      logger.error('Failed to update menu schedule', error);
      throw error;
    }
  }

  /**
   * Get current active menu for a merchant
   */
  async getCurrentMenu(merchantId: string): Promise<{
    schedule: MenuSchedule;
    availableItems: ScheduledMenuItem[];
    nextTransition?: Date;
  } | null> {
    try {
      const now = new Date();
      const currentDay = now.getDay();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      // Get all active schedules for merchant
      const activeSchedules = await prisma.menuSchedule.findMany({
        where: {
          merchantId,
          status: 'active',
          OR: [
            { startDate: null },
            { startDate: { lte: now } },
          ],
          AND: [
            { endDate: null },
            { endDate: { gte: now } },
          ],
        },
        orderBy: { priority: 'desc' },
      });

      // Find applicable schedule
      for (const schedule of activeSchedules) {
        // Check if schedule applies today
        if (!this.isScheduleActiveNow(schedule, now)) {
          continue;
        }

        // Check time slots
        const activeSlot = schedule.timeSlots.find(slot => {
          if (!slot.isActive) return false;
          if (slot.dayOfWeek !== null && slot.dayOfWeek !== currentDay) return false;
          return this.isTimeInSlot(currentTime, slot.startTime, slot.endTime);
        });

        if (activeSlot) {
          // Get available items
          const availableItems = await this.getAvailableItems(schedule);

          // Find next transition
          const nextTransition = this.findNextTransition(schedule, now);

          return {
            schedule,
            availableItems,
            nextTransition,
          };
        }
      }

      return null;

    } catch (error) {
      logger.error('Failed to get current menu', error);
      throw error;
    }
  }

  /**
   * Schedule a menu override
   */
  async scheduleOverride(
    merchantId: string,
    override: {
      date: Date;
      reason: string;
      action: MenuOverride['action'];
      affectedItems?: string[];
      specialMenuId?: string;
    }
  ): Promise<void> {
    try {
      // Find schedules affected by this date
      const affectedSchedules = await prisma.menuSchedule.findMany({
        where: {
          merchantId,
          status: { in: ['active', 'scheduled'] },
        },
      });

      // Add override to each affected schedule
      for (const schedule of affectedSchedules) {
        const overrideData: MenuOverride = {
          id: `override_${Date.now()}`,
          ...override,
        };

        schedule.overrides = schedule.overrides || [];
        schedule.overrides.push(overrideData);

        await prisma.menuSchedule.update({
          where: { id: schedule.id },
          data: {
            overrides: schedule.overrides,
          },
        });
      }

      // Notify customers if override is for today or tomorrow
      const daysDiff = Math.floor((override.date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysDiff <= 1) {
        await this.notifyUpcomingOverride(merchantId, override);
      }

    } catch (error) {
      logger.error('Failed to schedule override', error);
      throw error;
    }
  }

  /**
   * Get menu schedule analytics
   */
  async getScheduleAnalytics(
    scheduleId: string,
    startDate: Date,
    endDate: Date
  ): Promise<MenuPerformance> {
    try {
      const schedule = await prisma.menuSchedule.findUnique({
        where: { id: scheduleId },
      });

      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Get orders during this schedule's active periods
      const orders = await prisma.order.findMany({
        where: {
          merchantId: schedule.merchantId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          // Additional filtering based on schedule times would go here
        },
        include: {
          items: true,
          review: true,
        },
      });

      // Calculate metrics
      const metrics = {
        totalOrders: orders.length,
        totalRevenue: orders.reduce((sum, order) => sum + order.total, 0),
        averageOrderValue: orders.length > 0 ? 
          orders.reduce((sum, order) => sum + order.total, 0) / orders.length : 0,
        topItems: this.calculateTopItems(orders),
        customerSatisfaction: this.calculateSatisfaction(orders),
        itemAvailabilityRate: await this.calculateAvailabilityRate(schedule, startDate, endDate),
      };

      return {
        scheduleId,
        period: { start: startDate, end: endDate },
        metrics,
      };

    } catch (error) {
      logger.error('Failed to get schedule analytics', error);
      throw error;
    }
  }

  /**
   * Preview schedule changes
   */
  async previewScheduleChanges(
    merchantId: string,
    newSchedule: Partial<MenuSchedule>,
    previewDays: number = 7
  ): Promise<{
    affectedTimeSlots: Array<{
      date: Date;
      currentMenu?: string;
      newMenu: string;
      impactedHours: number;
    }>;
    estimatedOrderImpact: number;
    conflicts: string[];
  }> {
    try {
      const startDate = new Date();
      const endDate = new Date(Date.now() + previewDays * 24 * 60 * 60 * 1000);
      
      const affectedTimeSlots: Array<{
        date: Date;
        currentMenu?: string;
        newMenu: string;
        impactedHours: number;
      }> = [];

      // Simulate each day
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const currentMenu = await this.getCurrentMenu(merchantId);
        
        // Check if new schedule would be active
        if (this.wouldScheduleBeActive(newSchedule, d)) {
          affectedTimeSlots.push({
            date: new Date(d),
            currentMenu: currentMenu?.schedule.name,
            newMenu: newSchedule.name || 'New Schedule',
            impactedHours: this.calculateImpactedHours(newSchedule.timeSlots || []),
          });
        }
      }

      // Estimate order impact based on historical data
      const estimatedOrderImpact = await this.estimateOrderImpact(
        merchantId,
        affectedTimeSlots
      );

      // Check for conflicts
      const conflicts = await this.checkScheduleConflicts(merchantId, newSchedule);

      return {
        affectedTimeSlots,
        estimatedOrderImpact,
        conflicts,
      };

    } catch (error) {
      logger.error('Failed to preview schedule changes', error);
      throw error;
    }
  }

  /**
   * Duplicate a menu schedule
   */
  async duplicateSchedule(
    scheduleId: string,
    modifications?: Partial<MenuSchedule>
  ): Promise<MenuSchedule> {
    try {
      const originalSchedule = await prisma.menuSchedule.findUnique({
        where: { id: scheduleId },
      });

      if (!originalSchedule) {
        throw new Error('Schedule not found');
      }

      const duplicatedSchedule = {
        ...originalSchedule,
        id: `schedule_${Date.now()}`,
        name: `${originalSchedule.name} (Copy)`,
        status: 'inactive' as const,
        ...modifications,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await prisma.menuSchedule.create({
        data: duplicatedSchedule,
      });

      return duplicatedSchedule;

    } catch (error) {
      logger.error('Failed to duplicate schedule', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async loadActiveSchedules(): Promise<void> {
    const schedules = await prisma.menuSchedule.findMany({
      where: {
        status: { in: ['active', 'scheduled'] },
      },
    });

    schedules.forEach(schedule => {
      this.activeSchedules.set(schedule.id, schedule);
    });
  }

  private async checkAndProcessTransitions(): Promise<void> {
    const now = new Date();

    for (const [scheduleId, schedule] of this.activeSchedules) {
      // Check if schedule should become active
      if (schedule.status === 'scheduled' && schedule.startDate && schedule.startDate <= now) {
        await this.activateSchedule(scheduleId);
      }

      // Check if schedule should become inactive
      if (schedule.status === 'active' && schedule.endDate && schedule.endDate <= now) {
        await this.deactivateSchedule(scheduleId);
      }

      // Check for time slot transitions
      if (schedule.status === 'active') {
        await this.checkTimeSlotTransitions(schedule);
      }
    }
  }

  private async activateSchedule(scheduleId: string): Promise<void> {
    try {
      const schedule = this.activeSchedules.get(scheduleId);
      if (!schedule) return;

      // Create transition record
      const transition: MenuTransition = {
        id: `transition_${Date.now()}`,
        merchantId: schedule.merchantId,
        fromScheduleId: 'none',
        toScheduleId: scheduleId,
        transitionTime: new Date(),
        status: 'in_progress',
        affectedOrders: [],
        notifications: [],
      };

      // Update schedule status
      schedule.status = 'active';
      await prisma.menuSchedule.update({
        where: { id: scheduleId },
        data: { status: 'active' },
      });

      // Notify relevant parties
      await this.processMenuTransition(transition);

      this.emit('schedule:activated', {
        scheduleId,
        merchantId: schedule.merchantId,
      });

    } catch (error) {
      logger.error('Failed to activate schedule', error);
    }
  }

  private async deactivateSchedule(scheduleId: string): Promise<void> {
    try {
      const schedule = this.activeSchedules.get(scheduleId);
      if (!schedule) return;

      schedule.status = 'inactive';
      await prisma.menuSchedule.update({
        where: { id: scheduleId },
        data: { status: 'inactive' },
      });

      this.activeSchedules.delete(scheduleId);

      this.emit('schedule:deactivated', {
        scheduleId,
        merchantId: schedule.merchantId,
      });

    } catch (error) {
      logger.error('Failed to deactivate schedule', error);
    }
  }

  private validateTimeSlots(timeSlots: TimeSlot[]): void {
    for (const slot of timeSlots) {
      // Validate time format
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(slot.startTime) || !timeRegex.test(slot.endTime)) {
        throw new Error('Invalid time format. Use HH:MM');
      }

      // Validate end time is after start time
      if (slot.startTime >= slot.endTime) {
        throw new Error('End time must be after start time');
      }
    }

    // Check for overlapping slots on same day
    for (let i = 0; i < timeSlots.length; i++) {
      for (let j = i + 1; j < timeSlots.length; j++) {
        if (timeSlots[i].dayOfWeek === timeSlots[j].dayOfWeek) {
          if (this.timeSlotsOverlap(timeSlots[i], timeSlots[j])) {
            throw new Error('Time slots overlap');
          }
        }
      }
    }
  }

  private timeSlotsOverlap(slot1: TimeSlot, slot2: TimeSlot): boolean {
    return !(slot1.endTime <= slot2.startTime || slot2.endTime <= slot1.startTime);
  }

  private async checkScheduleConflicts(
    merchantId: string,
    newSchedule: Partial<MenuSchedule>
  ): Promise<string[]> {
    const conflicts: string[] = [];

    const existingSchedules = await prisma.menuSchedule.findMany({
      where: {
        merchantId,
        status: { in: ['active', 'scheduled'] },
        id: { not: newSchedule.id },
      },
    });

    for (const existing of existingSchedules) {
      // Check priority conflicts
      if (existing.priority === newSchedule.priority) {
        conflicts.push(`Priority ${existing.priority} already used by ${existing.name}`);
      }

      // Check time slot conflicts at same priority
      if (newSchedule.timeSlots && existing.priority === newSchedule.priority) {
        for (const newSlot of newSchedule.timeSlots) {
          for (const existingSlot of existing.timeSlots) {
            if (newSlot.dayOfWeek === existingSlot.dayOfWeek && 
                this.timeSlotsOverlap(newSlot, existingSlot)) {
              conflicts.push(`Time conflict with ${existing.name}`);
            }
          }
        }
      }
    }

    return [...new Set(conflicts)]; // Remove duplicates
  }

  private isScheduleActiveNow(schedule: MenuSchedule, now: Date): boolean {
    // Check date range
    if (schedule.startDate && schedule.startDate > now) return false;
    if (schedule.endDate && schedule.endDate < now) return false;

    // Check overrides
    if (schedule.overrides) {
      const todayOverride = schedule.overrides.find(o => 
        this.isSameDay(o.date, now) && o.action === 'closed'
      );
      if (todayOverride) return false;
    }

    // Check recurrence
    if (schedule.recurrence) {
      return this.matchesRecurrence(schedule.recurrence, now);
    }

    return true;
  }

  private isTimeInSlot(currentTime: string, startTime: string, endTime: string): boolean {
    return currentTime >= startTime && currentTime <= endTime;
  }

  private matchesRecurrence(pattern: RecurrencePattern, date: Date): boolean {
    // Check exceptions
    if (pattern.exceptions) {
      for (const exception of pattern.exceptions) {
        if (this.isSameDay(exception, date)) return false;
      }
    }

    switch (pattern.type) {
      case 'daily':
        return true;
      
      case 'weekly':
        return pattern.daysOfWeek ? 
          pattern.daysOfWeek.includes(date.getDay()) : true;
      
      case 'monthly':
        return pattern.datesOfMonth ? 
          pattern.datesOfMonth.includes(date.getDate()) : true;
      
      default:
        return true;
    }
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.toDateString() === date2.toDateString();
  }

  private async getAvailableItems(schedule: MenuSchedule): Promise<ScheduledMenuItem[]> {
    const availableItems: ScheduledMenuItem[] = [];

    for (const item of schedule.menuItems) {
      // Check quantity limits
      if (item.maxQuantity && item.currentQuantity && 
          item.currentQuantity >= item.maxQuantity) {
        item.availabilityStatus = 'sold_out';
      }

      if (item.availabilityStatus === 'available' || 
          item.availabilityStatus === 'limited') {
        availableItems.push(item);
      }
    }

    return availableItems;
  }

  private findNextTransition(schedule: MenuSchedule, now: Date): Date | undefined {
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.getDay();

    // Find next time slot end for today
    const todaySlots = schedule.timeSlots.filter(slot => 
      slot.isActive && (slot.dayOfWeek === null || slot.dayOfWeek === currentDay)
    );

    for (const slot of todaySlots) {
      if (this.isTimeInSlot(currentTime, slot.startTime, slot.endTime)) {
        const [hours, minutes] = slot.endTime.split(':').map(Number);
        const transition = new Date(now);
        transition.setHours(hours, minutes, 0, 0);
        return transition;
      }
    }

    // Find next day's first slot
    for (let i = 1; i <= 7; i++) {
      const nextDay = (currentDay + i) % 7;
      const nextDaySlots = schedule.timeSlots.filter(slot =>
        slot.isActive && (slot.dayOfWeek === null || slot.dayOfWeek === nextDay)
      );

      if (nextDaySlots.length > 0) {
        const earliestSlot = nextDaySlots.reduce((earliest, slot) =>
          slot.startTime < earliest.startTime ? slot : earliest
        );

        const [hours, minutes] = earliestSlot.startTime.split(':').map(Number);
        const transition = new Date(now);
        transition.setDate(transition.getDate() + i);
        transition.setHours(hours, minutes, 0, 0);
        return transition;
      }
    }

    return undefined;
  }

  private async notifyScheduleUpdate(schedule: MenuSchedule): Promise<void> {
    // Notify merchant
    await notificationService.sendMerchantNotification(
      schedule.merchantId,
      'Menu Schedule Updated',
      `Your ${schedule.name} menu schedule has been updated`,
      {
        type: 'menu_schedule_updated',
        scheduleId: schedule.id,
      }
    );

    // Notify customers with pending orders
    const pendingOrders = await prisma.order.findMany({
      where: {
        merchantId: schedule.merchantId,
        status: { in: ['pending', 'confirmed'] },
      },
    });

    for (const order of pendingOrders) {
      await notificationService.sendCustomerNotification(
        order.customerId,
        'Menu Update',
        'The restaurant menu has been updated. Some items may have changed.',
        {
          type: 'menu_updated',
          orderId: order.id,
        }
      );
    }
  }

  private async notifyUpcomingOverride(
    merchantId: string,
    override: any
  ): Promise<void> {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) return;

    // Get customers who frequently order from this merchant
    const frequentCustomers = await prisma.customer.findMany({
      where: {
        orders: {
          some: {
            merchantId,
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
          },
        },
      },
      take: 100,
    });

    const message = override.action === 'closed' ?
      `${merchant.name} will be closed on ${override.date.toLocaleDateString()} due to ${override.reason}` :
      `${merchant.name} will have a limited menu on ${override.date.toLocaleDateString()}`;

    for (const customer of frequentCustomers) {
      await notificationService.sendCustomerNotification(
        customer.id,
        'Restaurant Schedule Update',
        message,
        {
          type: 'merchant_schedule_override',
          merchantId,
          date: override.date,
        }
      );
    }
  }

  private calculateTopItems(orders: any[]): Array<{ itemId: string; quantity: number; revenue: number }> {
    const itemStats: Record<string, { quantity: number; revenue: number }> = {};

    for (const order of orders) {
      for (const item of order.items) {
        if (!itemStats[item.menuItemId]) {
          itemStats[item.menuItemId] = { quantity: 0, revenue: 0 };
        }
        itemStats[item.menuItemId].quantity += item.quantity;
        itemStats[item.menuItemId].revenue += item.price * item.quantity;
      }
    }

    return Object.entries(itemStats)
      .map(([itemId, stats]) => ({ itemId, ...stats }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }

  private calculateSatisfaction(orders: any[]): number {
    const ordersWithReviews = orders.filter(o => o.review);
    if (ordersWithReviews.length === 0) return 0;

    const totalRating = ordersWithReviews.reduce((sum, order) => 
      sum + order.review.rating, 0
    );

    return totalRating / ordersWithReviews.length;
  }

  private async calculateAvailabilityRate(
    schedule: MenuSchedule,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    // This would track how often items were available vs sold out
    // For now, return a simulated value
    return 0.92; // 92% availability
  }

  private wouldScheduleBeActive(schedule: Partial<MenuSchedule>, date: Date): boolean {
    if (!schedule.timeSlots) return false;
    
    const dayOfWeek = date.getDay();
    return schedule.timeSlots.some(slot => 
      slot.isActive && (slot.dayOfWeek === null || slot.dayOfWeek === dayOfWeek)
    );
  }

  private calculateImpactedHours(timeSlots: TimeSlot[]): number {
    let totalMinutes = 0;

    for (const slot of timeSlots) {
      if (!slot.isActive) continue;

      const [startHours, startMinutes] = slot.startTime.split(':').map(Number);
      const [endHours, endMinutes] = slot.endTime.split(':').map(Number);

      const startTotalMinutes = startHours * 60 + startMinutes;
      const endTotalMinutes = endHours * 60 + endMinutes;

      totalMinutes += endTotalMinutes - startTotalMinutes;
    }

    return totalMinutes / 60;
  }

  private async estimateOrderImpact(
    merchantId: string,
    affectedTimeSlots: any[]
  ): Promise<number> {
    // Get average orders per hour for this merchant
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentOrders = await prisma.order.count({
      where: {
        merchantId,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    const avgOrdersPerHour = recentOrders / (30 * 24);
    
    const totalImpactedHours = affectedTimeSlots.reduce((sum, slot) => 
      sum + slot.impactedHours, 0
    );

    return Math.round(avgOrdersPerHour * totalImpactedHours);
  }

  private async processMenuTransition(transition: MenuTransition): Promise<void> {
    try {
      // Find active orders
      const activeOrders = await prisma.order.findMany({
        where: {
          merchantId: transition.merchantId,
          status: { in: ['pending', 'confirmed', 'preparing'] },
        },
      });

      transition.affectedOrders = activeOrders.map(o => o.id);

      // Notify kitchen staff
      await notificationService.sendWebSocketEvent(
        `merchant_${transition.merchantId}`,
        'menu_transition',
        {
          fromScheduleId: transition.fromScheduleId,
          toScheduleId: transition.toScheduleId,
          affectedOrders: transition.affectedOrders,
        }
      );

      // Update transition status
      transition.status = 'completed';
      await prisma.menuTransition.create({
        data: transition,
      });

    } catch (error) {
      logger.error('Failed to process menu transition', error);
      transition.status = 'failed';
    }
  }

  private async checkTimeSlotTransitions(schedule: MenuSchedule): Promise<void> {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const currentDay = now.getDay();

    // Check if we're transitioning between time slots
    for (const slot of schedule.timeSlots) {
      if (!slot.isActive) continue;
      if (slot.dayOfWeek !== null && slot.dayOfWeek !== currentDay) continue;

      // Check if slot is ending
      if (currentTime === slot.endTime) {
        await this.handleTimeSlotEnd(schedule, slot);
      }

      // Check if slot is starting
      if (currentTime === slot.startTime) {
        await this.handleTimeSlotStart(schedule, slot);
      }
    }
  }

  private async handleTimeSlotEnd(schedule: MenuSchedule, slot: TimeSlot): Promise<void> {
    this.emit('timeslot:ended', {
      scheduleId: schedule.id,
      merchantId: schedule.merchantId,
      slot,
    });
  }

  private async handleTimeSlotStart(schedule: MenuSchedule, slot: TimeSlot): Promise<void> {
    // Reset daily limits for menu items
    for (const item of schedule.menuItems) {
      if (item.maxQuantity) {
        item.currentQuantity = 0;
      }
    }

    await prisma.menuSchedule.update({
      where: { id: schedule.id },
      data: { menuItems: schedule.menuItems },
    });

    this.emit('timeslot:started', {
      scheduleId: schedule.id,
      merchantId: schedule.merchantId,
      slot,
    });
  }
}

// Export singleton instance
export const menuSchedulingService = new MenuSchedulingService();