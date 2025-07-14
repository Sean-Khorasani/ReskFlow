import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

interface ModificationValidation {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export class ModificationValidationService {
  private readonly MODIFICATION_RULES = {
    pending: {
      allowedModifications: ['all'],
      timeLimit: null,
      requiresApproval: false,
    },
    confirmed: {
      allowedModifications: ['add_item', 'remove_item', 'update_quantity', 'update_instructions', 'change_time'],
      timeLimit: 10, // minutes after confirmation
      requiresApproval: true,
    },
    preparing: {
      allowedModifications: ['add_item', 'update_instructions'],
      timeLimit: 5,
      requiresApproval: true,
    },
    ready: {
      allowedModifications: ['update_instructions'],
      timeLimit: null,
      requiresApproval: true,
    },
    assigned: {
      allowedModifications: [],
      timeLimit: null,
      requiresApproval: false,
    },
    picked_up: {
      allowedModifications: [],
      timeLimit: null,
      requiresApproval: false,
    },
    delivered: {
      allowedModifications: [],
      timeLimit: null,
      requiresApproval: false,
    },
    cancelled: {
      allowedModifications: [],
      timeLimit: null,
      requiresApproval: false,
    },
  };

  async canModifyOrder(order: any): Promise<ValidationResult> {
    // Check order status
    const rules = this.MODIFICATION_RULES[order.status as keyof typeof this.MODIFICATION_RULES];
    
    if (!rules || rules.allowedModifications.length === 0) {
      return {
        allowed: false,
        reason: `Orders in ${order.status} status cannot be modified`,
      };
    }

    // Check time limit
    if (rules.timeLimit) {
      const statusChangedAt = this.getStatusChangeTime(order);
      const minutesSinceChange = dayjs().diff(statusChangedAt, 'minute');
      
      if (minutesSinceChange > rules.timeLimit) {
        return {
          allowed: false,
          reason: `Modification time limit exceeded (${rules.timeLimit} minutes)`,
        };
      }
    }

    // Check if order has active modifications
    const pendingModifications = await prisma.orderModification.count({
      where: {
        order_id: order.id,
        status: 'pending',
      },
    });

    if (pendingModifications > 0) {
      return {
        allowed: false,
        reason: 'Order has pending modifications',
      };
    }

    // Check merchant settings
    const merchantSettings = await this.getMerchantSettings(order.merchant_id);
    
    if (!merchantSettings.allowModifications) {
      return {
        allowed: false,
        reason: 'Merchant does not allow order modifications',
      };
    }

    // Check if reskflow has started
    if (order.reskflow && ['en_route', 'arrived', 'delivered'].includes(order.reskflow.status)) {
      return {
        allowed: false,
        reason: 'Cannot modify order after reskflow has started',
      };
    }

    return { allowed: true };
  }

  async canCancelOrder(order: any, initiatedBy: string): Promise<ValidationResult> {
    // Check if order is already cancelled
    if (order.status === 'cancelled') {
      return {
        allowed: false,
        reason: 'Order is already cancelled',
      };
    }

    // Check if order is delivered
    if (order.status === 'delivered') {
      return {
        allowed: false,
        reason: 'Cannot cancel delivered orders',
      };
    }

    // Get user role
    const user = await prisma.user.findUnique({
      where: { id: initiatedBy },
    });

    if (!user) {
      return {
        allowed: false,
        reason: 'Invalid user',
      };
    }

    // Customer can cancel their own orders
    if (user.role === 'CUSTOMER' && order.customer_id === initiatedBy) {
      // Check time restrictions
      if (order.status === 'preparing') {
        const prepTime = dayjs().diff(order.accepted_at, 'minute');
        if (prepTime > 5) {
          return {
            allowed: false,
            reason: 'Cannot cancel after food preparation has started',
          };
        }
      }
      
      if (['ready', 'assigned', 'picked_up'].includes(order.status)) {
        return {
          allowed: false,
          reason: 'Order has already been prepared',
        };
      }
      
      return { allowed: true };
    }

    // Merchant can cancel their orders
    if (user.merchant_id === order.merchant_id) {
      if (['assigned', 'picked_up'].includes(order.status)) {
        return {
          allowed: false,
          reason: 'Cannot cancel after driver pickup',
        };
      }
      return { allowed: true };
    }

    // Support/Admin can cancel any order
    if (['SUPPORT', 'ADMIN'].includes(user.role)) {
      return { allowed: true };
    }

    // Driver can request cancellation
    if (user.role === 'DRIVER' && order.reskflow?.driver_id === initiatedBy) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'Unauthorized to cancel this order',
    };
  }

