import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import geolib from 'geolib';
import dayjs from 'dayjs';

interface SafeDropLocation {
  id: string;
  name: string;
  type: 'lobby' | 'mailroom' | 'concierge' | 'security' | 'neighbor' | 'garage';
  description: string;
  distance: number;
  available: boolean;
  requirements?: string[];
}

interface SafeDropRequest {
  reskflowId: string;
  driverId: string;
  reason: string;
  attemptedLocation?: {
    latitude: number;
    longitude: number;
  };
  photoUrl?: string;
  notes?: string;
}

interface SafeDropResult {
  id: string;
  reskflowId: string;
  approved: boolean;
  safeLocation?: string;
  instructions?: string;
  verificationRequired: boolean;
  alternativeLocations?: SafeDropLocation[];
}

export class SafeDropService {
  private readonly SAFE_DROP_REASONS = [
    'customer_unavailable',
    'no_safe_location',
    'building_closed',
    'weather_conditions',
    'security_concerns',
    'customer_request',
  ];

  async initiateSafeDrop(params: {
    reskflowId: string;
    driverId: string;
    reason: string;
    safeLocation?: string;
    photoUrl?: string;
  }): Promise<SafeDropResult> {
    // Verify reskflow and driver
    const reskflow = await prisma.reskflow.findUnique({
      where: { id: params.reskflowId },
      include: {
        order: {
          include: {
            customer: true,
            contactlessDelivery: true,
          },
        },
      },
    });

    if (!reskflow || reskflow.driver_id !== params.driverId) {
      throw new Error('Delivery not found or unauthorized');
    }

    // Check if safe drop is enabled
    const contactlessSettings = reskflow.order.contactlessDelivery;
    if (!contactlessSettings?.safe_drop_enabled) {
      throw new Error('Safe drop not enabled for this order');
    }

    // Validate reason
    if (!this.SAFE_DROP_REASONS.includes(params.reason)) {
      throw new Error('Invalid safe drop reason');
    }

    // Get suggested locations
    const suggestedLocations = await this.getSuggestedDropLocations(params.reskflowId);

    // Create safe drop record
    const safeDrop = await prisma.safeDrop.create({
      data: {
        id: uuidv4(),
        reskflow_id: params.reskflowId,
        order_id: reskflow.order_id,
        driver_id: params.driverId,
        reason: params.reason,
        safe_location: params.safeLocation || suggestedLocations[0]?.name,
        photo_url: params.photoUrl,
        status: 'pending',
        created_at: new Date(),
      },
    });

    // Auto-approve based on customer preferences
    const autoApproved = await this.checkAutoApproval(reskflow.order, params.reason);

    if (autoApproved) {
      await prisma.safeDrop.update({
        where: { id: safeDrop.id },
        data: {
          status: 'approved',
          approved_at: new Date(),
          approved_by: 'auto',
        },
      });
    } else {
      // Notify customer for approval
      await this.notifyCustomerForApproval(safeDrop, reskflow.order);
    }

    return {
      id: safeDrop.id,
      reskflowId: params.reskflowId,
      approved: autoApproved,
      safeLocation: safeDrop.safe_location,
      instructions: this.generateSafeDropInstructions(params.reason, safeDrop.safe_location),
      verificationRequired: !autoApproved,
      alternativeLocations: suggestedLocations,
    };
  }

  async approveSafeDrop(safeDropId: string, customerId: string): Promise<void> {
    const safeDrop = await prisma.safeDrop.findUnique({
      where: { id: safeDropId },
      include: {
        order: true,
      },
    });

    if (!safeDrop || safeDrop.order.customer_id !== customerId) {
      throw new Error('Safe drop not found or unauthorized');
    }

    await prisma.safeDrop.update({
      where: { id: safeDropId },
      data: {
        status: 'approved',
        approved_at: new Date(),
        approved_by: customerId,
      },
    });

    // Notify driver
    await this.notifyDriverApproval(safeDrop.reskflow_id, true);
  }

  async rejectSafeDrop(
    safeDropId: string,
    customerId: string,
    reason?: string
  ): Promise<void> {
    const safeDrop = await prisma.safeDrop.findUnique({
      where: { id: safeDropId },
      include: {
        order: true,
      },
    });

    if (!safeDrop || safeDrop.order.customer_id !== customerId) {
      throw new Error('Safe drop not found or unauthorized');
    }

    await prisma.safeDrop.update({
      where: { id: safeDropId },
      data: {
        status: 'rejected',
        rejected_at: new Date(),
        rejected_by: customerId,
        rejection_reason: reason,
      },
    });

    // Notify driver
    await this.notifyDriverApproval(safeDrop.reskflow_id, false);
  }

