import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';

interface Kitchen {
  id: string;
  name: string;
  address: string;
  capacity: number;
  equipment: string[];
  isActive: boolean;
  operatingHours: {
    [day: string]: { open: string; close: string };
  };
}

interface KitchenStation {
  id: string;
  kitchenId: string;
  name: string;
  type: string;
  capacity: number;
  equipment: string[];
  isActive: boolean;
}

interface RegisterKitchenParams {
  id?: string;
  name: string;
  address: string;
  capacity: number;
  equipment: string[];
  ownerId: string;
  operatingHours?: any;
}

interface EquipmentStatus {
  equipmentId: string;
  name: string;
  status: 'operational' | 'maintenance' | 'repair';
  lastMaintenance?: Date;
  nextMaintenance?: Date;
}

export class KitchenIntegrationService {
  async registerKitchen(params: RegisterKitchenParams): Promise<Kitchen> {
    const kitchenId = params.id || uuidv4();

    // Check if kitchen already exists
    const existing = await prisma.kitchen.findUnique({
      where: { id: kitchenId },
    });

    if (existing) {
      throw new Error('Kitchen already registered');
    }

    // Create kitchen
    const kitchen = await prisma.kitchen.create({
      data: {
        id: kitchenId,
        name: params.name,
        address: params.address,
        max_orders_per_hour: params.capacity,
        equipment: params.equipment,
        owner_id: params.ownerId,
        operating_hours: params.operatingHours || this.getDefaultOperatingHours(),
        is_active: true,
        created_at: new Date(),
      },
    });

    // Create default stations
    await this.createDefaultStations(kitchenId);

    return this.mapToKitchen(kitchen);
  }

  async updateKitchen(
    kitchenId: string,
    updates: Partial<Kitchen>,
    userId: string
  ): Promise<Kitchen> {
    const kitchen = await prisma.kitchen.findUnique({
      where: { id: kitchenId },
    });

    if (!kitchen || kitchen.owner_id !== userId) {
      throw new Error('Kitchen not found or unauthorized');
    }

    const updated = await prisma.kitchen.update({
      where: { id: kitchenId },
      data: {
        name: updates.name,
        address: updates.address,
        max_orders_per_hour: updates.capacity,
        equipment: updates.equipment,
        operating_hours: updates.operatingHours,
        updated_at: new Date(),
      },
    });

    return this.mapToKitchen(updated);
  }

  async getKitchenStations(kitchenId: string): Promise<KitchenStation[]> {
    const stations = await prisma.kitchenStation.findMany({
      where: {
        kitchen_id: kitchenId,
        is_active: true,
      },
      orderBy: { created_at: 'asc' },
    });

    return stations.map(s => this.mapToKitchenStation(s));
  }

  async createKitchenStation(params: {
    kitchenId: string;
    name: string;
    type: string;
    capacity: number;
    equipment: string[];
  }): Promise<KitchenStation> {
    const station = await prisma.kitchenStation.create({
      data: {
        id: uuidv4(),
        kitchen_id: params.kitchenId,
        name: params.name,
        type: params.type,
        capacity: params.capacity,
        equipment: params.equipment,
        is_active: true,
        created_at: new Date(),
      },
    });

    return this.mapToKitchenStation(station);
  }

  async updateStationCapacity(
    stationId: string,
    capacity: number
  ): Promise<void> {
    await prisma.kitchenStation.update({
      where: { id: stationId },
      data: {
        capacity,
        updated_at: new Date(),
      },
    });
  }

  async getEquipmentStatus(kitchenId: string): Promise<EquipmentStatus[]> {
    const equipment = await prisma.kitchenEquipment.findMany({
      where: { kitchen_id: kitchenId },
    });

    return equipment.map(e => ({
      equipmentId: e.id,
      name: e.name,
      status: e.status as 'operational' | 'maintenance' | 'repair',
      lastMaintenance: e.last_maintenance,
      nextMaintenance: e.next_maintenance,
    }));
  }

