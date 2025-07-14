import { prisma, logger } from '@reskflow/shared';

interface TemperatureZone {
  zone: string;
  minTemp: number;
  maxTemp: number;
  description: string;
  itemCategories: string[];
}

interface OrderRequirements {
  zone: string;
  strictestRequirement: boolean;
  items: Array<{
    itemId: string;
    name: string;
    zone: string;
    specialRequirements?: string;
  }>;
}

interface ZoneTransition {
  fromZone: string;
  toZone: string;
  maxDuration: number; // minutes
  allowed: boolean;
}

export class TemperatureZoneService {
  private zones: Map<string, TemperatureZone> = new Map();
  private zoneTransitions: Map<string, ZoneTransition> = new Map();

  constructor() {
    this.initializeZones();
    this.initializeTransitions();
  }

  private initializeZones(): void {
    const zones: TemperatureZone[] = [
      {
        zone: 'frozen',
        minTemp: -25,
        maxTemp: -15,
        description: 'Deep frozen items (ice cream, frozen meals)',
        itemCategories: ['ice_cream', 'frozen_food', 'frozen_desserts'],
      },
      {
        zone: 'refrigerated',
        minTemp: 0,
        maxTemp: 5,
        description: 'Refrigerated items (dairy, meat, produce)',
        itemCategories: ['dairy', 'meat', 'seafood', 'deli', 'fresh_produce'],
      },
      {
        zone: 'cold',
        minTemp: 2,
        maxTemp: 8,
        description: 'Cold items (beverages, salads)',
        itemCategories: ['beverages', 'salads', 'sandwiches', 'fresh_juice'],
      },
      {
        zone: 'cool',
        minTemp: 8,
        maxTemp: 15,
        description: 'Cool items (chocolate, wine)',
        itemCategories: ['chocolate', 'wine', 'beer', 'kombucha'],
      },
      {
        zone: 'ambient',
        minTemp: 15,
        maxTemp: 25,
        description: 'Room temperature items',
        itemCategories: ['dry_goods', 'canned_food', 'snacks', 'bread'],
      },
      {
        zone: 'hot',
        minTemp: 60,
        maxTemp: 80,
        description: 'Hot prepared foods',
        itemCategories: ['hot_food', 'pizza', 'soup', 'grilled_items'],
      },
    ];

    zones.forEach(zone => this.zones.set(zone.zone, zone));
  }

  private initializeTransitions(): void {
    // Define allowed zone transitions and maximum duration
    const transitions: ZoneTransition[] = [
      // Frozen items can briefly enter refrigerated zone
      { fromZone: 'frozen', toZone: 'refrigerated', maxDuration: 10, allowed: true },
      // Refrigerated items can briefly enter cold zone
      { fromZone: 'refrigerated', toZone: 'cold', maxDuration: 15, allowed: true },
      // Cold items can enter cool zone
      { fromZone: 'cold', toZone: 'cool', maxDuration: 20, allowed: true },
      // Hot items should never enter cold zones
      { fromZone: 'hot', toZone: 'cold', maxDuration: 0, allowed: false },
      { fromZone: 'hot', toZone: 'refrigerated', maxDuration: 0, allowed: false },
      { fromZone: 'hot', toZone: 'frozen', maxDuration: 0, allowed: false },
    ];

    transitions.forEach(t => {
      const key = `${t.fromZone}-${t.toZone}`;
      this.zoneTransitions.set(key, t);
    });
  }

  async getOrderRequirements(orderId: string): Promise<OrderRequirements> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const itemRequirements: Array<{
      itemId: string;
      name: string;
      zone: string;
      specialRequirements?: string;
    }> = [];

    let strictestZone = 'ambient';
    let strictestMinTemp = -999;
    let strictestMaxTemp = 999;

    for (const orderItem of order.orderItems) {
      const item = orderItem.item;
      const zone = await this.getItemZone(item);
      
      itemRequirements.push({
        itemId: item.id,
        name: item.name,
        zone: zone.zone,
        specialRequirements: item.special_temperature_requirements,
      });

      // Find strictest requirements
      if (zone.minTemp > strictestMinTemp) {
        strictestMinTemp = zone.minTemp;
      }
      if (zone.maxTemp < strictestMaxTemp) {
        strictestMaxTemp = zone.maxTemp;
        strictestZone = zone.zone;
      }
    }

