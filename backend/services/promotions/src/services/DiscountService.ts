import { prisma, logger } from '@reskflow/shared';
import { ValidationService } from './ValidationService';
import dayjs from 'dayjs';

interface DiscountCalculation {
  orderId: string;
  merchantId: string;
  customerId?: string;
  items: OrderItem[];
  subtotal: number;
  reskflowFee: number;
  couponCode?: string;
}

interface OrderItem {
  itemId: string;
  quantity: number;
  price: number;
  categoryId: string;
}

interface AppliedDiscount {
  promotionId: string;
  promotionName: string;
  type: string;
  amount: number;
  appliedTo: 'order' | 'items' | 'reskflow';
  itemsAffected?: string[];
}

interface DiscountResult {
  subtotal: number;
  reskflowFee: number;
  totalDiscount: number;
  finalTotal: number;
  appliedDiscounts: AppliedDiscount[];
  savings: number;
  messages: string[];
}

export class DiscountService {
  constructor(private validationService: ValidationService) {}

  async calculateDiscounts(calculation: DiscountCalculation): Promise<DiscountResult> {
    const appliedDiscounts: AppliedDiscount[] = [];
    let currentSubtotal = calculation.subtotal;
    let currentDeliveryFee = calculation.reskflowFee;
    const messages: string[] = [];

    // Get all applicable promotions
    const promotions = await this.getApplicablePromotions(
      calculation.merchantId,
      calculation.customerId,
      calculation
    );

    // Apply coupon if provided
    if (calculation.couponCode) {
      const couponDiscount = await this.applyCoupon(
        calculation.couponCode,
        calculation,
        currentSubtotal
      );
      
      if (couponDiscount) {
        appliedDiscounts.push(couponDiscount);
        if (couponDiscount.appliedTo === 'order') {
          currentSubtotal -= couponDiscount.amount;
        } else if (couponDiscount.appliedTo === 'reskflow') {
          currentDeliveryFee -= couponDiscount.amount;
        }
        messages.push(`Coupon applied: ${couponDiscount.promotionName}`);
      }
    }

    // Apply automatic promotions
    for (const promotion of promotions) {
      const discount = await this.applyPromotion(
        promotion,
        calculation,
        currentSubtotal,
        currentDeliveryFee
      );

      if (discount && !this.conflictsWithExisting(discount, appliedDiscounts)) {
        appliedDiscounts.push(discount);
        
        if (discount.appliedTo === 'order') {
          currentSubtotal -= discount.amount;
        } else if (discount.appliedTo === 'reskflow') {
          currentDeliveryFee = Math.max(0, currentDeliveryFee - discount.amount);
        }
        
        messages.push(`${discount.promotionName} applied`);
      }
    }

    // Calculate totals
    const totalDiscount = calculation.subtotal - currentSubtotal + 
                         calculation.reskflowFee - currentDeliveryFee;
    const finalTotal = currentSubtotal + currentDeliveryFee;
    const savings = (totalDiscount / calculation.subtotal) * 100;

    // Record discount applications
    if (calculation.orderId && appliedDiscounts.length > 0) {
      await this.recordDiscountApplications(calculation.orderId, appliedDiscounts);
    }

    return {
      subtotal: currentSubtotal,
      reskflowFee: currentDeliveryFee,
      totalDiscount,
      finalTotal,
      appliedDiscounts,
      savings,
      messages,
    };
  }

  async validateAndApplyDiscount(
    orderId: string,
    promotionId: string,
    customerId: string
  ): Promise<boolean> {
    try {
      // Get order details
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Get promotion
      const promotion = await prisma.promotion.findUnique({
        where: { id: promotionId },
      });

      if (!promotion || promotion.status !== 'active') {
        throw new Error('Promotion not available');
      }

      // Validate eligibility
      const isEligible = await this.validationService.validatePromotionEligibility(
        promotion,
        customerId,
        {
          items: order.orderItems.map(oi => ({
            itemId: oi.item_id,
            quantity: oi.quantity,
            price: oi.price,
            categoryId: oi.item.category_id,
          })),
          subtotal: order.subtotal,
          reskflowType: order.order_type,
          paymentMethod: order.payment?.method || '',
        }
      );

      if (!isEligible) {
        return false;
      }

      // Calculate discount
      const discount = this.calculatePromotionDiscount(
        promotion,
        order.subtotal,
        order.orderItems
      );

      // Apply discount to order
      await prisma.order.update({
        where: { id: orderId },
        data: {
          discount_amount: discount.amount,
          total: order.subtotal + order.reskflow_fee - discount.amount,
        },
      });

      // Record usage
      await prisma.promotionUsage.create({
        data: {
          promotion_id: promotionId,
          order_id: orderId,
          customer_id: customerId,
          discount_amount: discount.amount,
          used_at: new Date(),
        },
      });

      return true;
    } catch (error) {
      logger.error('Error applying discount:', error);
      return false;
    }
  }