  async validateModification(
    order: any,
    modification: any
  ): Promise<ModificationValidation> {
    const warnings: string[] = [];

    // Get allowed modifications for current status
    const rules = this.MODIFICATION_RULES[order.status as keyof typeof this.MODIFICATION_RULES];
    
    if (!rules.allowedModifications.includes('all') && 
        !rules.allowedModifications.includes(modification.type)) {
      return {
        valid: false,
        error: `${modification.type} modifications not allowed for ${order.status} orders`,
      };
    }

    // Validate specific modification types
    switch (modification.type) {
      case 'add_item':
        return this.validateAddItem(order, modification);
      
      case 'remove_item':
        return this.validateRemoveItem(order, modification);
      
      case 'update_quantity':
        return this.validateUpdateQuantity(order, modification);
      
      case 'change_address':
        return this.validateAddressChange(order, modification);
      
      case 'update_instructions':
        return this.validateInstructionsUpdate(modification);
      
      case 'change_time':
        return this.validateTimeChange(order, modification);
      
      default:
        return {
          valid: false,
          error: 'Invalid modification type',
        };
    }
  }

  private async validateAddItem(
    order: any,
    modification: any
  ): Promise<ModificationValidation> {
    if (!modification.itemId) {
      return {
        valid: false,
        error: 'Item ID is required',
      };
    }

    // Check if item exists and is available
    const item = await prisma.item.findFirst({
      where: {
        id: modification.itemId,
        merchant_id: order.merchant_id,
        is_available: true,
      },
    });

    if (!item) {
      return {
        valid: false,
        error: 'Item not found or unavailable',
      };
    }

    // Check inventory
    if (item.track_inventory && item.stock_quantity < (modification.quantity || 1)) {
      return {
        valid: false,
        error: 'Insufficient stock',
      };
    }

    // Check if item requires options
    if (item.has_options && !modification.options) {
      return {
        valid: false,
        error: 'Item requires options to be selected',
      };
    }

    return { valid: true };
  }

  private async validateRemoveItem(
    order: any,
    modification: any
  ): Promise<ModificationValidation> {
    if (!modification.itemId) {
      return {
        valid: false,
        error: 'Item ID is required',
      };
    }

    // Check if item exists in order
    const orderItem = order.orderItems.find(
      (oi: any) => oi.item_id === modification.itemId
    );

    if (!orderItem) {
      return {
        valid: false,
        error: 'Item not found in order',
      };
    }

    // Check if it's the last item
    if (order.orderItems.length === 1) {
      return {
        valid: false,
        error: 'Cannot remove the last item. Cancel the order instead.',
      };
    }

    // Warn if item is already being prepared
    const warnings: string[] = [];
    if (order.status === 'preparing') {
      warnings.push('Item may already be in preparation');
    }

    return { valid: true, warnings };
  }

  private async validateUpdateQuantity(
    order: any,
    modification: any
  ): Promise<ModificationValidation> {
    if (!modification.itemId || modification.quantity === undefined) {
      return {
        valid: false,
        error: 'Item ID and quantity are required',
      };
    }

    if (modification.quantity < 0) {
      return {
        valid: false,
        error: 'Quantity cannot be negative',
      };
    }

    if (modification.quantity === 0) {
      return {
        valid: false,
        error: 'Use remove_item to remove items from order',
      };
    }

    // Check if item exists in order
    const orderItem = order.orderItems.find(
      (oi: any) => oi.item_id === modification.itemId
    );

    if (!orderItem) {
      return {
        valid: false,
        error: 'Item not found in order',
      };
    }

    // Check inventory for increase
    if (modification.quantity > orderItem.quantity) {
      const item = await prisma.item.findUnique({
        where: { id: modification.itemId },
      });

      if (item?.track_inventory) {
        const additionalQty = modification.quantity - orderItem.quantity;
        if (item.stock_quantity < additionalQty) {
          return {
            valid: false,
            error: 'Insufficient stock for quantity increase',
          };
        }
      }
    }

    return { valid: true };
  }

