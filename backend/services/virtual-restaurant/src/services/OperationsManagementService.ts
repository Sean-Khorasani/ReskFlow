import { prisma, logger } from '@reskflow/shared';
import { KitchenIntegrationService } from './KitchenIntegrationService';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface KitchenCapacity {
  totalCapacity: number;
  allocatedCapacity: number;
  availableCapacity: number;
  allocations: Array<{
    virtualRestaurantId: string;
    name: string;
    percentage: number;
    ordersPerHour: number;
  }>;
}

interface ConsolidatedOrder {
  orderId: string;
  virtualRestaurantName: string;
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    specialInstructions?: string;
    station: string;
  }>;
  priority: number;
  estimatedPrepTime: number;
  status: string;
}

interface StationAssignment {
  stationId: string;
  stationName: string;
  items: any[];
  currentLoad: number;
  estimatedTime: number;
}

interface KitchenPerformance {
  ordersPerHour: number;
  averagePrepTime: number;
  peakHours: number[];
  stationUtilization: Array<{
    station: string;
    utilization: number;
  }>;
  bottlenecks: string[];
}

export class OperationsManagementService {
  constructor(
    private kitchenIntegrationService: KitchenIntegrationService
  ) {}

  async getKitchenCapacity(kitchenId: string): Promise<KitchenCapacity> {
    const kitchen = await prisma.kitchen.findUnique({
      where: { id: kitchenId },
      include: {
        virtualRestaurants: {
          where: { status: 'active' },
        },
        capacityAllocations: {
          where: { is_active: true },
        },
      },
    });

    if (!kitchen) {
      throw new Error('Kitchen not found');
    }

    // Calculate allocations
    const allocations = kitchen.capacityAllocations.map(allocation => {
      const restaurant = kitchen.virtualRestaurants.find(
        vr => vr.id === allocation.virtual_restaurant_id
      );
      
      return {
        virtualRestaurantId: allocation.virtual_restaurant_id,
        name: restaurant?.name || 'Unknown',
        percentage: allocation.percentage,
        ordersPerHour: Math.floor((kitchen.max_orders_per_hour * allocation.percentage) / 100),
      };
    });

    const allocatedCapacity = allocations.reduce((sum, a) => sum + a.percentage, 0);
    const availableCapacity = 100 - allocatedCapacity;

    return {
      totalCapacity: kitchen.max_orders_per_hour,
      allocatedCapacity,
      availableCapacity,
      allocations,
    };
  }

  async allocateKitchenCapacity(
    kitchenId: string,
    virtualRestaurantId: string,
    percentage: number
  ): Promise<{ success: boolean; message: string }> {
    // Check available capacity
    const capacity = await this.getKitchenCapacity(kitchenId);
    
    if (capacity.availableCapacity < percentage) {
      throw new Error(
        `Insufficient capacity. Available: ${capacity.availableCapacity}%, Requested: ${percentage}%`
      );
    }

    // Check if allocation exists
    const existingAllocation = await prisma.capacityAllocation.findFirst({
      where: {
        kitchen_id: kitchenId,
        virtual_restaurant_id: virtualRestaurantId,
        is_active: true,
      },
    });

    if (existingAllocation) {
      // Update existing allocation
      await prisma.capacityAllocation.update({
        where: { id: existingAllocation.id },
        data: {
          percentage,
          updated_at: new Date(),
        },
      });
    } else {
      // Create new allocation
      await prisma.capacityAllocation.create({
        data: {
          id: uuidv4(),
          kitchen_id: kitchenId,
          virtual_restaurant_id: virtualRestaurantId,
          percentage,
          is_active: true,
          created_at: new Date(),
        },
      });
    }

    return {
      success: true,
      message: `Allocated ${percentage}% capacity to virtual restaurant`,
    };
  }

  async checkAvailableCapacity(kitchenId: string): Promise<boolean> {
    const capacity = await this.getKitchenCapacity(kitchenId);
    return capacity.availableCapacity >= 10; // Minimum 10% allocation
  }

