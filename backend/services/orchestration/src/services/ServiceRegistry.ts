import { EventEmitter } from 'events';
import { prisma, logger } from '@reskflow/shared';
import axios from 'axios';
import NodeCache from 'node-cache';

interface ServiceDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  baseUrl: string;
  healthCheckUrl: string;
  endpoints: ServiceEndpoint[];
  metadata?: {
    tags?: string[];
    dependencies?: string[];
    capabilities?: string[];
    sla?: {
      availability: number;
      responseTime: number;
    };
  };
}

interface ServiceEndpoint {
  id: string;
  path: string;
  method: string;
  description: string;
  requestSchema?: any;
  responseSchema?: any;
  authentication?: boolean;
  rateLimit?: {
    requests: number;
    window: string;
  };
}

interface ServiceInstance {
  id: string;
  serviceId: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastHealthCheck?: Date;
  metadata?: {
    region?: string;
    zone?: string;
    version?: string;
    load?: number;
  };
}

interface ServiceHealth {
  serviceId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  healthyInstances: number;
  totalInstances: number;
  lastCheck: Date;
  issues?: string[];
}

export class ServiceRegistry extends EventEmitter {
  private services: Map<string, ServiceDefinition>;
  private instances: Map<string, ServiceInstance[]>;
  private healthCache: NodeCache;
  private healthCheckInterval: NodeJS.Timer | null = null;

  constructor() {
    super();
    this.services = new Map();
    this.instances = new Map();
    this.healthCache = new NodeCache({ stdTTL: 60 }); // 1 minute cache
    
    this.loadServices();
    this.startHealthChecks();
  }

  async registerService(definition: ServiceDefinition): Promise<void> {
    // Validate service definition
    this.validateServiceDefinition(definition);

    // Store in database
    await prisma.serviceDefinition.create({
      data: {
        id: definition.id,
        name: definition.name,
        version: definition.version,
        description: definition.description,
        base_url: definition.baseUrl,
        health_check_url: definition.healthCheckUrl,
        endpoints: definition.endpoints,
        metadata: definition.metadata,
        created_at: new Date(),
      },
    });

    this.services.set(definition.id, definition);
    
    // Initialize instances array
    if (!this.instances.has(definition.id)) {
      this.instances.set(definition.id, []);
    }

    logger.info(`Service registered: ${definition.name} v${definition.version}`);
    this.emit('service-registered', definition);
  }

  async registerInstance(instance: ServiceInstance): Promise<void> {
    const service = this.services.get(instance.serviceId);
    if (!service) {
      throw new Error(`Service ${instance.serviceId} not found`);
    }

    // Store instance
    await prisma.serviceInstance.create({
      data: {
        id: instance.id,
        service_id: instance.serviceId,
        url: instance.url,
        status: 'unknown',
        metadata: instance.metadata,
        created_at: new Date(),
      },
    });

    // Add to instances
    const instances = this.instances.get(instance.serviceId) || [];
    instances.push(instance);
    this.instances.set(instance.serviceId, instances);

    // Perform initial health check
    await this.checkInstanceHealth(instance);

    logger.info(`Instance registered: ${instance.id} for service ${instance.serviceId}`);
    this.emit('instance-registered', instance);
  }

  async deregisterInstance(instanceId: string): Promise<void> {
    // Find and remove instance
    for (const [serviceId, instances] of this.instances) {
      const index = instances.findIndex(i => i.id === instanceId);
      if (index > -1) {
        instances.splice(index, 1);
        
        await prisma.serviceInstance.delete({
          where: { id: instanceId },
        });
        
        logger.info(`Instance deregistered: ${instanceId}`);
        this.emit('instance-deregistered', { instanceId, serviceId });
        return;
      }
    }
  }

  async discoverService(
    serviceId: string,
    criteria?: {
      healthy?: boolean;
      region?: string;
      version?: string;
    }
  ): Promise<ServiceInstance | null> {
    const instances = this.instances.get(serviceId) || [];
    
    let availableInstances = instances;
    
    // Apply filters
    if (criteria) {
      if (criteria.healthy !== undefined) {
        availableInstances = availableInstances.filter(
          i => (i.status === 'healthy') === criteria.healthy
        );
      }
      
      if (criteria.region) {
        availableInstances = availableInstances.filter(
          i => i.metadata?.region === criteria.region
        );
      }
      
      if (criteria.version) {
        availableInstances = availableInstances.filter(
          i => i.metadata?.version === criteria.version
        );
      }
    }

    if (availableInstances.length === 0) {
      return null;
    }

    // Load balance: round-robin or least-loaded
    return this.selectInstance(availableInstances);
  }

