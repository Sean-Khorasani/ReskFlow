import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';
import Joi from 'joi';

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class ValidationService {
  private promotionSchema = Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(500).required(),
    type: Joi.string()
      .valid('percentage', 'fixed', 'bogo', 'bundle', 'loyalty', 'free_reskflow')
      .required(),
    value: Joi.number().positive().required(),
    startDate: Joi.date().required(),
    endDate: Joi.date().greater(Joi.ref('startDate')).required(),
    usageLimit: Joi.number().integer().positive().optional(),
    customerLimit: Joi.number().integer().positive().optional(),
    conditions: Joi.object({
      minOrderAmount: Joi.number().positive().optional(),
      maxDiscountAmount: Joi.number().positive().optional(),
      applicableItems: Joi.array().items(Joi.string()).optional(),
      applicableCategories: Joi.array().items(Joi.string()).optional(),
      excludedItems: Joi.array().items(Joi.string()).optional(),
      customerSegments: Joi.array().items(Joi.string()).optional(),
      dayOfWeek: Joi.array().items(Joi.number().min(0).max(6)).optional(),
      timeOfDay: Joi.object({
        start: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
        end: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      }).optional(),
      reskflowTypes: Joi.array().items(Joi.string()).optional(),
      paymentMethods: Joi.array().items(Joi.string()).optional(),
      firstOrderOnly: Joi.boolean().optional(),
      requiresCoupon: Joi.boolean().optional(),
    }).required(),
  });

  async validatePromotion(promotion: any): Promise<ValidationResult> {
    const result = this.promotionSchema.validate(promotion, { abortEarly: false });
    
    if (result.error) {
      return {
        valid: false,
        errors: result.error.details.map(d => d.message),
      };
    }

    // Additional business logic validation
    const businessErrors: string[] = [];

    // Validate percentage discount
    if (promotion.type === 'percentage' && promotion.value > 100) {
      businessErrors.push('Percentage discount cannot exceed 100%');
    }

    // Validate date range
    const duration = dayjs(promotion.endDate).diff(promotion.startDate, 'day');
    if (duration > 365) {
      businessErrors.push('Promotion duration cannot exceed 1 year');
    }

    // Validate conditions
    if (promotion.conditions.maxDiscountAmount && 
        promotion.conditions.maxDiscountAmount < promotion.value &&
        promotion.type === 'fixed') {
      businessErrors.push('Max discount amount cannot be less than fixed discount value');
    }

    return {
      valid: businessErrors.length === 0,
      errors: businessErrors.length > 0 ? businessErrors : undefined,
    };
  }

  async validatePromotionEligibility(
    promotion: any,
    customerId?: string,
    orderDetails?: {
      items: Array<{ itemId: string; categoryId: string; quantity: number; price: number }>;
      subtotal: number;
      reskflowType: string;
      paymentMethod: string;
    }
  ): Promise<boolean> {
    const conditions = promotion.conditions;

    // Check basic conditions
    const now = new Date();
    if (now < promotion.start_date || now > promotion.end_date) {
      return false;
    }

    if (promotion.status !== 'active') {
      return false;
    }

    // Check usage limits
    if (promotion.usage_limit && promotion.usage_count >= promotion.usage_limit) {
      return false;
    }

    // Check order amount
    if (conditions.minOrderAmount && orderDetails) {
      if (orderDetails.subtotal < conditions.minOrderAmount) {
        return false;
      }
    }

    // Check customer eligibility
    if (customerId) {
      const customerEligible = await this.checkCustomerEligibility(
        promotion,
        customerId,
        conditions
      );
      if (!customerEligible) {
        return false;
      }
    }

    // Check item/category restrictions
    if (orderDetails && (conditions.applicableItems || conditions.applicableCategories)) {
      const itemsEligible = this.checkItemEligibility(
        orderDetails.items,
        conditions
      );
      if (!itemsEligible) {
        return false;
      }
    }

    // Check day/time restrictions
    if (!this.checkTimeRestrictions(conditions)) {
      return false;
    }

    // Check reskflow type
    if (conditions.reskflowTypes && orderDetails) {
      if (!conditions.reskflowTypes.includes(orderDetails.reskflowType)) {
        return false;
      }
    }

    // Check payment method
    if (conditions.paymentMethods && orderDetails) {
      if (!conditions.paymentMethods.includes(orderDetails.paymentMethod)) {
        return false;
      }
    }

    return true;
  }

  async checkCustomerEligibility(
    promotion: any,
    customerId: string,
    conditions: any
  ): Promise<boolean> {
    // Check customer usage limit
    if (promotion.customer_limit) {
      const usage = await prisma.promotionUsage.count({
        where: {
          promotion_id: promotion.id,
          customer_id: customerId,
        },
      });

      if (usage >= promotion.customer_limit) {
        return false;
      }
    }

    // Check first order only
    if (conditions.firstOrderOnly) {
      const previousOrders = await prisma.order.count({
        where: {
          customer_id: customerId,
          merchant_id: promotion.merchant_id,
          status: 'delivered',
        },
      });

      if (previousOrders > 0) {
        return false;
      }
    }

    // Check customer segments
    if (conditions.customerSegments?.length > 0) {
      const segment = await this.getCustomerSegment(customerId, promotion.merchant_id);
      if (!conditions.customerSegments.includes(segment)) {
        return false;
      }
    }

    return true;
  }

  checkItemEligibility(
    items: Array<{ itemId: string; categoryId: string }>,
    conditions: any
  ): boolean {
    const hasEligibleItems = items.some(item => {
      // Check excluded items first
      if (conditions.excludedItems?.includes(item.itemId)) {
        return false;
      }

      // Check applicable items
      if (conditions.applicableItems?.length > 0) {
        return conditions.applicableItems.includes(item.itemId);
      }

      // Check applicable categories
      if (conditions.applicableCategories?.length > 0) {
        return conditions.applicableCategories.includes(item.categoryId);
      }

      // No restrictions, item is eligible
      return true;
    });

    return hasEligibleItems;
  }

  checkTimeRestrictions(conditions: any): boolean {
    const now = dayjs();

    // Check day of week
    if (conditions.dayOfWeek?.length > 0) {
      const currentDay = now.day();
      if (!conditions.dayOfWeek.includes(currentDay)) {
        return false;
      }
    }

    // Check time of day
    if (conditions.timeOfDay) {
      const currentTime = now.format('HH:mm');
      const { start, end } = conditions.timeOfDay;

      // Handle overnight time ranges
      if (start > end) {
        // e.g., 22:00 - 02:00
        if (currentTime < end || currentTime >= start) {
          return true;
        }
        return false;
      } else {
        // Normal time range
        if (currentTime >= start && currentTime <= end) {
          return true;
        }
        return false;
      }
    }

    return true;
  }

  async validateCouponCode(code: string): Promise<ValidationResult> {
    const errors: string[] = [];

    // Format validation
    if (!code || code.length < 3 || code.length > 20) {
      errors.push('Coupon code must be between 3 and 20 characters');
    }

    if (!/^[A-Z0-9-]+$/.test(code.toUpperCase())) {
      errors.push('Coupon code can only contain letters, numbers, and hyphens');
    }

    // Check uniqueness
    const existing = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (existing) {
      errors.push('Coupon code already exists');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async validateDiscountStack(
    discounts: Array<{ promotionId: string; type: string; amount: number }>,
    merchantSettings?: any
  ): Promise<ValidationResult> {
    const errors: string[] = [];

    // Check if stacking is allowed
    if (!merchantSettings?.allowDiscountStacking && discounts.length > 1) {
      errors.push('Multiple discounts cannot be applied together');
    }

    // Check for conflicting discount types
    const types = discounts.map(d => d.type);
    
    if (types.includes('bogo') && types.length > 1) {
      errors.push('BOGO promotions cannot be combined with other discounts');
    }

    if (types.filter(t => t === 'percentage').length > 1) {
      errors.push('Multiple percentage discounts cannot be applied');
    }

    if (types.filter(t => t === 'free_reskflow').length > 1) {
      errors.push('Multiple free reskflow promotions cannot be applied');
    }

    // Check total discount amount
    const totalDiscount = discounts.reduce((sum, d) => sum + d.amount, 0);
    const maxDiscountPercent = merchantSettings?.maxDiscountPercent || 50;

    // This would need order subtotal to calculate percentage
    // For now, just ensure reasonable limits

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async getCustomerSegment(
    customerId: string,
    merchantId: string
  ): Promise<string> {
    // Get customer segment from database or calculate it
    const customerData = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        orders: {
          where: {
            merchant_id: merchantId,
            status: 'delivered',
          },
          select: {
            total: true,
            created_at: true,
          },
        },
      },
    });

    if (!customerData || customerData.orders.length === 0) {
      return 'new';
    }

    const totalSpent = customerData.orders.reduce((sum, o) => sum + o.total, 0);
    const lastOrderDate = customerData.orders
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0]
      .created_at;

    const daysSinceLastOrder = dayjs().diff(lastOrderDate, 'day');

    // Simple segmentation logic
    if (totalSpent > 500 && daysSinceLastOrder < 30) {
      return 'vip';
    } else if (customerData.orders.length >= 5) {
      return 'regular';
    } else if (daysSinceLastOrder > 60) {
      return 'at_risk';
    } else {
      return 'occasional';
    }
  }
}