  async getConsolidatedOrders(params: {
    kitchenId: string;
    virtualRestaurantId?: string;
    status?: string;
  }): Promise<ConsolidatedOrder[]> {
    const where: any = {
      virtual_restaurant: {
        parent_kitchen_id: params.kitchenId,
      },
    };

    if (params.virtualRestaurantId) {
      where.virtual_restaurant_id = params.virtualRestaurantId;
    }
    if (params.status) {
      where.status = params.status;
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        virtualRestaurant: true,
        orderItems: {
          include: { item: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    // Consolidate orders
    const consolidatedOrders: ConsolidatedOrder[] = [];

    for (const order of orders) {
      const items = order.orderItems.map(orderItem => ({
        itemId: orderItem.item_id,
        name: orderItem.item.name,
        quantity: orderItem.quantity,
        specialInstructions: orderItem.special_instructions,
        station: this.determineStation(orderItem.item),
      }));

      // Group by station for efficiency
      const stationGroups = this.groupByStation(items);
      const estimatedPrepTime = this.calculatePrepTime(stationGroups);

      consolidatedOrders.push({
        orderId: order.id,
        virtualRestaurantName: order.virtualRestaurant.name,
        items,
        priority: this.calculatePriority(order),
        estimatedPrepTime,
        status: order.status,
      });
    }

    // Sort by priority
    consolidatedOrders.sort((a, b) => b.priority - a.priority);

    return consolidatedOrders;
  }

  async routeOrderToStation(
    orderId: string,
    kitchenId: string
  ): Promise<StationAssignment[]> {
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

    // Get kitchen stations
    const stations = await this.kitchenIntegrationService.getKitchenStations(kitchenId);

    // Get current station loads
    const stationLoads = await this.getStationLoads(kitchenId);

    // Assign items to stations
    const assignments: StationAssignment[] = [];

    for (const orderItem of order.orderItems) {
      const station = this.determineStation(orderItem.item);
      const kitchenStation = stations.find(s => s.type === station);

      if (!kitchenStation) continue;

      let assignment = assignments.find(a => a.stationId === kitchenStation.id);
      if (!assignment) {
        assignment = {
          stationId: kitchenStation.id,
          stationName: kitchenStation.name,
          items: [],
          currentLoad: stationLoads.get(kitchenStation.id) || 0,
          estimatedTime: 0,
        };
        assignments.push(assignment);
      }

      assignment.items.push({
        itemId: orderItem.item_id,
        name: orderItem.item.name,
        quantity: orderItem.quantity,
        prepTime: orderItem.item.preparation_time || 10,
      });
    }

    // Calculate estimated times
    for (const assignment of assignments) {
      assignment.estimatedTime = this.calculateStationTime(
        assignment.items,
        assignment.currentLoad
      );

      // Create station assignment record
      await prisma.stationAssignment.create({
        data: {
          order_id: orderId,
          station_id: assignment.stationId,
          items: assignment.items,
          estimated_time: assignment.estimatedTime,
          assigned_at: new Date(),
        },
      });
    }

    return assignments;
  }

  async updateCapacityAllocation(data: {
    kitchenId: string;
    allocations: Array<{
      virtualRestaurantId: string;
      percentage: number;
    }>;
  }): Promise<void> {
    // Validate total doesn't exceed 100%
    const total = data.allocations.reduce((sum, a) => sum + a.percentage, 0);
    if (total > 100) {
      throw new Error('Total allocation cannot exceed 100%');
    }

    // Update allocations
    for (const allocation of data.allocations) {
      await this.allocateKitchenCapacity(
        data.kitchenId,
        allocation.virtualRestaurantId,
        allocation.percentage
      );
    }
  }

  async optimizeKitchenLayout(kitchenId: string): Promise<{
    currentEfficiency: number;
    optimizedEfficiency: number;
    recommendations: Array<{
      type: string;
      description: string;
      impact: string;
    }>;
  }> {
    // Analyze current kitchen performance
    const performance = await this.analyzeKitchenPerformance(kitchenId);
    const currentEfficiency = this.calculateEfficiency(performance);

    const recommendations: any[] = [];

    // Check for bottlenecks
    if (performance.bottlenecks.length > 0) {
      recommendations.push({
        type: 'bottleneck',
        description: `Address bottlenecks at: ${performance.bottlenecks.join(', ')}`,
        impact: 'high',
      });
    }

    // Check station utilization
    const underutilized = performance.stationUtilization.filter(s => s.utilization < 50);
    if (underutilized.length > 0) {
      recommendations.push({
        type: 'utilization',
        description: `Consolidate underutilized stations: ${underutilized.map(s => s.station).join(', ')}`,
        impact: 'medium',
      });
    }

    // Check peak hour performance
    if (performance.averagePrepTime > 20) {
      recommendations.push({
        type: 'prep_time',
        description: 'Add additional prep stations during peak hours',
        impact: 'high',
      });
    }

    // Calculate potential efficiency
    const optimizedEfficiency = Math.min(
      currentEfficiency + recommendations.length * 5,
      95
    );

    return {
      currentEfficiency,
      optimizedEfficiency,
      recommendations,
    };
  }

  async manageMultiBrandOrders(kitchenId: string): Promise<{
    ordersByBrand: Map<string, number>;
    crossUtilization: number;
    sharedIngredients: string[];
    optimizationPotential: number;
  }> {
    const thirtyMinutesAgo = dayjs().subtract(30, 'minute').toDate();

    // Get recent orders from all virtual restaurants in kitchen
    const orders = await prisma.order.findMany({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
        },
        created_at: { gte: thirtyMinutesAgo },
      },
      include: {
        virtualRestaurant: true,
        orderItems: {
          include: { item: true },
        },
      },
    });

    // Group by brand
    const ordersByBrand = new Map<string, number>();
    const ingredientUsage = new Map<string, Set<string>>();

    for (const order of orders) {
      const brand = order.virtualRestaurant.name;
      ordersByBrand.set(brand, (ordersByBrand.get(brand) || 0) + 1);

      // Track ingredient usage
      for (const orderItem of order.orderItems) {
        const ingredients = orderItem.item.ingredients || [];
        for (const ingredient of ingredients) {
          if (!ingredientUsage.has(ingredient)) {
            ingredientUsage.set(ingredient, new Set());
          }
          ingredientUsage.get(ingredient)!.add(brand);
        }
      }
    }

    // Find shared ingredients
    const sharedIngredients = Array.from(ingredientUsage.entries())
      .filter(([_, brands]) => brands.size > 1)
      .map(([ingredient, _]) => ingredient);

    // Calculate cross-utilization
    const totalIngredients = ingredientUsage.size;
    const crossUtilization = totalIngredients > 0
      ? (sharedIngredients.length / totalIngredients) * 100
      : 0;

    // Calculate optimization potential
    const optimizationPotential = this.calculateOptimizationPotential(
      ordersByBrand,
      crossUtilization,
      sharedIngredients.length
    );

    return {
      ordersByBrand,
      crossUtilization,
      sharedIngredients,
      optimizationPotential,
    };
  }

  private determineStation(item: any): string {
    // Determine kitchen station based on item category
    const stationMap: { [category: string]: string } = {
      'hot_food': 'grill',
      'cold_food': 'cold_prep',
      'beverages': 'beverage',
      'desserts': 'pastry',
      'salads': 'cold_prep',
      'sandwiches': 'sandwich',
      'pizza': 'pizza',
      'pasta': 'saute',
      'grilled': 'grill',
      'fried': 'fryer',
    };

    return stationMap[item.category] || 'general_prep';
  }

  private groupByStation(items: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();
    
    for (const item of items) {
      const station = item.station;
      if (!groups.has(station)) {
        groups.set(station, []);
      }
      groups.get(station)!.push(item);
    }

    return groups;
  }

  private calculatePrepTime(stationGroups: Map<string, any[]>): number {
    let maxTime = 0;

    // Prep time is determined by the slowest station
    for (const [station, items] of stationGroups) {
      const stationTime = items.reduce((total, item) => {
        return total + (item.prepTime || 10) * item.quantity;
      }, 0);
      
      maxTime = Math.max(maxTime, stationTime);
    }

    return maxTime;
  }

  private calculatePriority(order: any): number {
    let priority = 50; // Base priority

    // Age of order
    const orderAge = dayjs().diff(order.created_at, 'minute');
    priority += Math.min(orderAge, 30); // Max 30 points for age

    // Delivery time commitment
    if (order.promised_reskflow_time) {
      const timeUntilDelivery = dayjs(order.promised_reskflow_time).diff(dayjs(), 'minute');
      if (timeUntilDelivery < 30) {
        priority += 20;
      }
    }

    // VIP customers
    if (order.customer?.is_vip) {
      priority += 10;
    }

    return priority;
  }

  private async getStationLoads(kitchenId: string): Promise<Map<string, number>> {
    const activeAssignments = await prisma.stationAssignment.findMany({
      where: {
        station: {
          kitchen_id: kitchenId,
        },
        completed_at: null,
      },
      include: {
        station: true,
      },
    });

    const loads = new Map<string, number>();
    
    for (const assignment of activeAssignments) {
      const currentLoad = loads.get(assignment.station_id) || 0;
      loads.set(assignment.station_id, currentLoad + 1);
    }

    return loads;
  }

  private calculateStationTime(items: any[], currentLoad: number): number {
    const baseTime = items.reduce((total, item) => {
      return total + item.prepTime * item.quantity;
    }, 0);

    // Add time for current load (5 minutes per existing order)
    const loadTime = currentLoad * 5;

    return baseTime + loadTime;
  }

  private async analyzeKitchenPerformance(kitchenId: string): Promise<KitchenPerformance> {
    const oneHourAgo = dayjs().subtract(1, 'hour').toDate();
    const oneDayAgo = dayjs().subtract(1, 'day').toDate();

    // Get recent orders
    const recentOrders = await prisma.order.count({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
        },
        created_at: { gte: oneHourAgo },
      },
    });

