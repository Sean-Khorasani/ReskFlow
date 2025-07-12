import { Request, Response, NextFunction } from 'express';
import { OrderStatisticsService } from '../services/order-statistics.service';

export class StatisticsController {
  private statisticsService: OrderStatisticsService;

  constructor() {
    this.statisticsService = new OrderStatisticsService();
  }

  getOrderStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate, merchantId } = req.query;
      
      // For merchants, ensure they can only see their own stats
      let filterMerchantId = merchantId as string;
      if (req.user!.role === 'MERCHANT') {
        filterMerchantId = req.user!.merchantId!;
      }

      const statistics = await this.statisticsService.getOrderStatistics({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        merchantId: filterMerchantId,
      });

      res.json({ statistics });
    } catch (error) {
      next(error);
    }
  };

  getRevenueStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate, merchantId, groupBy } = req.query;
      
      // For merchants, ensure they can only see their own stats
      let filterMerchantId = merchantId as string;
      if (req.user!.role === 'MERCHANT') {
        filterMerchantId = req.user!.merchantId!;
      }

      const statistics = await this.statisticsService.getRevenueStatistics({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        merchantId: filterMerchantId,
        groupBy: groupBy as 'day' | 'week' | 'month' | undefined,
      });

      res.json({ statistics });
    } catch (error) {
      next(error);
    }
  };

  getPopularItems = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { merchantId, limit } = req.query;
      
      // For merchants, ensure they can only see their own stats
      let filterMerchantId = merchantId as string;
      if (req.user!.role === 'MERCHANT') {
        filterMerchantId = req.user!.merchantId!;
      }

      const items = await this.statisticsService.getPopularItems({
        merchantId: filterMerchantId,
        limit: limit ? parseInt(limit as string) : 10,
      });

      res.json({ items });
    } catch (error) {
      next(error);
    }
  };
}