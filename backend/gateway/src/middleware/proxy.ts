/**
 * Proxy Middleware
 * Routes requests to appropriate backend services
 */

import { Request, Response, NextFunction } from 'express';
import httpProxy from 'http-proxy-middleware';
import { logger } from '../utils/logger';
import { config } from '../config';
import { AuthRequest } from './auth';

// Create proxy instances for each service
const serviceProxies = new Map<string, any>();

// Initialize proxies for all services
Object.entries(config.services).forEach(([serviceName, serviceConfig]) => {
  const proxy = httpProxy.createProxyMiddleware({
    target: serviceConfig.url,
    changeOrigin: true,
    pathRewrite: {
      [`^/api/${serviceName}`]: ''
    },
    onProxyReq: (proxyReq, req: any, res) => {
      // Forward authentication headers
      if ((req as AuthRequest).user) {
        proxyReq.setHeader('X-User-Id', (req as AuthRequest).user!.id);
        proxyReq.setHeader('X-User-Role', (req as AuthRequest).user!.role);
      }

      // Forward correlation ID for tracing
      const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
      proxyReq.setHeader('X-Correlation-Id', correlationId);

      // Log proxy request
      logger.debug('Proxying request', {
        service: serviceName,
        method: req.method,
        path: req.path,
        correlationId
      });
    },
    onProxyRes: (proxyRes, req, res) => {
      // Add response headers
      proxyRes.headers['X-Service-Name'] = serviceName;
      proxyRes.headers['X-Response-Time'] = Date.now() - (req as any).startTime;
    },
    onError: (err, req, res: any) => {
      logger.error('Proxy error:', {
        service: serviceName,
        error: err.message,
        path: req.url
      });

      res.status(502).json({
        error: 'Service unavailable',
        service: serviceName,
        message: 'The requested service is temporarily unavailable'
      });
    }
  });

  serviceProxies.set(serviceName, proxy);
});

/**
 * Dynamic proxy middleware
 * Routes requests to appropriate service based on path
 */
export const proxyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Record start time for response time calculation
  (req as any).startTime = Date.now();

  // Extract service name from path
  const pathParts = req.path.split('/');
  const serviceName = pathParts[2]; // /api/{service}/...

  if (!serviceName) {
    res.status(404).json({ error: 'Service not specified' });
    return;
  }

  // Get proxy for service
  const proxy = serviceProxies.get(serviceName);
  
  if (!proxy) {
    res.status(404).json({ 
      error: 'Unknown service',
      service: serviceName 
    });
    return;
  }

  // Use the proxy
  proxy(req, res, next);
};

/**
 * Health check proxy
 * Checks health of all backend services
 */
