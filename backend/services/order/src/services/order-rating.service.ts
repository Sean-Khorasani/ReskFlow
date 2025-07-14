import { OrderRating } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

interface CreateRatingDto {
  orderId: string;
  userId: string;
  foodRating: number;
  reskflowRating?: number;
  overallRating: number;
  comment?: string;
}

export class OrderRatingService {
  async createRating(data: CreateRatingDto): Promise<OrderRating> {
    // Verify order exists and is completed
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: { rating: true },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    if (order.userId !== data.userId) {
      throw new ValidationError('Cannot rate order that does not belong to you');
    }

    if (order.status !== 'DELIVERED' && order.status !== 'COMPLETED') {
      throw new ValidationError('Can only rate delivered orders');
    }

    if (order.rating) {
      throw new ConflictError('Order has already been rated');
    }

    // For pickup/dine-in orders, reskflow rating is not required
    if (order.reskflowType !== 'DELIVERY' && data.reskflowRating) {
      data.reskflowRating = undefined;
    }

    // Create rating
    const rating = await prisma.orderRating.create({
      data: {
        orderId: data.orderId,
        userId: data.userId,
        foodRating: data.foodRating,
        reskflowRating: data.reskflowRating,
        overallRating: data.overallRating,
        comment: data.comment,
      },
    });

    // Update order status to completed if delivered
    if (order.status === 'DELIVERED') {
      await prisma.order.update({
        where: { id: data.orderId },
        data: { status: 'COMPLETED' },
      });
    }

    logger.info(`Rating created for order ${order.orderNumber}`);
    return rating;
  }

  async getRating(ratingId: string): Promise<OrderRating | null> {
    return prisma.orderRating.findUnique({
      where: { id: ratingId },
      include: {
        order: {
          select: {
            orderNumber: true,
            merchantId: true,
          },
        },
      },
    });
  }

  async getOrderRating(orderId: string): Promise<OrderRating | null> {
    return prisma.orderRating.findUnique({
      where: { orderId },
    });
  }

  async getMerchantRatings(
    merchantId: string,
    page: number = 1,
    limit: number = 10
  ) {
    const skip = (page - 1) * limit;

    const [ratings, total] = await Promise.all([
      prisma.orderRating.findMany({
        where: {
          order: {
            merchantId,
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              orderNumber: true,
              items: {
                select: {
                  productName: true,
                  quantity: true,
                },
              },
            },
          },
        },
      }),
      prisma.orderRating.count({
        where: {
          order: {
            merchantId,
          },
        },
      }),
    ]);

    // Calculate average ratings
    const averages = await prisma.orderRating.aggregate({
      where: {
        order: {
          merchantId,
        },
      },
      _avg: {
        foodRating: true,
        reskflowRating: true,
        overallRating: true,
      },
      _count: true,
    });

    return {
      ratings,
      averages: {
        food: averages._avg.foodRating || 0,
        reskflow: averages._avg.reskflowRating || 0,
        overall: averages._avg.overallRating || 0,
        totalRatings: averages._count,
      },
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async addMerchantReply(
    ratingId: string,
    merchantId: string,
    reply: string
  ): Promise<OrderRating> {
    const rating = await prisma.orderRating.findUnique({
      where: { id: ratingId },
      include: {
        order: {
          select: {
            merchantId: true,
          },
        },
      },
    });

    if (!rating) {
      throw new NotFoundError('Rating not found');
    }

    if (rating.order.merchantId !== merchantId) {
      throw new ValidationError('Cannot reply to ratings from other merchants');
    }

    if (rating.merchantReply) {
      throw new ConflictError('Reply has already been added');
    }

    return prisma.orderRating.update({
      where: { id: ratingId },
      data: {
        merchantReply: reply,
        merchantReplyAt: new Date(),
      },
    });
  }
}