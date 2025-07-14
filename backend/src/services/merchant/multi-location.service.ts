/**
 * Multi-Location Management Service
 * Manages multiple merchant locations, centralized operations, and franchise management
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { analyticsService } from '../analytics/analytics.service';

const prisma = new PrismaClient();

interface MerchantGroup {
  id: string;
  name: string;
  type: 'chain' | 'franchise' | 'multi_outlet';
  headquarters: {
    address: string;
    city: string;
    state: string;
    country: string;
    timezone: string;
  };
  brandGuidelines?: BrandGuidelines;
  centralizedServices: string[]; // 'menu', 'pricing', 'inventory', 'marketing', 'hr'
  settings: GroupSettings;
  createdAt: Date;
  updatedAt: Date;
}

interface Location {
  id: string;
  groupId: string;
  merchantId: string;
  name: string;
  code: string; // Unique location code
  type: 'company_owned' | 'franchise' | 'licensed';
  status: 'active' | 'inactive' | 'suspended' | 'closed';
  manager: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    latitude: number;
    longitude: number;
  };
  operatingHours: OperatingHours;
  serviceArea?: ServiceArea;
  capabilities: string[]; // 'reskflow', 'pickup', 'dine_in', 'catering'
  performance: LocationPerformance;
  settings: LocationSettings;
  joinedAt: Date;
}

interface BrandGuidelines {
  logo: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  menuStyle: 'centralized' | 'localized' | 'hybrid';
  pricingStrategy: 'uniform' | 'zone_based' | 'location_based';
}

interface GroupSettings {
  requireApprovalFor: string[]; // 'menu_changes', 'price_changes', 'promotions'
  revenueSharing?: {
    enabled: boolean;
    platformFee: number;
    franchiseFee?: number;
    marketingFee?: number;
  };
  dataSharing: {
    customerData: boolean;
    salesData: boolean;
    inventoryData: boolean;
  };
  communicationChannels: string[]; // 'email', 'sms', 'dashboard', 'mobile_app'
}

interface LocationSettings {
  autonomy: {
    menuCustomization: boolean;
    pricingAdjustment: boolean;
    promotions: boolean;
    inventory: boolean;
    staffing: boolean;
  };
  overrides: {
    operatingHours?: boolean;
    serviceArea?: boolean;
    reskflowFees?: boolean;
  };
  reporting: {
    frequency: 'daily' | 'weekly' | 'monthly';
    metrics: string[];
  };
}

interface OperatingHours {
  regular: Array<{
    dayOfWeek: number;
    open: string;
    close: string;
    breaks?: Array<{ start: string; end: string }>;
  }>;
  holidays: Array<{
    date: Date;
    hours?: { open: string; close: string };
    closed: boolean;
  }>;
}

interface ServiceArea {
  type: 'radius' | 'polygon' | 'zones';
  radius?: number; // km
  polygon?: Array<{ lat: number; lng: number }>;
  zones?: string[]; // ZIP codes or zone IDs
  reskflowFees: Array<{
    distance: number;
    fee: number;
  }>;
}

interface LocationPerformance {
  rating: number;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  customerSatisfaction: number;
  operationalEfficiency: number;
  complianceScore: number;
  lastUpdated: Date;
}

interface CentralizedMenu {
  id: string;
  groupId: string;
  name: string;
  description: string;
  categories: MenuCategory[];
  applicableLocations: string[]; // 'all' or specific location IDs
  variations: MenuVariation[];
  lastUpdated: Date;
}

interface MenuCategory {
  id: string;
  name: string;
  description?: string;
  items: MenuItem[];
  displayOrder: number;
}

interface MenuItem {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  images: string[];
  nutritionalInfo?: any;
  allergens: string[];
  preparationTime: number;
  availability: 'always' | 'seasonal' | 'limited';
  customizations: any[];
}

interface MenuVariation {
  locationId: string;
  itemVariations: Array<{
    itemId: string;
    priceAdjustment?: number;
    available: boolean;
    customNote?: string;
  }>;
}

interface LocationComparison {
  period: { start: Date; end: Date };
  locations: Array<{
    location: Location;
    metrics: {
      revenue: number;
      orders: number;
      averageOrderValue: number;
      customerSatisfaction: number;
      operationalCost: number;
      profitMargin: number;
    };
    rank: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  insights: string[];
  recommendations: string[];
}

interface TransferRequest {
  id: string;
  type: 'inventory' | 'staff' | 'equipment';
  fromLocationId: string;
  toLocationId: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit?: string;
  }>;
  reason: string;
  status: 'pending' | 'approved' | 'in_transit' | 'completed' | 'cancelled';
  requestedBy: string;
  approvedBy?: string;
  completedAt?: Date;
}

export class MultiLocationService extends EventEmitter {
  private locationCache: Map<string, Location> = new Map();
  private performanceJob: CronJob;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private initializeService() {
    // Load locations into cache
    this.loadLocations();

    // Setup performance calculation job
    this.performanceJob = new CronJob('0 */6 * * *', async () => {
      await this.calculateLocationPerformance();
    });
    this.performanceJob.start();
  }

  /**
   * Create merchant group
   */
  async createMerchantGroup(
    group: Omit<MerchantGroup, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MerchantGroup> {
    try {
      const newGroup: MerchantGroup = {
        id: `group_${Date.now()}`,
        ...group,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await prisma.merchantGroup.create({
        data: newGroup,
      });

      this.emit('group:created', {
        groupId: newGroup.id,
        name: group.name,
      });

      return newGroup;

    } catch (error) {
      logger.error('Failed to create merchant group', error);
      throw error;
    }
  }

  /**
   * Add location to group
   */
  async addLocation(
    groupId: string,
    location: Omit<Location, 'id' | 'groupId' | 'performance' | 'joinedAt'>
  ): Promise<Location> {
    try {
      const group = await prisma.merchantGroup.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        throw new Error('Merchant group not found');
      }

      // Initialize performance metrics
      const initialPerformance: LocationPerformance = {
        rating: 0,
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        customerSatisfaction: 0,
        operationalEfficiency: 0,
        complianceScore: 100,
        lastUpdated: new Date(),
      };

      const newLocation: Location = {
        id: `loc_${Date.now()}`,
        groupId,
        ...location,
        performance: initialPerformance,
        joinedAt: new Date(),
      };

      await prisma.location.create({
        data: newLocation,
      });

      // Update cache
      this.locationCache.set(newLocation.id, newLocation);

      // Setup location-specific services
      await this.setupLocationServices(newLocation, group);

      this.emit('location:added', {
        locationId: newLocation.id,
        groupId,
        merchantId: location.merchantId,
      });

      return newLocation;

    } catch (error) {
      logger.error('Failed to add location', error);
      throw error;
    }
  }

  /**
   * Update location settings
   */
  async updateLocationSettings(
    locationId: string,
    settings: Partial<LocationSettings>
  ): Promise<void> {
    try {
      const location = this.locationCache.get(locationId);
      if (!location) {
        throw new Error('Location not found');
      }

      const updatedSettings = {
        ...location.settings,
        ...settings,
      };

      await prisma.location.update({
        where: { id: locationId },
        data: { settings: updatedSettings },
      });

      location.settings = updatedSettings;
      this.locationCache.set(locationId, location);

      this.emit('location:settings_updated', {
        locationId,
        settings: updatedSettings,
      });

    } catch (error) {
      logger.error('Failed to update location settings', error);
      throw error;
    }
  }

  /**
   * Create centralized menu
   */
  async createCentralizedMenu(
    groupId: string,
    menu: Omit<CentralizedMenu, 'id' | 'groupId' | 'lastUpdated'>
  ): Promise<CentralizedMenu> {
    try {
      const centralizedMenu: CentralizedMenu = {
        id: `menu_${Date.now()}`,
        groupId,
        ...menu,
        lastUpdated: new Date(),
      };

      await prisma.centralizedMenu.create({
        data: centralizedMenu,
      });

      // Apply to locations
      await this.applyMenuToLocations(centralizedMenu);

      this.emit('menu:centralized_created', {
        menuId: centralizedMenu.id,
        groupId,
      });

      return centralizedMenu;

    } catch (error) {
      logger.error('Failed to create centralized menu', error);
      throw error;
    }
  }

  /**
   * Update menu with location variations
   */
  async updateMenuVariation(
    menuId: string,
    locationId: string,
    variations: MenuVariation['itemVariations']
  ): Promise<void> {
    try {
      const menu = await prisma.centralizedMenu.findUnique({
        where: { id: menuId },
      });

      if (!menu) {
        throw new Error('Menu not found');
      }

      // Check if location has permission
      const location = this.locationCache.get(locationId);
      if (!location?.settings.autonomy.menuCustomization) {
        throw new Error('Location does not have menu customization permission');
      }

      // Update or create variation
      const existingVariationIndex = menu.variations.findIndex(
        v => v.locationId === locationId
      );

      if (existingVariationIndex >= 0) {
        menu.variations[existingVariationIndex].itemVariations = variations;
      } else {
        menu.variations.push({
          locationId,
          itemVariations: variations,
        });
      }

      await prisma.centralizedMenu.update({
        where: { id: menuId },
        data: {
          variations: menu.variations,
          lastUpdated: new Date(),
        },
      });

      // Apply changes to merchant menu
      await this.syncLocationMenu(locationId, menu);

    } catch (error) {
      logger.error('Failed to update menu variation', error);
      throw error;
    }
  }

  /**
   * Compare location performance
   */
  async compareLocations(
    groupId: string,
    startDate: Date,
    endDate: Date
  ): Promise<LocationComparison> {
    try {
      const locations = Array.from(this.locationCache.values())
        .filter(loc => loc.groupId === groupId && loc.status === 'active');

      const locationMetrics = await Promise.all(
        locations.map(async (location) => {
          const metrics = await this.getLocationMetrics(
            location.id,
            startDate,
            endDate
          );

          return {
            location,
            metrics,
            rank: 0,
            trend: this.calculateTrend(location.id, metrics),
          };
        })
      );

      // Rank locations by revenue
      locationMetrics.sort((a, b) => b.metrics.revenue - a.metrics.revenue);
      locationMetrics.forEach((loc, index) => {
        loc.rank = index + 1;
      });

      // Generate insights
      const insights = this.generateLocationInsights(locationMetrics);

      // Generate recommendations
      const recommendations = this.generateLocationRecommendations(locationMetrics);

      return {
        period: { start: startDate, end: endDate },
        locations: locationMetrics,
        insights,
        recommendations,
      };

    } catch (error) {
      logger.error('Failed to compare locations', error);
      throw error;
    }
  }

  /**
   * Request transfer between locations
   */
  async requestTransfer(
    transfer: Omit<TransferRequest, 'id' | 'status' | 'approvedBy' | 'completedAt'>
  ): Promise<TransferRequest> {
    try {
      const fromLocation = this.locationCache.get(transfer.fromLocationId);
      const toLocation = this.locationCache.get(transfer.toLocationId);

      if (!fromLocation || !toLocation) {
        throw new Error('Invalid location(s)');
      }

      if (fromLocation.groupId !== toLocation.groupId) {
        throw new Error('Locations must be in the same group');
      }

      const transferRequest: TransferRequest = {
        id: `transfer_${Date.now()}`,
        ...transfer,
        status: 'pending',
      };

      await prisma.transferRequest.create({
        data: transferRequest,
      });

      // Notify managers
      await this.notifyTransferRequest(transferRequest, fromLocation, toLocation);

      this.emit('transfer:requested', {
        transferId: transferRequest.id,
        type: transfer.type,
      });

      return transferRequest;

    } catch (error) {
      logger.error('Failed to request transfer', error);
      throw error;
    }
  }

  /**
   * Approve transfer request
   */
  async approveTransfer(
    transferId: string,
    approvedBy: string
  ): Promise<void> {
    try {
      const transfer = await prisma.transferRequest.findUnique({
        where: { id: transferId },
      });

      if (!transfer) {
        throw new Error('Transfer request not found');
      }

      if (transfer.status !== 'pending') {
        throw new Error('Transfer is not pending approval');
      }

      await prisma.transferRequest.update({
        where: { id: transferId },
        data: {
          status: 'approved',
          approvedBy,
        },
      });

      // Initiate transfer process
      await this.processTransfer(transfer);

      this.emit('transfer:approved', {
        transferId,
        approvedBy,
      });

    } catch (error) {
      logger.error('Failed to approve transfer', error);
      throw error;
    }
  }

  /**
   * Generate consolidated report
   */
  async generateConsolidatedReport(
    groupId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    group: MerchantGroup;
    summary: {
      totalRevenue: number;
      totalOrders: number;
      totalLocations: number;
      activeLocations: number;
      averageRating: number;
      topPerformingLocation: Location;
      needsAttentionLocations: Location[];
    };
    locationBreakdown: Array<{
      location: Location;
      revenue: number;
      orders: number;
      growth: number;
      issues: string[];
    }>;
    insights: {
      trends: string[];
      opportunities: string[];
      risks: string[];
    };
  }> {
    try {
      const group = await prisma.merchantGroup.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        throw new Error('Group not found');
      }

      const locations = Array.from(this.locationCache.values())
        .filter(loc => loc.groupId === groupId);

      const activeLocations = locations.filter(loc => loc.status === 'active');

      // Get metrics for each location
      const locationData = await Promise.all(
        activeLocations.map(async (location) => {
          const [metrics, previousMetrics, issues] = await Promise.all([
            this.getLocationMetrics(location.id, startDate, endDate),
            this.getLocationMetrics(
              location.id,
              new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime())),
              startDate
            ),
            this.getLocationIssues(location.id),
          ]);

          const growth = previousMetrics.revenue > 0
            ? ((metrics.revenue - previousMetrics.revenue) / previousMetrics.revenue) * 100
            : 0;

          return {
            location,
            revenue: metrics.revenue,
            orders: metrics.orders,
            growth,
            issues,
          };
        })
      );

      // Calculate summary
      const totalRevenue = locationData.reduce((sum, loc) => sum + loc.revenue, 0);
      const totalOrders = locationData.reduce((sum, loc) => sum + loc.orders, 0);
      const averageRating = activeLocations.reduce((sum, loc) => 
        sum + loc.performance.rating, 0
      ) / activeLocations.length;

      const topPerformingLocation = locationData
        .sort((a, b) => b.revenue - a.revenue)[0].location;

      const needsAttentionLocations = activeLocations
        .filter(loc => 
          loc.performance.operationalEfficiency < 70 ||
          loc.performance.customerSatisfaction < 3.5 ||
          loc.performance.complianceScore < 80
        );

      // Generate insights
      const insights = {
        trends: this.analyzeTrends(locationData),
        opportunities: this.identifyOpportunities(locationData, group),
        risks: this.identifyRisks(locationData),
      };

      return {
        group,
        summary: {
          totalRevenue,
          totalOrders,
          totalLocations: locations.length,
          activeLocations: activeLocations.length,
          averageRating,
          topPerformingLocation,
          needsAttentionLocations,
        },
        locationBreakdown: locationData,
        insights,
      };

    } catch (error) {
      logger.error('Failed to generate consolidated report', error);
      throw error;
    }
  }

  /**
   * Broadcast announcement to all locations
   */
  async broadcastAnnouncement(
    groupId: string,
    announcement: {
      title: string;
      message: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      targetLocations?: string[]; // null for all
      attachments?: string[];
      requiresAcknowledgment: boolean;
    }
  ): Promise<void> {
    try {
      const locations = Array.from(this.locationCache.values())
        .filter(loc => 
          loc.groupId === groupId &&
          loc.status === 'active' &&
          (!announcement.targetLocations || announcement.targetLocations.includes(loc.id))
        );

      const announcementId = `announce_${Date.now()}`;

      // Send to each location manager
      for (const location of locations) {
        await notificationService.sendEmail(
          location.manager.email,
          'group_announcement',
          {
            announcementId,
            title: announcement.title,
            message: announcement.message,
            priority: announcement.priority,
            locationName: location.name,
            requiresAcknowledgment: announcement.requiresAcknowledgment,
          }
        );

        // Also send push notification for urgent announcements
        if (announcement.priority === 'urgent') {
          await notificationService.sendMerchantNotification(
            location.merchantId,
            announcement.title,
            announcement.message,
            {
              type: 'urgent_group_announcement',
              announcementId,
            }
          );
        }
      }

      // Track announcement
      await prisma.groupAnnouncement.create({
        data: {
          id: announcementId,
          groupId,
          ...announcement,
          sentAt: new Date(),
          recipientCount: locations.length,
        },
      });

    } catch (error) {
      logger.error('Failed to broadcast announcement', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async loadLocations(): Promise<void> {
    const locations = await prisma.location.findMany({
      where: { status: 'active' },
    });

    locations.forEach(location => {
      this.locationCache.set(location.id, location);
    });
  }

  private async setupLocationServices(
    location: Location,
    group: MerchantGroup
  ): Promise<void> {
    // Setup based on centralized services
    if (group.centralizedServices.includes('menu')) {
      await this.setupCentralizedMenu(location);
    }

    if (group.centralizedServices.includes('pricing')) {
      await this.setupCentralizedPricing(location);
    }

    if (group.centralizedServices.includes('inventory')) {
      await this.setupInventorySync(location);
    }
  }

  private async setupCentralizedMenu(location: Location): Promise<void> {
    // Apply group menu to location
    const groupMenu = await prisma.centralizedMenu.findFirst({
      where: {
        groupId: location.groupId,
        applicableLocations: {
          has: 'all',
        },
      },
    });

    if (groupMenu) {
      await this.syncLocationMenu(location.id, groupMenu);
    }
  }

  private async setupCentralizedPricing(location: Location): Promise<void> {
    // Setup pricing rules based on group strategy
    const group = await prisma.merchantGroup.findUnique({
      where: { id: location.groupId },
    });

    if (group?.brandGuidelines?.pricingStrategy === 'zone_based') {
      await this.applyZonePricing(location);
    }
  }

  private async setupInventorySync(location: Location): Promise<void> {
    // Enable inventory sync with other locations
    await prisma.inventorySync.create({
      data: {
        locationId: location.id,
        syncEnabled: true,
        syncFrequency: 'realtime',
        lastSyncAt: new Date(),
      },
    });
  }

  private async applyMenuToLocations(menu: CentralizedMenu): Promise<void> {
    const targetLocationIds = menu.applicableLocations.includes('all')
      ? Array.from(this.locationCache.keys())
      : menu.applicableLocations;

    for (const locationId of targetLocationIds) {
      const location = this.locationCache.get(locationId);
      if (location && location.groupId === menu.groupId) {
        await this.syncLocationMenu(locationId, menu);
      }
    }
  }

  private async syncLocationMenu(locationId: string, menu: CentralizedMenu): Promise<void> {
    const location = this.locationCache.get(locationId);
    if (!location) return;

    // Get location-specific variations
    const variation = menu.variations.find(v => v.locationId === locationId);

    // Apply menu to merchant
    for (const category of menu.categories) {
      for (const item of category.items) {
        let price = item.basePrice;
        let available = true;

        // Apply variations if any
        if (variation) {
          const itemVariation = variation.itemVariations.find(
            v => v.itemId === item.id
          );
          if (itemVariation) {
            if (itemVariation.priceAdjustment) {
              price += itemVariation.priceAdjustment;
            }
            available = itemVariation.available;
          }
        }

        // Update merchant menu item
        await prisma.menuItem.upsert({
          where: {
            merchantId_externalId: {
              merchantId: location.merchantId,
              externalId: item.id,
            },
          },
          create: {
            merchantId: location.merchantId,
            externalId: item.id,
            categoryId: category.id,
            name: item.name,
            description: item.description,
            price,
            available,
            images: item.images,
            preparationTime: item.preparationTime,
            nutritionalInfo: item.nutritionalInfo,
            allergens: item.allergens,
          },
          update: {
            price,
            available,
          },
        });
      }
    }
  }

  private async calculateLocationPerformance(): Promise<void> {
    for (const [locationId, location] of this.locationCache) {
      try {
        const performance = await this.calculatePerformanceMetrics(locationId);
        
        location.performance = {
          ...performance,
          lastUpdated: new Date(),
        };

        await prisma.location.update({
          where: { id: locationId },
          data: { performance: location.performance },
        });

        // Alert if performance drops
        if (performance.operationalEfficiency < 60 || 
            performance.customerSatisfaction < 3.0) {
          await this.alertPerformanceIssue(location);
        }

      } catch (error) {
        logger.error(`Failed to calculate performance for location ${locationId}`, error);
      }
    }
  }

  private async calculatePerformanceMetrics(locationId: string): Promise<Omit<LocationPerformance, 'lastUpdated'>> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const location = this.locationCache.get(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    // Get recent orders and reviews
    const [orders, reviews] = await Promise.all([
      prisma.order.findMany({
        where: {
          merchantId: location.merchantId,
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.review.findMany({
        where: {
          order: {
            merchantId: location.merchantId,
            createdAt: { gte: thirtyDaysAgo },
          },
        },
      }),
    ]);

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const rating = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;

    const customerSatisfaction = reviews.length > 0
      ? reviews.reduce((sum, review) => sum + (review.rating >= 4 ? 1 : 0), 0) / reviews.length * 5
      : 0;

    // Calculate operational efficiency (simplified)
    const onTimeDeliveries = orders.filter(order => 
      order.deliveredAt && order.estimatedDeliveryTime &&
      order.deliveredAt <= order.estimatedDeliveryTime
    ).length;

    const operationalEfficiency = totalOrders > 0
      ? (onTimeDeliveries / totalOrders) * 100
      : 0;

    // Compliance score (simplified - would check various compliance metrics)
    const complianceScore = 95; // Placeholder

    return {
      rating,
      totalOrders,
      totalRevenue,
      averageOrderValue,
      customerSatisfaction,
      operationalEfficiency,
      complianceScore,
    };
  }

  private async getLocationMetrics(
    locationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const location = this.locationCache.get(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    const orders = await prisma.order.findMany({
      where: {
        merchantId: location.merchantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        review: true,
      },
    });

    const revenue = orders.reduce((sum, order) => sum + order.total, 0);
    const customerSatisfaction = orders.filter(o => o.review).reduce((sum, order) => 
      sum + (order.review?.rating || 0), 0
    ) / orders.filter(o => o.review).length || 0;

    // Calculate operational cost (simplified)
    const operationalCost = revenue * 0.7; // 70% of revenue as cost
    const profitMargin = ((revenue - operationalCost) / revenue) * 100;

    return {
      revenue,
      orders: orders.length,
      averageOrderValue: orders.length > 0 ? revenue / orders.length : 0,
      customerSatisfaction,
      operationalCost,
      profitMargin,
    };
  }

  private calculateTrend(
    locationId: string,
    currentMetrics: any
  ): 'up' | 'down' | 'stable' {
    // Simplified trend calculation
    const location = this.locationCache.get(locationId);
    if (!location) return 'stable';

    const previousRevenue = location.performance.totalRevenue;
    const revenueDiff = ((currentMetrics.revenue - previousRevenue) / previousRevenue) * 100;

    if (revenueDiff > 5) return 'up';
    if (revenueDiff < -5) return 'down';
    return 'stable';
  }

  private generateLocationInsights(locationMetrics: any[]): string[] {
    const insights: string[] = [];

    // Revenue concentration
    const topLocation = locationMetrics[0];
    const revenueConcentration = (topLocation.metrics.revenue / 
      locationMetrics.reduce((sum, loc) => sum + loc.metrics.revenue, 0)) * 100;

    if (revenueConcentration > 40) {
      insights.push(`${topLocation.location.name} generates ${revenueConcentration.toFixed(1)}% of total revenue`);
    }

    // Growth patterns
    const growingLocations = locationMetrics.filter(loc => loc.trend === 'up').length;
    if (growingLocations > locationMetrics.length / 2) {
      insights.push(`${growingLocations} locations showing positive growth`);
    }

    // Satisfaction gaps
    const satisfactionGap = Math.max(...locationMetrics.map(l => l.metrics.customerSatisfaction)) -
                          Math.min(...locationMetrics.map(l => l.metrics.customerSatisfaction));
    if (satisfactionGap > 1) {
      insights.push(`Significant customer satisfaction gap of ${satisfactionGap.toFixed(1)} points between locations`);
    }

    return insights;
  }

  private generateLocationRecommendations(locationMetrics: any[]): string[] {
    const recommendations: string[] = [];

    // Underperforming locations
    const underperforming = locationMetrics.filter(loc => 
      loc.metrics.profitMargin < 10 || loc.metrics.customerSatisfaction < 3.5
    );

    if (underperforming.length > 0) {
      recommendations.push(`Focus on improving ${underperforming.length} underperforming locations`);
    }

    // Best practices sharing
    const topPerformer = locationMetrics[0];
    if (topPerformer.metrics.customerSatisfaction > 4.5) {
      recommendations.push(`Share best practices from ${topPerformer.location.name} with other locations`);
    }

    // Expansion opportunities
    const highDemandLocations = locationMetrics.filter(loc => 
      loc.metrics.orders > 1000 && loc.metrics.profitMargin > 20
    );

    if (highDemandLocations.length > 0) {
      recommendations.push(`Consider expanding capacity in ${highDemandLocations.length} high-demand locations`);
    }

    return recommendations;
  }

  private async getLocationIssues(locationId: string): Promise<string[]> {
    const issues: string[] = [];
    const location = this.locationCache.get(locationId);
    
    if (!location) return issues;

    if (location.performance.operationalEfficiency < 70) {
      issues.push('Low operational efficiency');
    }

    if (location.performance.customerSatisfaction < 3.5) {
      issues.push('Below average customer satisfaction');
    }

    if (location.performance.complianceScore < 80) {
      issues.push('Compliance issues need attention');
    }

    return issues;
  }

  private analyzeTrends(locationData: any[]): string[] {
    const trends: string[] = [];

    const avgGrowth = locationData.reduce((sum, loc) => sum + loc.growth, 0) / locationData.length;
    if (avgGrowth > 10) {
      trends.push(`Strong overall growth of ${avgGrowth.toFixed(1)}% across locations`);
    }

    const consistentPerformers = locationData.filter(loc => 
      Math.abs(loc.growth) < 5 && loc.revenue > 0
    );
    if (consistentPerformers.length > locationData.length / 2) {
      trends.push('Majority of locations showing stable performance');
    }

    return trends;
  }

  private identifyOpportunities(locationData: any[], group: MerchantGroup): string[] {
    const opportunities: string[] = [];

    // Cross-location synergies
    if (group.centralizedServices.length < 3) {
      opportunities.push('Implement more centralized services to improve efficiency');
    }

    // Underutilized locations
    const underutilized = locationData.filter(loc => 
      loc.orders < 100 && loc.location.capabilities.includes('reskflow')
    );
    if (underutilized.length > 0) {
      opportunities.push(`${underutilized.length} locations have capacity for growth`);
    }

    return opportunities;
  }

  private identifyRisks(locationData: any[]): string[] {
    const risks: string[] = [];

    const decliningLocations = locationData.filter(loc => loc.growth < -10);
    if (decliningLocations.length > 0) {
      risks.push(`${decliningLocations.length} locations showing significant decline`);
    }

    const highCostLocations = locationData.filter(loc => 
      loc.metrics.profitMargin < 5
    );
    if (highCostLocations.length > 0) {
      risks.push(`${highCostLocations.length} locations operating at minimal profit margins`);
    }

    return risks;
  }

  private async notifyTransferRequest(
    transfer: TransferRequest,
    fromLocation: Location,
    toLocation: Location
  ): Promise<void> {
    // Notify both location managers
    await Promise.all([
      notificationService.sendEmail(
        fromLocation.manager.email,
        'transfer_request_from',
        {
          transferId: transfer.id,
          type: transfer.type,
          toLocation: toLocation.name,
          items: transfer.items,
          reason: transfer.reason,
        }
      ),
      notificationService.sendEmail(
        toLocation.manager.email,
        'transfer_request_to',
        {
          transferId: transfer.id,
          type: transfer.type,
          fromLocation: fromLocation.name,
          items: transfer.items,
          reason: transfer.reason,
        }
      ),
    ]);
  }

  private async processTransfer(transfer: TransferRequest): Promise<void> {
    await prisma.transferRequest.update({
      where: { id: transfer.id },
      data: { status: 'in_transit' },
    });

    // In a real system, this would integrate with inventory/staff management
    // For now, we'll simulate the transfer completion
    setTimeout(async () => {
      await prisma.transferRequest.update({
        where: { id: transfer.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });

      this.emit('transfer:completed', {
        transferId: transfer.id,
      });
    }, 2000);
  }

  private async alertPerformanceIssue(location: Location): Promise<void> {
    await notificationService.sendEmail(
      location.manager.email,
      'performance_alert',
      {
        locationName: location.name,
        efficiency: location.performance.operationalEfficiency,
        satisfaction: location.performance.customerSatisfaction,
        recommendations: [
          'Review operational processes',
          'Conduct staff training',
          'Analyze customer feedback',
        ],
      }
    );
  }

  private async applyZonePricing(location: Location): Promise<void> {
    // Determine pricing zone based on location
    const zone = await this.determinePricingZone(location.address);
    
    // Apply zone-specific pricing multiplier
    await prisma.pricingRule.create({
      data: {
        merchantId: location.merchantId,
        type: 'zone_based',
        zone,
        multiplier: this.getZoneMultiplier(zone),
        active: true,
      },
    });
  }

  private async determinePricingZone(address: any): Promise<string> {
    // Simplified zone determination based on city
    const premiumCities = ['New York', 'San Francisco', 'Los Angeles'];
    const standardCities = ['Chicago', 'Houston', 'Phoenix'];
    
    if (premiumCities.includes(address.city)) return 'premium';
    if (standardCities.includes(address.city)) return 'standard';
    return 'economy';
  }

  private getZoneMultiplier(zone: string): number {
    switch (zone) {
      case 'premium': return 1.2;
      case 'standard': return 1.0;
      case 'economy': return 0.9;
      default: return 1.0;
    }
  }
}

// Export singleton instance
export const multiLocationService = new MultiLocationService();