export const healthCheckProxy = async (req: Request, res: Response): Promise<void> => {
  const healthChecks = await Promise.allSettled(
    Object.entries(config.services).map(async ([serviceName, serviceConfig]) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${serviceConfig.url}/health`, {
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        return {
          service: serviceName,
          status: response.ok ? 'healthy' : 'unhealthy',
          statusCode: response.status,
          responseTime: response.headers.get('x-response-time')
        };
      } catch (error) {
        return {
          service: serviceName,
          status: 'unreachable',
          error: error.message
        };
      }
    })
  );

  const results = healthChecks.map((result, index) => {
    const serviceName = Object.keys(config.services)[index];
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        service: serviceName,
        status: 'error',
        error: result.reason.message
      };
    }
  });

  const overallHealth = results.every(r => r.status === 'healthy') ? 'healthy' : 'degraded';

  res.json({
    status: overallHealth,
    services: results,
    timestamp: new Date().toISOString()
  });
};

/**
 * Service discovery proxy
 * Returns available services and their endpoints
 */
export const serviceDiscoveryProxy = (req: Request, res: Response): void => {
  const services = Object.entries(config.services).map(([name, serviceConfig]) => ({
    name,
    baseUrl: `/api/${name}`,
    endpoints: Object.entries(serviceConfig.endpoints || {}).map(([endpoint, path]) => ({
      name: endpoint,
      path: path as string,
      method: getMethodFromEndpoint(endpoint)
    })),
    status: 'available' // This could be dynamic based on health checks
  }));

  res.json({
    services,
    version: process.env.API_VERSION || '1.0.0',
    timestamp: new Date().toISOString()
  });
};

/**
 * Circuit breaker proxy
 * Implements circuit breaker pattern for service calls
 */
class CircuitBreaker {
  private failures: Map<string, number> = new Map();
  private lastFailureTime: Map<string, number> = new Map();
  private state: Map<string, 'closed' | 'open' | 'half-open'> = new Map();
  
  private readonly threshold = 5;
  private readonly timeout = 60000; // 1 minute
  private readonly resetTimeout = 30000; // 30 seconds

  isOpen(service: string): boolean {
    const currentState = this.state.get(service) || 'closed';
    
    if (currentState === 'open') {
      const lastFailure = this.lastFailureTime.get(service) || 0;
      if (Date.now() - lastFailure > this.resetTimeout) {
        this.state.set(service, 'half-open');
        return false;
      }
      return true;
    }
    
    return false;
  }

  recordSuccess(service: string): void {
    this.failures.delete(service);
    this.lastFailureTime.delete(service);
    this.state.set(service, 'closed');
  }

  recordFailure(service: string): void {
    const failures = (this.failures.get(service) || 0) + 1;
    this.failures.set(service, failures);
    this.lastFailureTime.set(service, Date.now());

    if (failures >= this.threshold) {
      this.state.set(service, 'open');
      logger.warn(`Circuit breaker opened for service: ${service}`);
    }
  }

  getState(service: string): string {
    return this.state.get(service) || 'closed';
  }
}

const circuitBreaker = new CircuitBreaker();

/**
 * Circuit breaker middleware
 */
export const circuitBreakerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const pathParts = req.path.split('/');
  const serviceName = pathParts[2];

  if (circuitBreaker.isOpen(serviceName)) {
    res.status(503).json({
      error: 'Service temporarily unavailable',
      service: serviceName,
      retryAfter: 30
    });
    return;
  }

  // Intercept response to track success/failure
  const originalSend = res.send;
  res.send = function(data: any): any {
    if (res.statusCode >= 500) {
      circuitBreaker.recordFailure(serviceName);
    } else {
      circuitBreaker.recordSuccess(serviceName);
    }
    return originalSend.call(this, data);
  };

  next();
};

/**
 * Request retry middleware
 */
export const retryMiddleware = (options: {
  maxRetries?: number;
  retryDelay?: number;
  retryableStatuses?: number[];
}) => {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryableStatuses = [502, 503, 504]
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let retries = 0;
    
    const attemptRequest = async (): Promise<void> => {
      try {
        // Clone the request for retry
        // const clonedReq = Object.create(req);
        
        // Create a mock response to capture the result
        const mockRes: any = {
          statusCode: 0,
          headers: {},
          setHeader: (key: string, value: string) => {
            mockRes.headers[key] = value;
          },
          send: (data: any) => {
            if (retryableStatuses.includes(mockRes.statusCode) && retries < maxRetries) {
              retries++;
              logger.info(`Retrying request (attempt ${retries}/${maxRetries})`, {
                path: req.path,
                statusCode: mockRes.statusCode
              });
              
              setTimeout(() => attemptRequest(), retryDelay * retries);
            } else {
              // Send actual response
              Object.entries(mockRes.headers).forEach(([key, value]) => {
                res.setHeader(key, value as string);
              });
              res.status(mockRes.statusCode).send(data);
            }
          },
          status: (code: number) => {
            mockRes.statusCode = code;
            return mockRes;
          },
          json: (data: any) => {
            mockRes.send(JSON.stringify(data));
          }
        };

        // Call the next middleware with our mock response
        next();
      } catch (error) {
        logger.error('Request retry error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    };

    await attemptRequest();
  };
};

/**
 * Load balancer middleware
 */
export class LoadBalancer {
  private instances: Map<string, string[]> = new Map();
  private currentIndex: Map<string, number> = new Map();

  addInstance(service: string, url: string): void {
    const instances = this.instances.get(service) || [];
    instances.push(url);
    this.instances.set(service, instances);
  }

  getNextInstance(service: string): string | null {
    const instances = this.instances.get(service);
    if (!instances || instances.length === 0) return null;

    const currentIndex = this.currentIndex.get(service) || 0;
    const instance = instances[currentIndex];
    
    // Round-robin
    this.currentIndex.set(service, (currentIndex + 1) % instances.length);
    
    return instance;
  }

  removeInstance(service: string, url: string): void {
    const instances = this.instances.get(service) || [];
    const filtered = instances.filter(instance => instance !== url);
    this.instances.set(service, filtered);
  }
}

/**
 * Helper functions
 */
function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getMethodFromEndpoint(endpoint: string): string {
  const methodMap: Record<string, string> = {
    create: 'POST',
    update: 'PUT',
    delete: 'DELETE',
    get: 'GET',
    list: 'GET',
    search: 'GET'
  };

  for (const [key, method] of Object.entries(methodMap)) {
    if (endpoint.toLowerCase().includes(key)) {
      return method;
    }
  }

  return 'GET';
}