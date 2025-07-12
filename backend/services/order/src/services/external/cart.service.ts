import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { ServiceUnavailableError } from '../../utils/errors';

export class CartService {
  private baseUrl = config.services.cart;

  async getCart(cartId: string, userId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/carts/${cartId}`, {
        headers: {
          'X-User-Id': userId,
        },
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get cart:', error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw new ServiceUnavailableError('Cart service unavailable');
    }
  }

  async clearCart(cartId: string, userId: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/api/v1/carts/${cartId}/items`, {
        headers: {
          'X-User-Id': userId,
        },
      });
    } catch (error) {
      logger.error('Failed to clear cart:', error);
      // Don't throw error for cart clearing as order is already created
    }
  }
}