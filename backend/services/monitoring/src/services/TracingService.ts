import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { logger } from '@reskflow/shared';

interface TraceContext {
  traceId: string;
  spanId: string;
  userId?: string;
  requestId?: string;
  service: string;
}

interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export class TracingService {
  private sdk: NodeSDK;
  private tracer: any;
  private readonly serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.initializeTracing();
    this.tracer = trace.getTracer(serviceName);
  }

  private initializeTracing(): void {
    const jaegerExporter = new JaegerExporter({
      endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    });

    const prometheusExporter = new PrometheusExporter({
      port: parseInt(process.env.METRICS_PORT || '9464'),
    }, () => {
      logger.info(`Prometheus metrics server started on port ${process.env.METRICS_PORT || '9464'}`);
    });

    const resource = Resource.default().merge(
      new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      })
    );

    this.sdk = new NodeSDK({
      resource,
      traceExporter: jaegerExporter,
      metricReader: prometheusExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
        }),
      ],
    });

    this.sdk.start();
    
    logger.info(`Tracing initialized for service: ${this.serviceName}`);
  }

  createSpan(
    name: string,
    attributes?: SpanAttributes,
    kind: SpanKind = SpanKind.INTERNAL
  ): any {
    const span = this.tracer.startSpan(name, {
      kind,
      attributes,
    });

    // Add default attributes
    span.setAttributes({
      'service.name': this.serviceName,
      'service.environment': process.env.NODE_ENV || 'development',
      ...attributes,
    });

    return span;
  }

  async traceAsync<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: SpanAttributes
  ): Promise<T> {
    const span = this.createSpan(name, attributes);

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        fn
      );
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  traceSync<T>(
    name: string,
    fn: () => T,
    attributes?: SpanAttributes
  ): T {
    const span = this.createSpan(name, attributes);

    try {
      const result = context.with(
        trace.setSpan(context.active(), span),
        fn
      );
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  getCurrentTraceContext(): TraceContext | null {
    const span = trace.getActiveSpan();
    if (!span) return null;

    const spanContext = span.spanContext();
    
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      service: this.serviceName,
    };
  }

  injectTraceContext(headers: Record<string, string>): void {
    const span = trace.getActiveSpan();
    if (!span) return;

    const spanContext = span.spanContext();
    headers['x-trace-id'] = spanContext.traceId;
    headers['x-span-id'] = spanContext.spanId;
    headers['x-service-name'] = this.serviceName;
  }

  extractTraceContext(headers: Record<string, string>): TraceContext | null {
    const traceId = headers['x-trace-id'];
    const spanId = headers['x-span-id'];
    const service = headers['x-service-name'];

    if (!traceId || !spanId) return null;

    return {
      traceId,
      spanId,
      service: service || 'unknown',
    };
  }

  createChildSpan(
    name: string,
    parentContext: TraceContext,
    attributes?: SpanAttributes
  ): any {
    // Create a new context with the parent trace
    const ctx = trace.setSpanContext(context.active(), {
      traceId: parentContext.traceId,
      spanId: parentContext.spanId,
      traceFlags: 1,
      isRemote: true,
    });

    return context.with(ctx, () => {
      return this.createSpan(name, {
        ...attributes,
        'parent.service': parentContext.service,
      });
    });
  }

  // HTTP request tracing
  traceHttpRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    attributes?: SpanAttributes
  ): void {
    const span = this.createSpan('http_request', {
      'http.method': method,
      'http.url': url,
      'http.status_code': statusCode,
      'http.duration': duration,
      ...attributes,
    }, SpanKind.CLIENT);

    if (statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${statusCode}`,
      });
    }

    span.end();
  }

  // Database query tracing
  traceDatabaseQuery(
    operation: string,
    table: string,
    duration: number,
    attributes?: SpanAttributes
  ): void {
    const span = this.createSpan('db_query', {
      'db.operation': operation,
      'db.table': table,
      'db.duration': duration,
      'db.system': 'postgresql',
      ...attributes,
    }, SpanKind.CLIENT);

    span.end();
  }

  // Message queue tracing
  traceQueueOperation(
    operation: 'publish' | 'consume',
    queue: string,
    messageId: string,
    attributes?: SpanAttributes
  ): any {
    return this.createSpan(`queue_${operation}`, {
      'messaging.system': 'redis',
      'messaging.destination': queue,
      'messaging.message_id': messageId,
      'messaging.operation': operation,
      ...attributes,
    }, operation === 'publish' ? SpanKind.PRODUCER : SpanKind.CONSUMER);
  }

  // Business operation tracing
  traceBusinessOperation(
    operation: string,
    entity: string,
    entityId: string,
    attributes?: SpanAttributes
  ): any {
    return this.createSpan(`business_${operation}`, {
      'business.operation': operation,
      'business.entity': entity,
      'business.entity_id': entityId,
      ...attributes,
    });
  }

  // Trace correlation
  correlateTraces(traces: TraceContext[]): string {
    // Create a correlation ID that links multiple traces
    const correlationId = `corr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    traces.forEach(trace => {
      // In production, this would update the traces with correlation metadata
      logger.debug(`Correlating trace ${trace.traceId} with correlation ID ${correlationId}`);
    });

    return correlationId;
  }

  // Performance tracking
  async tracePerformance<T>(
    name: string,
    fn: () => Promise<T>,
    thresholds?: {
      warning: number;
      critical: number;
    }
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    const span = this.createSpan(`performance_${name}`, {
      'performance.name': name,
    });

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        fn
      );
      
      const duration = Date.now() - startTime;
      
      span.setAttributes({
        'performance.duration': duration,
      });

      if (thresholds) {
        if (duration > thresholds.critical) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `Performance critical: ${duration}ms`,
          });
          span.setAttribute('performance.level', 'critical');
        } else if (duration > thresholds.warning) {
          span.setAttribute('performance.level', 'warning');
        } else {
          span.setAttribute('performance.level', 'ok');
        }
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return { result, duration };
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Distributed transaction tracing
  async traceDistributedTransaction(
    transactionId: string,
    services: string[],
    fn: () => Promise<any>
  ): Promise<any> {
    const span = this.createSpan('distributed_transaction', {
      'transaction.id': transactionId,
      'transaction.services': services.join(','),
      'transaction.service_count': services.length,
    });

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        fn
      );
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      
      // Record which service failed
      span.setAttribute('transaction.failed_at', this.serviceName);
      
      throw error;
    } finally {
      span.end();
    }
  }

  // Custom metrics
  recordMetric(
    name: string,
    value: number,
    unit: string,
    labels?: Record<string, string>
  ): void {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute(`metric.${name}`, value);
      span.setAttribute(`metric.${name}.unit`, unit);
      
      if (labels) {
        Object.entries(labels).forEach(([key, val]) => {
          span.setAttribute(`metric.${name}.${key}`, val);
        });
      }
    }
  }

  // Error tracking
  recordError(
    error: Error,
    context?: {
      userId?: string;
      requestId?: string;
      operation?: string;
      metadata?: any;
    }
  ): void {
    const span = trace.getActiveSpan() || this.createSpan('error_tracking');
    
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });

    if (context) {
      span.setAttributes({
        'error.user_id': context.userId || '',
        'error.request_id': context.requestId || '',
        'error.operation': context.operation || '',
        'error.metadata': JSON.stringify(context.metadata || {}),
      });
    }

    span.end();
  }

  async shutdown(): Promise<void> {
    await this.sdk.shutdown();
    logger.info('Tracing service shut down');
  }
}