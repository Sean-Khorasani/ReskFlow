import { prisma, logger } from '@reskflow/shared';
import { ValidationService } from './ValidationService';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface Coupon {
  id: string;
  code: string;
  promotionId: string;
  status: 'active' | 'used' | 'expired' | 'disabled';
  usageLimit?: number;
  usageCount: number;
  customerUsageLimit?: number;
  expiresAt?: Date;
  metadata?: any;
  createdAt: Date;
}

interface CouponValidation {
  valid: boolean;
  coupon?: Coupon;
  promotion?: any;
  error?: string;
  discount?: {
    amount: number;
    type: string;
  };
}

interface BulkCouponResult {
  created: number;
  codes: string[];
  errors: string[];
}

export class CouponService {
  constructor(private validationService: ValidationService) {}

  async createCoupon(params: {
    promotionId: string;
    code?: string;
    usageLimit?: number;
    customerUsageLimit?: number;
    expiresAt?: Date;
    metadata?: any;
  }): Promise<Coupon> {
    // Generate code if not provided
    const code = params.code || this.generateCouponCode();

    // Ensure code is unique
    const existing = await prisma.coupon.findUnique({
      where: { code },
    });

    if (existing) {
      throw new Error('Coupon code already exists');
    }

    // Verify promotion exists
    const promotion = await prisma.promotion.findUnique({
      where: { id: params.promotionId },
    });

    if (!promotion) {
      throw new Error('Promotion not found');
    }

    // Create coupon
    const coupon = await prisma.coupon.create({
      data: {
        id: uuidv4(),
        code,
        promotion_id: params.promotionId,
        status: 'active',
        usage_limit: params.usageLimit,
        usage_count: 0,
        customer_usage_limit: params.customerUsageLimit,
        expires_at: params.expiresAt || promotion.end_date,
        metadata: params.metadata || {},
      },
    });

    return this.mapToCoupon(coupon);
  }

  async generatePromotionCoupon(
    promotionId: string,
    prefix?: string
  ): Promise<Coupon> {
    const code = this.generateCouponCode(prefix);
    
    return this.createCoupon({
      promotionId,
      code,
    });
  }

  async generateBulkCoupons(
    promotionId: string,
    count: number,
    prefix?: string
  ): Promise<BulkCouponResult> {
    const codes: string[] = [];
    const errors: string[] = [];
    let created = 0;

    // Generate unique codes
    const generatedCodes = new Set<string>();
    while (generatedCodes.size < count) {
      generatedCodes.add(this.generateCouponCode(prefix));
    }

    // Check for existing codes
    const existingCodes = await prisma.coupon.findMany({
      where: {
        code: { in: Array.from(generatedCodes) },
      },
      select: { code: true },
    });

    const existingSet = new Set(existingCodes.map(c => c.code));

    // Create coupons
    const couponsToCreate = [];
    for (const code of generatedCodes) {
      if (!existingSet.has(code)) {
        couponsToCreate.push({
          id: uuidv4(),
          code,
          promotion_id: promotionId,
          status: 'active',
          usage_count: 0,
          created_at: new Date(),
        });
        codes.push(code);
      } else {
        errors.push(`Code ${code} already exists`);
      }
    }

    if (couponsToCreate.length > 0) {
      const result = await prisma.coupon.createMany({
        data: couponsToCreate,
      });
      created = result.count;
    }

    return { created, codes, errors };
  }

