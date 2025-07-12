import axios from 'axios';
import { CryptoCurrency, ExchangeRate } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';

export class ExchangeRateService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_PREFIX = 'exchange_rate:';

  async getRate(from: CryptoCurrency, to: string): Promise<number> {
    try {
      // Check cache first
      const cacheKey = `${this.CACHE_PREFIX}${from}_${to}`;
      const cachedRate = await redis.get(cacheKey);
      
      if (cachedRate) {
        return parseFloat(cachedRate);
      }

      // Fetch from API
      const rate = await this.fetchRateFromAPI(from, to);
      
      // Cache the rate
      await redis.setex(cacheKey, this.CACHE_TTL, rate.toString());
      
      return rate;
    } catch (error) {
      logger.error('Error getting exchange rate:', error);
      // Return a fallback rate if API fails
      return this.getFallbackRate(from, to);
    }
  }

  async getRates(cryptos: CryptoCurrency[], to: string = 'USD'): Promise<Map<CryptoCurrency, number>> {
    const rates = new Map<CryptoCurrency, number>();
    
    // Fetch rates in parallel
    const promises = cryptos.map(async (crypto) => {
      const rate = await this.getRate(crypto, to);
      rates.set(crypto, rate);
    });
    
    await Promise.all(promises);
    return rates;
  }

  private async fetchRateFromAPI(from: CryptoCurrency, to: string): Promise<number> {
    try {
      const cryptoId = this.getCryptoId(from);
      const response = await axios.get(
        `${config.crypto.exchangeRateApi.url}/simple/price`,
        {
          params: {
            ids: cryptoId,
            vs_currencies: to.toLowerCase()
          },
          headers: config.crypto.exchangeRateApi.apiKey ? {
            'X-API-Key': config.crypto.exchangeRateApi.apiKey
          } : undefined
        }
      );

      const rate = response.data[cryptoId][to.toLowerCase()];
      if (!rate) {
        throw new Error(`Rate not found for ${from} to ${to}`);
      }

      return rate;
    } catch (error) {
      logger.error(`Error fetching rate from API for ${from} to ${to}:`, error);
      throw error;
    }
  }

  private getCryptoId(crypto: CryptoCurrency): string {
    const mapping: Record<CryptoCurrency, string> = {
      [CryptoCurrency.BTC]: 'bitcoin',
      [CryptoCurrency.ETH]: 'ethereum',
      [CryptoCurrency.USDT]: 'tether',
      [CryptoCurrency.USDC]: 'usd-coin',
      [CryptoCurrency.MATIC]: 'matic-network'
    };
    
    return mapping[crypto];
  }

  private getFallbackRate(from: CryptoCurrency, to: string): number {
    // Fallback rates (should be updated regularly)
    if (to !== 'USD') {
      logger.warn(`No fallback rate for ${to}, using USD rates`);
    }

    const fallbackRates: Record<CryptoCurrency, number> = {
      [CryptoCurrency.BTC]: 45000,
      [CryptoCurrency.ETH]: 3000,
      [CryptoCurrency.USDT]: 1,
      [CryptoCurrency.USDC]: 1,
      [CryptoCurrency.MATIC]: 0.8
    };

    return fallbackRates[from] || 1;
  }

  async convertAmount(
    amount: number,
    from: CryptoCurrency,
    to: string = 'USD'
  ): Promise<number> {
    const rate = await this.getRate(from, to);
    return amount * rate;
  }
}