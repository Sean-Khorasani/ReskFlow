import express from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { logger } from '@reskflow/shared';
import { ServiceRegistry } from './ServiceRegistry';
import { CircuitBreakerManager } from './CircuitBreaker';
import NodeCache from 'node-cache';
import { v4 as uuidv4 } from 'uuid';
import joi from 'joi';

interface RouteConfig {
  path: string;
  method: string;
  serviceId: string;
  targetPath: string;
  authentication?: boolean;
  authorization?: string[];
  rateLimit?: {
    requests: number;
    window: string;
  };
  cache?: {
    ttl: number;
    key?: string;
  };
  transform?: {
    request?: (data: any) => any;
    response?: (data: any) => any;
  };
  validation?: {
    body?: joi.Schema;
    query?: joi.Schema;
    params?: joi.Schema;
  };
}

interface GatewayRequest {
  id: string;
  method: string;
  path: string;
  headers: any;
  body?: any;
  query?: any;
  params?: any;
  user?: any;
  startTime: Date;
}

interface GatewayResponse {
  statusCode: number;
  headers: any;
  body: any;
  duration: number;
}

export class APIGateway {
  private routes: Map<string, RouteConfig>;
  private cache: NodeCache;
  private rateLimitStore: Map<string, number[]>;
  private readonly circuitBreakerManager: CircuitBreakerManager;

  constructor(
    private serviceRegistry: ServiceRegistry
  ) {
    this.routes = new Map();
    this.cache = new NodeCache({ stdTTL: 300 }); // 5 minute default
    this.rateLimitStore = new Map();
    this.circuitBreakerManager = CircuitBreakerManager.getInstance();
    
    this.loadRoutes();
  }

  registerRoute(config: RouteConfig): void {
    const key = `${config.method}:${config.path}`;
    this.routes.set(key, config);
    logger.info(`Route registered: ${key} -> ${config.serviceId}${config.targetPath}`);
  }

  async handleRequest(req: express.Request): Promise<GatewayResponse> {
    const gatewayRequest: GatewayRequest = {
      id: uuidv4(),
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
      query: req.query,
      params: req.params,
      user: (req as any).user,
      startTime: new Date(),
    };

    try {
      // Find matching route
      const route = this.findRoute(gatewayRequest.method, gatewayRequest.path);
      if (!route) {
        return this.createErrorResponse(404, 'Route not found');
      }

      // Apply middleware chain
      await this.applyAuthentication(gatewayRequest, route);
      await this.applyAuthorization(gatewayRequest, route);
      await this.applyRateLimit(gatewayRequest, route);
      await this.validateRequest(gatewayRequest, route);

      // Check cache
      if (route.cache) {
        const cached = this.checkCache(gatewayRequest, route);
        if (cached) {
          return cached;
        }
      }

      // Transform request if needed
      if (route.transform?.request) {
        gatewayRequest.body = route.transform.request(gatewayRequest.body);
      }

      // Forward request
      const response = await this.forwardRequest(gatewayRequest, route);

      // Transform response if needed
      if (route.transform?.response) {
        response.body = route.transform.response(response.body);
      }

      // Cache response if configured
      if (route.cache && response.statusCode < 400) {
        this.cacheResponse(gatewayRequest, route, response);
      }

      return response;
    } catch (error: any) {
      logger.error(`Gateway error for request ${gatewayRequest.id}:`, error);
      
      if (error.statusCode) {
        return this.createErrorResponse(error.statusCode, error.message);
      }
      
      return this.createErrorResponse(500, 'Internal server error');
    }
  }

  private async forwardRequest(
    request: GatewayRequest,
    route: RouteConfig
  ): Promise<GatewayResponse> {
    // Discover service instance
    const discovery = await this.serviceRegistry.discoverEndpoint(
      route.serviceId,
      route.targetPath
    );

    if (!discovery) {
      throw { statusCode: 503, message: 'Service unavailable' };
    }

    // Get circuit breaker
    const breaker = this.circuitBreakerManager.getBreaker(route.serviceId);

    // Prepare request config
    const config: AxiosRequestConfig = {
      method: request.method as any,
      url: discovery.url,
      headers: this.prepareHeaders(request.headers),
      params: request.query,
      data: request.body,
      timeout: 10000, // 10 seconds
    };

    // Execute with circuit breaker
    const response = await breaker.execute(
      async () => {
        const start = Date.now();
        const res = await axios(config);
        const duration = Date.now() - start;

        logger.info(`Request ${request.id} completed in ${duration}ms`);
        
        return {
          statusCode: res.status,
          headers: res.headers,
          body: res.data,
          duration,
        };
      },
      // Fallback function
      async () => {
        logger.warn(`Using fallback for ${route.serviceId}`);
        return this.getFallbackResponse(route.serviceId);
      }
    );

    return response;
  }

