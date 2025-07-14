import { Server } from 'socket.io';
import { logger } from '@reskflow/shared';

interface ModificationUpdate {
  type: string;
  modificationId?: string;
  status?: string;
  data?: any;
  timestamp: Date;
}

export class RealTimeUpdateService {
  constructor(private io: Server) {}

  async sendModificationUpdate(orderId: string, update: ModificationUpdate): Promise<void> {
    const fullUpdate = {
      ...update,
      timestamp: new Date(),
    };

    // Send to order room
    this.io.to(`order:${orderId}`).emit('modification-update', fullUpdate);
    
    logger.info(`Sent modification update for order ${orderId}:`, update.type);
  }

  async sendCancellationUpdate(orderId: string, cancellation: any): Promise<void> {
    const update = {
      type: 'order-cancelled',
      cancellationId: cancellation.id,
      reason: cancellation.reason,
      refundAmount: cancellation.refundAmount,
      timestamp: new Date(),
    };

    this.io.to(`order:${orderId}`).emit('cancellation-update', update);
    
    logger.info(`Sent cancellation update for order ${orderId}`);
  }

  async sendRefundUpdate(orderId: string, refund: any): Promise<void> {
    const update = {
      type: 'refund-update',
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount,
      timestamp: new Date(),
    };

    this.io.to(`order:${orderId}`).emit('refund-update', update);
    
    logger.info(`Sent refund update for order ${orderId}:`, refund.status);
  }

  async notifyMerchant(merchantId: string, notification: any): Promise<void> {
    this.io.to(`merchant:${merchantId}`).emit('merchant-notification', {
      ...notification,
      timestamp: new Date(),
    });
  }

  async notifyDriver(driverId: string, notification: any): Promise<void> {
    this.io.to(`driver:${driverId}`).emit('driver-notification', {
      ...notification,
      timestamp: new Date(),
    });
  }

  async notifyCustomer(customerId: string, notification: any): Promise<void> {
    this.io.to(`customer:${customerId}`).emit('customer-notification', {
      ...notification,
      timestamp: new Date(),
    });
  }

  async broadcastOrderUpdate(orderId: string, update: any): Promise<void> {
    // Get all parties involved in the order
    const parties = await this.getOrderParties(orderId);
    
    // Send to each party's room
    if (parties.customerId) {
      await this.notifyCustomer(parties.customerId, update);
    }
    
    if (parties.merchantId) {
      await this.notifyMerchant(parties.merchantId, update);
    }
    
    if (parties.driverId) {
      await this.notifyDriver(parties.driverId, update);
    }
  }

  private async getOrderParties(orderId: string): Promise<{
    customerId?: string;
    merchantId?: string;
    driverId?: string;
  }> {
    // This would fetch from database
    // For now, return mock data
    return {
      customerId: `customer_${orderId}`,
      merchantId: `merchant_${orderId}`,
      driverId: `driver_${orderId}`,
    };
  }
}