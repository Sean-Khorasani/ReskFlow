import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import { ModificationValidationService } from './ModificationValidationService';
import { CancellationService } from './CancellationService';
import { RealTimeUpdateService } from './RealTimeUpdateService';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface OrderModification {
  id: string;
  orderId: string;
  type: 'add_item' | 'remove_item' | 'update_quantity' | 'change_address' | 'update_instructions' | 'change_time';
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  requestedBy: string;
  requestedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  originalValue: any;
  newValue: any;
  priceImpact: number;
  reason: string;
  notes?: string;
}

interface ModificationRequest {
  orderId: string;
  customerId: string;
  modifications: Array<{
    type: string;
    itemId?: string;
    quantity?: number;
    address?: any;
    instructions?: string;
    scheduledTime?: Date;
  }>;
  reason: string;
}

interface ModificationResult {
  success: boolean;
  modificationId?: string;
  priceChange?: number;
  newTotal?: number;
  requiresApproval: boolean;
  estimatedTime?: number;
  message: string;
}

interface ModificationAnalytics {
  totalRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  averageApprovalTime: number;
  commonModificationTypes: Array<{
    type: string;
    count: number;
    approvalRate: number;
  }>;
  priceImpact: {
    totalIncrease: number;
    totalDecrease: number;
    averageChange: number;
  };
  reasonBreakdown: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
}

export class OrderModificationService {
  constructor(
    private validationService: ModificationValidationService,
    private cancellationService: CancellationService,
    private realTimeService: RealTimeUpdateService,
    private modificationQueue: Bull.Queue
  ) {}

  async requestModification(request: ModificationRequest): Promise<ModificationResult> {
    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: request.orderId },
      include: {
        orderItems: {
          include: { item: true },
        },
        merchant: true,
        reskflow: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Validate customer owns the order
    if (order.customer_id !== request.customerId) {
      throw new Error('Unauthorized to modify this order');
    }

    // Check if modifications are allowed
    const canModify = await this.validationService.canModifyOrder(order);
    if (!canModify.allowed) {
      throw new Error(canModify.reason || 'Order cannot be modified');
    }

    // Process each modification
    const modificationResults = [];
    let totalPriceImpact = 0;
    let requiresApproval = false;

    for (const mod of request.modifications) {
      const validation = await this.validationService.validateModification(
        order,
        mod
      );

      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid modification');
      }

      // Calculate price impact
      const priceImpact = await this.calculatePriceImpact(order, mod);
      totalPriceImpact += priceImpact;

      // Determine if approval is needed
      if (this.requiresMerchantApproval(order, mod, priceImpact)) {
        requiresApproval = true;
      }

      modificationResults.push({
        type: mod.type,
        priceImpact,
        requiresApproval,
      });
    }

    // Create modification request
    const modification = await prisma.orderModification.create({
      data: {
        id: uuidv4(),
        order_id: request.orderId,
        status: requiresApproval ? 'pending' : 'approved',
        requested_by: request.customerId,
        modifications: request.modifications,
        total_price_impact: totalPriceImpact,
        reason: request.reason,
        requires_approval: requiresApproval,
      },
    });

    // If auto-approved, apply immediately
    if (!requiresApproval) {
      await this.applyModifications(modification.id);
    } else {
      // Notify merchant for approval
      await this.notifyMerchantForApproval(order, modification);
    }

    // Send real-time updates
    await this.realTimeService.sendModificationUpdate(request.orderId, {
      type: 'modification_requested',
      modificationId: modification.id,
      status: modification.status,
    });