  async validateCoupon(
    code: string,
    merchantId: string,
    customerId?: string,
    orderAmount?: number
  ): Promise<CouponValidation> {
    try {
      // Find coupon
      const coupon = await prisma.coupon.findUnique({
        where: { code: code.toUpperCase() },
        include: {
          promotion: true,
        },
      });

      if (!coupon) {
        return {
          valid: false,
          error: 'Invalid coupon code',
        };
      }

      // Check merchant
      if (coupon.promotion.merchant_id !== merchantId) {
        return {
          valid: false,
          error: 'Coupon not valid for this merchant',
        };
      }

      // Check status
      if (coupon.status !== 'active') {
        return {
          valid: false,
          error: `Coupon is ${coupon.status}`,
        };
      }

      // Check expiration
      if (coupon.expires_at && dayjs().isAfter(coupon.expires_at)) {
        await this.expireCoupon(coupon.id);
        return {
          valid: false,
          error: 'Coupon has expired',
        };
      }

      // Check promotion status
      if (coupon.promotion.status !== 'active') {
        return {
          valid: false,
          error: 'Associated promotion is not active',
        };
      }

      // Check usage limit
      if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
        return {
          valid: false,
          error: 'Coupon usage limit reached',
        };
      }

      // Check customer usage limit
      if (customerId && coupon.customer_usage_limit) {
        const customerUsage = await prisma.couponUsage.count({
          where: {
            coupon_id: coupon.id,
            customer_id: customerId,
          },
        });

        if (customerUsage >= coupon.customer_usage_limit) {
          return {
            valid: false,
            error: 'You have already used this coupon',
          };
        }
      }

      // Validate promotion conditions
      if (orderAmount !== undefined) {
        const conditions = coupon.promotion.conditions as any;
        if (conditions.minOrderAmount && orderAmount < conditions.minOrderAmount) {
          return {
            valid: false,
            error: `Minimum order amount is $${conditions.minOrderAmount}`,
          };
        }
      }

      // Calculate discount preview
      let discountAmount = 0;
      if (orderAmount) {
        switch (coupon.promotion.type) {
          case 'percentage':
            discountAmount = (orderAmount * coupon.promotion.value) / 100;
            if (coupon.promotion.conditions.maxDiscountAmount) {
              discountAmount = Math.min(
                discountAmount,
                coupon.promotion.conditions.maxDiscountAmount
              );
            }
            break;
          
          case 'fixed':
            discountAmount = Math.min(coupon.promotion.value, orderAmount);
            break;
        }
      }

      return {
        valid: true,
        coupon: this.mapToCoupon(coupon),
        promotion: coupon.promotion,
        discount: {
          amount: discountAmount,
          type: coupon.promotion.type,
        },
      };
    } catch (error) {
      logger.error('Error validating coupon:', error);
      return {
        valid: false,
        error: 'Error validating coupon',
      };
    }
  }

  async useCoupon(
    couponId: string,
    customerId: string,
    orderId: string
  ): Promise<void> {
    // Update usage count
    await prisma.coupon.update({
      where: { id: couponId },
      data: {
        usage_count: { increment: 1 },
      },
    });

    // Record usage
    await prisma.couponUsage.create({
      data: {
        id: uuidv4(),
        coupon_id: couponId,
        customer_id: customerId,
        order_id: orderId,
        used_at: new Date(),
      },
    });

    // Check if coupon should be marked as used
    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId },
    });

    if (coupon && coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
      await prisma.coupon.update({
        where: { id: couponId },
        data: { status: 'used' },
      });
    }
  }

  async disableCoupon(couponId: string): Promise<void> {
    await prisma.coupon.update({
      where: { id: couponId },
      data: {
        status: 'disabled',
        disabled_at: new Date(),
      },
    });
  }

  async expireCoupon(couponId: string): Promise<void> {
    await prisma.coupon.update({
      where: { id: couponId },
      data: {
        status: 'expired',
        expired_at: new Date(),
      },
    });
  }

  async getCouponUsageStats(couponId: string): Promise<{
    totalUsage: number;
    uniqueCustomers: number;
    revenue: number;
    averageOrderValue: number;
    usageByDay: Array<{ date: string; count: number }>;
  }> {
    const usage = await prisma.couponUsage.findMany({
      where: { coupon_id: couponId },
      include: {
        order: true,
      },
    });

    const uniqueCustomers = new Set(usage.map(u => u.customer_id)).size;
    const revenue = usage.reduce((sum, u) => sum + (u.order?.total || 0), 0);
    const averageOrderValue = usage.length > 0 ? revenue / usage.length : 0;

    // Group by day
    const usageByDay = new Map<string, number>();
    usage.forEach(u => {
      const date = dayjs(u.used_at).format('YYYY-MM-DD');
      usageByDay.set(date, (usageByDay.get(date) || 0) + 1);
    });

    return {
      totalUsage: usage.length,
      uniqueCustomers,
      revenue,
      averageOrderValue,
      usageByDay: Array.from(usageByDay.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async searchCoupons(params: {
    merchantId: string;
    query?: string;
    status?: string;
    promotionId?: string;
    page: number;
    limit: number;
  }): Promise<{
    coupons: Coupon[];
    total: number;
  }> {
    const where: any = {
      promotion: {
        merchant_id: params.merchantId,
      },
    };

    if (params.query) {
      where.code = {
        contains: params.query.toUpperCase(),
      };
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.promotionId) {
      where.promotion_id = params.promotionId;
    }

    const [coupons, total] = await Promise.all([
      prisma.coupon.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          promotion: {
            select: {
              name: true,
              type: true,
              value: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      prisma.coupon.count({ where }),
    ]);

    return {
      coupons: coupons.map(c => this.mapToCoupon(c)),
      total,
    };
  }

  private generateCouponCode(prefix?: string): string {
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = prefix ? `${prefix}-${randomPart}` : randomPart;
    return code.substring(0, 12); // Limit length
  }

  private mapToCoupon(dbCoupon: any): Coupon {
    return {
      id: dbCoupon.id,
      code: dbCoupon.code,
      promotionId: dbCoupon.promotion_id,
      status: dbCoupon.status,
      usageLimit: dbCoupon.usage_limit,
      usageCount: dbCoupon.usage_count,
      customerUsageLimit: dbCoupon.customer_usage_limit,
      expiresAt: dbCoupon.expires_at,
      metadata: dbCoupon.metadata,
      createdAt: dbCoupon.created_at,
    };
  }
}