  async updateEquipmentStatus(
    equipmentId: string,
    status: 'operational' | 'maintenance' | 'repair'
  ): Promise<void> {
    await prisma.kitchenEquipment.update({
      where: { id: equipmentId },
      data: {
        status,
        status_updated_at: new Date(),
      },
    });

    if (status === 'maintenance') {
      await prisma.kitchenEquipment.update({
        where: { id: equipmentId },
        data: {
          last_maintenance: new Date(),
          next_maintenance: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        },
      });
    }
  }

  async checkKitchenAvailability(
    kitchenId: string,
    orderTime: Date
  ): Promise<{
    isAvailable: boolean;
    reason?: string;
    nextAvailable?: Date;
  }> {
    const kitchen = await prisma.kitchen.findUnique({
      where: { id: kitchenId },
    });

    if (!kitchen || !kitchen.is_active) {
      return {
        isAvailable: false,
        reason: 'Kitchen is not active',
      };
    }

    // Check operating hours
    const dayOfWeek = orderTime.toLocaleDateString('en-US', { weekday: 'lowercase' });
    const hours = kitchen.operating_hours[dayOfWeek];
    
    if (!hours) {
      return {
        isAvailable: false,
        reason: 'Kitchen closed on this day',
      };
    }

    const orderHour = orderTime.getHours();
    const orderMinute = orderTime.getMinutes();
    const orderTimeString = `${orderHour.toString().padStart(2, '0')}:${orderMinute.toString().padStart(2, '0')}`;

    if (orderTimeString < hours.open || orderTimeString > hours.close) {
      return {
        isAvailable: false,
        reason: 'Outside operating hours',
        nextAvailable: this.getNextAvailableTime(kitchen, orderTime),
      };
    }

    // Check capacity
    const currentOrders = await prisma.order.count({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
        },
        created_at: {
          gte: new Date(orderTime.getTime() - 60 * 60 * 1000), // Last hour
        },
        status: { in: ['pending', 'preparing'] },
      },
    });

    if (currentOrders >= kitchen.max_orders_per_hour) {
      return {
        isAvailable: false,
        reason: 'Kitchen at capacity',
        nextAvailable: new Date(orderTime.getTime() + 30 * 60 * 1000), // 30 minutes later
      };
    }

    return { isAvailable: true };
  }

  async getKitchenMetrics(
    kitchenId: string,
    period: string = '24h'
  ): Promise<{
    totalOrders: number;
    averagePrepTime: number;
    peakHours: number[];
    utilizationRate: number;
    equipmentDowntime: number;
  }> {
    const hours = parseInt(period) || 24;
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get orders
    const orders = await prisma.order.findMany({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
        },
        created_at: { gte: startTime },
      },
    });

    const totalOrders = orders.length;

    // Calculate average prep time
    const completedOrders = orders.filter(o => o.prepared_at);
    const prepTimes = completedOrders.map(o => 
      (o.prepared_at!.getTime() - o.created_at.getTime()) / (1000 * 60)
    );
    const averagePrepTime = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length
      : 0;

    // Find peak hours
    const hourCounts = new Map<number, number>();
    orders.forEach(order => {
      const hour = order.created_at.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });

    const peakHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => hour);

    // Calculate utilization
    const kitchen = await prisma.kitchen.findUnique({
      where: { id: kitchenId },
    });
    const maxCapacity = (kitchen?.max_orders_per_hour || 50) * hours;
    const utilizationRate = (totalOrders / maxCapacity) * 100;

    // Calculate equipment downtime
    const equipmentDowntime = await this.calculateEquipmentDowntime(kitchenId, startTime);

    return {
      totalOrders,
      averagePrepTime: Math.round(averagePrepTime),
      peakHours,
      utilizationRate: Math.round(utilizationRate),
      equipmentDowntime,
    };
  }

  async integrateWithPOS(
    kitchenId: string,
    posSystem: string,
    credentials: any
  ): Promise<{ success: boolean; message: string }> {
    // Store POS integration details
    await prisma.kitchenIntegration.create({
      data: {
        kitchen_id: kitchenId,
        integration_type: 'pos',
        provider: posSystem,
        credentials: credentials, // Should be encrypted
        is_active: true,
        created_at: new Date(),
      },
    });

    // Test connection
    const connected = await this.testPOSConnection(posSystem, credentials);
    
    if (!connected) {
      throw new Error('Failed to connect to POS system');
    }

    return {
      success: true,
      message: `Successfully integrated with ${posSystem}`,
    };
  }

  private async createDefaultStations(kitchenId: string): Promise<void> {
    const defaultStations = [
      { name: 'Grill Station', type: 'grill', capacity: 10, equipment: ['grill', 'flat_top'] },
      { name: 'Cold Prep', type: 'cold_prep', capacity: 15, equipment: ['refrigerator', 'cutting_board'] },
      { name: 'Hot Line', type: 'saute', capacity: 12, equipment: ['stove', 'oven'] },
      { name: 'Fryer Station', type: 'fryer', capacity: 8, equipment: ['deep_fryer'] },
      { name: 'Beverage Station', type: 'beverage', capacity: 20, equipment: ['beverage_dispenser', 'coffee_machine'] },
      { name: 'Dessert Station', type: 'pastry', capacity: 10, equipment: ['refrigerator', 'display_case'] },
    ];

    for (const station of defaultStations) {
      await this.createKitchenStation({
        kitchenId,
        ...station,
      });
    }
  }

  private getDefaultOperatingHours(): any {
    const defaultHours = { open: '09:00', close: '22:00' };
    return {
      monday: defaultHours,
      tuesday: defaultHours,
      wednesday: defaultHours,
      thursday: defaultHours,
      friday: { open: '09:00', close: '23:00' },
      saturday: { open: '09:00', close: '23:00' },
      sunday: { open: '10:00', close: '21:00' },
    };
  }

  private getNextAvailableTime(kitchen: any, currentTime: Date): Date {
    const tomorrow = new Date(currentTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dayOfWeek = tomorrow.toLocaleDateString('en-US', { weekday: 'lowercase' });
    const hours = kitchen.operating_hours[dayOfWeek];
    
    if (hours) {
      const [openHour, openMinute] = hours.open.split(':').map(Number);
      tomorrow.setHours(openHour, openMinute, 0, 0);
      return tomorrow;
    }
    
    return currentTime;
  }

  private async calculateEquipmentDowntime(
    kitchenId: string,
    startTime: Date
  ): Promise<number> {
    const downtimeRecords = await prisma.equipmentDowntime.findMany({
      where: {
        equipment: {
          kitchen_id: kitchenId,
        },
        start_time: { gte: startTime },
      },
    });

    let totalDowntime = 0;
    for (const record of downtimeRecords) {
      const duration = record.end_time
        ? (record.end_time.getTime() - record.start_time.getTime()) / (1000 * 60 * 60)
        : 0;
      totalDowntime += duration;
    }

    return Math.round(totalDowntime);
  }

  private async testPOSConnection(
    posSystem: string,
    credentials: any
  ): Promise<boolean> {
    // In production, this would actually test the connection
    logger.info(`Testing connection to ${posSystem}`);
    return true;
  }

  private mapToKitchen(dbKitchen: any): Kitchen {
    return {
      id: dbKitchen.id,
      name: dbKitchen.name,
      address: dbKitchen.address,
      capacity: dbKitchen.max_orders_per_hour,
      equipment: dbKitchen.equipment,
      isActive: dbKitchen.is_active,
      operatingHours: dbKitchen.operating_hours,
    };
  }

  private mapToKitchenStation(dbStation: any): KitchenStation {
    return {
      id: dbStation.id,
      kitchenId: dbStation.kitchen_id,
      name: dbStation.name,
      type: dbStation.type,
      capacity: dbStation.capacity,
      equipment: dbStation.equipment,
      isActive: dbStation.is_active,
    };
  }
}