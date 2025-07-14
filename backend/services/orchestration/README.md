# Service Orchestration and API Gateway

This service provides workflow orchestration, service discovery, circuit breaking, and API gateway functionality for ReskFlow.

## Features

### Workflow Engine
- **Workflow Definition**: Define multi-step workflows with conditions
- **Saga Pattern**: Distributed transaction support with compensations
- **Async Execution**: Queue-based workflow processing
- **Step Retry**: Configurable retry policies per step
- **Conditional Flow**: Dynamic routing based on step results
- **Compensation**: Automatic rollback on failures

### Service Registry
- **Service Discovery**: Dynamic service instance discovery
- **Health Monitoring**: Automatic health checks
- **Load Balancing**: Smart instance selection
- **Dependency Tracking**: Service dependency graphs
- **Metadata Support**: Tags, capabilities, and SLA tracking

### Circuit Breaker
- **Failure Protection**: Prevent cascading failures
- **Automatic Recovery**: Half-open state testing
- **Configurable Thresholds**: Failure rate and volume
- **Fallback Support**: Graceful degradation
- **Metrics Collection**: Track circuit states

### API Gateway
- **Request Routing**: Dynamic route configuration
- **Authentication**: Token validation
- **Authorization**: Role-based access control
- **Rate Limiting**: Per-user and per-route limits
- **Response Caching**: Reduce backend load
- **Request/Response Transform**: Data manipulation

## API Endpoints

### Workflows
- `POST /api/workflows` - Register new workflow
- `POST /api/workflows/:workflowId/execute` - Execute workflow
- `GET /api/workflows/instances/:instanceId` - Get workflow status
- `POST /api/workflows/instances/:instanceId/cancel` - Cancel workflow
- `POST /api/saga/execute` - Execute saga transaction

### Service Registry
- `POST /api/registry/services` - Register service
- `POST /api/registry/instances` - Register instance
- `DELETE /api/registry/instances/:id` - Deregister instance
- `GET /api/registry/services` - List all services
- `GET /api/registry/services/:id/health` - Get service health
- `GET /api/registry/services/:id/dependencies` - Get dependencies
- `POST /api/registry/discover` - Discover service instance
- `POST /api/registry/search` - Search services

### Circuit Breakers
- `GET /api/circuit-breakers` - Get all circuit breaker stats
- `POST /api/circuit-breakers/:name/reset` - Reset circuit breaker

### API Gateway
- `GET /api/gateway/routes` - List configured routes
- `GET /api/gateway/metrics` - Get gateway metrics
- `ALL /api/*` - Gateway proxy endpoint

## Workflow Examples

### Order Processing Workflow
```json
{
  "id": "order-processing",
  "name": "Order Processing",
  "steps": [
    {
      "id": "validate-order",
      "service": "order",
      "action": "validate",
      "input": { "orderId": "{{input.orderId}}" }
    },
    {
      "id": "process-payment",
      "service": "payment",
      "action": "charge",
      "compensate": {
        "service": "payment",
        "action": "refund"
      }
    },
    {
      "id": "assign-reskflow",
      "service": "reskflow",
      "action": "assign"
    }
  ]
}
```

### Saga Transaction Example
```javascript
await orchestration.executeSaga([
  {
    name: "Reserve Inventory",
    forward: () => inventory.reserve(items),
    compensate: () => inventory.release(items)
  },
  {
    name: "Charge Payment",
    forward: () => payment.charge(amount),
    compensate: () => payment.refund(amount)
  },
  {
    name: "Create Delivery",
    forward: () => reskflow.create(order),
    compensate: () => reskflow.cancel(order)
  }
]);
```

## Circuit Breaker States

1. **CLOSED**: Normal operation, requests pass through
2. **OPEN**: Failure threshold exceeded, requests rejected
3. **HALF_OPEN**: Testing recovery, limited requests allowed

## Gateway Route Configuration

```javascript
{
  path: '/api/orders',
  method: 'POST',
  serviceId: 'order-service',
  targetPath: '/api/orders',
  authentication: true,
  authorization: ['customer'],
  rateLimit: { requests: 10, window: '1m' },
  cache: { ttl: 300 },
  validation: {
    body: joi.object({
      items: joi.array().required(),
      reskflowAddress: joi.string().required()
    })
  }
}
```

## Environment Variables

```env
PORT=3024
DATABASE_URL=postgresql://user:pass@localhost:5432/reskflow
REDIS_HOST=localhost
REDIS_PORT=6379
ORCHESTRATION_URL=http://localhost:3024
REGION=us-east-1
```

## Best Practices

### Workflow Design
- Keep steps idempotent
- Always define compensations for state-changing operations
- Use conditions for error handling
- Set appropriate timeouts

### Service Registration
- Include health check endpoints
- Define clear API contracts
- Tag services appropriately
- Monitor instance health

### Circuit Breaking
- Set thresholds based on service SLAs
- Implement meaningful fallbacks
- Monitor circuit states
- Test failure scenarios

### API Gateway
- Use caching for read-heavy endpoints
- Apply rate limits to prevent abuse
- Validate requests early
- Transform data at the edge