    return {
      zone: strictestZone,
      strictestRequirement: itemRequirements.some(i => i.specialRequirements),
      items: itemRequirements,
    };
  }

  async getItemZone(item: any): Promise<TemperatureZone> {
    // Check for custom temperature requirements
    if (item.custom_temperature_zone) {
      const customZone = this.zones.get(item.custom_temperature_zone);
      if (customZone) return customZone;
    }

    // Match by category
    for (const [zoneName, zone] of this.zones) {
      if (zone.itemCategories.includes(item.category)) {
        return zone;
      }
    }

    // Check for temperature keywords in item name/description
    const itemText = `${item.name} ${item.description}`.toLowerCase();
    
    if (itemText.includes('frozen') || itemText.includes('ice cream')) {
      return this.zones.get('frozen')!;
    }
    if (itemText.includes('cold') || itemText.includes('chilled')) {
      return this.zones.get('refrigerated')!;
    }
    if (itemText.includes('hot') || itemText.includes('warm')) {
      return this.zones.get('hot')!;
    }

    // Default to ambient
    return this.zones.get('ambient')!;
  }

  async checkZoneCompliance(params: {
    currentTemp: number;
    requiredZone: string;
    duration: number; // minutes at current temp
  }): Promise<{
    compliant: boolean;
    severity?: 'info' | 'warning' | 'critical';
    message?: string;
  }> {
    const zone = this.zones.get(params.requiredZone);
    if (!zone) {
      return { compliant: false, severity: 'critical', message: 'Unknown zone' };
    }

    // Check if temperature is within zone range
    if (params.currentTemp >= zone.minTemp && params.currentTemp <= zone.maxTemp) {
      return { compliant: true };
    }

    // Temperature out of range - determine severity
    const deviation = Math.max(
      zone.minTemp - params.currentTemp,
      params.currentTemp - zone.maxTemp
    );

    let severity: 'info' | 'warning' | 'critical';
    let message: string;

    if (deviation > 10) {
      severity = 'critical';
      message = `Temperature ${params.currentTemp}°C is critically out of range for ${zone.zone} zone`;
    } else if (deviation > 5 || params.duration > 10) {
      severity = 'warning';
      message = `Temperature ${params.currentTemp}°C exceeds ${zone.zone} zone limits`;
    } else {
      severity = 'info';
      message = `Minor temperature deviation detected`;
    }

    return { compliant: false, severity, message };
  }

  async validateMultiZoneDelivery(items: Array<{
    zone: string;
    quantity: number;
  }>): Promise<{
    isValid: boolean;
    conflicts: string[];
    recommendations: string[];
  }> {
    const conflicts: string[] = [];
    const recommendations: string[] = [];
    let isValid = true;

    // Check for incompatible zones
    const hasHot = items.some(i => i.zone === 'hot');
    const hasFrozen = items.some(i => i.zone === 'frozen');
    const hasRefrigerated = items.some(i => i.zone === 'refrigerated');

    if (hasHot && (hasFrozen || hasRefrigerated)) {
      isValid = false;
      conflicts.push('Hot items cannot be delivered with frozen/refrigerated items');
      recommendations.push('Use separate deliveries or insulated compartments');
    }

    if (hasFrozen && hasRefrigerated && !hasHot) {
      // This is allowed but needs special handling
      recommendations.push('Use dual-temperature vehicle or separate compartments');
    }

    // Check zone compatibility
    const zones = [...new Set(items.map(i => i.zone))];
    if (zones.length > 2 && !this.hasMultiZoneVehicle()) {
      recommendations.push('Consider using a multi-zone reskflow vehicle');
    }

    return { isValid, conflicts, recommendations };
  }

  async calculateZoneTransitionRisk(params: {
    fromZone: string;
    toZone: string;
    transitionDuration: number; // minutes
    itemType: string;
  }): Promise<{
    riskLevel: 'low' | 'medium' | 'high';
    allowed: boolean;
    maxAllowedDuration: number;
    recommendations: string[];
  }> {
    const key = `${params.fromZone}-${params.toZone}`;
    const transition = this.zoneTransitions.get(key);
    
    const recommendations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    if (!transition) {
      // No specific rule, calculate based on temperature difference
      const fromZone = this.zones.get(params.fromZone);
      const toZone = this.zones.get(params.toZone);
      
      if (!fromZone || !toZone) {
        return {
          riskLevel: 'high',
          allowed: false,
          maxAllowedDuration: 0,
          recommendations: ['Invalid zone transition'],
        };
      }

      const tempDiff = Math.abs(fromZone.maxTemp - toZone.minTemp);
      const maxDuration = Math.max(5, 30 - tempDiff); // Rough estimate

      if (params.transitionDuration > maxDuration) {
        riskLevel = 'high';
        recommendations.push('Minimize transition time');
      } else if (params.transitionDuration > maxDuration / 2) {
        riskLevel = 'medium';
        recommendations.push('Monitor temperature closely during transition');
      }

      return {
        riskLevel,
        allowed: true,
        maxAllowedDuration: maxDuration,
        recommendations,
      };
    }

    // Use predefined transition rules
    if (!transition.allowed) {
      return {
        riskLevel: 'high',
        allowed: false,
        maxAllowedDuration: 0,
        recommendations: ['This zone transition is not allowed'],
      };
    }

    if (params.transitionDuration > transition.maxDuration) {
      riskLevel = 'high';
      recommendations.push(`Transition time exceeds maximum allowed (${transition.maxDuration} min)`);
    } else if (params.transitionDuration > transition.maxDuration * 0.7) {
      riskLevel = 'medium';
      recommendations.push('Approaching maximum transition time');
    }

    return {
      riskLevel,
      allowed: transition.allowed,
      maxAllowedDuration: transition.maxDuration,
      recommendations,
    };
  }

  async getZoneSpecifications(): Promise<TemperatureZone[]> {
    return Array.from(this.zones.values());
  }

  async updateItemZone(itemId: string, zone: string): Promise<void> {
    if (!this.zones.has(zone)) {
      throw new Error('Invalid temperature zone');
    }

    await prisma.item.update({
      where: { id: itemId },
      data: { custom_temperature_zone: zone },
    });

    logger.info(`Updated item ${itemId} to temperature zone ${zone}`);
  }

  private hasMultiZoneVehicle(): boolean {
    // Check if multi-zone vehicles are available
    // In production, this would check actual vehicle capabilities
    return true;
  }

  async generateZoneReport(merchantId: string, period: string = '30d'): Promise<{
    zoneDistribution: Array<{ zone: string; itemCount: number; percentage: number }>;
    incompatibleOrders: number;
    multiZoneOrders: number;
    recommendations: string[];
  }> {
    const days = parseInt(period) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Analyze orders by temperature zones
    const orders = await prisma.order.findMany({
      where: {
        merchant_id: merchantId,
        created_at: { gte: startDate },
      },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
    });

    const zoneCount = new Map<string, number>();
    let incompatibleOrders = 0;
    let multiZoneOrders = 0;
    let totalItems = 0;

    for (const order of orders) {
      const orderZones = new Set<string>();
      
      for (const orderItem of order.orderItems) {
        const zone = await this.getItemZone(orderItem.item);
        orderZones.add(zone.zone);
        zoneCount.set(zone.zone, (zoneCount.get(zone.zone) || 0) + orderItem.quantity);
        totalItems += orderItem.quantity;
      }

      if (orderZones.size > 1) {
        multiZoneOrders++;
        
        // Check compatibility
        const items = Array.from(orderZones).map(z => ({ zone: z, quantity: 1 }));
        const validation = await this.validateMultiZoneDelivery(items);
        if (!validation.isValid) {
          incompatibleOrders++;
        }
      }
    }

    // Calculate distribution
    const zoneDistribution = Array.from(zoneCount.entries()).map(([zone, count]) => ({
      zone,
      itemCount: count,
      percentage: (count / totalItems) * 100,
    })).sort((a, b) => b.itemCount - a.itemCount);

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (incompatibleOrders > orders.length * 0.1) {
      recommendations.push('High number of incompatible temperature zones in orders');
      recommendations.push('Consider offering separate hot/cold reskflow options');
    }

    if (multiZoneOrders > orders.length * 0.3) {
      recommendations.push('Many orders require multi-zone handling');
      recommendations.push('Invest in multi-compartment reskflow vehicles');
    }

    const frozenPercentage = (zoneCount.get('frozen') || 0) / totalItems * 100;
    if (frozenPercentage > 20) {
      recommendations.push('High volume of frozen items');
      recommendations.push('Ensure adequate frozen storage capacity in vehicles');
    }

    return {
      zoneDistribution,
      incompatibleOrders,
      multiZoneOrders,
      recommendations,
    };
  }
}