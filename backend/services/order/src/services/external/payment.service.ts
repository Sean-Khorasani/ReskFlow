import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { ServiceUnavailableError } from '../../utils/errors';

export class PaymentService {
  private baseUrl = config.services.payment;

  async createPayment(orderData: {
    orderId: string;
    userId: string;
    amount: number;
    paymentMethodId?: string;
  }): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/payments`, {
        orderId: orderData.orderId,
        userId: orderData.userId,
        amount: orderData.amount,
        paymentMethodId: orderData.paymentMethodId,
        type: 'ORDER_PAYMENT',
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to create payment:', error);
      throw new ServiceUnavailableError('Payment service unavailable');
    }
  }

  async refundPayment(paymentId: string, amount: number, reason?: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/payments/${paymentId}/refund`,
        {
          amount,
          reason,
        }
      );
      return response.data;
    } catch (error) {
      logger.error('Failed to refund payment:', error);
      throw new ServiceUnavailableError('Payment service unavailable');
    }
  }

  async getPaymentStatus(paymentId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/payments/${paymentId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get payment status:', error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw new ServiceUnavailableError('Payment service unavailable');
    }
  }
}