  private findRoute(method: string, path: string): RouteConfig | null {
    // Try exact match first
    const key = `${method}:${path}`;
    if (this.routes.has(key)) {
      return this.routes.get(key)!;
    }

    // Try pattern matching
    for (const [routeKey, config] of this.routes) {
      const [routeMethod, routePath] = routeKey.split(':');
      if (routeMethod !== method) continue;

      // Convert Express route pattern to regex
      const pattern = routePath
        .replace(/:[^/]+/g, '([^/]+)')
        .replace(/\*/g, '.*');
      
      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(path)) {
        return config;
      }
    }

    return null;
  }

  private async applyAuthentication(
    request: GatewayRequest,
    route: RouteConfig
  ): Promise<void> {
    if (!route.authentication) return;

    if (!request.user) {
      throw { statusCode: 401, message: 'Authentication required' };
    }
  }

  private async applyAuthorization(
    request: GatewayRequest,
    route: RouteConfig
  ): Promise<void> {
    if (!route.authorization || route.authorization.length === 0) return;

    if (!request.user) {
      throw { statusCode: 401, message: 'Authentication required' };
    }

    const hasPermission = route.authorization.some(role => 
      request.user.roles?.includes(role)
    );

    if (!hasPermission) {
      throw { statusCode: 403, message: 'Insufficient permissions' };
    }
  }

  private async applyRateLimit(
    request: GatewayRequest,
    route: RouteConfig
  ): Promise<void> {
    if (!route.rateLimit) return;

    const key = `${request.user?.id || request.headers['x-forwarded-for'] || 'anonymous'}:${route.path}`;
    const now = Date.now();
    const windowMs = this.parseWindow(route.rateLimit.window);
    
    // Get request times
    let requestTimes = this.rateLimitStore.get(key) || [];
    
    // Filter out old requests
    requestTimes = requestTimes.filter(time => now - time < windowMs);
    
    // Check limit
    if (requestTimes.length >= route.rateLimit.requests) {
      throw { 
        statusCode: 429, 
        message: 'Rate limit exceeded',
        headers: {
          'X-RateLimit-Limit': route.rateLimit.requests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(requestTimes[0] + windowMs).toISOString(),
        },
      };
    }

    // Record request
    requestTimes.push(now);
    this.rateLimitStore.set(key, requestTimes);
  }

  private async validateRequest(
    request: GatewayRequest,
    route: RouteConfig
  ): Promise<void> {
    if (!route.validation) return;

    const errors: string[] = [];

    if (route.validation.body) {
      const { error } = route.validation.body.validate(request.body);
      if (error) errors.push(`Body: ${error.message}`);
    }

    if (route.validation.query) {
      const { error } = route.validation.query.validate(request.query);
      if (error) errors.push(`Query: ${error.message}`);
    }

    if (route.validation.params) {
      const { error } = route.validation.params.validate(request.params);
      if (error) errors.push(`Params: ${error.message}`);
    }

    if (errors.length > 0) {
      throw { 
        statusCode: 400, 
        message: 'Validation failed',
        errors,
      };
    }
  }

  private checkCache(
    request: GatewayRequest,
    route: RouteConfig
  ): GatewayResponse | null {
    if (!route.cache) return null;

    const cacheKey = this.generateCacheKey(request, route);
    const cached = this.cache.get<GatewayResponse>(cacheKey);

    if (cached) {
      logger.info(`Cache hit for request ${request.id}`);
      return {
        ...cached,
        headers: {
          ...cached.headers,
          'X-Cache': 'HIT',
        },
      };
    }

    return null;
  }

  private cacheResponse(
    request: GatewayRequest,
    route: RouteConfig,
    response: GatewayResponse
  ): void {
    if (!route.cache) return;

    const cacheKey = this.generateCacheKey(request, route);
    this.cache.set(cacheKey, response, route.cache.ttl);
  }

  private generateCacheKey(
    request: GatewayRequest,
    route: RouteConfig
  ): string {
    if (route.cache?.key) {
      return route.cache.key
        .replace('{method}', request.method)
        .replace('{path}', request.path)
        .replace('{user}', request.user?.id || 'anonymous');
    }

    // Default cache key
    const parts = [
      route.serviceId,
      request.method,
      request.path,
      JSON.stringify(request.query || {}),
      request.user?.id || 'anonymous',
    ];

    return parts.join(':');
  }

  private prepareHeaders(headers: any): any {
    // Remove sensitive headers
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'host',
      'connection',
    ];

    const prepared: any = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (!sensitiveHeaders.includes(key.toLowerCase())) {
        prepared[key] = value;
      }
    }

    // Add gateway headers
    prepared['X-Gateway-Request-ID'] = uuidv4();
    prepared['X-Forwarded-Host'] = headers.host;
    
    return prepared;
  }

  private async getFallbackResponse(serviceId: string): Promise<GatewayResponse> {
    // Service-specific fallback responses
    const fallbacks: Record<string, any> = {
      'user-service': {
        statusCode: 503,
        body: { message: 'User service temporarily unavailable' },
      },
      'payment-service': {
        statusCode: 503,
        body: { message: 'Payment processing temporarily unavailable' },
      },
      'reskflow-service': {
        statusCode: 503,
        body: { message: 'Delivery service temporarily unavailable' },
      },
    };

    const fallback = fallbacks[serviceId] || {
      statusCode: 503,
      body: { message: 'Service temporarily unavailable' },
    };

    return {
      ...fallback,
      headers: { 'X-Fallback': 'true' },
      duration: 0,
    };
  }

  private createErrorResponse(statusCode: number, message: string): GatewayResponse {
    return {
      statusCode,
      headers: {},
      body: { error: message },
      duration: 0,
    };
  }

  private parseWindow(window: string): number {
    const match = window.match(/^(\d+)([smhd])$/);
    if (!match) throw new Error(`Invalid rate limit window: ${window}`);

    const [, value, unit] = match;
    const multipliers: Record<string, number> = {
      's': 1000,
      'm': 60000,
      'h': 3600000,
      'd': 86400000,
    };

    return parseInt(value) * multipliers[unit];
  }

  private loadRoutes(): void {
    // Define gateway routes
    const routes: RouteConfig[] = [
      // User routes
      {
        path: '/api/users',
        method: 'POST',
        serviceId: 'user-service',
        targetPath: '/api/users',
        validation: {
          body: joi.object({
            email: joi.string().email().required(),
            password: joi.string().min(8).required(),
            role: joi.string().valid('customer', 'merchant', 'driver'),
          }),
        },
      },
      {
        path: '/api/users/profile',
        method: 'GET',
        serviceId: 'user-service',
        targetPath: '/api/users/profile',
        authentication: true,
        cache: { ttl: 300 },
      },
      
      // Payment routes
      {
        path: '/api/payments',
        method: 'POST',
        serviceId: 'payment-service',
        targetPath: '/api/payments',
        authentication: true,
        authorization: ['customer'],
        rateLimit: { requests: 10, window: '1m' },
      },
      
      // Order routes
      {
        path: '/api/orders',
        method: 'POST',
        serviceId: 'order-service',
        targetPath: '/api/orders',
        authentication: true,
        transform: {
          request: (data: any) => ({
            ...data,
            timestamp: new Date().toISOString(),
          }),
        },
      },
      {
        path: '/api/orders/:id',
        method: 'GET',
        serviceId: 'order-service',
        targetPath: '/api/orders/:id',
        authentication: true,
        cache: { ttl: 60 },
      },
      
      // Search routes
      {
        path: '/api/search',
        method: 'POST',
        serviceId: 'search-service',
        targetPath: '/api/search',
        rateLimit: { requests: 30, window: '1m' },
        cache: { 
          ttl: 300,
          key: 'search:{user}:{method}:{path}',
        },
      },
    ];

    routes.forEach(route => this.registerRoute(route));
  }

  getRoutes(): RouteConfig[] {
    return Array.from(this.routes.values());
  }

  getMetrics(): any {
    const metrics = {
      routes: this.routes.size,
      cache: {
        keys: this.cache.keys().length,
        hits: this.cache.getStats().hits,
        misses: this.cache.getStats().misses,
      },
      circuitBreakers: this.circuitBreakerManager.getStats(),
      rateLimits: this.rateLimitStore.size,
    };

    return metrics;
  }
}