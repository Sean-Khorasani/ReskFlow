/**
 * Vehicle Inspection Service
 * Manages vehicle safety checks, maintenance tracking, and compliance
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { storageService } from '../storage/storage.service';

const prisma = new PrismaClient();

interface VehicleInspection {
  id: string;
  vehicleId: string;
  driverId: string;
  type: 'pre_trip' | 'post_trip' | 'weekly' | 'monthly' | 'annual';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'requires_attention';
  scheduledDate: Date;
  completedDate?: Date;
  expiresDate?: Date;
  checklist: InspectionChecklist;
  results: InspectionResults;
  photos: InspectionPhoto[];
  signature?: string;
  notes?: string;
}

interface InspectionChecklist {
  categories: InspectionCategory[];
  version: string;
  totalItems: number;
  requiredItems: string[];
}

interface InspectionCategory {
  id: string;
  name: string;
  items: InspectionItem[];
  required: boolean;
}

interface InspectionItem {
  id: string;
  name: string;
  description: string;
  type: 'pass_fail' | 'numeric' | 'text' | 'photo';
  required: boolean;
  acceptableRange?: {
    min?: number;
    max?: number;
  };
  warningThreshold?: number;
}

interface InspectionResults {
  items: {
    itemId: string;
    status: 'pass' | 'fail' | 'warning' | 'not_applicable';
    value?: string | number;
    notes?: string;
    photoIds?: string[];
  }[];
  overallStatus: 'pass' | 'fail' | 'warning';
  failedItems: string[];
  warningItems: string[];
  completionTime: number; // minutes
}

interface InspectionPhoto {
  id: string;
  url: string;
  type: 'damage' | 'tire' | 'lights' | 'interior' | 'exterior' | 'document';
  description?: string;
  timestamp: Date;
}

interface MaintenanceSchedule {
  id: string;
  vehicleId: string;
  type: 'oil_change' | 'tire_rotation' | 'brake_service' | 'general' | 'custom';
  intervalMiles?: number;
  intervalDays?: number;
  lastServiceDate?: Date;
  lastServiceMileage?: number;
  nextDueDate?: Date;
  nextDueMileage?: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface VehicleIssue {
  id: string;
  vehicleId: string;
  reportedBy: string;
  type: 'mechanical' | 'electrical' | 'body' | 'safety' | 'other';
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  description: string;
  status: 'reported' | 'acknowledged' | 'in_repair' | 'resolved' | 'deferred';
  photos?: string[];
  estimatedCost?: number;
  actualCost?: number;
  resolvedDate?: Date;
}

export class VehicleInspectionService extends EventEmitter {
  private inspectionChecklists: Map<string, InspectionChecklist> = new Map();

  constructor() {
    super();
    this.initializeChecklists();
    this.setupScheduledJobs();
  }

  /**
   * Initialize inspection checklists
   */
  private initializeChecklists() {
    // Pre-trip inspection checklist
    this.inspectionChecklists.set('pre_trip', {
      version: '1.0',
      totalItems: 25,
      requiredItems: ['brakes', 'lights', 'tires', 'mirrors', 'seatbelts'],
      categories: [
        {
          id: 'exterior',
          name: 'Exterior',
          required: true,
          items: [
            {
              id: 'body_damage',
              name: 'Body Damage',
              description: 'Check for dents, scratches, or damage',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'lights',
              name: 'All Lights',
              description: 'Headlights, brake lights, turn signals',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'tires',
              name: 'Tire Condition',
              description: 'Check tread depth and pressure',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'tire_pressure',
              name: 'Tire Pressure',
              description: 'Record tire pressure in PSI',
              type: 'numeric',
              required: false,
              acceptableRange: { min: 30, max: 35 },
            },
            {
              id: 'mirrors',
              name: 'Mirrors',
              description: 'Side and rearview mirrors intact and clean',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'windshield',
              name: 'Windshield',
              description: 'No cracks or obstructions',
              type: 'pass_fail',
              required: true,
            },
          ],
        },
        {
          id: 'engine',
          name: 'Engine & Fluids',
          required: true,
          items: [
            {
              id: 'engine_start',
              name: 'Engine Start',
              description: 'Engine starts smoothly without unusual noise',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'oil_level',
              name: 'Oil Level',
              description: 'Check engine oil level',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'coolant_level',
              name: 'Coolant Level',
              description: 'Check coolant reservoir',
              type: 'pass_fail',
              required: false,
            },
            {
              id: 'brake_fluid',
              name: 'Brake Fluid',
              description: 'Check brake fluid level',
              type: 'pass_fail',
              required: true,
            },
          ],
        },
        {
          id: 'interior',
          name: 'Interior & Safety',
          required: true,
          items: [
            {
              id: 'seatbelts',
              name: 'Seatbelts',
              description: 'All seatbelts functioning properly',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'brakes',
              name: 'Brake Test',
              description: 'Brakes responsive and no grinding',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'horn',
              name: 'Horn',
              description: 'Horn works properly',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'dashboard_lights',
              name: 'Dashboard Warning Lights',
              description: 'No warning lights illuminated',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'cleanliness',
              name: 'Interior Cleanliness',
              description: 'Vehicle clean and presentable',
              type: 'pass_fail',
              required: true,
            },
          ],
        },
        {
          id: 'documents',
          name: 'Documentation',
          required: true,
          items: [
            {
              id: 'registration',
              name: 'Registration',
              description: 'Current vehicle registration',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'insurance',
              name: 'Insurance',
              description: 'Valid insurance documentation',
              type: 'pass_fail',
              required: true,
            },
            {
              id: 'driver_license',
              name: 'Driver License',
              description: 'Valid driver license',
              type: 'pass_fail',
              required: true,
            },
          ],
        },
      ],
    });

    // Weekly inspection checklist
    this.inspectionChecklists.set('weekly', {
      version: '1.0',
      totalItems: 15,
      requiredItems: ['tire_pressure', 'fluid_levels', 'lights', 'brakes'],
      categories: [
        {
          id: 'measurements',
          name: 'Measurements & Levels',
          required: true,
          items: [
            {
              id: 'mileage',
              name: 'Current Mileage',
              description: 'Record current odometer reading',
              type: 'numeric',
              required: true,
            },
            {
              id: 'fuel_economy',
              name: 'Fuel Economy',
              description: 'Calculate MPG since last check',
              type: 'numeric',
              required: false,
              acceptableRange: { min: 20, max: 40 },
              warningThreshold: 22,
            },
            {
              id: 'tire_tread',
              name: 'Tire Tread Depth',
              description: 'Measure tread depth in 32nds of inch',
              type: 'numeric',
              required: true,
              acceptableRange: { min: 4, max: 12 },
              warningThreshold: 5,
            },
          ],
        },
      ],
    });
  }

  /**
   * Setup scheduled jobs
   */
  private setupScheduledJobs() {
    // Daily reminder for pre-trip inspections
    const dailyJob = new CronJob('0 6 * * *', async () => {
      await this.sendDailyInspectionReminders();
    });
    dailyJob.start();

    // Weekly inspection reminders
    const weeklyJob = new CronJob('0 8 * * 1', async () => {
      await this.sendWeeklyInspectionReminders();
    });
    weeklyJob.start();

    // Check for overdue inspections
    const overdueJob = new CronJob('0 10 * * *', async () => {
      await this.checkOverdueInspections();
    });
    overdueJob.start();
  }

  /**
   * Start vehicle inspection
   */
  async startInspection(
    driverId: string,
    vehicleId: string,
    type: VehicleInspection['type']
  ): Promise<VehicleInspection> {
    try {
      // Verify driver owns/is assigned to vehicle
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
      });

      if (!vehicle || vehicle.driverId !== driverId) {
        throw new Error('Vehicle not assigned to driver');
      }

      // Check for incomplete inspections
      const incompleteInspection = await prisma.vehicleInspection.findFirst({
        where: {
          vehicleId,
          driverId,
          status: 'in_progress',
        },
      });

      if (incompleteInspection) {
        return incompleteInspection;
      }

      // Get appropriate checklist
      const checklist = this.inspectionChecklists.get(type);
      if (!checklist) {
        throw new Error('Invalid inspection type');
      }

      // Create new inspection
      const inspection = await prisma.vehicleInspection.create({
        data: {
          vehicleId,
          driverId,
          type,
          status: 'in_progress',
          scheduledDate: new Date(),
          checklist,
          results: {
            items: [],
            overallStatus: 'pass',
            failedItems: [],
            warningItems: [],
            completionTime: 0,
          },
          photos: [],
        },
      });

      // Send notification
      await notificationService.sendDriverNotification(
        driverId,
        'Inspection Started',
        `${type.replace('_', ' ')} inspection for ${vehicle.make} ${vehicle.model}`,
        {
          type: 'inspection_started',
          inspectionId: inspection.id,
        }
      );

      return inspection;

    } catch (error) {
      logger.error('Failed to start inspection', error);
      throw error;
    }
  }

  /**
   * Submit inspection item result
   */
  async submitInspectionItem(
    inspectionId: string,
    itemId: string,
    result: {
      status: 'pass' | 'fail' | 'warning' | 'not_applicable';
      value?: string | number;
      notes?: string;
      photos?: Express.Multer.File[];
    }
  ): Promise<void> {
    try {
      const inspection = await prisma.vehicleInspection.findUnique({
        where: { id: inspectionId },
      });

      if (!inspection || inspection.status !== 'in_progress') {
        throw new Error('Inspection not found or not in progress');
      }

      // Upload photos if provided
      const photoUrls: string[] = [];
      if (result.photos && result.photos.length > 0) {
        for (const photo of result.photos) {
          const url = await storageService.uploadFile(
            photo,
            `inspections/${inspectionId}/${itemId}`
          );
          photoUrls.push(url);

          // Add to inspection photos
          inspection.photos.push({
            id: `photo_${Date.now()}`,
            url,
            type: 'general',
            timestamp: new Date(),
          });
        }
      }

      // Update results
      const existingItemIndex = inspection.results.items.findIndex(
        i => i.itemId === itemId
      );

      const itemResult = {
        itemId,
        status: result.status,
        value: result.value,
        notes: result.notes,
        photoIds: photoUrls,
      };

      if (existingItemIndex >= 0) {
        inspection.results.items[existingItemIndex] = itemResult;
      } else {
        inspection.results.items.push(itemResult);
      }

      // Update failed/warning items
      if (result.status === 'fail') {
        if (!inspection.results.failedItems.includes(itemId)) {
          inspection.results.failedItems.push(itemId);
        }
      } else {
        inspection.results.failedItems = inspection.results.failedItems.filter(
          id => id !== itemId
        );
      }

      if (result.status === 'warning') {
        if (!inspection.results.warningItems.includes(itemId)) {
          inspection.results.warningItems.push(itemId);
        }
      } else {
        inspection.results.warningItems = inspection.results.warningItems.filter(
          id => id !== itemId
        );
      }

      // Update overall status
      if (inspection.results.failedItems.length > 0) {
        inspection.results.overallStatus = 'fail';
      } else if (inspection.results.warningItems.length > 0) {
        inspection.results.overallStatus = 'warning';
      } else {
        inspection.results.overallStatus = 'pass';
      }

      // Save updates
      await prisma.vehicleInspection.update({
        where: { id: inspectionId },
        data: {
          results: inspection.results,
          photos: inspection.photos,
        },
      });

    } catch (error) {
      logger.error('Failed to submit inspection item', error);
      throw error;
    }
  }

  /**
   * Complete inspection
   */
  async completeInspection(
    inspectionId: string,
    driverId: string,
    signature: string
  ): Promise<InspectionResults> {
    try {
      const inspection = await prisma.vehicleInspection.findUnique({
        where: { id: inspectionId },
        include: {
          vehicle: true,
        },
      });

      if (!inspection || inspection.driverId !== driverId) {
        throw new Error('Inspection not found or unauthorized');
      }

      if (inspection.status !== 'in_progress') {
        throw new Error('Inspection not in progress');
      }

      // Validate all required items completed
      const requiredItems = inspection.checklist.requiredItems;
      const completedItems = inspection.results.items.map(i => i.itemId);
      const missingItems = requiredItems.filter(id => !completedItems.includes(id));

      if (missingItems.length > 0) {
        throw new Error(`Missing required items: ${missingItems.join(', ')}`);
      }

      // Calculate completion time
      const completionTime = Math.round(
        (Date.now() - inspection.scheduledDate.getTime()) / 60000
      );

      // Update inspection
      const updatedInspection = await prisma.vehicleInspection.update({
        where: { id: inspectionId },
        data: {
          status: inspection.results.overallStatus === 'fail' ? 'failed' : 'completed',
          completedDate: new Date(),
          signature,
          results: {
            ...inspection.results,
            completionTime,
          },
        },
      });

      // Handle failed inspection
      if (inspection.results.overallStatus === 'fail') {
        await this.handleFailedInspection(inspection);
      }

      // Update vehicle status
      await prisma.vehicle.update({
        where: { id: inspection.vehicleId },
        data: {
          lastInspectionDate: new Date(),
          lastInspectionStatus: inspection.results.overallStatus,
          isRoadworthy: inspection.results.overallStatus !== 'fail',
        },
      });

      // Create maintenance issues for failed items
      if (inspection.results.failedItems.length > 0) {
        await this.createMaintenanceIssues(inspection);
      }

      // Schedule next inspection
      await this.scheduleNextInspection(inspection.vehicle, inspection.type);

      // Send confirmation
      await notificationService.sendDriverNotification(
        driverId,
        'Inspection Completed',
        `${inspection.type.replace('_', ' ')} inspection ${inspection.results.overallStatus}`,
        {
          type: 'inspection_completed',
          inspectionId,
          status: inspection.results.overallStatus,
        }
      );

      this.emit('inspection:completed', {
        inspectionId,
        vehicleId: inspection.vehicleId,
        status: inspection.results.overallStatus,
      });

      return inspection.results;

    } catch (error) {
      logger.error('Failed to complete inspection', error);
      throw error;
    }
  }

  /**
   * Report vehicle issue
   */
  async reportVehicleIssue(
    driverId: string,
    vehicleId: string,
    issue: {
      type: VehicleIssue['type'];
      severity: VehicleIssue['severity'];
      description: string;
      photos?: Express.Multer.File[];
    }
  ): Promise<VehicleIssue> {
    try {
      // Upload photos
      const photoUrls: string[] = [];
      if (issue.photos) {
        for (const photo of issue.photos) {
          const url = await storageService.uploadFile(
            photo,
            `issues/${vehicleId}/${Date.now()}`
          );
          photoUrls.push(url);
        }
      }

      // Create issue
      const vehicleIssue = await prisma.vehicleIssue.create({
        data: {
          vehicleId,
          reportedBy: driverId,
          type: issue.type,
          severity: issue.severity,
          description: issue.description,
          status: 'reported',
          photos: photoUrls,
        },
      });

      // Update vehicle status if critical
      if (issue.severity === 'critical') {
        await prisma.vehicle.update({
          where: { id: vehicleId },
          data: {
            isRoadworthy: false,
            status: 'maintenance_required',
          },
        });

        // Take driver offline
        await prisma.driver.update({
          where: { id: driverId },
          data: { isOnline: false },
        });
      }

      // Notify fleet manager
      await this.notifyFleetManager(vehicleIssue);

      // Send confirmation to driver
      await notificationService.sendDriverNotification(
        driverId,
        'Issue Reported',
        'Your vehicle issue has been reported and will be addressed soon',
        {
          type: 'issue_reported',
          issueId: vehicleIssue.id,
          severity: issue.severity,
        }
      );

      return vehicleIssue;

    } catch (error) {
      logger.error('Failed to report vehicle issue', error);
      throw error;
    }
  }

  /**
   * Get inspection history
   */
  async getInspectionHistory(
    vehicleId: string,
    limit: number = 10
  ): Promise<VehicleInspection[]> {
    const inspections = await prisma.vehicleInspection.findMany({
      where: { vehicleId },
      orderBy: { completedDate: 'desc' },
      take: limit,
      include: {
        driver: {
          include: { user: true },
        },
      },
    });

    return inspections;
  }

  /**
   * Get maintenance schedule
   */
  async getMaintenanceSchedule(vehicleId: string): Promise<MaintenanceSchedule[]> {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    const schedules = await prisma.maintenanceSchedule.findMany({
      where: { vehicleId },
      orderBy: { priority: 'desc' },
    });

    // Update due dates based on current mileage and date
    for (const schedule of schedules) {
      if (schedule.intervalMiles && vehicle.currentMileage) {
        schedule.nextDueMileage = (schedule.lastServiceMileage || 0) + schedule.intervalMiles;
      }

      if (schedule.intervalDays && schedule.lastServiceDate) {
        schedule.nextDueDate = new Date(
          schedule.lastServiceDate.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000
        );
      }

      // Update priority based on how close to due
      schedule.priority = this.calculateMaintenancePriority(schedule, vehicle);
    }

    return schedules;
  }

  /**
   * Get vehicle health score
   */
  async getVehicleHealthScore(vehicleId: string): Promise<{
    score: number;
    factors: {
      inspections: number;
      maintenance: number;
      issues: number;
      age: number;
    };
    recommendations: string[];
  }> {
    const [vehicle, recentInspections, openIssues, maintenanceSchedule] = await Promise.all([
      prisma.vehicle.findUnique({ where: { id: vehicleId } }),
      prisma.vehicleInspection.findMany({
        where: {
          vehicleId,
          completedDate: {
            gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
          },
        },
      }),
      prisma.vehicleIssue.findMany({
        where: {
          vehicleId,
          status: { notIn: ['resolved'] },
        },
      }),
      this.getMaintenanceSchedule(vehicleId),
    ]);

    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // Calculate scores
    const inspectionScore = this.calculateInspectionScore(recentInspections);
    const maintenanceScore = this.calculateMaintenanceScore(maintenanceSchedule);
    const issueScore = this.calculateIssueScore(openIssues);
    const ageScore = this.calculateAgeScore(vehicle);

    const overallScore = Math.round(
      (inspectionScore * 0.3 + maintenanceScore * 0.3 + issueScore * 0.3 + ageScore * 0.1) 
    );

    const recommendations = this.generateHealthRecommendations(
      vehicle,
      recentInspections,
      openIssues,
      maintenanceSchedule
    );

    return {
      score: overallScore,
      factors: {
        inspections: inspectionScore,
        maintenance: maintenanceScore,
        issues: issueScore,
        age: ageScore,
      },
      recommendations,
    };
  }

  /**
   * Helper methods
   */

  private async handleFailedInspection(inspection: VehicleInspection): Promise<void> {
    // Notify fleet manager
    await notificationService.sendEmail(
      process.env.FLEET_MANAGER_EMAIL!,
      'failed_inspection',
      {
        vehicleId: inspection.vehicleId,
        driverId: inspection.driverId,
        failedItems: inspection.results.failedItems,
        inspectionId: inspection.id,
      }
    );

    // Create high-priority maintenance request
    await prisma.maintenanceRequest.create({
      data: {
        vehicleId: inspection.vehicleId,
        requestedBy: inspection.driverId,
        type: 'inspection_failure',
        priority: 'high',
        description: `Failed inspection: ${inspection.results.failedItems.join(', ')}`,
        status: 'pending',
      },
    });
  }

  private async createMaintenanceIssues(inspection: VehicleInspection): Promise<void> {
    const issues = inspection.results.failedItems.map(itemId => {
      const item = this.findChecklistItem(inspection.checklist, itemId);
      return {
        vehicleId: inspection.vehicleId,
        reportedBy: inspection.driverId,
        type: 'safety' as const,
        severity: 'major' as const,
        description: `Failed inspection: ${item?.name || itemId}`,
        status: 'reported' as const,
      };
    });

    await prisma.vehicleIssue.createMany({ data: issues });
  }

  private findChecklistItem(checklist: InspectionChecklist, itemId: string): InspectionItem | null {
    for (const category of checklist.categories) {
      const item = category.items.find(i => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  private async scheduleNextInspection(vehicle: any, type: string): Promise<void> {
    let nextDate: Date;

    switch (type) {
      case 'pre_trip':
        nextDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Next day
        break;
      case 'weekly':
        nextDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Next week
        break;
      case 'monthly':
        nextDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Next month
        break;
      default:
        return;
    }

    await prisma.scheduledInspection.create({
      data: {
        vehicleId: vehicle.id,
        type,
        scheduledDate: nextDate,
        status: 'scheduled',
      },
    });
  }

  private async notifyFleetManager(issue: VehicleIssue): Promise<void> {
    await notificationService.sendEmail(
      process.env.FLEET_MANAGER_EMAIL!,
      'vehicle_issue_reported',
      {
        issueId: issue.id,
        vehicleId: issue.vehicleId,
        severity: issue.severity,
        description: issue.description,
        reportedBy: issue.reportedBy,
      }
    );

    // Send SMS for critical issues
    if (issue.severity === 'critical') {
      await notificationService.sendSMS(
        process.env.FLEET_MANAGER_PHONE!,
        `CRITICAL: Vehicle ${issue.vehicleId} reported ${issue.type} issue: ${issue.description}`
      );
    }
  }

  private calculateMaintenancePriority(schedule: MaintenanceSchedule, vehicle: any): 'low' | 'medium' | 'high' | 'critical' {
    const now = Date.now();
    
    // Check mileage
    if (schedule.nextDueMileage && vehicle.currentMileage) {
      const milesUntilDue = schedule.nextDueMileage - vehicle.currentMileage;
      if (milesUntilDue <= 0) return 'critical';
      if (milesUntilDue <= 100) return 'high';
      if (milesUntilDue <= 500) return 'medium';
    }

    // Check date
    if (schedule.nextDueDate) {
      const daysUntilDue = (schedule.nextDueDate.getTime() - now) / (24 * 60 * 60 * 1000);
      if (daysUntilDue <= 0) return 'critical';
      if (daysUntilDue <= 7) return 'high';
      if (daysUntilDue <= 30) return 'medium';
    }

    return 'low';
  }

  private calculateInspectionScore(inspections: VehicleInspection[]): number {
    if (inspections.length === 0) return 50;

    const passedInspections = inspections.filter(i => i.results.overallStatus === 'pass').length;
    const warningInspections = inspections.filter(i => i.results.overallStatus === 'warning').length;
    
    const passRate = passedInspections / inspections.length;
    const warningRate = warningInspections / inspections.length;

    return Math.round(passRate * 100 - warningRate * 10);
  }

  private calculateMaintenanceScore(schedules: MaintenanceSchedule[]): number {
    if (schedules.length === 0) return 100;

    const overdueCount = schedules.filter(s => s.priority === 'critical').length;
    const highPriorityCount = schedules.filter(s => s.priority === 'high').length;

    return Math.max(0, 100 - overdueCount * 20 - highPriorityCount * 10);
  }

  private calculateIssueScore(issues: VehicleIssue[]): number {
    if (issues.length === 0) return 100;

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const majorCount = issues.filter(i => i.severity === 'major').length;
    const moderateCount = issues.filter(i => i.severity === 'moderate').length;

    return Math.max(0, 100 - criticalCount * 30 - majorCount * 20 - moderateCount * 10);
  }

  private calculateAgeScore(vehicle: any): number {
    if (!vehicle.year) return 50;

    const age = new Date().getFullYear() - vehicle.year;
    if (age <= 2) return 100;
    if (age <= 5) return 80;
    if (age <= 8) return 60;
    if (age <= 10) return 40;
    return 20;
  }

  private generateHealthRecommendations(
    vehicle: any,
    inspections: VehicleInspection[],
    issues: VehicleIssue[],
    schedules: MaintenanceSchedule[]
  ): string[] {
    const recommendations: string[] = [];

    // Check inspection frequency
    if (inspections.length === 0) {
      recommendations.push('Schedule a comprehensive vehicle inspection');
    }

    // Check critical issues
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push(`Address ${criticalIssues.length} critical issue(s) immediately`);
    }

    // Check overdue maintenance
    const overdueSchedules = schedules.filter(s => s.priority === 'critical');
    if (overdueSchedules.length > 0) {
      recommendations.push(`Complete ${overdueSchedules.length} overdue maintenance item(s)`);
    }

    // Mileage-based recommendations
    if (vehicle.currentMileage > 50000 && !schedules.find(s => s.type === 'general')) {
      recommendations.push('Schedule comprehensive 50,000-mile service');
    }

    return recommendations;
  }

  private async sendDailyInspectionReminders(): Promise<void> {
    const driversWithShifts = await prisma.driver.findMany({
      where: {
        shifts: {
          some: {
            date: {
              gte: new Date(),
              lt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            status: { in: ['assigned', 'confirmed'] },
          },
        },
      },
      include: {
        vehicle: true,
      },
    });

    for (const driver of driversWithShifts) {
      if (driver.vehicle) {
        await notificationService.sendDriverNotification(
          driver.id,
          'Pre-Trip Inspection Reminder',
          'Remember to complete your pre-trip vehicle inspection before starting your shift',
          {
            type: 'inspection_reminder',
            inspectionType: 'pre_trip',
          }
        );
      }
    }
  }

  private async sendWeeklyInspectionReminders(): Promise<void> {
    const vehicles = await prisma.vehicle.findMany({
      where: {
        lastInspectionDate: {
          lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
        isActive: true,
      },
      include: {
        driver: true,
      },
    });

    for (const vehicle of vehicles) {
      if (vehicle.driver) {
        await notificationService.sendDriverNotification(
          vehicle.driverId!,
          'Weekly Inspection Due',
          `Your ${vehicle.make} ${vehicle.model} is due for weekly inspection`,
          {
            type: 'inspection_due',
            inspectionType: 'weekly',
            vehicleId: vehicle.id,
          }
        );
      }
    }
  }

  private async checkOverdueInspections(): Promise<void> {
    const overdueInspections = await prisma.scheduledInspection.findMany({
      where: {
        scheduledDate: { lt: new Date() },
        status: 'scheduled',
      },
      include: {
        vehicle: {
          include: { driver: true },
        },
      },
    });

    for (const inspection of overdueInspections) {
      await prisma.scheduledInspection.update({
        where: { id: inspection.id },
        data: { status: 'overdue' },
      });

      if (inspection.vehicle.driver) {
        await notificationService.sendDriverNotification(
          inspection.vehicle.driverId!,
          'Overdue Inspection',
          `Your ${inspection.type.replace('_', ' ')} inspection is overdue`,
          {
            type: 'inspection_overdue',
            inspectionType: inspection.type,
            vehicleId: inspection.vehicleId,
          }
        );
      }
    }
  }
}

// Export singleton instance
export const vehicleInspectionService = new VehicleInspectionService();