import { register, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { prisma, logger } from '@reskflow/shared';
import { EventEmitter } from 'events';

interface MetricDefinition {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  help: string;
  labelNames?: string[];
  buckets?: number[];
  percentiles?: number[];
}

interface ServiceMetrics {
  service: string;
  metrics: {
    requests: Counter;
    requestDuration: Histogram;
    activeConnections: Gauge;
    errors: Counter;
    queueSize: Gauge;
    processingTime: Summary;
  };
}

export class MetricsCollector extends EventEmitter {
  private serviceMetrics: Map<string, ServiceMetrics>;
  private customMetrics: Map<string, any>;
  
  // Platform-wide metrics
  private readonly platformMetrics = {
    totalOrders: new Counter({
      name: 'reskflow_total_orders',
      help: 'Total number of orders placed',
      labelNames: ['status', 'merchant_category'],
    }),
    
    activeDeliveries: new Gauge({
      name: 'reskflow_active_deliveries',
      help: 'Current number of active deliveries',
      labelNames: ['zone', 'priority'],
    }),
    
    reskflowTime: new Histogram({
      name: 'reskflow_time_minutes',
      help: 'Delivery time in minutes',
      labelNames: ['zone', 'distance_category'],
      buckets: [10, 20, 30, 40, 50, 60, 90, 120],
    }),
    
    merchantRevenue: new Counter({
      name: 'reskflow_merchant_revenue',
      help: 'Total merchant revenue',
      labelNames: ['merchant_id', 'category'],
    }),
    
    customerSatisfaction: new Gauge({
      name: 'reskflow_customer_satisfaction',
      help: 'Customer satisfaction rating',
      labelNames: ['merchant_id', 'zone'],
    }),
    
    systemErrors: new Counter({
      name: 'reskflow_system_errors',
      help: 'Total system errors',
      labelNames: ['service', 'error_type', 'severity'],
    }),
    
    paymentProcessing: new Histogram({
      name: 'reskflow_payment_processing_ms',
      help: 'Payment processing time in milliseconds',
      labelNames: ['payment_method', 'status'],
      buckets: [100, 250, 500, 1000, 2500, 5000],
    }),
    
    driverUtilization: new Gauge({
      name: 'reskflow_driver_utilization',
      help: 'Driver utilization percentage',
      labelNames: ['zone', 'vehicle_type'],
    }),
    
    queueDepth: new Gauge({
      name: 'reskflow_queue_depth',
      help: 'Queue depth for various services',
      labelNames: ['service', 'queue_name', 'priority'],
    }),
    
    cacheHitRate: new Gauge({
      name: 'reskflow_cache_hit_rate',
      help: 'Cache hit rate percentage',
      labelNames: ['cache_type', 'service'],
    }),
  };

  constructor() {
    super();
    this.serviceMetrics = new Map();
    this.customMetrics = new Map();
    this.initializeServiceMetrics();
    this.startMetricsCollection();
  }

  registerService(serviceName: string): ServiceMetrics {
    if (this.serviceMetrics.has(serviceName)) {
      return this.serviceMetrics.get(serviceName)!;
    }

    const metrics: ServiceMetrics = {
      service: serviceName,
      metrics: {
        requests: new Counter({
          name: `${serviceName}_requests_total`,
          help: `Total requests to ${serviceName}`,
          labelNames: ['method', 'endpoint', 'status'],
        }),
        
        requestDuration: new Histogram({
          name: `${serviceName}_request_duration_ms`,
          help: `Request duration in milliseconds for ${serviceName}`,
          labelNames: ['method', 'endpoint'],
          buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
        }),
        
        activeConnections: new Gauge({
          name: `${serviceName}_active_connections`,
          help: `Active connections to ${serviceName}`,
          labelNames: ['type'],
        }),
        
        errors: new Counter({
          name: `${serviceName}_errors_total`,
          help: `Total errors in ${serviceName}`,
          labelNames: ['type', 'code'],
        }),
        
        queueSize: new Gauge({
          name: `${serviceName}_queue_size`,
          help: `Queue size for ${serviceName}`,
          labelNames: ['queue_name'],
        }),
        
        processingTime: new Summary({
          name: `${serviceName}_processing_time_ms`,
          help: `Processing time in milliseconds for ${serviceName}`,
          labelNames: ['operation'],
          percentiles: [0.5, 0.9, 0.95, 0.99],
        }),
      },
    };

    this.serviceMetrics.set(serviceName, metrics);
    return metrics;
  }

  recordRequest(service: string, method: string, endpoint: string, status: number, duration: number): void {
    const serviceMetrics = this.serviceMetrics.get(service);
    if (!serviceMetrics) return;

    serviceMetrics.metrics.requests.inc({ method, endpoint, status: status.toString() });
    serviceMetrics.metrics.requestDuration.observe({ method, endpoint }, duration);
  }

  recordError(service: string, errorType: string, errorCode: string): void {
    const serviceMetrics = this.serviceMetrics.get(service);
    if (serviceMetrics) {
      serviceMetrics.metrics.errors.inc({ type: errorType, code: errorCode });
    }

    this.platformMetrics.systemErrors.inc({ 
      service, 
      error_type: errorType, 
      severity: this.getErrorSeverity(errorCode) 
    });
  }

  updateActiveConnections(service: string, type: string, count: number): void {
    const serviceMetrics = this.serviceMetrics.get(service);
    if (serviceMetrics) {
      serviceMetrics.metrics.activeConnections.set({ type }, count);
    }
  }

  updateQueueSize(service: string, queueName: string, size: number): void {
    const serviceMetrics = this.serviceMetrics.get(service);
    if (serviceMetrics) {
      serviceMetrics.metrics.queueSize.set({ queue_name: queueName }, size);
    }

    this.platformMetrics.queueDepth.set({ 
      service, 
      queue_name: queueName, 
      priority: 'normal' 
    }, size);
  }

  recordProcessingTime(service: string, operation: string, duration: number): void {
    const serviceMetrics = this.serviceMetrics.get(service);
    if (serviceMetrics) {
      serviceMetrics.metrics.processingTime.observe({ operation }, duration);
    }
  }

  // Platform-wide metric recording methods
  recordOrder(status: string, merchantCategory: string): void {
    this.platformMetrics.totalOrders.inc({ status, merchant_category: merchantCategory });
  }

  updateActiveDeliveries(zone: string, priority: string, count: number): void {
    this.platformMetrics.activeDeliveries.set({ zone, priority }, count);
  }

  recordDeliveryTime(zone: string, distanceCategory: string, timeMinutes: number): void {
    this.platformMetrics.reskflowTime.observe({ zone, distance_category: distanceCategory }, timeMinutes);
  }

  recordMerchantRevenue(merchantId: string, category: string, amount: number): void {
    this.platformMetrics.merchantRevenue.inc({ merchant_id: merchantId, category }, amount);
  }

  updateCustomerSatisfaction(merchantId: string, zone: string, rating: number): void {
    this.platformMetrics.customerSatisfaction.set({ merchant_id: merchantId, zone }, rating);
  }

  recordPaymentProcessing(paymentMethod: string, status: string, durationMs: number): void {
    this.platformMetrics.paymentProcessing.observe({ payment_method: paymentMethod, status }, durationMs);
  }

  updateDriverUtilization(zone: string, vehicleType: string, utilization: number): void {
    this.platformMetrics.driverUtilization.set({ zone, vehicle_type: vehicleType }, utilization);
  }

  updateCacheHitRate(cacheType: string, service: string, hitRate: number): void {
    this.platformMetrics.cacheHitRate.set({ cache_type: cacheType, service }, hitRate);
  }

  // Custom metric registration
  registerCustomMetric(definition: MetricDefinition): void {
    let metric: any;

    switch (definition.type) {
      case 'counter':
        metric = new Counter({
          name: definition.name,
          help: definition.help,
          labelNames: definition.labelNames,
        });
        break;
      case 'gauge':
        metric = new Gauge({
          name: definition.name,
          help: definition.help,
          labelNames: definition.labelNames,
        });
        break;
      case 'histogram':
        metric = new Histogram({
          name: definition.name,
          help: definition.help,
          labelNames: definition.labelNames,
          buckets: definition.buckets,
        });
        break;
      case 'summary':
        metric = new Summary({
          name: definition.name,
          help: definition.help,
          labelNames: definition.labelNames,
          percentiles: definition.percentiles,
        });
        break;
    }

    this.customMetrics.set(definition.name, metric);
  }

  getCustomMetric(name: string): any {
    return this.customMetrics.get(name);
  }

  // Aggregate metrics collection
  async collectBusinessMetrics(): Promise<{
    orders: any;
    revenue: any;
    performance: any;
    satisfaction: any;
  }> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600000);

    const [orderStats, revenueStats, performanceStats, satisfactionStats] = await Promise.all([
      this.collectOrderMetrics(hourAgo, now),
      this.collectRevenueMetrics(hourAgo, now),
      this.collectPerformanceMetrics(hourAgo, now),
      this.collectSatisfactionMetrics(hourAgo, now),
    ]);

    return {
      orders: orderStats,
      revenue: revenueStats,
      performance: performanceStats,
      satisfaction: satisfactionStats,
    };
  }

  private async collectOrderMetrics(start: Date, end: Date): Promise<any> {
    const orders = await prisma.order.groupBy({
      by: ['status'],
      where: {
        created_at: {
          gte: start,
          lte: end,
        },
      },
      _count: true,
    });

    return orders.reduce((acc, curr) => {
      acc[curr.status] = curr._count;
      return acc;
    }, {} as Record<string, number>);
  }

  private async collectRevenueMetrics(start: Date, end: Date): Promise<any> {
    const revenue = await prisma.order.aggregate({
      where: {
        created_at: {
          gte: start,
          lte: end,
        },
        status: 'delivered',
      },
      _sum: {
        total: true,
        reskflow_fee: true,
        service_fee: true,
      },
      _avg: {
        total: true,
      },
    });

    return {
      total: revenue._sum.total || 0,
      reskflowFees: revenue._sum.reskflow_fee || 0,
      serviceFees: revenue._sum.service_fee || 0,
      averageOrderValue: revenue._avg.total || 0,
    };
  }

  private async collectPerformanceMetrics(start: Date, end: Date): Promise<any> {
    const deliveries = await prisma.reskflow.findMany({
      where: {
        created_at: {
          gte: start,
          lte: end,
        },
        status: 'delivered',
      },
      select: {
        actual_reskflow_time: true,
        estimated_reskflow_time: true,
      },
    });

    let onTimeCount = 0;
    let totalDeliveryTime = 0;

    deliveries.forEach(reskflow => {
      if (reskflow.actual_reskflow_time && reskflow.estimated_reskflow_time) {
        const actualTime = new Date(reskflow.actual_reskflow_time).getTime();
        const estimatedTime = new Date(reskflow.estimated_reskflow_time).getTime();
        
        if (actualTime <= estimatedTime + 600000) { // 10 minute buffer
          onTimeCount++;
        }
        
        totalDeliveryTime += actualTime - estimatedTime;
      }
    });

    return {
      onTimeDeliveryRate: deliveries.length > 0 ? onTimeCount / deliveries.length : 0,
      averageDeliveryTime: deliveries.length > 0 ? totalDeliveryTime / deliveries.length / 60000 : 0, // in minutes
    };
  }

  private async collectSatisfactionMetrics(start: Date, end: Date): Promise<any> {
    const ratings = await prisma.review.aggregate({
      where: {
        created_at: {
          gte: start,
          lte: end,
        },
      },
      _avg: {
        rating: true,
        food_rating: true,
        reskflow_rating: true,
        packaging_rating: true,
      },
      _count: true,
    });

    return {
      averageRating: ratings._avg.rating || 0,
      foodRating: ratings._avg.food_rating || 0,
      reskflowRating: ratings._avg.reskflow_rating || 0,
      packagingRating: ratings._avg.packaging_rating || 0,
      totalReviews: ratings._count,
    };
  }

  // Export metrics for Prometheus
  getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }

  private initializeServiceMetrics(): void {
    // Register core services
    const coreServices = [
      'user', 'merchant', 'catalog', 'cart', 'payment', 'reskflow',
      'tracking', 'notification', 'analytics', 'recommendation',
      'search', 'quality-control',
    ];

    coreServices.forEach(service => this.registerService(service));
  }

  private startMetricsCollection(): void {
    // Collect platform metrics every minute
    setInterval(async () => {
      try {
        const metrics = await this.collectBusinessMetrics();
        this.emit('metrics-collected', metrics);
      } catch (error) {
        logger.error('Error collecting metrics:', error);
      }
    }, 60000);

    // Collect system metrics every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);
  }

  private collectSystemMetrics(): void {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Register system metrics if not already registered
    if (!this.customMetrics.has('system_memory_usage')) {
      this.registerCustomMetric({
        name: 'system_memory_usage',
        type: 'gauge',
        help: 'System memory usage in bytes',
        labelNames: ['type'],
      });

      this.registerCustomMetric({
        name: 'system_cpu_usage',
        type: 'gauge',
        help: 'System CPU usage',
        labelNames: ['type'],
      });
    }

    const memoryMetric = this.customMetrics.get('system_memory_usage');
    const cpuMetric = this.customMetrics.get('system_cpu_usage');

    memoryMetric.set({ type: 'rss' }, usage.rss);
    memoryMetric.set({ type: 'heap_total' }, usage.heapTotal);
    memoryMetric.set({ type: 'heap_used' }, usage.heapUsed);
    memoryMetric.set({ type: 'external' }, usage.external);

    cpuMetric.set({ type: 'user' }, cpuUsage.user);
    cpuMetric.set({ type: 'system' }, cpuUsage.system);
  }

  private getErrorSeverity(errorCode: string): string {
    if (errorCode.startsWith('5')) return 'critical';
    if (errorCode.startsWith('4')) return 'high';
    return 'medium';
  }
}