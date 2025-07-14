# Monitoring and Observability Service

Comprehensive monitoring, logging, alerting, and distributed tracing for ReskFlow.

## Features

### Metrics Collection
- **Service Metrics**: Request count, duration, error rates, queue sizes
- **Business Metrics**: Orders, revenue, reskflow times, satisfaction scores
- **System Metrics**: Memory usage, CPU usage, connection pools
- **Custom Metrics**: Support for application-specific metrics
- **Prometheus Export**: Compatible with Prometheus monitoring

### Log Aggregation
- **Centralized Logging**: Collect logs from all services
- **Elasticsearch Integration**: Full-text search and analysis
- **Log Analysis**: Pattern detection and anomaly identification
- **Service Health**: Real-time health monitoring based on logs
- **Export Support**: Export logs in JSON or CSV format

### Alert Management
- **Rule-based Alerts**: Define custom alert rules
- **Multi-severity**: Low, medium, high, and critical alerts
- **Smart Cooldowns**: Prevent alert fatigue
- **Multiple Channels**: Email, Slack, SMS notifications
- **Alert History**: Track and analyze alert patterns

### Distributed Tracing
- **OpenTelemetry**: Industry-standard tracing
- **Jaeger Integration**: Trace visualization and analysis
- **Performance Tracking**: Identify bottlenecks
- **Distributed Transactions**: Track across services
- **Correlation IDs**: Link related traces

## API Endpoints

### Metrics
- `GET /metrics` - Prometheus-compatible metrics endpoint
- `POST /api/metrics/record` - Record custom metrics
- `GET /api/metrics/business` - Get business metrics summary

### Logging
- `POST /api/logs` - Submit log entries
- `POST /api/logs/search` - Search logs
- `POST /api/logs/analyze` - Analyze log patterns
- `GET /api/logs/service/:service/health` - Get service health
- `POST /api/logs/aggregate` - Aggregate logs
- `POST /api/logs/export` - Export logs

### Alerts
- `POST /api/alerts/rules` - Create alert rule
- `PUT /api/alerts/rules/:ruleId` - Update alert rule
- `DELETE /api/alerts/rules/:ruleId` - Delete alert rule
- `POST /api/alerts/trigger` - Manually trigger alert
- `PUT /api/alerts/:alertId/acknowledge` - Acknowledge alert
- `PUT /api/alerts/:alertId/resolve` - Resolve alert
- `GET /api/alerts/active` - Get active alerts
- `POST /api/alerts/history` - Get alert history
- `POST /api/alerts/statistics` - Get alert statistics

### Tracing
- `GET /api/trace/context` - Get current trace context
- `POST /api/trace/correlate` - Correlate multiple traces

### Dashboard
- `GET /api/dashboard` - Get monitoring dashboard data

## Default Alert Rules

1. **High Error Rate**: Triggers when error rate exceeds 5%
2. **Low Driver Availability**: When availability drops below 80%
3. **High Order Volume**: When orders exceed capacity
4. **Payment Gateway Failure**: On payment failures
5. **Database Connection Pool**: When connections exhausted
6. **High Memory Usage**: When memory exceeds 85%
7. **API Response Time**: When response time is high
8. **Order Cancellation Rate**: When cancellations exceed 15%

## Real-time Features

### WebSocket Events
- `metrics-update`: Real-time metric updates
- `new-log`: New log entries
- `critical-error`: Critical errors
- `new-alert`: New alerts triggered
- `alert-resolved`: Alert resolved

### Subscriptions
- `subscribe-metrics`: Subscribe to service metrics
- `subscribe-alerts`: Subscribe to alerts by severity
- `subscribe-logs`: Subscribe to service logs

## Environment Variables

```env
PORT=3023
METRICS_PORT=9464
DATABASE_URL=postgresql://user:pass@localhost:5432/reskflow
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme
JAEGER_ENDPOINT=http://localhost:14268/api/traces
```

## Integration with Services

### For Service Developers

1. **Record Metrics**:
```javascript
await fetch('/api/metrics/record', {
  method: 'POST',
  body: JSON.stringify({
    service: 'payment',
    metric: 'payment_processing_time',
    value: 1250,
    labels: { method: 'stripe', status: 'success' }
  })
});
```

2. **Submit Logs**:
```javascript
await fetch('/api/logs', {
  method: 'POST',
  body: JSON.stringify({
    level: 'error',
    service: 'reskflow',
    message: 'Failed to assign driver',
    error: { code: 'NO_DRIVERS_AVAILABLE' },
    metadata: { orderId: '123', zone: 'downtown' }
  })
});
```

3. **Use Tracing**:
```javascript
const span = tracingService.createSpan('process_order', {
  'order.id': orderId,
  'order.amount': amount
});

try {
  // Process order
  span.setStatus({ code: SpanStatusCode.OK });
} catch (error) {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR });
} finally {
  span.end();
}
```

## Monitoring Stack

1. **Metrics**: Prometheus + Grafana
2. **Logs**: Elasticsearch + Kibana
3. **Traces**: Jaeger
4. **Alerts**: AlertManager + PagerDuty

## Performance Considerations

- Log rotation every 7 days
- Metrics retention for 30 days
- Alert cooldowns to prevent spam
- Batch log ingestion for efficiency
- Index optimization for search performance

## Security

- Authentication required for all endpoints
- Role-based access for sensitive operations
- Log sanitization to remove PII
- Encrypted storage for sensitive metrics