    // Get prep times
    const completedOrders = await prisma.order.findMany({
      where: {
        virtual_restaurant: {
          parent_kitchen_id: kitchenId,
        },
        prepared_at: { not: null },
        created_at: { gte: oneDayAgo },
      },
    });

    const prepTimes = completedOrders.map(order => 
      dayjs(order.prepared_at).diff(order.created_at, 'minute')
    );

    const averagePrepTime = prepTimes.length > 0
      ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length
      : 0;

    // Analyze peak hours
    const hourlyOrders = await prisma.$queryRaw`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as order_count
      FROM orders o
      JOIN virtual_restaurants vr ON o.virtual_restaurant_id = vr.id
      WHERE vr.parent_kitchen_id = ${kitchenId}
        AND o.created_at >= ${oneDayAgo}
      GROUP BY hour
      ORDER BY order_count DESC
      LIMIT 3
    ` as any[];

    const peakHours = hourlyOrders.map(h => parseInt(h.hour));

    // Get station utilization
    const stationStats = await this.getStationUtilization(kitchenId);

    // Identify bottlenecks
    const bottlenecks = stationStats
      .filter(s => s.utilization > 90)
      .map(s => s.station);

    return {
      ordersPerHour: recentOrders,
      averagePrepTime: Math.round(averagePrepTime),
      peakHours,
      stationUtilization: stationStats,
      bottlenecks,
    };
  }

  private async getStationUtilization(kitchenId: string): Promise<any[]> {
    const stations = await this.kitchenIntegrationService.getKitchenStations(kitchenId);
    const utilization: any[] = [];

    for (const station of stations) {
      const activeOrders = await prisma.stationAssignment.count({
        where: {
          station_id: station.id,
          completed_at: null,
        },
      });

      utilization.push({
        station: station.name,
        utilization: Math.min((activeOrders / station.capacity) * 100, 100),
      });
    }

    return utilization;
  }

  private calculateEfficiency(performance: KitchenPerformance): number {
    let efficiency = 100;

    // Deduct for high prep time
    if (performance.averagePrepTime > 15) {
      efficiency -= (performance.averagePrepTime - 15) * 2;
    }

    // Deduct for bottlenecks
    efficiency -= performance.bottlenecks.length * 10;

    // Deduct for poor utilization
    const avgUtilization = performance.stationUtilization.reduce(
      (sum, s) => sum + s.utilization, 0
    ) / performance.stationUtilization.length;

    if (avgUtilization < 50) {
      efficiency -= (50 - avgUtilization) * 0.5;
    }

    return Math.max(0, Math.round(efficiency));
  }

  private calculateOptimizationPotential(
    ordersByBrand: Map<string, number>,
    crossUtilization: number,
    sharedIngredientsCount: number
  ): number {
    // Base potential
    let potential = 50;

    // Higher potential with more brands
    potential += Math.min(ordersByBrand.size * 5, 20);

    // Higher potential with more shared ingredients
    potential += Math.min(crossUtilization * 0.3, 20);

    // Bonus for significant ingredient sharing
    if (sharedIngredientsCount > 10) {
      potential += 10;
    }

    return Math.min(potential, 100);
  }
}