  async discoverEndpoint(
    serviceId: string,
    endpointPath: string
  ): Promise<{
    instance: ServiceInstance;
    endpoint: ServiceEndpoint;
    url: string;
  } | null> {
    const service = this.services.get(serviceId);
    if (!service) return null;

    const endpoint = service.endpoints.find(e => e.path === endpointPath);
    if (!endpoint) return null;

    const instance = await this.discoverService(serviceId, { healthy: true });
    if (!instance) return null;

    return {
      instance,
      endpoint,
      url: `${instance.url}${endpoint.path}`,
    };
  }

  async getServiceHealth(serviceId: string): Promise<ServiceHealth> {
    // Check cache first
    const cached = this.healthCache.get<ServiceHealth>(`health:${serviceId}`);
    if (cached) return cached;

    const instances = this.instances.get(serviceId) || [];
    const healthyInstances = instances.filter(i => i.status === 'healthy').length;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    const issues: string[] = [];
    
    if (instances.length === 0) {
      status = 'unhealthy';
      issues.push('No instances available');
    } else if (healthyInstances === 0) {
      status = 'unhealthy';
      issues.push('All instances are unhealthy');
    } else if (healthyInstances < instances.length) {
      status = 'degraded';
      issues.push(`${instances.length - healthyInstances} instances are unhealthy`);
    } else {
      status = 'healthy';
    }

    const health: ServiceHealth = {
      serviceId,
      status,
      healthyInstances,
      totalInstances: instances.length,
      lastCheck: new Date(),
      issues: issues.length > 0 ? issues : undefined,
    };

    this.healthCache.set(`health:${serviceId}`, health);
    return health;
  }

  async getAllServices(): Promise<ServiceDefinition[]> {
    return Array.from(this.services.values());
  }

  async getServiceDependencies(serviceId: string): Promise<{
    direct: string[];
    transitive: string[];
    graph: any;
  }> {
    const visited = new Set<string>();
    const dependencies = new Set<string>();
    
    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const service = this.services.get(id);
      if (service?.metadata?.dependencies) {
        service.metadata.dependencies.forEach(dep => {
          dependencies.add(dep);
          traverse(dep);
        });
      }
    };
    
    const service = this.services.get(serviceId);
    const direct = service?.metadata?.dependencies || [];
    
    traverse(serviceId);
    dependencies.delete(serviceId); // Remove self
    
    const transitive = Array.from(dependencies).filter(d => !direct.includes(d));
    