  private async getApplicablePromotions(
    merchantId: string,
    customerId?: string,
    calculation: DiscountCalculation
  ): Promise<any[]> {
    const now = new Date();

    // Get active promotions
    const promotions = await prisma.promotion.findMany({
      where: {
        merchant_id: merchantId,
        status: 'active',
        start_date: { lte: now },
        end_date: { gte: now },
        conditions: {
          path: '$.requiresCoupon',
          equals: false,
        },
      },
      orderBy: [
        { priority: 'desc' },
        { value: 'desc' },
      ],
    });

    // Filter based on eligibility
    const eligible = [];
    for (const promotion of promotions) {
      const isEligible = await this.validationService.validatePromotionEligibility(
        promotion,
        customerId,
        {
          items: calculation.items,
          subtotal: calculation.subtotal,
          reskflowType: 'reskflow', // Default
          paymentMethod: 'card', // Default
        }
      );

      if (isEligible) {
        eligible.push(promotion);
      }
    }

    return eligible;
  }

  private async applyCoupon(
    couponCode: string,
    calculation: DiscountCalculation,
    currentSubtotal: number
  ): Promise<AppliedDiscount | null> {
    try {
      // Validate coupon
      const coupon = await prisma.coupon.findFirst({
        where: {
          code: couponCode,
          status: 'active',
          expires_at: { gte: new Date() },
        },
        include: {
          promotion: true,
        },
      });

      if (!coupon || !coupon.promotion) {
        return null;
      }

      // Check usage limit
      if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
        return null;
      }

      // Check customer usage
      if (calculation.customerId && coupon.customer_usage_limit) {
        const customerUsage = await prisma.couponUsage.count({
          where: {
            coupon_id: coupon.id,
            customer_id: calculation.customerId,
          },
        });

        if (customerUsage >= coupon.customer_usage_limit) {
          return null;
        }
      }

      // Calculate discount
      const discount = this.calculatePromotionDiscount(
        coupon.promotion,
        currentSubtotal,
        calculation.items
      );

      // Update coupon usage
      await prisma.coupon.update({
        where: { id: coupon.id },
        data: { usage_count: { increment: 1 } },
      });

      // Record coupon usage
      if (calculation.customerId) {
        await prisma.couponUsage.create({
          data: {
            coupon_id: coupon.id,
            customer_id: calculation.customerId,
            order_id: calculation.orderId,
            used_at: new Date(),
          },
        });
      }

      return discount;
    } catch (error) {
      logger.error('Error applying coupon:', error);
      return null;
    }
  }

  private async applyPromotion(
    promotion: any,
    calculation: DiscountCalculation,
    currentSubtotal: number,
    currentDeliveryFee: number
  ): Promise<AppliedDiscount | null> {
    const conditions = promotion.conditions;

    // Check if promotion applies to current context
    if (conditions.minOrderAmount && currentSubtotal < conditions.minOrderAmount) {
      return null;
    }

    // Calculate discount based on promotion type
    let discount: AppliedDiscount | null = null;

    switch (promotion.type) {
      case 'percentage':
        discount = this.calculatePercentageDiscount(promotion, currentSubtotal);
        break;
      
      case 'fixed':
        discount = this.calculateFixedDiscount(promotion, currentSubtotal);
        break;
      
      case 'bogo':
        discount = this.calculateBogoDiscount(promotion, calculation.items);
        break;
      
      case 'bundle':
        discount = this.calculateBundleDiscount(promotion, calculation.items);
        break;
      
      case 'free_reskflow':
        discount = this.calculateFreeDeliveryDiscount(promotion, currentDeliveryFee);
        break;
    }

    return discount;
  }

  private calculatePromotionDiscount(
    promotion: any,
    subtotal: number,
    items: any[]
  ): AppliedDiscount {
    const conditions = promotion.conditions;
    let discountAmount = 0;
    let appliedTo: 'order' | 'items' | 'reskflow' = 'order';

    switch (promotion.type) {
      case 'percentage':
        discountAmount = (subtotal * promotion.value) / 100;
        if (conditions.maxDiscountAmount) {
          discountAmount = Math.min(discountAmount, conditions.maxDiscountAmount);
        }
        break;

      case 'fixed':
        discountAmount = Math.min(promotion.value, subtotal);
        break;

      case 'free_reskflow':
        appliedTo = 'reskflow';
        discountAmount = promotion.value; // Will be capped by actual reskflow fee
        break;
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      type: promotion.type,
      amount: discountAmount,
      appliedTo,
    };
  }

  private calculatePercentageDiscount(
    promotion: any,
    subtotal: number
  ): AppliedDiscount {
    let amount = (subtotal * promotion.value) / 100;
    
    if (promotion.conditions.maxDiscountAmount) {
      amount = Math.min(amount, promotion.conditions.maxDiscountAmount);
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      type: 'percentage',
      amount,
      appliedTo: 'order',
    };
  }

  private calculateFixedDiscount(
    promotion: any,
    subtotal: number
  ): AppliedDiscount {
    const amount = Math.min(promotion.value, subtotal);

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      type: 'fixed',
      amount,
      appliedTo: 'order',
    };
  }

  private calculateBogoDiscount(
    promotion: any,
    items: OrderItem[]
  ): AppliedDiscount | null {
    const conditions = promotion.conditions;
    const eligibleItems = items.filter(item => {
      if (conditions.applicableItems?.length) {
        return conditions.applicableItems.includes(item.itemId);
      }
      if (conditions.applicableCategories?.length) {
        return conditions.applicableCategories.includes(item.categoryId);
      }
      return true;
    });

    if (eligibleItems.length < 2) {
      return null;
    }

    // Sort by price to give free on cheapest
    eligibleItems.sort((a, b) => a.price - b.price);
    
    // Calculate free items (buy one get one)
    const freeItemsCount = Math.floor(eligibleItems.length / 2);
    let discountAmount = 0;
    const itemsAffected: string[] = [];

    for (let i = 0; i < freeItemsCount; i++) {
      discountAmount += eligibleItems[i].price;
      itemsAffected.push(eligibleItems[i].itemId);
    }

    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      type: 'bogo',
      amount: discountAmount,
      appliedTo: 'items',
      itemsAffected,
    };
  }

  private calculateBundleDiscount(
    promotion: any,
    items: OrderItem[]
  ): AppliedDiscount | null {
    // Bundle discount logic would go here
    // For now, return null
    return null;
  }

  private calculateFreeDeliveryDiscount(
    promotion: any,
    reskflowFee: number
  ): AppliedDiscount {
    return {
      promotionId: promotion.id,
      promotionName: promotion.name,
      type: 'free_reskflow',
      amount: reskflowFee,
      appliedTo: 'reskflow',
    };
  }

  private conflictsWithExisting(
    newDiscount: AppliedDiscount,
    existingDiscounts: AppliedDiscount[]
  ): boolean {
    // Check for conflicts
    for (const existing of existingDiscounts) {
      // Can't apply multiple discounts to same category
      if (existing.appliedTo === newDiscount.appliedTo) {
        return true;
      }

      // Can't apply BOGO with other item discounts
      if (
        (existing.type === 'bogo' || newDiscount.type === 'bogo') &&
        (existing.appliedTo === 'items' || newDiscount.appliedTo === 'items')
      ) {
        return true;
      }
    }

    return false;
  }

  private async recordDiscountApplications(
    orderId: string,
    discounts: AppliedDiscount[]
  ): Promise<void> {
    for (const discount of discounts) {
      await prisma.appliedDiscount.create({
        data: {
          order_id: orderId,
          promotion_id: discount.promotionId,
          discount_type: discount.type,
          discount_amount: discount.amount,
          applied_to: discount.appliedTo,
          items_affected: discount.itemsAffected,
          applied_at: new Date(),
        },
      });
    }
  }
}