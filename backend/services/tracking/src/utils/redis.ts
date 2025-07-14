import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

class RedisClient {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error', { error: error.message });
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      logger.warn('Redis client disconnected');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.isConnected = true;
      logger.info('Redis connection established');
    } catch (error) {
      logger.error('Failed to connect to Redis', { error: error.message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error('Error closing Redis connection', { error: error.message });
    }
  }

  // Location tracking operations
  async updateLocation(sessionId: string, location: any): Promise<void> {
    if (!this.isConnected) return;

    try {
      const key = `tracking:location:${sessionId}`;
      const locationData = {
        ...location,
        timestamp: new Date().toISOString(),
      };
      
      await this.client.setEx(key, 3600, JSON.stringify(locationData)); // 1 hour TTL
      await this.client.publish(`location:${sessionId}`, JSON.stringify(locationData));
      
      // Store in location history
      const historyKey = `tracking:history:${sessionId}`;
      await this.client.lPush(historyKey, JSON.stringify(locationData));
      await this.client.lTrim(historyKey, 0, 999); // Keep last 1000 updates
      await this.client.expire(historyKey, 86400); // 24 hours TTL
    } catch (error) {
      logger.error('Failed to update location in Redis', { error: error.message, sessionId });
    }
  }

  async getLocation(sessionId: string): Promise<any | null> {
    if (!this.isConnected) return null;

    try {
      const key = `tracking:location:${sessionId}`;
      const location = await this.client.get(key);
      return location ? JSON.parse(location) : null;
    } catch (error) {
      logger.error('Failed to get location from Redis', { error: error.message, sessionId });
      return null;
    }
  }

  async getLocationHistory(sessionId: string, limit: number = 100): Promise<any[]> {
    if (!this.isConnected) return [];

    try {
      const historyKey = `tracking:history:${sessionId}`;
      const history = await this.client.lRange(historyKey, 0, limit - 1);
      return history.map(item => JSON.parse(item));
    } catch (error) {
      logger.error('Failed to get location history from Redis', { error: error.message, sessionId });
      return [];
    }
  }

  // Session management
  async setSessionStatus(sessionId: string, status: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      const key = `tracking:status:${sessionId}`;
      await this.client.setEx(key, 3600, status);
      await this.client.publish(`status:${sessionId}`, status);
    } catch (error) {
      logger.error('Failed to set session status in Redis', { error: error.message, sessionId });
    }
  }

  async getSessionStatus(sessionId: string): Promise<string | null> {
    if (!this.isConnected) return null;

    try {
      const key = `tracking:status:${sessionId}`;
      return await this.client.get(key);
    } catch (error) {
      logger.error('Failed to get session status from Redis', { error: error.message, sessionId });
      return null;
    }
  }

  // Driver tracking
  async setDriverLocation(driverId: string, location: any): Promise<void> {
    if (!this.isConnected) return;

    try {
      const key = `driver:location:${driverId}`;
      const locationData = {
        ...location,
        timestamp: new Date().toISOString(),
      };
      
      await this.client.setEx(key, 300, JSON.stringify(locationData)); // 5 minutes TTL
      await this.client.geoAdd('drivers:locations', {
        longitude: location.longitude,
        latitude: location.latitude,
        member: driverId,
      });
    } catch (error) {
      logger.error('Failed to set driver location in Redis', { error: error.message, driverId });
    }
  }

  async getDriverLocation(driverId: string): Promise<any | null> {
    if (!this.isConnected) return null;

    try {
      const key = `driver:location:${driverId}`;
      const location = await this.client.get(key);
      return location ? JSON.parse(location) : null;
    } catch (error) {
      logger.error('Failed to get driver location from Redis', { error: error.message, driverId });
      return null;
    }
  }

  async getNearbyDrivers(latitude: number, longitude: number, radius: number): Promise<string[]> {
    if (!this.isConnected) return [];

    try {
      const results = await this.client.geoRadius(
        'drivers:locations',
        { longitude, latitude },
        radius,
        'km'
      );
      return results;
    } catch (error) {
      logger.error('Failed to get nearby drivers from Redis', { error: error.message });
      return [];
    }
  }

  // Real-time subscriptions
  async subscribeToLocation(sessionId: string, callback: (location: any) => void): Promise<void> {
    if (!this.isConnected) return;

    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();
      
      await subscriber.subscribe(`location:${sessionId}`, (message) => {
        try {
          const location = JSON.parse(message);
          callback(location);
        } catch (error) {
          logger.error('Failed to parse location message', { error: error.message, message });
        }
      });
    } catch (error) {
      logger.error('Failed to subscribe to location updates', { error: error.message, sessionId });
    }
  }

  async subscribeToStatus(sessionId: string, callback: (status: string) => void): Promise<void> {
    if (!this.isConnected) return;

    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();
      
      await subscriber.subscribe(`status:${sessionId}`, (message) => {
        callback(message);
      });
    } catch (error) {
      logger.error('Failed to subscribe to status updates', { error: error.message, sessionId });
    }
  }

  // Caching operations
  async cache(key: string, data: any, ttl: number = 3600): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.setEx(`cache:${key}`, ttl, JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to cache data in Redis', { error: error.message, key });
    }
  }

  async getCached(key: string): Promise<any | null> {
    if (!this.isConnected) return null;

    try {
      const data = await this.client.get(`cache:${key}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Failed to get cached data from Redis', { error: error.message, key });
      return null;
    }
  }

  async deleteCached(key: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.del(`cache:${key}`);
    } catch (error) {
      logger.error('Failed to delete cached data from Redis', { error: error.message, key });
    }
  }

  // Analytics and metrics
  async incrementCounter(key: string, value: number = 1): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.incrBy(`counter:${key}`, value);
    } catch (error) {
      logger.error('Failed to increment counter in Redis', { error: error.message, key });
    }
  }

  async getCounter(key: string): Promise<number> {
    if (!this.isConnected) return 0;

    try {
      const count = await this.client.get(`counter:${key}`);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger.error('Failed to get counter from Redis', { error: error.message, key });
      return 0;
    }
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      logger.error('Redis ping failed', { error: error.message });
      return false;
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

export const redisClient = new RedisClient();
export default redisClient;