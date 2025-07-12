import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { ServiceUnavailableError } from '../../utils/errors';

interface Product {
  id: string;
  merchantId: string;
  name: string;
  price: number;
  image?: string;
  isAvailable: boolean;
}

export class CatalogService {
  private baseUrl = config.services.catalog;

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/products/${productId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get product:', error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw new ServiceUnavailableError('Catalog service unavailable');
    }
  }

  async validateProducts(productIds: string[]): Promise<Map<string, Product>> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/products/validate`, {
        productIds,
      });
      
      const products = new Map<string, Product>();
      response.data.forEach((product: Product) => {
        products.set(product.id, product);
      });
      
      return products;
    } catch (error) {
      logger.error('Failed to validate products:', error);
      throw new ServiceUnavailableError('Catalog service unavailable');
    }
  }
}