    return {
      direct,
      transitive,
      graph: this.buildDependencyGraph(serviceId),
    };
  }

  async searchServices(criteria: {
    name?: string;
    tags?: string[];
    capabilities?: string[];
  }): Promise<ServiceDefinition[]> {
    let results = Array.from(this.services.values());
    
    if (criteria.name) {
      const searchTerm = criteria.name.toLowerCase();
      results = results.filter(s => 
        s.name.toLowerCase().includes(searchTerm) ||
        s.description.toLowerCase().includes(searchTerm)
      );
    }
    
    if (criteria.tags && criteria.tags.length > 0) {
      results = results.filter(s =>
        criteria.tags!.some(tag => s.metadata?.tags?.includes(tag))
      );
    }
    
    if (criteria.capabilities && criteria.capabilities.length > 0) {
      results = results.filter(s =>
        criteria.capabilities!.every(cap => 
          s.metadata?.capabilities?.includes(cap)
        )
      );
    }
    
    return results;
  }

  private async checkInstanceHealth(instance: ServiceInstance): Promise<void> {
    const service = this.services.get(instance.serviceId);
    if (!service) return;

    try {
      const healthUrl = `${instance.url}${service.healthCheckUrl}`;
      const response = await axios.get(healthUrl, { timeout: 5000 });
      
      instance.status = response.status === 200 ? 'healthy' : 'unhealthy';
      instance.lastHealthCheck = new Date();
      
      // Update load if provided
      if (response.data?.load !== undefined) {
        instance.metadata = {
          ...instance.metadata,
          load: response.data.load,
        };
      }
    } catch (error) {
      instance.status = 'unhealthy';
      instance.lastHealthCheck = new Date();
      
      logger.error(`Health check failed for ${instance.id}:`, error);
    }

    // Update in database
    await prisma.serviceInstance.update({
      where: { id: instance.id },
      data: {
        status: instance.status,
        last_health_check: instance.lastHealthCheck,
        metadata: instance.metadata,
      },
    });

    // Emit event if status changed
    this.emit('instance-health-changed', {
      instance,
      previousStatus: instance.status,
    });
  }

  private selectInstance(instances: ServiceInstance[]): ServiceInstance {
    // Filter healthy instances
    const healthyInstances = instances.filter(i => i.status === 'healthy');
    
    if (healthyInstances.length === 0) {
      // No healthy instances, return any
      return instances[Math.floor(Math.random() * instances.length)];
    }

    // Select based on load (if available)
    const withLoad = healthyInstances.filter(i => i.metadata?.load !== undefined);
    
    if (withLoad.length > 0) {
      // Return instance with lowest load
      return withLoad.reduce((prev, curr) => 
        (curr.metadata!.load! < prev.metadata!.load!) ? curr : prev
      );
    }

    // Random selection
    return healthyInstances[Math.floor(Math.random() * healthyInstances.length)];
  }

  private buildDependencyGraph(serviceId: string): any {
    const graph: any = { nodes: [], edges: [] };
    const visited = new Set<string>();
    
    const addNode = (id: string, level: number = 0) => {
      if (visited.has(id)) return;
      visited.add(id);
      
      const service = this.services.get(id);
      if (!service) return;
      
      graph.nodes.push({
        id,
        name: service.name,
        level,
      });
      
      if (service.metadata?.dependencies) {
        service.metadata.dependencies.forEach(dep => {
          graph.edges.push({ from: id, to: dep });
          addNode(dep, level + 1);
        });
      }
    };
    
    addNode(serviceId);
    return graph;
  }

  private validateServiceDefinition(definition: ServiceDefinition): void {
    if (!definition.id || !definition.name) {
      throw new Error('Service must have id and name');
    }
    
    if (!definition.baseUrl || !definition.healthCheckUrl) {
      throw new Error('Service must have base URL and health check URL');
    }
    
    if (!definition.endpoints || definition.endpoints.length === 0) {
      throw new Error('Service must have at least one endpoint');
    }
    
    // Validate endpoints
    definition.endpoints.forEach(endpoint => {
      if (!endpoint.path || !endpoint.method) {
        throw new Error('Endpoint must have path and method');
      }
    });
  }

  private loadServices(): void {
    // Load core services
    const coreServices: ServiceDefinition[] = [
      {
        id: 'user-service',
        name: 'User Service',
        version: '1.0.0',
        description: 'User management and authentication',
        baseUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',
        healthCheckUrl: '/health',
        endpoints: [
          {
            id: 'create-user',
            path: '/api/users',
            method: 'POST',
            description: 'Create new user',
            authentication: false,
          },
          {
            id: 'get-user',
            path: '/api/users/:id',
            method: 'GET',
            description: 'Get user by ID',
            authentication: true,
          },
        ],
        metadata: {
          tags: ['core', 'authentication'],
          capabilities: ['user-management', 'authentication'],
        },
      },
      {
        id: 'payment-service',
        name: 'Payment Service',
        version: '1.0.0',
        description: 'Payment processing',
        baseUrl: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3006',
        healthCheckUrl: '/health',
        endpoints: [
          {
            id: 'process-payment',
            path: '/api/payments',
            method: 'POST',
            description: 'Process payment',
            authentication: true,
          },
          {
            id: 'refund-payment',
            path: '/api/payments/:id/refund',
            method: 'POST',
            description: 'Refund payment',
            authentication: true,
          },
        ],
        metadata: {
          tags: ['core', 'financial'],
          capabilities: ['payment-processing', 'refunds'],
          dependencies: ['user-service'],
        },
      },
      {
        id: 'reskflow-service',
        name: 'Delivery Service',
        version: '1.0.0',
        description: 'Delivery management',
        baseUrl: process.env.DELIVERY_SERVICE_URL || 'http://reskflow-service:3003',
        healthCheckUrl: '/health',
        endpoints: [
          {
            id: 'create-reskflow',
            path: '/api/deliveries',
            method: 'POST',
            description: 'Create reskflow',
            authentication: true,
          },
          {
            id: 'assign-driver',
            path: '/api/deliveries/:id/assign',
            method: 'POST',
            description: 'Assign driver',
            authentication: true,
          },
        ],
        metadata: {
          tags: ['core', 'logistics'],
          capabilities: ['reskflow-management', 'driver-assignment'],
          dependencies: ['user-service', 'tracking-service'],
        },
      },
    ];

    coreServices.forEach(service => {
      this.services.set(service.id, service);
      this.instances.set(service.id, []);
    });
  }

  private startHealthChecks(): void {
    // Check health of all instances periodically
    this.healthCheckInterval = setInterval(async () => {
      for (const [serviceId, instances] of this.instances) {
        for (const instance of instances) {
          await this.checkInstanceHealth(instance);
        }
      }
    }, 30000); // Every 30 seconds
  }

  async shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}