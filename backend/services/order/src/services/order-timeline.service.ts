import { OrderStatus, OrderTimeline, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

interface TimelineEntry {
  orderId: string;
  status: OrderStatus;
  message: string;
  actor?: string;
  metadata?: any;
}

export class OrderTimelineService {
  async addEntry(
    tx: Prisma.TransactionClient | typeof prisma,
    entry: TimelineEntry
  ): Promise<OrderTimeline> {
    try {
      return await tx.orderTimeline.create({
        data: {
          orderId: entry.orderId,
          status: entry.status,
          message: entry.message,
          actor: entry.actor,
          metadata: entry.metadata,
        },
      });
    } catch (error) {
      logger.error('Failed to add timeline entry:', error);
      throw error;
    }
  }

  async getOrderTimeline(orderId: string): Promise<OrderTimeline[]> {
    return prisma.orderTimeline.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLatestEntry(orderId: string): Promise<OrderTimeline | null> {
    return prisma.orderTimeline.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }
}