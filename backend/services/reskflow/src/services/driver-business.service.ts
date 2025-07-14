import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { publishMessage } from '../config/rabbitmq';
import {
  Driver,
  DriverProfile,
  DriverPreferences,
  DriverShift,
  DriverEarnings,
  DriverPerformance,
  DeliveryAssignment,
  DriverBusinessCase,
  VehicleInfo,
  DriverDocument,
  DriverRating,
  DriverLocation,
  ShiftStatus,
  DriverStatus,
  VehicleType,
  DocumentType,
  DriverAnalytics
} from '../types/driver.types';

export class DriverBusinessService {
  
  // Driver Registration and Onboarding
  async registerDriver(registrationData: {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    password: string;
    dateOfBirth: Date;
    licenseNumber: string;
    licenseExpiry: Date;
    vehicleInfo: VehicleInfo;
    bankAccount: {
      accountNumber: string;
      routingNumber: string;
      accountHolderName: string;
    };
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
    emergencyContact: {
      name: string;
      phone: string;
      relationship: string;
    };
    referralCode?: string;
  }): Promise<DriverBusinessCase> {
    try {
      logger.info('Starting driver registration', { email: registrationData.email });

      // Check if driver exists
      const existingDriver = await prisma.user.findFirst({
        where: {
          OR: [
            { email: registrationData.email },
            { phone: registrationData.phone }
          ]
        }
      });

      if (existingDriver) {
        throw new Error('Driver already exists with this email or phone');
      }

      // Create driver account
      const driver = await prisma.user.create({
        data: {
          email: registrationData.email,
          phone: registrationData.phone,
          firstName: registrationData.firstName,
          lastName: registrationData.lastName,
          password: registrationData.password, // Should be hashed
          dateOfBirth: registrationData.dateOfBirth,
          role: 'DRIVER',
          status: 'PENDING_VERIFICATION',
          emailVerified: false,
          phoneVerified: false,
        }
      });

      // Create driver profile
      const driverProfile = await prisma.driverProfile.create({
        data: {
          userId: driver.id,
          licenseNumber: registrationData.licenseNumber,
          licenseExpiry: registrationData.licenseExpiry,
          driverStatus: DriverStatus.PENDING_VERIFICATION,
          totalDeliveries: 0,
          totalEarnings: 0,
          avgRating: 0,
          ratingCount: 0,
          completionRate: 0,
          onTimeRate: 0,
          cancellationRate: 0,
          acceptanceRate: 0,
          joinedAt: new Date(),
          bankAccount: registrationData.bankAccount,
          address: registrationData.address,
          emergencyContact: registrationData.emergencyContact,
        }
      });

      // Create vehicle record
      const vehicle = await prisma.driverVehicle.create({
        data: {
          driverId: driver.id,
          type: registrationData.vehicleInfo.type,
          make: registrationData.vehicleInfo.make,
          model: registrationData.vehicleInfo.model,
          year: registrationData.vehicleInfo.year,
          licensePlate: registrationData.vehicleInfo.licensePlate,
          color: registrationData.vehicleInfo.color,
          capacity: registrationData.vehicleInfo.capacity,
          isActive: true,
          insuranceExpiry: registrationData.vehicleInfo.insuranceExpiry,
          registrationExpiry: registrationData.vehicleInfo.registrationExpiry,
        }
      });

      // Initialize driver preferences
      await this.initializeDriverPreferences(driver.id);

      // Create document requirements
      await this.createDocumentRequirements(driver.id);

      // Handle referral if provided
      if (registrationData.referralCode) {
        await this.processDriverReferral(driver.id, registrationData.referralCode);
      }

      // Send welcome notifications and onboarding materials
      await this.sendDriverWelcomeNotifications(driver.id);

      // Track registration analytics
      await this.trackDriverEvent(driver.id, 'DRIVER_REGISTRATION', {
        vehicleType: registrationData.vehicleInfo.type,
        referralCode: registrationData.referralCode,
      });

      logger.info('Driver registration completed', { 
        driverId: driver.id,
        email: registrationData.email 
      });

      return {
        success: true,
        driver: {
          id: driver.id,
          email: driver.email,
          firstName: driver.firstName,
          lastName: driver.lastName,
          status: DriverStatus.PENDING_VERIFICATION
        },
        businessCase: 'DRIVER_REGISTRATION',
        metadata: {
          vehicleId: vehicle.id,
          documentsRequired: true,
          backgroundCheckRequired: true,
          trainingRequired: true
        }
      };

    } catch (error) {
      logger.error('Driver registration failed', {
        error: error.message,
        email: registrationData.email
      });
      throw error;
    }
  }

