import express from 'express';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { WorkflowEngine } from './services/WorkflowEngine';
import { ServiceRegistry } from './services/ServiceRegistry';
import { CircuitBreakerManager } from './services/CircuitBreaker';
import { APIGateway } from './services/APIGateway';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

// Initialize Redis
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

// Initialize services
const workflowEngine = new WorkflowEngine();
const serviceRegistry = new ServiceRegistry();
const circuitBreakerManager = CircuitBreakerManager.getInstance();
const apiGateway = new APIGateway(serviceRegistry);

// Workflow routes
app.post('/api/workflows', authMiddleware, async (req, res) => {
  try {
    await workflowEngine.registerWorkflow(req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error registering workflow:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/workflows/:workflowId/execute', authMiddleware, async (req, res) => {
  try {
    const result = await workflowEngine.executeWorkflow(
      req.params.workflowId,
      req.body,
      { async: req.query.async === 'true' }
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error executing workflow:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/workflows/instances/:instanceId', authMiddleware, async (req, res) => {
  try {
    const instance = await workflowEngine.getWorkflowStatus(req.params.instanceId);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    res.json(instance);
  } catch (error) {
    logger.error('Error getting workflow status:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/workflows/instances/:instanceId/cancel', authMiddleware, async (req, res) => {
  try {
    await workflowEngine.cancelWorkflow(req.params.instanceId, req.body.reason);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error cancelling workflow:', error);
    res.status(400).json({ error: error.message });
  }
});

// Saga endpoint
app.post('/api/saga/execute', authMiddleware, async (req, res) => {
  try {
    const result = await workflowEngine.executeSaga(req.body.steps);
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Saga execution failed:', error);
    res.status(400).json({ error: error.message });
  }
});

// Service registry routes
app.post('/api/registry/services', authMiddleware, async (req, res) => {
  try {
    await serviceRegistry.registerService(req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error registering service:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/registry/instances', authMiddleware, async (req, res) => {
  try {
    await serviceRegistry.registerInstance(req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error registering instance:', error);
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/registry/instances/:instanceId', authMiddleware, async (req, res) => {
  try {
    await serviceRegistry.deregisterInstance(req.params.instanceId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deregistering instance:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/registry/services', authMiddleware, async (req, res) => {
  try {
    const services = await serviceRegistry.getAllServices();
    res.json(services);
  } catch (error) {
    logger.error('Error getting services:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/registry/services/:serviceId/health', authMiddleware, async (req, res) => {
  try {
    const health = await serviceRegistry.getServiceHealth(req.params.serviceId);
    res.json(health);
  } catch (error) {
    logger.error('Error getting service health:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/registry/services/:serviceId/dependencies', authMiddleware, async (req, res) => {
  try {
    const dependencies = await serviceRegistry.getServiceDependencies(req.params.serviceId);
    res.json(dependencies);
  } catch (error) {
    logger.error('Error getting dependencies:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/registry/discover', authMiddleware, async (req, res) => {
  try {
    const { serviceId, criteria } = req.body;
    const instance = await serviceRegistry.discoverService(serviceId, criteria);
    
    if (!instance) {
      return res.status(404).json({ error: 'No available instances' });
    }
    
    res.json(instance);
  } catch (error) {
    logger.error('Error discovering service:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/registry/search', authMiddleware, async (req, res) => {
  try {
    const services = await serviceRegistry.searchServices(req.body);
    res.json(services);
  } catch (error) {
    logger.error('Error searching services:', error);
    res.status(400).json({ error: error.message });
  }
});

// Circuit breaker routes
app.get('/api/circuit-breakers', authMiddleware, async (req, res) => {
  try {
    const stats = circuitBreakerManager.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Error getting circuit breaker stats:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/circuit-breakers/:name/reset', authMiddleware, async (req, res) => {
  try {
    const breaker = circuitBreakerManager.getBreaker(req.params.name);
    breaker.reset();
    res.json({ success: true });
  } catch (error) {
    logger.error('Error resetting circuit breaker:', error);
    res.status(400).json({ error: error.message });
  }
});

// API Gateway routes
app.get('/api/gateway/routes', authMiddleware, async (req, res) => {
  try {
    const routes = apiGateway.getRoutes();
    res.json(routes);
  } catch (error) {
    logger.error('Error getting routes:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/gateway/metrics', authMiddleware, async (req, res) => {
  try {
    const metrics = apiGateway.getMetrics();
    res.json(metrics);
  } catch (error) {
    logger.error('Error getting gateway metrics:', error);
    res.status(400).json({ error: error.message });
  }
});

// Gateway proxy - catch all routes
app.all('/api/*', async (req, res) => {
  try {
    const response = await apiGateway.handleRequest(req);
    
    // Set response headers
    Object.entries(response.headers).forEach(([key, value]) => {
      res.setHeader(key, value as string);
    });
    
    res.status(response.statusCode).json(response.body);
  } catch (error) {
    logger.error('Gateway error:', error);
    res.status(500).json({ error: 'Gateway error' });
  }
});

// Common workflow endpoints
app.post('/api/workflows/order', authMiddleware, async (req, res) => {
  try {
    const result = await workflowEngine.executeOrderWorkflow(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Order workflow error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/workflows/reskflow', authMiddleware, async (req, res) => {
  try {
    const result = await workflowEngine.executeDeliveryWorkflow(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Delivery workflow error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/workflows/refund', authMiddleware, async (req, res) => {
  try {
    const result = await workflowEngine.executeRefundWorkflow(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Refund workflow error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Service event handlers
serviceRegistry.on('service-registered', (service) => {
  logger.info(`New service registered: ${service.name}`);
});

serviceRegistry.on('instance-health-changed', (data) => {
  if (data.instance.status === 'unhealthy') {
    logger.warn(`Instance ${data.instance.id} is unhealthy`);
  }
});

workflowEngine.on('workflow-completed', (instance) => {
  logger.info(`Workflow ${instance.id} completed with status: ${instance.status}`);
});

// Register self in service registry
async function registerSelf() {
  try {
    await serviceRegistry.registerService({
      id: 'orchestration-service',
      name: 'Orchestration Service',
      version: '1.0.0',
      description: 'Service orchestration and workflow management',
      baseUrl: process.env.ORCHESTRATION_URL || `http://localhost:${PORT}`,
      healthCheckUrl: '/health',
      endpoints: [
        {
          id: 'execute-workflow',
          path: '/api/workflows/:workflowId/execute',
          method: 'POST',
          description: 'Execute a workflow',
          authentication: true,
        },
        {
          id: 'get-service-health',
          path: '/api/registry/services/:serviceId/health',
          method: 'GET',
          description: 'Get service health',
          authentication: true,
        },
      ],
      metadata: {
        tags: ['core', 'orchestration'],
        capabilities: ['workflow-execution', 'service-discovery', 'circuit-breaking'],
      },
    });

    await serviceRegistry.registerInstance({
      id: `orchestration-${process.env.HOSTNAME || 'local'}`,
      serviceId: 'orchestration-service',
      url: process.env.ORCHESTRATION_URL || `http://localhost:${PORT}`,
      metadata: {
        region: process.env.REGION || 'us-east-1',
        version: '1.0.0',
      },
    });
  } catch (error) {
    logger.error('Failed to register self:', error);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'orchestration',
    uptime: process.uptime(),
    workflows: {
      // Add workflow stats
    },
    services: {
      // Add service registry stats
    },
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  await serviceRegistry.shutdown();
  await redisClient.quit();
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3024;

async function start() {
  try {
    await connectDB();
    await redisClient.connect();
    
    app.listen(PORT, () => {
      logger.info(`Orchestration service running on port ${PORT}`);
      
      // Register self after startup
      registerSelf();
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();