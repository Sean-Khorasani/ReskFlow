/**
 * Emergency SOS Service
 * Manages driver safety, emergency contacts, and incident response
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import axios from 'axios';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { locationService } from '../location/location.service';

const prisma = new PrismaClient();

interface EmergencyContact {
  id: string;
  driverId: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
  notificationPreference: 'call' | 'sms' | 'both';
}

interface SOSIncident {
  id: string;
  driverId: string;
  type: 'accident' | 'medical' | 'safety' | 'vehicle_breakdown' | 'other';
  status: 'active' | 'responded' | 'resolved' | 'false_alarm';
  location: {
    latitude: number;
    longitude: number;
    address?: string;
    accuracy?: number;
  };
  triggeredAt: Date;
  respondedAt?: Date;
  resolvedAt?: Date;
  reskflowId?: string;
  description?: string;
  audioRecording?: string;
  photos?: string[];
  responders: EmergencyResponder[];
  timeline: IncidentEvent[];
}

interface EmergencyResponder {
  id: string;
  type: 'police' | 'ambulance' | 'platform_support' | 'emergency_contact';
  name?: string;
  arrivedAt?: Date;
  notes?: string;
}

interface IncidentEvent {
  timestamp: Date;
  type: string;
  description: string;
  metadata?: any;
}

interface SafetyCheckIn {
  id: string;
  driverId: string;
  scheduledAt: Date;
  respondedAt?: Date;
  status: 'pending' | 'confirmed' | 'missed' | 'escalated';
  location?: {
    latitude: number;
    longitude: number;
  };
}

interface SafetyZone {
  id: string;
  name: string;
  type: 'high_risk' | 'moderate_risk' | 'safe';
  polygon: Array<{ lat: number; lng: number }>;
  alerts: {
    enterAlert: boolean;
    stayAlert: boolean;
    checkInFrequency?: number; // minutes
  };
  activeHours?: {
    start: string;
    end: string;
  };
}

export class EmergencySOSService extends EventEmitter {
  private readonly EMERGENCY_HOTLINE = process.env.EMERGENCY_HOTLINE || '911';
  private readonly PLATFORM_EMERGENCY_LINE = process.env.PLATFORM_EMERGENCY_LINE;
  private activeIncidents: Map<string, SOSIncident> = new Map();
  private safetyZones: Map<string, SafetyZone> = new Map();

  constructor() {
    super();
    this.initializeSafetyZones();
    this.startMonitoring();
  }

  /**
   * Initialize safety zones
   */
  private async initializeSafetyZones() {
    const zones = await prisma.safetyZone.findMany({ where: { active: true } });
    zones.forEach(zone => {
      this.safetyZones.set(zone.id, zone);
    });
  }

  /**
   * Start monitoring services
   */
  private startMonitoring() {
    // Check for missed check-ins every minute
    setInterval(async () => {
      await this.checkMissedCheckIns();
    }, 60000);

    // Monitor active incidents every 30 seconds
    setInterval(async () => {
      await this.monitorActiveIncidents();
    }, 30000);
  }

  /**
   * Trigger SOS
   */
  async triggerSOS(
    driverId: string,
    data: {
      type: SOSIncident['type'];
      location: { latitude: number; longitude: number };
      reskflowId?: string;
      description?: string;
      silentMode?: boolean;
    }
  ): Promise<SOSIncident> {
    try {
      logger.error('SOS TRIGGERED', { driverId, ...data });

      // Get driver and current reskflow info
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        include: {
          user: true,
          vehicle: true,
          currentDelivery: {
            include: {
              order: {
                include: {
                  customer: true,
                  merchant: true,
                },
              },
            },
          },
        },
      });

      if (!driver) {
        throw new Error('Driver not found');
      }

      // Get address for location
      const address = await locationService.reverseGeocode(
        data.location.latitude,
        data.location.longitude
      );

      // Create incident
      const incident: SOSIncident = {
        id: `sos_${Date.now()}`,
        driverId,
        type: data.type,
        status: 'active',
        location: {
          ...data.location,
          address,
        },
        triggeredAt: new Date(),
        reskflowId: data.reskflowId || driver.currentDelivery?.id,
        description: data.description,
        responders: [],
        timeline: [
          {
            timestamp: new Date(),
            type: 'sos_triggered',
            description: `SOS triggered: ${data.type}`,
            metadata: { location: data.location },
          },
        ],
      };

      // Save to database
      await prisma.sosIncident.create({
        data: {
          ...incident,
          driverId,
        },
      });

      // Store in active incidents
      this.activeIncidents.set(incident.id, incident);

      // Start emergency response
      await this.initiateEmergencyResponse(incident, driver, data.silentMode);

      // Emit event
      this.emit('sos:triggered', {
        incident,
        driver,
      });

      return incident;

    } catch (error) {
      logger.error('Failed to trigger SOS', error);
      throw error;
    }
  }

  /**
   * Cancel SOS
   */
  async cancelSOS(incidentId: string, driverId: string, reason: string): Promise<void> {
    try {
      const incident = this.activeIncidents.get(incidentId);
      if (!incident || incident.driverId !== driverId) {
        throw new Error('Incident not found or unauthorized');
      }

      if (incident.status !== 'active') {
        throw new Error('Incident is not active');
      }

      // Update incident
      incident.status = 'false_alarm';
      incident.resolvedAt = new Date();
      incident.timeline.push({
        timestamp: new Date(),
        type: 'sos_cancelled',
        description: `SOS cancelled by driver: ${reason}`,
      });

      // Update database
      await prisma.sosIncident.update({
        where: { id: incidentId },
        data: {
          status: 'false_alarm',
          resolvedAt: new Date(),
          resolutionNotes: reason,
        },
      });

      // Notify responders
      await this.notifyRespondersOfCancellation(incident, reason);

      // Remove from active incidents
      this.activeIncidents.delete(incidentId);

      // Emit event
      this.emit('sos:cancelled', {
        incidentId,
        reason,
      });

    } catch (error) {
      logger.error('Failed to cancel SOS', error);
      throw error;
    }
  }

  /**
   * Update emergency contacts
   */
  async updateEmergencyContacts(
    driverId: string,
    contacts: Omit<EmergencyContact, 'id' | 'driverId'>[]
  ): Promise<EmergencyContact[]> {
    try {
      // Validate at least one contact
      if (contacts.length === 0) {
        throw new Error('At least one emergency contact is required');
      }

      // Ensure only one primary contact
      const primaryContacts = contacts.filter(c => c.isPrimary);
      if (primaryContacts.length !== 1) {
        throw new Error('Exactly one primary contact is required');
      }

      // Delete existing contacts
      await prisma.emergencyContact.deleteMany({
        where: { driverId },
      });

      // Create new contacts
      const createdContacts = await prisma.emergencyContact.createMany({
        data: contacts.map(contact => ({
          ...contact,
          driverId,
        })),
      });

      // Return created contacts
      return await prisma.emergencyContact.findMany({
        where: { driverId },
      });

    } catch (error) {
      logger.error('Failed to update emergency contacts', error);
      throw error;
    }
  }

  /**
   * Start safety check-in
   */
  async startSafetyCheckIn(
    driverId: string,
    frequency: number = 30 // minutes
  ): Promise<void> {
    try {
      // Cancel existing check-ins
      await this.cancelSafetyCheckIn(driverId);

      // Schedule first check-in
      const checkIn = await prisma.safetyCheckIn.create({
        data: {
          driverId,
          scheduledAt: new Date(Date.now() + frequency * 60 * 1000),
          status: 'pending',
        },
      });

      // Send notification
      await notificationService.sendDriverNotification(
        driverId,
        'Safety Check-In Activated',
        `We'll check on you every ${frequency} minutes. Stay safe!`,
        {
          type: 'safety_checkin_activated',
          frequency,
        }
      );

    } catch (error) {
      logger.error('Failed to start safety check-in', error);
      throw error;
    }
  }

  /**
   * Respond to safety check-in
   */
  async respondToCheckIn(
    checkInId: string,
    driverId: string,
    location?: { latitude: number; longitude: number }
  ): Promise<void> {
    try {
      const checkIn = await prisma.safetyCheckIn.findUnique({
        where: { id: checkInId },
      });

      if (!checkIn || checkIn.driverId !== driverId) {
        throw new Error('Check-in not found or unauthorized');
      }

      if (checkIn.status !== 'pending') {
        throw new Error('Check-in already processed');
      }

      // Update check-in
      await prisma.safetyCheckIn.update({
        where: { id: checkInId },
        data: {
          respondedAt: new Date(),
          status: 'confirmed',
          location,
        },
      });

      // Schedule next check-in
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      });

      if (driver?.safetyCheckInFrequency) {
        await prisma.safetyCheckIn.create({
          data: {
            driverId,
            scheduledAt: new Date(Date.now() + driver.safetyCheckInFrequency * 60 * 1000),
            status: 'pending',
          },
        });
      }

    } catch (error) {
      logger.error('Failed to respond to check-in', error);
      throw error;
    }
  }

  /**
   * Cancel safety check-in
   */
  async cancelSafetyCheckIn(driverId: string): Promise<void> {
    await prisma.safetyCheckIn.updateMany({
      where: {
        driverId,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
      },
    });
  }

  /**
   * Report safety concern
   */
  async reportSafetyConcern(
    driverId: string,
    concern: {
      type: 'unsafe_pickup' | 'unsafe_reskflow' | 'aggressive_customer' | 'suspicious_activity' | 'other';
      location: { latitude: number; longitude: number };
      description: string;
      orderId?: string;
      photos?: Express.Multer.File[];
    }
  ): Promise<void> {
    try {
      // Upload photos
      const photoUrls: string[] = [];
      if (concern.photos) {
        for (const photo of concern.photos) {
          const url = await storageService.uploadFile(
            photo,
            `safety-concerns/${driverId}/${Date.now()}`
          );
          photoUrls.push(url);
        }
      }

      // Create safety report
      const report = await prisma.safetyConcern.create({
        data: {
          driverId,
          type: concern.type,
          location: concern.location,
          description: concern.description,
          orderId: concern.orderId,
          photos: photoUrls,
          status: 'reported',
        },
      });

      // Check if location is in a safety zone
      const zone = this.checkSafetyZone(concern.location);
      if (!zone || zone.type === 'high_risk') {
        // Escalate to safety team
        await this.escalateToSafetyTeam(report, zone);
      }

      // Send confirmation
      await notificationService.sendDriverNotification(
        driverId,
        'Safety Concern Reported',
        'Your safety concern has been logged and our team is reviewing it',
        {
          type: 'safety_concern_reported',
          reportId: report.id,
        }
      );

    } catch (error) {
      logger.error('Failed to report safety concern', error);
      throw error;
    }
  }

  /**
   * Get incident details
   */
  async getIncidentDetails(incidentId: string): Promise<SOSIncident | null> {
    const incident = await prisma.sosIncident.findUnique({
      where: { id: incidentId },
      include: {
        driver: {
          include: {
            user: true,
            vehicle: true,
          },
        },
        reskflow: {
          include: {
            order: {
              include: {
                customer: true,
                merchant: true,
              },
            },
          },
        },
      },
    });

    return incident;
  }

  /**
   * Get driver safety stats
   */
  async getDriverSafetyStats(driverId: string): Promise<{
    incidents: number;
    checkInsCompleted: number;
    checkInsMissed: number;
    safetyScore: number;
    recentIncidents: SOSIncident[];
  }> {
    const [incidents, checkIns, recentIncidents] = await Promise.all([
      prisma.sosIncident.count({ where: { driverId } }),
      prisma.safetyCheckIn.groupBy({
        by: ['status'],
        where: { driverId },
        _count: true,
      }),
      prisma.sosIncident.findMany({
        where: { driverId },
        orderBy: { triggeredAt: 'desc' },
        take: 5,
      }),
    ]);

    const checkInStats = checkIns.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    const safetyScore = this.calculateSafetyScore(
      incidents,
      checkInStats.confirmed || 0,
      checkInStats.missed || 0
    );

    return {
      incidents,
      checkInsCompleted: checkInStats.confirmed || 0,
      checkInsMissed: checkInStats.missed || 0,
      safetyScore,
      recentIncidents,
    };
  }

  /**
   * Private helper methods
   */

  private async initiateEmergencyResponse(
    incident: SOSIncident,
    driver: any,
    silentMode?: boolean
  ): Promise<void> {
    // 1. Alert platform emergency team
    await this.alertPlatformEmergencyTeam(incident, driver);

    // 2. Contact emergency services if needed
    if (incident.type === 'accident' || incident.type === 'medical') {
      await this.contactEmergencyServices(incident, driver);
    }

    // 3. Notify emergency contacts
    await this.notifyEmergencyContacts(incident, driver, silentMode);

    // 4. Start location tracking
    await this.startEmergencyLocationTracking(driver.id, incident.id);

    // 5. If reskflow in progress, notify customer and merchant
    if (driver.currentDelivery) {
      await this.notifyDeliveryParties(incident, driver.currentDelivery);
    }

    // 6. Dispatch nearest drivers for assistance
    await this.dispatchNearbyDrivers(incident, driver);
  }

  private async alertPlatformEmergencyTeam(incident: SOSIncident, driver: any): Promise<void> {
    // Send to emergency response dashboard
    await notificationService.sendWebSocketEvent('emergency_team', 'new_sos_incident', {
      incident,
      driver: {
        id: driver.id,
        name: driver.user.name,
        phone: driver.phone,
        vehicle: driver.vehicle,
        location: incident.location,
      },
    });

    // Send SMS to on-call team
    if (this.PLATFORM_EMERGENCY_LINE) {
      await notificationService.sendSMS(
        this.PLATFORM_EMERGENCY_LINE,
        `SOS ALERT: ${driver.user.name} triggered ${incident.type} emergency at ${incident.location.address}. Incident ID: ${incident.id}`
      );
    }

    // Create emergency responder record
    incident.responders.push({
      id: `resp_${Date.now()}`,
      type: 'platform_support',
      name: 'Platform Emergency Team',
    });
  }

  private async contactEmergencyServices(incident: SOSIncident, driver: any): Promise<void> {
    // This would integrate with emergency services API
    // For now, log critical information
    logger.error('EMERGENCY SERVICES REQUIRED', {
      type: incident.type,
      location: incident.location,
      driver: {
        name: driver.user.name,
        phone: driver.phone,
        vehicle: `${driver.vehicle?.make} ${driver.vehicle?.model} ${driver.vehicle?.licensePlate}`,
      },
    });

    incident.responders.push({
      id: `resp_${Date.now()}`,
      type: incident.type === 'medical' ? 'ambulance' : 'police',
    });

    incident.timeline.push({
      timestamp: new Date(),
      type: 'emergency_services_contacted',
      description: `${this.EMERGENCY_HOTLINE} contacted`,
    });
  }

  private async notifyEmergencyContacts(
    incident: SOSIncident,
    driver: any,
    silentMode?: boolean
  ): Promise<void> {
    const contacts = await prisma.emergencyContact.findMany({
      where: { driverId: driver.id },
      orderBy: { isPrimary: 'desc' },
    });

    for (const contact of contacts) {
      if (!silentMode || contact.isPrimary) {
        const message = `EMERGENCY: ${driver.user.name} has triggered an SOS alert (${incident.type}). Location: ${incident.location.address}. Please check on them immediately.`;

        if (contact.notificationPreference === 'call' || contact.notificationPreference === 'both') {
          // Initiate automated call
          await this.makeEmergencyCall(contact.phone, message);
        }

        if (contact.notificationPreference === 'sms' || contact.notificationPreference === 'both') {
          await notificationService.sendSMS(contact.phone, message);
        }

        if (contact.email) {
          await notificationService.sendEmail(
            contact.email,
            'emergency_sos_alert',
            {
              contactName: contact.name,
              driverName: driver.user.name,
              incidentType: incident.type,
              location: incident.location,
              incidentId: incident.id,
              trackingLink: `${process.env.FRONTEND_URL}/emergency/track/${incident.id}`,
            }
          );
        }

        incident.responders.push({
          id: `resp_${Date.now()}`,
          type: 'emergency_contact',
          name: contact.name,
        });
      }
    }
  }

  private async startEmergencyLocationTracking(driverId: string, incidentId: string): Promise<void> {
    // Enable high-frequency location updates
    await locationService.enableEmergencyTracking(driverId, {
      interval: 5000, // 5 seconds
      accuracy: 'high',
      incidentId,
    });
  }

  private async notifyDeliveryParties(incident: SOSIncident, reskflow: any): Promise<void> {
    // Notify customer
    await notificationService.sendCustomerNotification(
      reskflow.order.customerId,
      'Delivery Delayed',
      'Your reskflow driver has encountered an issue. We are working to resolve it and will update you soon.',
      {
        type: 'reskflow_emergency_delay',
        orderId: reskflow.orderId,
      }
    );

    // Notify merchant
    await notificationService.sendMerchantNotification(
      reskflow.order.merchantId,
      'Driver Emergency',
      `Driver for order #${reskflow.order.orderNumber} has an emergency. Support team is handling the situation.`,
      {
        type: 'driver_emergency',
        orderId: reskflow.orderId,
      }
    );
  }

  private async dispatchNearbyDrivers(incident: SOSIncident, driver: any): Promise<void> {
    // Find nearby available drivers
    const nearbyDrivers = await locationService.findNearbyDrivers(
      incident.location,
      5 // 5 km radius
    );

    const availableDrivers = nearbyDrivers.filter(d => 
      d.id !== driver.id && d.isOnline && !d.isOnDelivery
    );

    // Notify up to 3 nearest drivers
    const driversToNotify = availableDrivers.slice(0, 3);

    for (const nearbyDriver of driversToNotify) {
      await notificationService.sendDriverNotification(
        nearbyDriver.id,
        'Fellow Driver Needs Help!',
        `A driver ${Math.round(nearbyDriver.distance * 10) / 10}km away has triggered an SOS. Can you assist?`,
        {
          type: 'driver_sos_nearby',
          incidentId: incident.id,
          location: incident.location,
          distance: nearbyDriver.distance,
        }
      );
    }
  }

  private async checkMissedCheckIns(): Promise<void> {
    const missedCheckIns = await prisma.safetyCheckIn.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lt: new Date() },
      },
      include: {
        driver: {
          include: { user: true },
        },
      },
    });

    for (const checkIn of missedCheckIns) {
      // Update status
      await prisma.safetyCheckIn.update({
        where: { id: checkIn.id },
        data: { status: 'missed' },
      });

      // Send urgent notification
      await notificationService.sendDriverNotification(
        checkIn.driverId,
        '🚨 URGENT: Safety Check-In Missed',
        'Please confirm you are safe immediately!',
        {
          type: 'safety_checkin_missed',
          checkInId: checkIn.id,
          urgent: true,
        }
      );

      // If multiple missed check-ins, escalate
      const recentMissed = await prisma.safetyCheckIn.count({
        where: {
          driverId: checkIn.driverId,
          status: 'missed',
          scheduledAt: {
            gte: new Date(Date.now() - 2 * 60 * 60 * 1000), // Last 2 hours
          },
        },
      });

      if (recentMissed >= 2) {
        // Auto-trigger SOS
        await this.triggerSOS(checkIn.driverId, {
          type: 'safety',
          location: checkIn.driver.currentLocation || { latitude: 0, longitude: 0 },
          description: 'Multiple missed safety check-ins',
          silentMode: true,
        });
      }
    }
  }

  private async monitorActiveIncidents(): Promise<void> {
    for (const [incidentId, incident] of this.activeIncidents) {
      // Check if incident is taking too long
      const duration = Date.now() - incident.triggeredAt.getTime();
      
      if (duration > 30 * 60 * 1000 && !incident.respondedAt) {
        // 30 minutes without response
        await this.escalateIncident(incident);
      }
    }
  }

  private async escalateIncident(incident: SOSIncident): Promise<void> {
    incident.timeline.push({
      timestamp: new Date(),
      type: 'incident_escalated',
      description: 'Incident escalated due to no response',
    });

    // Notify senior management
    await notificationService.sendEmail(
      process.env.SAFETY_MANAGER_EMAIL!,
      'sos_incident_escalation',
      {
        incidentId: incident.id,
        driverId: incident.driverId,
        type: incident.type,
        duration: Math.round((Date.now() - incident.triggeredAt.getTime()) / 60000),
        location: incident.location,
      }
    );
  }

  private async notifyRespondersOfCancellation(incident: SOSIncident, reason: string): Promise<void> {
    // Notify platform team
    await notificationService.sendWebSocketEvent('emergency_team', 'sos_cancelled', {
      incidentId: incident.id,
      reason,
    });

    // Notify emergency contacts
    const contacts = await prisma.emergencyContact.findMany({
      where: { driverId: incident.driverId },
    });

    for (const contact of contacts) {
      await notificationService.sendSMS(
        contact.phone,
        `FALSE ALARM: The emergency alert has been cancelled. Reason: ${reason}`
      );
    }
  }

  private checkSafetyZone(location: { latitude: number; longitude: number }): SafetyZone | null {
    for (const [id, zone of this.safetyZones) {
      if (this.isPointInPolygon(location, zone.polygon)) {
        return zone;
      }
    }
    return null;
  }

  private isPointInPolygon(
    point: { latitude: number; longitude: number },
    polygon: Array<{ lat: number; lng: number }>
  ): boolean {
    let inside = false;
    const x = point.latitude;
    const y = point.longitude;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lat;
      const yi = polygon[i].lng;
      const xj = polygon[j].lat;
      const yj = polygon[j].lng;

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      
      if (intersect) inside = !inside;
    }

    return inside;
  }

  private async escalateToSafetyTeam(report: any, zone: SafetyZone | null): Promise<void> {
    await notificationService.sendWebSocketEvent('safety_team', 'safety_concern_high_priority', {
      report,
      zone: zone?.name,
      riskLevel: zone?.type || 'unknown',
    });
  }

  private calculateSafetyScore(incidents: number, checkInsCompleted: number, checkInsMissed: number): number {
    let score = 100;

    // Deduct for incidents
    score -= incidents * 10;

    // Deduct for missed check-ins
    score -= checkInsMissed * 5;

    // Bonus for completed check-ins
    score += Math.min(checkInsCompleted * 0.5, 10);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private async makeEmergencyCall(phone: string, message: string): Promise<void> {
    // This would integrate with a service like Twilio
    // For now, log the action
    logger.info('Emergency call initiated', { phone, message });
  }

  /**
   * Test SOS system
   */
  async testSOSSystem(driverId: string): Promise<{
    contactsConfigured: boolean;
    locationAvailable: boolean;
    notificationsSent: boolean;
    systemReady: boolean;
  }> {
    const results = {
      contactsConfigured: false,
      locationAvailable: false,
      notificationsSent: false,
      systemReady: false,
    };

    // Check emergency contacts
    const contacts = await prisma.emergencyContact.count({ where: { driverId } });
    results.contactsConfigured = contacts > 0;

    // Check location availability
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { currentLocation: true },
    });
    results.locationAvailable = !!driver?.currentLocation;

    // Test notification
    try {
      await notificationService.sendDriverNotification(
        driverId,
        'SOS System Test',
        'This is a test of the emergency SOS system. No action required.',
        {
          type: 'sos_test',
          test: true,
        }
      );
      results.notificationsSent = true;
    } catch (error) {
      logger.error('SOS test notification failed', error);
    }

    results.systemReady = results.contactsConfigured && results.locationAvailable && results.notificationsSent;

    return results;
  }
}

// Export singleton instance
export const emergencySOSService = new EmergencySOSService();