    return {
      success: true,
      modificationId: modification.id,
      priceChange: totalPriceImpact,
      newTotal: order.total + totalPriceImpact,
      requiresApproval,
      estimatedTime: this.estimateModificationTime(order.status),
      message: requiresApproval 
        ? 'Modification request sent to merchant for approval'
        : 'Modification applied successfully',
    };
  }

  async approveModification(
    modificationId: string,
    approvedBy: string,
    notes?: string
  ): Promise<ModificationResult> {
    const modification = await prisma.orderModification.findUnique({
      where: { id: modificationId },
      include: {
        order: true,
      },
    });

    if (!modification) {
      throw new Error('Modification request not found');
    }

    if (modification.status !== 'pending') {
      throw new Error('Modification already processed');
    }

    // Verify approver has permission
    const hasPermission = await this.verifyApprovalPermission(
      modification.order,
      approvedBy
    );

    if (!hasPermission) {
      throw new Error('Unauthorized to approve modifications');
    }

    // Update modification status
    await prisma.orderModification.update({
      where: { id: modificationId },
      data: {
        status: 'approved',
        reviewed_by: approvedBy,
        reviewed_at: new Date(),
        notes,
      },
    });

    // Apply modifications
    await this.applyModifications(modificationId);

    // Send notifications
    await this.realTimeService.sendModificationUpdate(modification.order_id, {
      type: 'modification_approved',
      modificationId,
      approvedBy,
    });

    return {
      success: true,
      modificationId,
      message: 'Modification approved and applied',
      requiresApproval: false,
    };
  }

  async rejectModification(
    modificationId: string,
    rejectedBy: string,
    reason: string
  ): Promise<ModificationResult> {
    const modification = await prisma.orderModification.findUnique({
      where: { id: modificationId },
      include: {
        order: true,
      },
    });

    if (!modification) {
      throw new Error('Modification request not found');
    }

    if (modification.status !== 'pending') {
      throw new Error('Modification already processed');
    }

    // Update modification status
    await prisma.orderModification.update({
      where: { id: modificationId },
      data: {
        status: 'rejected',
        reviewed_by: rejectedBy,
        reviewed_at: new Date(),
        rejection_reason: reason,
      },
    });

    // Send notifications
    await this.realTimeService.sendModificationUpdate(modification.order_id, {
      type: 'modification_rejected',
      modificationId,
      rejectedBy,
      reason,
    });

    return {
      success: false,
      modificationId,
      message: `Modification rejected: ${reason}`,
      requiresApproval: false,
    };
  }

  async getOrderModifications(
    orderId: string,
    userId: string
  ): Promise<OrderModification[]> {
    const modifications = await prisma.orderModification.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
    });

    return modifications.map(mod => this.mapToOrderModification(mod));
  }

  async getModificationStatus(
    orderId: string,
    userId: string
  ): Promise<{
    canModify: boolean;
    reason?: string;
    pendingModifications: number;
    lastModification?: Date;
    allowedModifications: string[];
  }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderModifications: {
          where: { status: 'pending' },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const canModify = await this.validationService.canModifyOrder(order);
    const allowedModifications = await this.getAllowedModifications(order);

    const lastModification = await prisma.orderModification.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });

    return {
      canModify: canModify.allowed,
      reason: canModify.reason,
      pendingModifications: order.orderModifications.length,
      lastModification: lastModification?.created_at,
      allowedModifications,
    };
  }

  async processModification(data: any): Promise<void> {
    logger.info('Processing modification:', data);
    // Background processing logic
  }

  async notifyParties(data: any): Promise<void> {
    logger.info('Notifying parties about modification:', data);
    // Notification logic
  }

  async updateInventory(data: any): Promise<void> {
    logger.info('Updating inventory for modification:', data);
    // Inventory update logic
  }

  async getModificationAnalytics(
    merchantId: string,
    period: string = '30d'
  ): Promise<ModificationAnalytics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all modifications for merchant orders
    const modifications = await prisma.$queryRaw`
      SELECT 
        om.*,
        o.merchant_id
      FROM order_modifications om
      JOIN orders o ON om.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND om.created_at >= ${startDate}
    `;

    const modList = modifications as any[];
    const totalRequests = modList.length;
    const approvedRequests = modList.filter(m => m.status === 'approved').length;
    const rejectedRequests = modList.filter(m => m.status === 'rejected').length;

    // Calculate average approval time
    const approvalTimes = modList
      .filter(m => m.status === 'approved' && m.reviewed_at)
      .map(m => dayjs(m.reviewed_at).diff(m.created_at, 'minute'));

    const averageApprovalTime = approvalTimes.length > 0
      ? approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length
      : 0;

    // Get modification types breakdown
    const typeBreakdown = new Map<string, { count: number; approved: number }>();
    
    modList.forEach(mod => {
      (mod.modifications as any[]).forEach(m => {
        if (!typeBreakdown.has(m.type)) {
          typeBreakdown.set(m.type, { count: 0, approved: 0 });
        }
        const stats = typeBreakdown.get(m.type)!;
        stats.count++;
        if (mod.status === 'approved') {
          stats.approved++;
        }
      });
    });

    const commonModificationTypes = Array.from(typeBreakdown.entries())
      .map(([type, stats]) => ({
        type,
        count: stats.count,
        approvalRate: stats.count > 0 ? (stats.approved / stats.count) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate price impact
    const priceImpact = modList.reduce(
      (acc, mod) => {
        const impact = mod.total_price_impact || 0;
        if (impact > 0) {
          acc.totalIncrease += impact;
        } else {
          acc.totalDecrease += Math.abs(impact);
        }
        return acc;
      },
      { totalIncrease: 0, totalDecrease: 0 }
    );

    priceImpact.averageChange = totalRequests > 0
      ? (priceImpact.totalIncrease - priceImpact.totalDecrease) / totalRequests
      : 0;

    // Get reason breakdown
    const reasonCounts = new Map<string, number>();
    modList.forEach(mod => {
      const reason = mod.reason || 'Other';
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    const reasonBreakdown = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / totalRequests) * 100,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalRequests,
      approvedRequests,
      rejectedRequests,
      averageApprovalTime,
      commonModificationTypes,
      priceImpact,
      reasonBreakdown,
    };
  }

  private async applyModifications(modificationId: string): Promise<void> {
    const modification = await prisma.orderModification.findUnique({
      where: { id: modificationId },
      include: {
        order: {
          include: {
            orderItems: true,
          },
        },
      },
    });

    if (!modification) return;

    const mods = modification.modifications as any[];

    for (const mod of mods) {
      switch (mod.type) {
        case 'add_item':
          await this.addItemToOrder(modification.order_id, mod);
          break;
        case 'remove_item':
          await this.removeItemFromOrder(modification.order_id, mod);
          break;
        case 'update_quantity':
          await this.updateItemQuantity(modification.order_id, mod);
          break;
        case 'change_address':
          await this.updateDeliveryAddress(modification.order_id, mod);
          break;
        case 'update_instructions':
          await this.updateInstructions(modification.order_id, mod);
          break;
        case 'change_time':
          await this.updateScheduledTime(modification.order_id, mod);
          break;
      }
    }

    // Update modification status
    await prisma.orderModification.update({
      where: { id: modificationId },
      data: {
        status: 'applied',
        applied_at: new Date(),
      },
    });

    // Recalculate order totals
    await this.recalculateOrderTotals(modification.order_id);

    // Queue inventory update
    await this.modificationQueue.add('update-inventory', {
      orderId: modification.order_id,
      modifications: mods,
    });
  }

  private async calculatePriceImpact(order: any, modification: any): Promise<number> {
    switch (modification.type) {
      case 'add_item':
        const item = await prisma.item.findUnique({
          where: { id: modification.itemId },
        });
        return item ? item.price * (modification.quantity || 1) : 0;

      case 'remove_item':
        const orderItem = order.orderItems.find(
          (oi: any) => oi.item_id === modification.itemId
        );
        return orderItem ? -(orderItem.price * orderItem.quantity) : 0;

      case 'update_quantity':
        const existingItem = order.orderItems.find(
          (oi: any) => oi.item_id === modification.itemId
        );
        if (existingItem) {
          const quantityDiff = modification.quantity - existingItem.quantity;
          return existingItem.price * quantityDiff;
        }
        return 0;

      default:
        return 0;
    }
  }

  private requiresMerchantApproval(
    order: any,
    modification: any,
    priceImpact: number
  ): boolean {
    // Already preparing or ready requires approval
    if (['preparing', 'ready'].includes(order.status)) {
      return true;
    }

    // Significant price changes require approval
    if (Math.abs(priceImpact) > order.total * 0.2) {
      return true;
    }

    // Address changes after confirmation require approval
    if (modification.type === 'change_address' && order.status !== 'pending') {
      return true;
    }

    // Time changes require approval if less than 30 minutes away
    if (modification.type === 'change_time') {
      const timeDiff = dayjs(modification.scheduledTime).diff(dayjs(), 'minute');
      if (timeDiff < 30) {
        return true;
      }
    }

    return false;
  }

  private async verifyApprovalPermission(
    order: any,
    userId: string
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) return false;

    // Merchant staff can approve
    if (user.merchant_id === order.merchant_id) {
      return true;
    }

    // Support staff can approve
    if (user.role === 'SUPPORT' || user.role === 'ADMIN') {
      return true;
    }

    return false;
  }

  private estimateModificationTime(orderStatus: string): number {
    const estimates: { [key: string]: number } = {
      pending: 2,
      confirmed: 5,
      preparing: 10,
      ready: 15,
    };

    return estimates[orderStatus] || 20;
  }

  private async getAllowedModifications(order: any): Promise<string[]> {
    const allowed: string[] = [];

    switch (order.status) {
      case 'pending':
      case 'confirmed':
        allowed.push('add_item', 'remove_item', 'update_quantity', 
                    'change_address', 'update_instructions', 'change_time');
        break;
      case 'preparing':
        allowed.push('add_item', 'update_instructions');
        break;
      case 'ready':
        allowed.push('update_instructions');
        break;
    }

    return allowed;
  }

  private async notifyMerchantForApproval(order: any, modification: any): Promise<void> {
    // Send notification to merchant
    await this.modificationQueue.add('notify-parties', {
      type: 'approval_required',
      orderId: order.id,
      modificationId: modification.id,
      merchantId: order.merchant_id,
    });
  }

  private async addItemToOrder(orderId: string, mod: any): Promise<void> {
    const item = await prisma.item.findUnique({
      where: { id: mod.itemId },
    });

    if (!item) return;

    await prisma.orderItem.create({
      data: {
        id: uuidv4(),
        order_id: orderId,
        item_id: mod.itemId,
        quantity: mod.quantity || 1,
        price: item.price,
        special_instructions: mod.instructions,
      },
    });
  }

  private async removeItemFromOrder(orderId: string, mod: any): Promise<void> {
    await prisma.orderItem.deleteMany({
      where: {
        order_id: orderId,
        item_id: mod.itemId,
      },
    });
  }

  private async updateItemQuantity(orderId: string, mod: any): Promise<void> {
    await prisma.orderItem.updateMany({
      where: {
        order_id: orderId,
        item_id: mod.itemId,
      },
      data: {
        quantity: mod.quantity,
      },
    });
  }

  private async updateDeliveryAddress(orderId: string, mod: any): Promise<void> {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        reskflow_address_id: mod.address.id,
      },
    });
  }

  private async updateInstructions(orderId: string, mod: any): Promise<void> {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        reskflow_instructions: mod.instructions,
      },
    });
  }

  private async updateScheduledTime(orderId: string, mod: any): Promise<void> {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        scheduled_reskflow_time: mod.scheduledTime,
      },
    });
  }

  private async recalculateOrderTotals(orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: true,
      },
    });

    if (!order) return;

    const subtotal = order.orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const total = subtotal + order.reskflow_fee + order.service_fee + 
                 order.tip - order.discount_amount;

    await prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        total,
        items_count: order.orderItems.length,
      },
    });
  }

  private mapToOrderModification(dbMod: any): OrderModification {
    const firstMod = (dbMod.modifications as any[])[0] || {};
    
    return {
      id: dbMod.id,
      orderId: dbMod.order_id,
      type: firstMod.type || 'update_quantity',
      status: dbMod.status,
      requestedBy: dbMod.requested_by,
      requestedAt: dbMod.created_at,
      reviewedBy: dbMod.reviewed_by,
      reviewedAt: dbMod.reviewed_at,
      originalValue: dbMod.original_value,
      newValue: dbMod.new_value,
      priceImpact: dbMod.total_price_impact || 0,
      reason: dbMod.reason,
      notes: dbMod.notes,
    };
  }
}