  private async validateAddressChange(
    order: any,
    modification: any
  ): Promise<ModificationValidation> {
    if (!modification.address || !modification.address.id) {
      return {
        valid: false,
        error: 'Valid address is required',
      };
    }

    // Verify address belongs to customer
    const address = await prisma.address.findFirst({
      where: {
        id: modification.address.id,
        customer_id: order.customer_id,
      },
    });

    if (!address) {
      return {
        valid: false,
        error: 'Invalid address',
      };
    }

    // Check if new address is within reskflow zone
    const inZone = await this.checkDeliveryZone(
      order.merchant_id,
      address.latitude,
      address.longitude
    );

    if (!inZone) {
      return {
        valid: false,
        error: 'New address is outside reskflow zone',
      };
    }

    // Calculate new reskflow fee
    const newDeliveryFee = await this.calculateDeliveryFee(
      order.merchant_id,
      address.latitude,
      address.longitude
    );

    const warnings: string[] = [];
    if (newDeliveryFee > order.reskflow_fee) {
      warnings.push(`Delivery fee will increase by $${(newDeliveryFee - order.reskflow_fee).toFixed(2)}`);
    }

    return { valid: true, warnings };
  }

  private validateInstructionsUpdate(modification: any): ModificationValidation {
    if (!modification.instructions || modification.instructions.trim().length === 0) {
      return {
        valid: false,
        error: 'Instructions cannot be empty',
      };
    }

    if (modification.instructions.length > 500) {
      return {
        valid: false,
        error: 'Instructions too long (max 500 characters)',
      };
    }

    return { valid: true };
  }

  private async validateTimeChange(
    order: any,
    modification: any
  ): Promise<ModificationValidation> {
    if (!modification.scheduledTime) {
      return {
        valid: false,
        error: 'Scheduled time is required',
      };
    }

    const newTime = dayjs(modification.scheduledTime);
    const now = dayjs();

    // Check if time is in the past
    if (newTime.isBefore(now)) {
      return {
        valid: false,
        error: 'Cannot schedule for past time',
      };
    }

    // Check minimum lead time
    const minLeadTime = 30; // minutes
    if (newTime.diff(now, 'minute') < minLeadTime) {
      return {
        valid: false,
        error: `Minimum ${minLeadTime} minutes lead time required`,
      };
    }

    // Check merchant operating hours
    const isOpen = await this.checkMerchantHours(order.merchant_id, newTime.toDate());
    if (!isOpen) {
      return {
        valid: false,
        error: 'Merchant is closed at the requested time',
      };
    }

    // Check if too far in future
    const maxDays = 7;
    if (newTime.diff(now, 'day') > maxDays) {
      return {
        valid: false,
        error: `Cannot schedule more than ${maxDays} days in advance`,
      };
    }

    return { valid: true };
  }

  private getStatusChangeTime(order: any): Date {
    // Get the timestamp when order entered current status
    switch (order.status) {
      case 'confirmed':
        return order.confirmed_at || order.created_at;
      case 'preparing':
        return order.accepted_at || order.confirmed_at;
      case 'ready':
        return order.ready_at || order.accepted_at;
      default:
        return order.created_at;
    }
  }

  private async getMerchantSettings(merchantId: string): Promise<any> {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    return merchant?.settings || {
      allowModifications: true,
      modificationTimeLimit: 10,
      requireApprovalForPriceIncrease: true,
    };
  }

  private async checkDeliveryZone(
    merchantId: string,
    latitude: number,
    longitude: number
  ): Promise<boolean> {
    // This would check if the location is within merchant's reskflow zone
    // For now, return true
    return true;
  }

  private async calculateDeliveryFee(
    merchantId: string,
    latitude: number,
    longitude: number
  ): Promise<number> {
    // This would calculate reskflow fee based on distance
    // For now, return a fixed fee
    return 5.99;
  }

  private async checkMerchantHours(
    merchantId: string,
    time: Date
  ): Promise<boolean> {
    // This would check merchant operating hours
    // For now, return true
    return true;
  }
}