  // Driver Shift Management
  async manageDriverShift(driverId: string, action: {
    type: 'START_SHIFT' | 'END_SHIFT' | 'TAKE_BREAK' | 'END_BREAK';
    location?: DriverLocation;
    notes?: string;
  }): Promise<DriverBusinessCase> {
    try {
      logger.info('Managing driver shift', { driverId, action: action.type });

      const driver = await prisma.driverProfile.findUnique({
        where: { userId: driverId },
        include: { currentShift: true }
      });

      if (!driver) {
        throw new Error('Driver not found');
      }

      let shift: any;
      let shiftData: any;

      switch (action.type) {
        case 'START_SHIFT':
          // Validate driver can start shift
          await this.validateDriverShiftEligibility(driverId);

          shift = await prisma.driverShift.create({
            data: {
              driverId,
              status: ShiftStatus.ACTIVE,
              startTime: new Date(),
              startLocation: action.location,
              notes: action.notes,
              plannedDuration: 8 * 60, // Default 8 hours in minutes
            }
          });

          // Update driver status
          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { 
              driverStatus: DriverStatus.AVAILABLE,
              currentShiftId: shift.id,
              lastActiveAt: new Date()
            }
          });

          shiftData = { shiftId: shift.id, status: ShiftStatus.ACTIVE };
          break;

        case 'END_SHIFT':
          if (!driver.currentShift) {
            throw new Error('No active shift found');
          }

          // Calculate shift earnings and performance
          const shiftSummary = await this.calculateShiftSummary(driver.currentShift.id);

          await prisma.driverShift.update({
            where: { id: driver.currentShift.id },
            data: {
              status: ShiftStatus.COMPLETED,
              endTime: new Date(),
              endLocation: action.location,
              actualDuration: shiftSummary.duration,
              totalEarnings: shiftSummary.earnings,
              totalDeliveries: shiftSummary.deliveries,
              totalDistance: shiftSummary.distance,
              fuelCost: shiftSummary.estimatedFuelCost,
              notes: action.notes
            }
          });

          // Update driver status
          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { 
              driverStatus: DriverStatus.OFFLINE,
              currentShiftId: null,
              totalEarnings: { increment: shiftSummary.earnings },
              totalDeliveries: { increment: shiftSummary.deliveries }
            }
          });

          shiftData = { 
            shiftId: driver.currentShift.id, 
            status: ShiftStatus.COMPLETED,
            summary: shiftSummary 
          };
          break;

        case 'TAKE_BREAK':
          if (!driver.currentShift) {
            throw new Error('No active shift found');
          }

          await prisma.driverShift.update({
            where: { id: driver.currentShift.id },
            data: { status: ShiftStatus.ON_BREAK }
          });

          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { driverStatus: DriverStatus.ON_BREAK }
          });

          shiftData = { shiftId: driver.currentShift.id, status: ShiftStatus.ON_BREAK };
          break;

        case 'END_BREAK':
          if (!driver.currentShift) {
            throw new Error('No active shift found');
          }

          await prisma.driverShift.update({
            where: { id: driver.currentShift.id },
            data: { status: ShiftStatus.ACTIVE }
          });

          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { driverStatus: DriverStatus.AVAILABLE }
          });

          shiftData = { shiftId: driver.currentShift.id, status: ShiftStatus.ACTIVE };
          break;
      }

      // Track shift event
      await this.trackDriverEvent(driverId, 'SHIFT_ACTION', {
        action: action.type,
        shiftId: shiftData.shiftId,
        location: action.location
      });

      return {
        success: true,
        driver: {
          id: driverId,
          status: action.type === 'END_SHIFT' ? DriverStatus.OFFLINE : 
                 action.type === 'TAKE_BREAK' ? DriverStatus.ON_BREAK : DriverStatus.AVAILABLE
        },
        businessCase: 'SHIFT_MANAGEMENT',
        metadata: shiftData
      };

    } catch (error) {
      logger.error('Shift management failed', {
        error: error.message,
        driverId,
        action: action.type
      });
      throw error;
    }
  }

  // Delivery Assignment and Acceptance
  async manageDeliveryAssignment(driverId: string, action: {
    type: 'ACCEPT_DELIVERY' | 'DECLINE_DELIVERY' | 'START_PICKUP' | 'CONFIRM_PICKUP' | 'START_DELIVERY' | 'CONFIRM_DELIVERY';
    deliveryId: string;
    location?: DriverLocation;
    notes?: string;
    reason?: string;
    photos?: string[];
    customerSignature?: string;
  }): Promise<DriverBusinessCase> {
    try {
      logger.info('Managing delivery assignment', { 
        driverId, 
        action: action.type, 
        deliveryId: action.deliveryId 
      });

      const delivery = await prisma.delivery.findUnique({
        where: { id: action.deliveryId },
        include: { order: true, driver: true }
      });

      if (!delivery) {
        throw new Error('Delivery not found');
      }

      let updateData: any = {};
      let resultMetadata: any = {};

      switch (action.type) {
        case 'ACCEPT_DELIVERY':
          // Validate driver can accept delivery
          await this.validateDeliveryAcceptance(driverId, action.deliveryId);

          updateData = {
            driverId,
            status: 'ASSIGNED',
            assignedAt: new Date(),
            acceptedAt: new Date()
          };

          // Update driver status
          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { 
              driverStatus: DriverStatus.BUSY,
              acceptanceRate: { increment: 1 }
            }
          });

          // Calculate and share route information
          const routeInfo = await this.calculateDeliveryRoute(driverId, action.deliveryId);
          resultMetadata = { routeInfo, estimatedTime: routeInfo.duration };

          break;

        case 'DECLINE_DELIVERY':
          // Track decline reason
          await this.trackDeliveryDecline(driverId, action.deliveryId, action.reason);

          // Reassign delivery to another driver
          await this.reassignDelivery(action.deliveryId);

          // Update driver metrics
          await this.updateDriverDeclineMetrics(driverId);

          resultMetadata = { declined: true, reason: action.reason };
          break;

        case 'START_PICKUP':
          updateData = {
            status: 'PICKING_UP',
            pickupStartedAt: new Date(),
            driverLocation: action.location
          };

          // Notify merchant of driver arrival
          await this.notifyMerchantDriverArrival(delivery.order.merchantId, driverId);
          break;

        case 'CONFIRM_PICKUP':
          updateData = {
            status: 'IN_TRANSIT',
            pickedUpAt: new Date(),
            pickupNotes: action.notes,
            pickupPhotos: action.photos || []
          };

          // Update estimated delivery time
          const estimatedDelivery = await this.calculateEstimatedDeliveryTime(action.deliveryId);
          updateData.estimatedDeliveryTime = estimatedDelivery;

          // Notify customer of pickup
          await this.notifyCustomerPickup(delivery.order.customerId, action.deliveryId);
          break;

        case 'START_DELIVERY':
          updateData = {
            status: 'DELIVERING',
            deliveryStartedAt: new Date(),
            driverLocation: action.location
          };

          // Notify customer of imminent delivery
          await this.notifyCustomerDeliveryStart(delivery.order.customerId, action.deliveryId);
          break;

        case 'CONFIRM_DELIVERY':
          updateData = {
            status: 'DELIVERED',
            deliveredAt: new Date(),
            deliveryNotes: action.notes,
            deliveryPhotos: action.photos || [],
            customerSignature: action.customerSignature,
            completedAt: new Date()
          };

          // Calculate delivery performance metrics
          const performance = await this.calculateDeliveryPerformance(action.deliveryId);

          // Update driver earnings and metrics
          await this.updateDriverEarningsAndMetrics(driverId, action.deliveryId, performance);

          // Make driver available for next delivery
          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { 
              driverStatus: DriverStatus.AVAILABLE,
              totalDeliveries: { increment: 1 },
              onTimeRate: performance.onTime ? { increment: 1 } : undefined,
              completionRate: { increment: 1 }
            }
          });

          // Notify customer of completion
          await this.notifyCustomerDeliveryComplete(delivery.order.customerId, action.deliveryId);

          // Trigger rating request
          await this.requestDeliveryRating(delivery.order.customerId, driverId, action.deliveryId);

          resultMetadata = { 
            performance, 
            earnings: performance.earnings,
            bonusEarned: performance.bonus 
          };
          break;
      }

      // Update delivery record
      if (Object.keys(updateData).length > 0) {
        await prisma.delivery.update({
          where: { id: action.deliveryId },
          data: updateData
        });
      }

      // Track delivery event
      await this.trackDriverEvent(driverId, 'DELIVERY_ACTION', {
        action: action.type,
        deliveryId: action.deliveryId,
        location: action.location
      });

      return {
        success: true,
        driver: {
          id: driverId,
          status: action.type === 'CONFIRM_DELIVERY' ? DriverStatus.AVAILABLE : DriverStatus.BUSY
        },
        businessCase: 'DELIVERY_MANAGEMENT',
        metadata: {
          deliveryId: action.deliveryId,
          action: action.type,
          ...resultMetadata
        }
      };

    } catch (error) {
      logger.error('Delivery assignment management failed', {
        error: error.message,
        driverId,
        deliveryId: action.deliveryId,
        action: action.type
      });
      throw error;
    }
  }

  // Driver Earnings and Performance Tracking
  async trackDriverEarnings(driverId: string, period: {
    start: Date;
    end: Date;
  }): Promise<DriverEarnings> {
    try {
      const earnings = await prisma.driverEarnings.findMany({
        where: {
          driverId,
          earnedAt: {
            gte: period.start,
            lte: period.end
          }
        },
        include: {
          delivery: true,
          shift: true
        }
      });

      const summary = earnings.reduce((acc, earning) => {
        acc.totalEarnings += earning.amount;
        acc.baseEarnings += earning.baseAmount;
        acc.tips += earning.tips;
        acc.bonuses += earning.bonuses;
        acc.incentives += earning.incentives;
        acc.totalDeliveries += 1;
        acc.totalDistance += earning.distance || 0;
        acc.totalTime += earning.timeSpent || 0;
        return acc;
      }, {
        totalEarnings: 0,
        baseEarnings: 0,
        tips: 0,
        bonuses: 0,
        incentives: 0,
        totalDeliveries: 0,
        totalDistance: 0,
        totalTime: 0
      });

      // Calculate additional metrics
      const avgEarningsPerDelivery = summary.totalDeliveries > 0 
        ? summary.totalEarnings / summary.totalDeliveries : 0;
      const avgEarningsPerMile = summary.totalDistance > 0 
        ? summary.totalEarnings / summary.totalDistance : 0;
      const avgEarningsPerHour = summary.totalTime > 0 
        ? summary.totalEarnings / (summary.totalTime / 60) : 0;

      return {
        driverId,
        period,
        ...summary,
        avgEarningsPerDelivery,
        avgEarningsPerMile,
        avgEarningsPerHour,
        earningsBreakdown: earnings
      };

    } catch (error) {
      logger.error('Earnings tracking failed', {
        error: error.message,
        driverId
      });
      throw error;
    }
  }

  // Driver Performance Analytics
  async getDriverPerformance(driverId: string, timeframe: {
    start: Date;
    end: Date;
  }): Promise<DriverPerformance> {
    try {
      const [deliveries, shifts, ratings] = await Promise.all([
        prisma.delivery.findMany({
          where: {
            driverId,
            createdAt: {
              gte: timeframe.start,
              lte: timeframe.end
            }
          }
        }),
        prisma.driverShift.findMany({
          where: {
            driverId,
            startTime: {
              gte: timeframe.start,
              lte: timeframe.end
            }
          }
        }),
        prisma.driverRating.findMany({
          where: {
            driverId,
            createdAt: {
              gte: timeframe.start,
              lte: timeframe.end
            }
          }
        })
      ]);

      const performance = this.calculatePerformanceMetrics(deliveries, shifts, ratings);

      return {
        driverId,
        timeframe,
        ...performance
      };

    } catch (error) {
      logger.error('Performance analytics failed', {
        error: error.message,
        driverId
      });
      throw error;
    }
  }

  // Driver Location Tracking
  async updateDriverLocation(driverId: string, location: DriverLocation): Promise<DriverBusinessCase> {
    try {
      // Update location in Redis for real-time tracking
      await redis.setex(
        `driver:location:${driverId}`,
        300, // 5 minutes TTL
        JSON.stringify({
          ...location,
          timestamp: new Date()
        })
      );

      // Store location history
      await prisma.driverLocationHistory.create({
        data: {
          driverId,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          speed: location.speed,
          heading: location.heading,
          timestamp: new Date()
        }
      });

      // Check for geofence events
      await this.checkGeofenceEvents(driverId, location);

      // Update driver profile with last known location
      await prisma.driverProfile.update({
        where: { userId: driverId },
        data: { 
          lastKnownLocation: location,
          lastActiveAt: new Date()
        }
      });

      return {
        success: true,
        driver: { id: driverId },
        businessCase: 'LOCATION_UPDATE',
        metadata: {
          location,
          timestamp: new Date()
        }
      };

    } catch (error) {
      logger.error('Location update failed', {
        error: error.message,
        driverId
      });
      throw error;
    }
  }

  // Helper Methods

  private async initializeDriverPreferences(driverId: string): Promise<void> {
    await prisma.driverPreferences.create({
      data: {
        driverId,
        notifications: {
          newDeliveries: true,
          proximityAlerts: true,
          earningsUpdates: true,
          shiftReminders: true,
          trafficAlerts: true
        },
        availability: {
          maxDeliveryDistance: 15, // miles
          preferredZones: [],
          workingHours: {
            monday: { start: '09:00', end: '18:00', available: true },
            tuesday: { start: '09:00', end: '18:00', available: true },
            wednesday: { start: '09:00', end: '18:00', available: true },
            thursday: { start: '09:00', end: '18:00', available: true },
            friday: { start: '09:00', end: '18:00', available: true },
            saturday: { start: '10:00', end: '20:00', available: true },
            sunday: { start: '11:00', end: '19:00', available: false }
          }
        },
        delivery: {
          acceptanceRate: 80, // minimum acceptance rate
          autoAcceptFamiliarRoutes: false,
          prioritizeTips: true,
          maxConcurrentDeliveries: 1
        }
      }
    });
  }

  private async createDocumentRequirements(driverId: string): Promise<void> {
    const requiredDocuments = [
      { type: DocumentType.DRIVERS_LICENSE, required: true },
      { type: DocumentType.VEHICLE_REGISTRATION, required: true },
      { type: DocumentType.INSURANCE_CERTIFICATE, required: true },
      { type: DocumentType.BACKGROUND_CHECK, required: true },
      { type: DocumentType.PROFILE_PHOTO, required: true },
      { type: DocumentType.VEHICLE_PHOTO, required: true },
      { type: DocumentType.BANK_STATEMENT, required: false }
    ];

    for (const doc of requiredDocuments) {
      await prisma.driverDocument.create({
        data: {
          driverId,
          type: doc.type,
          status: 'PENDING',
          required: doc.required,
          uploadedAt: null,
          verifiedAt: null
        }
      });
    }
  }

  private async processDriverReferral(driverId: string, referralCode: string): Promise<void> {
    const referrer = await prisma.driverProfile.findFirst({
      where: { referralCode }
    });

    if (referrer) {
      await prisma.driverReferral.create({
        data: {
          referrerId: referrer.userId,
          referredId: driverId,
          code: referralCode,
          status: 'PENDING',
          referrerBonus: 500,
          referredBonus: 200
        }
      });
    }
  }

  private async trackDriverEvent(driverId: string, event: string, metadata: any): Promise<void> {
    await publishMessage('driver.events', {
      driverId,
      event,
      metadata,
      timestamp: new Date()
    });

    await prisma.driverEvent.create({
      data: {
        driverId,
        eventType: event,
        eventData: metadata,
        timestamp: new Date()
      }
    });
  }

  private async sendDriverWelcomeNotifications(driverId: string): Promise<void> {
    await publishMessage('notifications.send', {
      driverId,
      type: 'DRIVER_WELCOME_EMAIL',
      template: 'driver_welcome',
      priority: 'HIGH'
    });

    await publishMessage('notifications.send', {
      driverId,
      type: 'DRIVER_ONBOARDING_SMS',
      template: 'driver_onboarding',
      priority: 'MEDIUM'
    });
  }

  // Additional helper methods would continue here...
  // This provides a comprehensive foundation for driver business logic
}