  async getSuggestedDropLocations(reskflowId: string): Promise<SafeDropLocation[]> {
    const reskflow = await prisma.reskflow.findUnique({
      where: { id: reskflowId },
      include: {
        order: {
          include: {
            reskflowAddress: true,
          },
        },
      },
    });

    if (!reskflow) {
      throw new Error('Delivery not found');
    }

    const address = reskflow.order.reskflowAddress;
    const locations: SafeDropLocation[] = [];

    // Check building amenities
    const buildingAmenities = await this.getBuildingAmenities(address);

    if (buildingAmenities.hasLobby) {
      locations.push({
        id: 'lobby',
        name: 'Building Lobby',
        type: 'lobby',
        description: 'Leave with lobby attendant or concierge',
        distance: 0,
        available: true,
        requirements: ['Photo of reskflow location', 'Lobby attendant name'],
      });
    }

    if (buildingAmenities.hasMailroom) {
      locations.push({
        id: 'mailroom',
        name: 'Mailroom',
        type: 'mailroom',
        description: 'Leave in secure mailroom',
        distance: 0,
        available: true,
        requirements: ['Photo of reskflow', 'Mailroom access'],
      });
    }

    // Add standard options
    locations.push({
      id: 'door',
      name: 'Outside Door',
      type: 'garage',
      description: 'Leave outside apartment/house door',
      distance: 0,
      available: true,
      requirements: ['Photo of reskflow location'],
    });

    // Check for nearby safe locations
    const nearbyLocations = await this.getNearbySecureLocations(
      address.latitude,
      address.longitude
    );

    locations.push(...nearbyLocations);

    // Sort by distance and availability
    return locations.sort((a, b) => {
      if (a.available !== b.available) {
        return a.available ? -1 : 1;
      }
      return a.distance - b.distance;
    });
  }

  async recordSafeDropCompletion(
    safeDropId: string,
    photoUrl: string,
    actualLocation: string
  ): Promise<void> {
    await prisma.safeDrop.update({
      where: { id: safeDropId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        completion_photo_url: photoUrl,
        actual_location: actualLocation,
      },
    });
  }

  private async checkAutoApproval(order: any, reason: string): Promise<boolean> {
    // Check customer's safe drop preferences
    const preferences = await prisma.customerPreference.findUnique({
      where: { customer_id: order.customer_id },
    });

    if (!preferences?.safe_drop_preferences) {
      return false;
    }

    const safeDropPrefs = preferences.safe_drop_preferences as any;

    // Auto-approve based on reason
    if (safeDropPrefs.auto_approve_reasons?.includes(reason)) {
      return true;
    }

    // Auto-approve for trusted drivers
    if (safeDropPrefs.trusted_drivers?.includes(order.reskflow?.driver_id)) {
      return true;
    }

    // Auto-approve during specific hours
    if (safeDropPrefs.auto_approve_hours) {
      const currentHour = dayjs().hour();
      const { start, end } = safeDropPrefs.auto_approve_hours;
      
      if (start <= end) {
        return currentHour >= start && currentHour < end;
      } else {
        // Handles overnight hours (e.g., 22:00 - 6:00)
        return currentHour >= start || currentHour < end;
      }
    }

    return false;
  }

  private async getBuildingAmenities(address: any): Promise<{
    hasLobby: boolean;
    hasMailroom: boolean;
    hasConcierge: boolean;
  }> {
    // Check if building has amenities based on address type
    // This would integrate with building database or APIs
    
    const isApartment = address.address_type === 'apartment' || 
                       address.address_line2?.toLowerCase().includes('apt');

    return {
      hasLobby: isApartment && address.building_name,
      hasMailroom: isApartment,
      hasConcierge: address.building_type === 'luxury' || address.has_concierge,
    };
  }

  private async getNearbySecureLocations(
    latitude: number,
    longitude: number
  ): Promise<SafeDropLocation[]> {
    // Query nearby secure locations from database
    const nearbyLocations = await prisma.$queryRaw`
      SELECT 
        id,
        name,
        type,
        description,
        latitude,
        longitude,
        ST_Distance_Sphere(
          point(longitude, latitude),
          point(${longitude}, ${latitude})
        ) as distance
      FROM secure_locations
      WHERE ST_Distance_Sphere(
        point(longitude, latitude),
        point(${longitude}, ${latitude})
      ) < 100  -- Within 100 meters
      ORDER BY distance
      LIMIT 5
    `;

    return (nearbyLocations as any[]).map(loc => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      description: loc.description,
      distance: Math.round(loc.distance),
      available: true,
      requirements: ['Photo verification'],
    }));
  }

  private generateSafeDropInstructions(reason: string, location: string): string {
    const instructions: { [key: string]: string } = {
      customer_unavailable: `Customer is not available. Please leave the order at ${location} and take a photo for verification.`,
      no_safe_location: `No safe location at reskflow address. Leave at ${location} and ensure it's secure.`,
      building_closed: `Building is closed. Leave at ${location} or with security if available.`,
      weather_conditions: `Due to weather conditions, leave at ${location} in a protected area.`,
      security_concerns: `For security reasons, leave at ${location} and notify customer immediately.`,
      customer_request: `As requested by customer, leave at ${location}.`,
    };

    return instructions[reason] || `Please leave the order at ${location} and take a photo.`;
  }

  private async notifyCustomerForApproval(safeDrop: any, order: any): Promise<void> {
    // Send notification to customer for safe drop approval
    logger.info(`Notifying customer ${order.customer_id} for safe drop approval`);
    
    // This would integrate with notification service
  }

  private async notifyDriverApproval(reskflowId: string, approved: boolean): Promise<void> {
    // Send notification to driver about approval status
    logger.info(`Notifying driver for reskflow ${reskflowId}: ${approved ? 'approved' : 'rejected'}`);
    
    // This would integrate with notification service
  }
}