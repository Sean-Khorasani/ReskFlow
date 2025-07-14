/**
 * Shift Scheduling Service
 * Manages driver shift scheduling, availability, and workforce optimization
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();

interface Shift {
  id: string;
  driverId?: string;
  date: Date;
  startTime: string; // HH:MM format
  endTime: string;
  type: 'regular' | 'peak' | 'late_night' | 'weekend' | 'holiday';
  status: 'open' | 'assigned' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  zone?: string;
  minimumDeliveries?: number;
  guaranteedEarnings?: number;
  actualEarnings?: number;
  reskflowCount?: number;
  breakTime?: number; // minutes
  notes?: string;
}

interface ShiftTemplate {
  id: string;
  name: string;
  dayOfWeek: number; // 0-6
  startTime: string;
  endTime: string;
  type: Shift['type'];
  driversNeeded: number;
  zone?: string;
  requirements?: ShiftRequirements;
}

interface ShiftRequirements {
  minRating?: number;
  minDeliveries?: number;
  vehicleTypes?: string[];
  certifications?: string[];
}

interface DriverAvailability {
  id: string;
  driverId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  preferredZones?: string[];
  maxHoursPerDay?: number;
  maxShiftsPerWeek?: number;
}

interface ShiftSwapRequest {
  id: string;
  requesterId: string;
  shiftId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  coveredBy?: string;
  createdAt: Date;
  expiresAt: Date;
}

interface ScheduleOptimization {
  date: Date;
  shifts: Shift[];
  coverage: {
    hour: number;
    required: number;
    scheduled: number;
    shortage: number;
  }[];
  recommendations: string[];
  score: number;
}

export class ShiftSchedulingService extends EventEmitter {
  private cronJobs: Map<string, CronJob> = new Map();

  constructor() {
    super();
    this.initializeCronJobs();
  }

  /**
   * Initialize scheduled jobs
   */
  private initializeCronJobs() {
    // Generate weekly schedule every Sunday at midnight
    const weeklyScheduleJob = new CronJob('0 0 * * 0', async () => {
      await this.generateWeeklySchedule();
    });
    weeklyScheduleJob.start();

    // Send shift reminders
    const reminderJob = new CronJob('0 * * * *', async () => {
      await this.sendShiftReminders();
    });
    reminderJob.start();

    // Check for understaffed shifts
    const coverageJob = new CronJob('*/30 * * * *', async () => {
      await this.checkShiftCoverage();
    });
    coverageJob.start();

    // Process shift swap requests
    const swapJob = new CronJob('*/15 * * * *', async () => {
      await this.processShiftSwapRequests();
    });
    swapJob.start();
  }

  /**
   * Create shift template
   */
  async createShiftTemplate(data: Omit<ShiftTemplate, 'id'>): Promise<ShiftTemplate> {
    try {
      const template = await prisma.shiftTemplate.create({
        data: {
          ...data,
          id: `template_${Date.now()}`,
        },
      });

      logger.info('Shift template created', { templateId: template.id });

      return template;

    } catch (error) {
      logger.error('Failed to create shift template', error);
      throw error;
    }
  }

  /**
   * Generate weekly schedule
   */
  async generateWeeklySchedule(startDate?: Date): Promise<ScheduleOptimization> {
    try {
      const weekStart = startDate || this.getNextWeekStart();
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // Get all shift templates
      const templates = await prisma.shiftTemplate.findMany({
        where: { active: true },
      });

      // Get driver availability
      const availability = await prisma.driverAvailability.findMany({
        include: {
          driver: {
            include: {
              ratings: {
                orderBy: { createdAt: 'desc' },
                take: 10,
              },
            },
          },
        },
      });

      // Get demand forecast
      const demandForecast = await this.getDemandForecast(weekStart, weekEnd);

      // Generate shifts based on templates and demand
      const shifts = await this.generateShiftsFromTemplates(templates, weekStart, demandForecast);

      // Assign drivers to shifts
      const assignedShifts = await this.optimizeShiftAssignments(shifts, availability);

      // Analyze coverage
      const coverage = this.analyzeShiftCoverage(assignedShifts, demandForecast);

      // Generate recommendations
      const recommendations = this.generateScheduleRecommendations(coverage, assignedShifts);

      const optimization: ScheduleOptimization = {
        date: weekStart,
        shifts: assignedShifts,
        coverage,
        recommendations,
        score: this.calculateScheduleScore(coverage),
      };

      // Save schedule
      await this.saveWeeklySchedule(optimization);

      // Notify drivers of new schedule
      await this.notifyDriversOfSchedule(assignedShifts);

      this.emit('schedule:generated', {
        weekStart,
        shiftCount: assignedShifts.length,
        score: optimization.score,
      });

      return optimization;

    } catch (error) {
      logger.error('Failed to generate weekly schedule', error);
      throw error;
    }
  }

  /**
   * Request shift
   */
  async requestShift(driverId: string, shiftId: string): Promise<void> {
    try {
      const [shift, driver] = await Promise.all([
        prisma.shift.findUnique({ where: { id: shiftId } }),
        prisma.driver.findUnique({
          where: { id: driverId },
          include: { ratings: { orderBy: { createdAt: 'desc' }, take: 10 } },
        }),
      ]);

      if (!shift || !driver) {
        throw new Error('Shift or driver not found');
      }

      if (shift.status !== 'open') {
        throw new Error('Shift is not available');
      }

      // Check if driver meets requirements
      const template = await prisma.shiftTemplate.findFirst({
        where: {
          dayOfWeek: shift.date.getDay(),
          startTime: shift.startTime,
          endTime: shift.endTime,
        },
      });

      if (template?.requirements) {
        await this.validateDriverRequirements(driver, template.requirements);
      }

      // Check for conflicts
      await this.checkShiftConflicts(driverId, shift);

      // Assign shift
      await prisma.shift.update({
        where: { id: shiftId },
        data: {
          driverId,
          status: 'assigned',
          assignedAt: new Date(),
        },
      });

      // Send confirmation
      await notificationService.sendDriverNotification(
        driverId,
        'Shift Assigned',
        `You've been assigned a shift on ${shift.date.toLocaleDateString()} from ${shift.startTime} to ${shift.endTime}`,
        {
          type: 'shift_assigned',
          shiftId,
        }
      );

      this.emit('shift:assigned', {
        shiftId,
        driverId,
      });

    } catch (error) {
      logger.error('Failed to request shift', error);
      throw error;
    }
  }

  /**
   * Update driver availability
   */
  async updateDriverAvailability(
    driverId: string,
    availability: Omit<DriverAvailability, 'id' | 'driverId'>[]
  ): Promise<void> {
    try {
      // Delete existing availability
      await prisma.driverAvailability.deleteMany({
        where: { driverId },
      });

      // Create new availability
      await prisma.driverAvailability.createMany({
        data: availability.map(avail => ({
          ...avail,
          driverId,
        })),
      });

      // Regenerate schedule if needed
      const affectedShifts = await prisma.shift.count({
        where: {
          driverId,
          date: { gte: new Date() },
          status: { in: ['assigned', 'confirmed'] },
        },
      });

      if (affectedShifts > 0) {
        await this.reassignAffectedShifts(driverId);
      }

      logger.info('Driver availability updated', { driverId });

    } catch (error) {
      logger.error('Failed to update driver availability', error);
      throw error;
    }
  }

  /**
   * Request shift swap
   */
  async requestShiftSwap(driverId: string, shiftId: string, reason: string): Promise<ShiftSwapRequest> {
    try {
      const shift = await prisma.shift.findUnique({
        where: { id: shiftId },
      });

      if (!shift || shift.driverId !== driverId) {
        throw new Error('Shift not found or not assigned to driver');
      }

      if (shift.status === 'in_progress' || shift.status === 'completed') {
        throw new Error('Cannot swap shift that is in progress or completed');
      }

      // Check if swap request already exists
      const existingRequest = await prisma.shiftSwapRequest.findFirst({
        where: {
          shiftId,
          status: 'pending',
        },
      });

      if (existingRequest) {
        throw new Error('Swap request already pending for this shift');
      }

      // Create swap request
      const swapRequest = await prisma.shiftSwapRequest.create({
        data: {
          requesterId: driverId,
          shiftId,
          reason,
          status: 'pending',
          expiresAt: new Date(shift.date.getTime() - 2 * 60 * 60 * 1000), // 2 hours before shift
        },
      });

      // Notify other eligible drivers
      await this.notifyEligibleDriversForSwap(shift, driverId);

      // Send confirmation to requester
      await notificationService.sendDriverNotification(
        driverId,
        'Shift Swap Requested',
        'Your shift swap request has been posted. We\'ll notify you when someone accepts.',
        {
          type: 'swap_requested',
          swapRequestId: swapRequest.id,
        }
      );

      return swapRequest;

    } catch (error) {
      logger.error('Failed to request shift swap', error);
      throw error;
    }
  }

  /**
   * Accept shift swap
   */
  async acceptShiftSwap(swapRequestId: string, driverId: string): Promise<void> {
    try {
      const swapRequest = await prisma.shiftSwapRequest.findUnique({
        where: { id: swapRequestId },
        include: {
          shift: true,
        },
      });

      if (!swapRequest || swapRequest.status !== 'pending') {
        throw new Error('Swap request not found or not available');
      }

      if (swapRequest.requesterId === driverId) {
        throw new Error('Cannot accept your own swap request');
      }

      // Validate driver can take the shift
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        include: { ratings: { orderBy: { createdAt: 'desc' }, take: 10 } },
      });

      if (!driver) {
        throw new Error('Driver not found');
      }

      // Check for conflicts
      await this.checkShiftConflicts(driverId, swapRequest.shift);

      // Update swap request and shift
      await prisma.$transaction([
        prisma.shiftSwapRequest.update({
          where: { id: swapRequestId },
          data: {
            status: 'approved',
            coveredBy: driverId,
            approvedAt: new Date(),
          },
        }),
        prisma.shift.update({
          where: { id: swapRequest.shiftId },
          data: {
            driverId,
            swappedFrom: swapRequest.requesterId,
          },
        }),
      ]);

      // Notify both drivers
      await Promise.all([
        notificationService.sendDriverNotification(
          swapRequest.requesterId,
          'Shift Swap Approved',
          `${driver.user.name} will cover your shift on ${swapRequest.shift.date.toLocaleDateString()}`,
          {
            type: 'swap_approved',
            swapRequestId,
          }
        ),
        notificationService.sendDriverNotification(
          driverId,
          'Shift Swap Confirmed',
          `You've successfully taken the shift on ${swapRequest.shift.date.toLocaleDateString()}`,
          {
            type: 'swap_confirmed',
            shiftId: swapRequest.shiftId,
          }
        ),
      ]);

    } catch (error) {
      logger.error('Failed to accept shift swap', error);
      throw error;
    }
  }

  /**
   * Clock in for shift
   */
  async clockIn(driverId: string, shiftId: string, location: { lat: number; lng: number }): Promise<void> {
    try {
      const shift = await prisma.shift.findUnique({
        where: { id: shiftId },
      });

      if (!shift || shift.driverId !== driverId) {
        throw new Error('Shift not found or not assigned to driver');
      }

      if (shift.status !== 'assigned' && shift.status !== 'confirmed') {
        throw new Error('Cannot clock in for this shift');
      }

      // Check if within allowed clock-in window (15 minutes before)
      const now = new Date();
      const shiftStart = this.parseShiftTime(shift.date, shift.startTime);
      const earliestClockIn = new Date(shiftStart.getTime() - 15 * 60 * 1000);

      if (now < earliestClockIn) {
        throw new Error('Too early to clock in. You can clock in 15 minutes before your shift.');
      }

      // Update shift
      await prisma.shift.update({
        where: { id: shiftId },
        data: {
          status: 'in_progress',
          actualStartTime: now,
          startLocation: location,
        },
      });

      // Update driver status
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          isOnline: true,
          currentShiftId: shiftId,
        },
      });

      // Send confirmation
      await notificationService.sendDriverNotification(
        driverId,
        'Clocked In',
        'You\'ve successfully clocked in for your shift. Drive safely!',
        {
          type: 'clock_in',
          shiftId,
        }
      );

      this.emit('shift:started', {
        shiftId,
        driverId,
        startTime: now,
      });

    } catch (error) {
      logger.error('Failed to clock in', error);
      throw error;
    }
  }

  /**
   * Clock out from shift
   */
  async clockOut(driverId: string, shiftId: string, location: { lat: number; lng: number }): Promise<any> {
    try {
      const shift = await prisma.shift.findUnique({
        where: { id: shiftId },
        include: {
          deliveries: true,
          earnings: true,
        },
      });

      if (!shift || shift.driverId !== driverId) {
        throw new Error('Shift not found or not assigned to driver');
      }

      if (shift.status !== 'in_progress') {
        throw new Error('Shift is not in progress');
      }

      const now = new Date();

      // Calculate shift metrics
      const actualHours = shift.actualStartTime
        ? (now.getTime() - shift.actualStartTime.getTime()) / (60 * 60 * 1000)
        : 0;

      const totalEarnings = shift.earnings.reduce((sum, e) => sum + e.totalAmount, 0);
      const reskflowCount = shift.deliveries.filter(d => d.status === 'delivered').length;

      // Update shift
      const updatedShift = await prisma.shift.update({
        where: { id: shiftId },
        data: {
          status: 'completed',
          actualEndTime: now,
          endLocation: location,
          actualHours,
          actualEarnings: totalEarnings,
          reskflowCount,
        },
      });

      // Update driver status
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          isOnline: false,
          currentShiftId: null,
        },
      });

      // Generate shift summary
      const summary = {
        shiftId,
        duration: `${Math.floor(actualHours)}h ${Math.round((actualHours % 1) * 60)}m`,
        earnings: totalEarnings,
        deliveries: reskflowCount,
        averagePerDelivery: reskflowCount > 0 ? totalEarnings / reskflowCount : 0,
        hourlyRate: actualHours > 0 ? totalEarnings / actualHours : 0,
      };

      // Send summary
      await notificationService.sendDriverNotification(
        driverId,
        'Shift Completed',
        `Great work! You earned $${totalEarnings.toFixed(2)} from ${reskflowCount} deliveries.`,
        {
          type: 'clock_out',
          shiftId,
          summary,
        }
      );

      this.emit('shift:completed', {
        shiftId,
        driverId,
        summary,
      });

      return summary;

    } catch (error) {
      logger.error('Failed to clock out', error);
      throw error;
    }
  }

  /**
   * Take break during shift
   */
  async takeBreak(driverId: string, duration: number): Promise<void> {
    try {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        include: {
          currentShift: true,
        },
      });

      if (!driver || !driver.currentShiftId) {
        throw new Error('No active shift found');
      }

      // Create break record
      await prisma.shiftBreak.create({
        data: {
          shiftId: driver.currentShiftId,
          startTime: new Date(),
          plannedDuration: duration,
        },
      });

      // Update driver status
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          isOnBreak: true,
          breakStartTime: new Date(),
        },
      });

      // Set reminder to end break
      setTimeout(async () => {
        await this.sendBreakReminder(driverId);
      }, (duration - 5) * 60 * 1000); // 5 minutes before break ends

      await notificationService.sendDriverNotification(
        driverId,
        'Break Started',
        `Your ${duration}-minute break has started. We'll remind you when it's time to resume.`,
        {
          type: 'break_started',
          duration,
        }
      );

    } catch (error) {
      logger.error('Failed to start break', error);
      throw error;
    }
  }

  /**
   * End break
   */
  async endBreak(driverId: string): Promise<void> {
    try {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      });

      if (!driver || !driver.isOnBreak) {
        throw new Error('Driver is not on break');
      }

      const breakDuration = driver.breakStartTime
        ? (Date.now() - driver.breakStartTime.getTime()) / 60000
        : 0;

      // Update break record
      await prisma.shiftBreak.updateMany({
        where: {
          shiftId: driver.currentShiftId!,
          endTime: null,
        },
        data: {
          endTime: new Date(),
          actualDuration: Math.round(breakDuration),
        },
      });

      // Update driver status
      await prisma.driver.update({
        where: { id: driverId },
        data: {
          isOnBreak: false,
          breakStartTime: null,
        },
      });

      await notificationService.sendDriverNotification(
        driverId,
        'Break Ended',
        'Welcome back! You\'re now available for deliveries.',
        {
          type: 'break_ended',
          duration: Math.round(breakDuration),
        }
      );

    } catch (error) {
      logger.error('Failed to end break', error);
      throw error;
    }
  }

  /**
   * Get driver schedule
   */
  async getDriverSchedule(driverId: string, startDate: Date, endDate: Date): Promise<any> {
    const shifts = await prisma.shift.findMany({
      where: {
        driverId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        swapRequests: {
          where: { status: 'pending' },
        },
      },
      orderBy: { date: 'asc' },
    });

    // Get driver stats
    const stats = await this.getDriverShiftStats(driverId, startDate, endDate);

    // Get available shifts
    const availableShifts = await prisma.shift.findMany({
      where: {
        driverId: null,
        status: 'open',
        date: {
          gte: new Date(),
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    return {
      scheduled: shifts,
      available: availableShifts,
      stats,
      canSwap: shifts.filter(s => this.canRequestSwap(s)),
    };
  }

  /**
   * Get shift details
   */
  async getShiftDetails(shiftId: string): Promise<any> {
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        driver: {
          include: { user: true },
        },
        deliveries: {
          include: {
            order: {
              include: {
                merchant: true,
                customer: true,
              },
            },
            rating: true,
          },
        },
        earnings: true,
        breaks: true,
      },
    });

    if (!shift) {
      throw new Error('Shift not found');
    }

    // Calculate metrics
    const metrics = {
      totalEarnings: shift.earnings.reduce((sum, e) => sum + e.totalAmount, 0),
      totalDeliveries: shift.deliveries.length,
      completedDeliveries: shift.deliveries.filter(d => d.status === 'delivered').length,
      averageDeliveryTime: this.calculateAverageDeliveryTime(shift.deliveries),
      averageRating: this.calculateAverageRating(shift.deliveries),
      totalDistance: shift.deliveries.reduce((sum, d) => sum + (d.actualDistance || 0), 0),
      breakTime: shift.breaks.reduce((sum, b) => sum + (b.actualDuration || 0), 0),
    };

    return {
      ...shift,
      metrics,
      timeline: this.buildShiftTimeline(shift),
    };
  }

  /**
   * Get shift coverage analysis
   */
  async getShiftCoverage(date: Date, zone?: string): Promise<any> {
    const shifts = await prisma.shift.findMany({
      where: {
        date: {
          gte: new Date(date.setHours(0, 0, 0, 0)),
          lt: new Date(date.setHours(23, 59, 59, 999)),
        },
        ...(zone && { zone }),
      },
      include: {
        driver: true,
      },
    });

    // Get historical demand data
    const demandData = await this.getHistoricalDemand(date, zone);

    // Analyze coverage by hour
    const hourlyAnalysis = [];
    for (let hour = 0; hour < 24; hour++) {
      const activeDrivers = shifts.filter(shift => {
        const start = parseInt(shift.startTime.split(':')[0]);
        const end = parseInt(shift.endTime.split(':')[0]);
        return hour >= start && hour < end;
      });

      hourlyAnalysis.push({
        hour,
        scheduled: activeDrivers.length,
        required: demandData[hour] || 0,
        coverage: activeDrivers.length / (demandData[hour] || 1),
        status: this.getCoverageStatus(activeDrivers.length, demandData[hour]),
      });
    }

    return {
      date,
      zone,
      totalShifts: shifts.length,
      filledShifts: shifts.filter(s => s.driverId).length,
      openShifts: shifts.filter(s => !s.driverId).length,
      hourlyAnalysis,
      recommendations: this.generateCoverageRecommendations(hourlyAnalysis),
    };
  }

  /**
   * Generate shifts from templates
   */
  private async generateShiftsFromTemplates(
    templates: ShiftTemplate[],
    weekStart: Date,
    demandForecast: any
  ): Promise<Shift[]> {
    const shifts: Shift[] = [];

    for (let day = 0; day < 7; day++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + day);

      const dayTemplates = templates.filter(t => t.dayOfWeek === date.getDay());

      for (const template of dayTemplates) {
        // Adjust drivers needed based on demand
        const demandMultiplier = demandForecast[date.getDay()]?.multiplier || 1;
        const driversNeeded = Math.ceil(template.driversNeeded * demandMultiplier);

        for (let i = 0; i < driversNeeded; i++) {
          shifts.push({
            id: `shift_${Date.now()}_${i}`,
            date,
            startTime: template.startTime,
            endTime: template.endTime,
            type: template.type,
            status: 'open',
            zone: template.zone,
            minimumDeliveries: template.minimumDeliveries,
            guaranteedEarnings: template.guaranteedEarnings,
          });
        }
      }
    }

    return shifts;
  }

  /**
   * Optimize shift assignments
   */
  private async optimizeShiftAssignments(
    shifts: Shift[],
    availability: any[]
  ): Promise<Shift[]> {
    const assignedShifts = [...shifts];

    // Sort drivers by rating and reliability
    const rankedDrivers = availability.sort((a, b) => {
      const aRating = this.calculateDriverRating(a.driver);
      const bRating = this.calculateDriverRating(b.driver);
      return bRating - aRating;
    });

    // Assign shifts using Hungarian algorithm or greedy approach
    for (const shift of assignedShifts) {
      if (shift.driverId) continue;

      const eligibleDrivers = rankedDrivers.filter(avail => 
        this.isDriverAvailableForShift(avail, shift) &&
        this.meetsShiftRequirements(avail.driver, shift)
      );

      if (eligibleDrivers.length > 0) {
        const bestMatch = this.findBestDriverMatch(shift, eligibleDrivers);
        if (bestMatch) {
          shift.driverId = bestMatch.driverId;
          shift.status = 'assigned';
        }
      }
    }

    return assignedShifts;
  }

  /**
   * Check if driver is available for shift
   */
  private isDriverAvailableForShift(availability: any, shift: Shift): boolean {
    if (availability.dayOfWeek !== shift.date.getDay()) return false;

    const availStart = this.parseTime(availability.startTime);
    const availEnd = this.parseTime(availability.endTime);
    const shiftStart = this.parseTime(shift.startTime);
    const shiftEnd = this.parseTime(shift.endTime);

    return availStart <= shiftStart && availEnd >= shiftEnd;
  }

  /**
   * Check if driver meets shift requirements
   */
  private meetsShiftRequirements(driver: any, shift: Shift): boolean {
    // Check rating, reskflow count, vehicle type, etc.
    return true; // Simplified
  }

  /**
   * Find best driver match for shift
   */
  private findBestDriverMatch(shift: Shift, eligibleDrivers: any[]): any {
    let bestScore = -1;
    let bestDriver = null;

    for (const driver of eligibleDrivers) {
      const score = this.calculateDriverShiftScore(driver, shift);
      if (score > bestScore) {
        bestScore = score;
        bestDriver = driver;
      }
    }

    return bestDriver;
  }

  /**
   * Calculate driver shift score
   */
  private calculateDriverShiftScore(driver: any, shift: Shift): number {
    let score = 0;

    // Rating score
    const rating = this.calculateDriverRating(driver.driver);
    score += rating * 20;

    // Zone preference
    if (driver.preferredZones?.includes(shift.zone)) {
      score += 10;
    }

    // Shift type experience
    const shiftTypeExperience = driver.driver.shiftHistory?.filter(
      (s: any) => s.type === shift.type
    ).length || 0;
    score += Math.min(shiftTypeExperience * 2, 20);

    // Reliability score
    const reliability = driver.driver.completionRate || 0.9;
    score += reliability * 30;

    return score;
  }

  /**
   * Calculate driver rating
   */
  private calculateDriverRating(driver: any): number {
    if (!driver.ratings || driver.ratings.length === 0) return 4.0;
    
    const sum = driver.ratings.reduce((acc: number, r: any) => acc + r.rating, 0);
    return sum / driver.ratings.length;
  }

  /**
   * Analyze shift coverage
   */
  private analyzeShiftCoverage(shifts: Shift[], demandForecast: any): any[] {
    const coverage = [];

    for (let hour = 0; hour < 24; hour++) {
      const activeShifts = shifts.filter(shift => {
        const start = parseInt(shift.startTime.split(':')[0]);
        const end = parseInt(shift.endTime.split(':')[0]);
        return hour >= start && hour < end && shift.driverId;
      });

      const required = demandForecast.hourly?.[hour] || 10;
      const scheduled = activeShifts.length;
      const shortage = Math.max(0, required - scheduled);

      coverage.push({
        hour,
        required,
        scheduled,
        shortage,
      });
    }

    return coverage;
  }

  /**
   * Generate schedule recommendations
   */
  private generateScheduleRecommendations(coverage: any[], shifts: Shift[]): string[] {
    const recommendations = [];

    // Check for understaffed hours
    const understaffedHours = coverage.filter(c => c.shortage > 0);
    if (understaffedHours.length > 0) {
      const peakShortage = Math.max(...understaffedHours.map(h => h.shortage));
      recommendations.push(
        `Need ${peakShortage} more drivers during peak hours (${understaffedHours[0].hour}:00 - ${understaffedHours[understaffedHours.length - 1].hour}:00)`
      );
    }

    // Check for overstaffing
    const overstaffedHours = coverage.filter(c => c.scheduled > c.required * 1.5);
    if (overstaffedHours.length > 0) {
      recommendations.push(
        `Consider reducing staff during ${overstaffedHours[0].hour}:00 - ${overstaffedHours[overstaffedHours.length - 1].hour}:00`
      );
    }

    // Check shift distribution
    const unassignedShifts = shifts.filter(s => !s.driverId);
    if (unassignedShifts.length > 0) {
      recommendations.push(
        `${unassignedShifts.length} shifts still need drivers`
      );
    }

    return recommendations;
  }

  /**
   * Calculate schedule score
   */
  private calculateScheduleScore(coverage: any[]): number {
    let score = 100;

    for (const hour of coverage) {
      if (hour.shortage > 0) {
        score -= hour.shortage * 2;
      } else if (hour.scheduled > hour.required * 1.5) {
        score -= (hour.scheduled - hour.required) * 1;
      }
    }

    return Math.max(0, score);
  }

  /**
   * Get demand forecast
   */
  private async getDemandForecast(startDate: Date, endDate: Date): Promise<any> {
    // This would use ML models based on historical data
    // For now, return mock data
    return {
      hourly: {
        11: 15, 12: 20, 13: 18, // Lunch peak
        17: 22, 18: 25, 19: 28, 20: 24, // Dinner peak
      },
      0: { multiplier: 0.8 }, // Sunday
      1: { multiplier: 1.0 }, // Monday
      2: { multiplier: 1.0 }, // Tuesday
      3: { multiplier: 1.1 }, // Wednesday
      4: { multiplier: 1.2 }, // Thursday
      5: { multiplier: 1.5 }, // Friday
      6: { multiplier: 1.4 }, // Saturday
    };
  }

  /**
   * Save weekly schedule
   */
  private async saveWeeklySchedule(optimization: ScheduleOptimization): Promise<void> {
    // Save shifts to database
    for (const shift of optimization.shifts) {
      await prisma.shift.upsert({
        where: { id: shift.id },
        create: shift,
        update: shift,
      });
    }
  }

  /**
   * Notify drivers of schedule
   */
  private async notifyDriversOfSchedule(shifts: Shift[]): Promise<void> {
    const driverShifts = new Map<string, Shift[]>();

    // Group shifts by driver
    for (const shift of shifts) {
      if (shift.driverId) {
        if (!driverShifts.has(shift.driverId)) {
          driverShifts.set(shift.driverId, []);
        }
        driverShifts.get(shift.driverId)!.push(shift);
      }
    }

    // Send notifications
    const notifications = Array.from(driverShifts.entries()).map(([driverId, driverShifts]) => 
      notificationService.sendDriverNotification(
        driverId,
        'New Schedule Available',
        `You have ${driverShifts.length} shifts scheduled for next week`,
        {
          type: 'schedule_published',
          shiftCount: driverShifts.length,
        }
      )
    );

    await Promise.all(notifications);
  }

  /**
   * Send shift reminders
   */
  private async sendShiftReminders(): Promise<void> {
    const upcomingShifts = await prisma.shift.findMany({
      where: {
        date: {
          gte: new Date(),
          lte: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
        },
        status: { in: ['assigned', 'confirmed'] },
        reminderSent: false,
      },
      include: {
        driver: true,
      },
    });

    for (const shift of upcomingShifts) {
      if (shift.driver) {
        await notificationService.sendDriverNotification(
          shift.driverId!,
          'Shift Reminder',
          `Your shift starts at ${shift.startTime} today`,
          {
            type: 'shift_reminder',
            shiftId: shift.id,
          }
        );

        await prisma.shift.update({
          where: { id: shift.id },
          data: { reminderSent: true },
        });
      }
    }
  }

  /**
   * Check shift coverage
   */
  private async checkShiftCoverage(): Promise<void> {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const understaffedShifts = await prisma.shift.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: 'open',
      },
    });

    if (understaffedShifts.length > 0) {
      // Send alerts to available drivers
      await this.alertAvailableDrivers(understaffedShifts);
    }
  }

  /**
   * Process shift swap requests
   */
  private async processShiftSwapRequests(): Promise<void> {
    // Auto-expire old requests
    await prisma.shiftSwapRequest.updateMany({
      where: {
        status: 'pending',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'cancelled' },
    });
  }

  /**
   * Additional helper methods
   */

  private getNextWeekStart(): Date {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    return nextMonday;
  }

  private parseShiftTime(date: Date, timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  private parseTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private validateDriverRequirements(driver: any, requirements: ShiftRequirements): void {
    if (requirements.minRating && this.calculateDriverRating(driver) < requirements.minRating) {
      throw new Error(`Minimum rating of ${requirements.minRating} required`);
    }

    if (requirements.minDeliveries && driver.totalDeliveries < requirements.minDeliveries) {
      throw new Error(`Minimum ${requirements.minDeliveries} deliveries required`);
    }

    if (requirements.vehicleTypes && !requirements.vehicleTypes.includes(driver.vehicle?.type)) {
      throw new Error('Vehicle type not suitable for this shift');
    }
  }

  private async checkShiftConflicts(driverId: string, shift: Shift): Promise<void> {
    const conflictingShifts = await prisma.shift.findMany({
      where: {
        driverId,
        date: shift.date,
        status: { in: ['assigned', 'confirmed', 'in_progress'] },
      },
    });

    for (const existing of conflictingShifts) {
      const existingStart = this.parseTime(existing.startTime);
      const existingEnd = this.parseTime(existing.endTime);
      const newStart = this.parseTime(shift.startTime);
      const newEnd = this.parseTime(shift.endTime);

      if ((newStart >= existingStart && newStart < existingEnd) ||
          (newEnd > existingStart && newEnd <= existingEnd) ||
          (newStart <= existingStart && newEnd >= existingEnd)) {
        throw new Error('Shift conflicts with existing schedule');
      }
    }
  }

  private async reassignAffectedShifts(driverId: string): Promise<void> {
    // Implementation for reassigning shifts when availability changes
  }

  private async notifyEligibleDriversForSwap(shift: Shift, requesterId: string): Promise<void> {
    // Find drivers with similar availability
    const eligibleDrivers = await prisma.driver.findMany({
      where: {
        id: { not: requesterId },
        isActive: true,
        availability: {
          some: {
            dayOfWeek: shift.date.getDay(),
          },
        },
      },
    });

    const notifications = eligibleDrivers.map(driver =>
      notificationService.sendDriverNotification(
        driver.id,
        'Shift Available',
        `A driver needs coverage for ${shift.date.toLocaleDateString()} ${shift.startTime}-${shift.endTime}`,
        {
          type: 'swap_available',
          shiftId: shift.id,
        }
      )
    );

    await Promise.all(notifications);
  }

  private async sendBreakReminder(driverId: string): Promise<void> {
    await notificationService.sendDriverNotification(
      driverId,
      'Break Ending Soon',
      'Your break will end in 5 minutes. Please prepare to resume deliveries.',
      {
        type: 'break_ending',
      }
    );
  }

  private async getDriverShiftStats(driverId: string, startDate: Date, endDate: Date): Promise<any> {
    const shifts = await prisma.shift.findMany({
      where: {
        driverId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        status: 'completed',
      },
      include: {
        earnings: true,
      },
    });

    const totalHours = shifts.reduce((sum, s) => sum + (s.actualHours || 0), 0);
    const totalEarnings = shifts.reduce((sum, s) => sum + (s.actualEarnings || 0), 0);
    const totalDeliveries = shifts.reduce((sum, s) => sum + (s.reskflowCount || 0), 0);

    return {
      totalShifts: shifts.length,
      totalHours,
      totalEarnings,
      totalDeliveries,
      averagePerShift: shifts.length > 0 ? totalEarnings / shifts.length : 0,
      averageHourly: totalHours > 0 ? totalEarnings / totalHours : 0,
    };
  }

  private canRequestSwap(shift: Shift): boolean {
    const now = new Date();
    const shiftStart = this.parseShiftTime(shift.date, shift.startTime);
    const hoursUntilShift = (shiftStart.getTime() - now.getTime()) / (60 * 60 * 1000);
    
    return shift.status === 'assigned' && hoursUntilShift > 4;
  }

  private calculateAverageDeliveryTime(deliveries: any[]): number {
    const completedDeliveries = deliveries.filter(d => 
      d.status === 'delivered' && d.pickedUpAt && d.deliveredAt
    );

    if (completedDeliveries.length === 0) return 0;

    const totalTime = completedDeliveries.reduce((sum, d) => {
      const time = (d.deliveredAt.getTime() - d.pickedUpAt.getTime()) / 60000;
      return sum + time;
    }, 0);

    return totalTime / completedDeliveries.length;
  }

  private calculateAverageRating(deliveries: any[]): number {
    const ratedDeliveries = deliveries.filter(d => d.rating);
    
    if (ratedDeliveries.length === 0) return 0;

    const totalRating = ratedDeliveries.reduce((sum, d) => sum + d.rating.rating, 0);
    return totalRating / ratedDeliveries.length;
  }

  private buildShiftTimeline(shift: any): any[] {
    const timeline = [];

    if (shift.actualStartTime) {
      timeline.push({
        time: shift.actualStartTime,
        event: 'Clock In',
        type: 'start',
      });
    }

    // Add deliveries
    for (const reskflow of shift.deliveries) {
      if (reskflow.acceptedAt) {
        timeline.push({
          time: reskflow.acceptedAt,
          event: `Accepted reskflow to ${reskflow.order.customer.name}`,
          type: 'reskflow',
          reskflowId: reskflow.id,
        });
      }
      if (reskflow.deliveredAt) {
        timeline.push({
          time: reskflow.deliveredAt,
          event: `Completed reskflow #${reskflow.order.orderNumber}`,
          type: 'reskflow_complete',
          reskflowId: reskflow.id,
        });
      }
    }

    // Add breaks
    for (const breakItem of shift.breaks) {
      timeline.push({
        time: breakItem.startTime,
        event: `Break started (${breakItem.plannedDuration} min)`,
        type: 'break_start',
      });
      if (breakItem.endTime) {
        timeline.push({
          time: breakItem.endTime,
          event: 'Break ended',
          type: 'break_end',
        });
      }
    }

    if (shift.actualEndTime) {
      timeline.push({
        time: shift.actualEndTime,
        event: 'Clock Out',
        type: 'end',
      });
    }

    // Sort by time
    return timeline.sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  private async getHistoricalDemand(date: Date, zone?: string): Promise<any> {
    // This would analyze historical order data
    // For now, return estimated demand
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const baselineDemand = {
      0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 4, 7: 5,
      8: 6, 9: 7, 10: 8, 11: 12, 12: 15, 13: 12, 14: 8,
      15: 7, 16: 8, 17: 12, 18: 18, 19: 20, 20: 18, 21: 12,
      22: 8, 23: 5,
    };

    // Adjust for weekend
    if (isWeekend) {
      Object.keys(baselineDemand).forEach(hour => {
        baselineDemand[parseInt(hour)] *= 1.3;
      });
    }

    return baselineDemand;
  }

  private getCoverageStatus(scheduled: number, required: number): string {
    const ratio = scheduled / required;
    if (ratio >= 0.9) return 'good';
    if (ratio >= 0.7) return 'fair';
    if (ratio >= 0.5) return 'poor';
    return 'critical';
  }

  private generateCoverageRecommendations(hourlyAnalysis: any[]): string[] {
    const recommendations = [];

    // Find critical hours
    const criticalHours = hourlyAnalysis.filter(h => h.status === 'critical');
    if (criticalHours.length > 0) {
      recommendations.push(
        `Critical understaffing at ${criticalHours.map(h => `${h.hour}:00`).join(', ')}`
      );
    }

    // Find peak hours needing attention
    const peakHours = hourlyAnalysis.filter(h => 
      h.required > 15 && h.coverage < 0.8
    );
    if (peakHours.length > 0) {
      recommendations.push(
        'Consider offering peak hour incentives to attract more drivers'
      );
    }

    return recommendations;
  }

  private async alertAvailableDrivers(understaffedShifts: Shift[]): Promise<void> {
    // Group by time slots
    const timeSlots = new Map<string, Shift[]>();
    
    for (const shift of understaffedShifts) {
      const key = `${shift.startTime}-${shift.endTime}`;
      if (!timeSlots.has(key)) {
        timeSlots.set(key, []);
      }
      timeSlots.get(key)!.push(shift);
    }

    // Find available drivers
    const availableDrivers = await prisma.driver.findMany({
      where: {
        isActive: true,
        currentShiftId: null,
      },
    });

    // Send targeted notifications
    for (const driver of availableDrivers) {
      await notificationService.sendDriverNotification(
        driver.id,
        'Shifts Available!',
        `${understaffedShifts.length} shifts need coverage today. Extra incentives available!`,
        {
          type: 'understaffed_alert',
          shiftCount: understaffedShifts.length,
        }
      );
    }
  }
}

// Export singleton instance
export const shiftSchedulingService = new ShiftSchedulingService();