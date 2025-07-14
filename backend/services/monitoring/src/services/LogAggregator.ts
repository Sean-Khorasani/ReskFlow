import { Client } from '@elastic/elasticsearch';
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import { prisma, logger } from '@reskflow/shared';
import { EventEmitter } from 'events';
import dayjs from 'dayjs';

interface LogEntry {
  timestamp: Date;
  level: string;
  service: string;
  message: string;
  metadata?: any;
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

interface LogQuery {
  service?: string;
  level?: string;
  startTime: Date;
  endTime: Date;
  searchText?: string;
  traceId?: string;
  userId?: string;
  limit?: number;
}

interface LogAnalysis {
  errorPatterns: Array<{
    pattern: string;
    count: number;
    services: string[];
    firstSeen: Date;
    lastSeen: Date;
  }>;
  anomalies: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: Date;
  }>;
  trends: {
    errorRate: number;
    errorRateChange: number;
    topErrors: Array<{ error: string; count: number }>;
    affectedServices: string[];
  };
}

export class LogAggregator extends EventEmitter {
  private elasticsearchClient: Client;
  private logger: winston.Logger;
  private readonly LOG_INDEX = 'reskflow-logs';
  private readonly ERROR_PATTERNS = new Map<string, RegExp>();

  constructor() {
    super();
    this.elasticsearchClient = new Client({
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: {
        username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD || 'changeme',
      },
    });

    this.initializeLogger();
    this.initializeErrorPatterns();
    this.setupIndexTemplate();
  }

  private initializeLogger(): void {
    const esTransport = new ElasticsearchTransport({
      level: 'info',
      client: this.elasticsearchClient,
      index: this.LOG_INDEX,
    });

    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        esTransport,
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
      ],
    });
  }

  private initializeErrorPatterns(): void {
    this.ERROR_PATTERNS.set('database_connection', /database.*connection.*failed/i);
    this.ERROR_PATTERNS.set('timeout', /timeout.*exceeded|request.*timeout/i);
    this.ERROR_PATTERNS.set('authentication', /auth.*failed|unauthorized|forbidden/i);
    this.ERROR_PATTERNS.set('rate_limit', /rate.*limit.*exceeded|too.*many.*requests/i);
    this.ERROR_PATTERNS.set('payment', /payment.*failed|transaction.*declined/i);
    this.ERROR_PATTERNS.set('network', /network.*error|connection.*refused/i);
    this.ERROR_PATTERNS.set('memory', /out.*of.*memory|heap.*limit/i);
    this.ERROR_PATTERNS.set('disk', /disk.*full|no.*space.*left/i);
  }

  async log(entry: LogEntry): Promise<void> {
    try {
      // Enhance log entry with additional metadata
      const enhancedEntry = {
        ...entry,
        '@timestamp': entry.timestamp || new Date(),
        environment: process.env.NODE_ENV || 'development',
        hostname: process.env.HOSTNAME || 'unknown',
        processId: process.pid,
      };

      // Log to Winston (which will forward to Elasticsearch)
      this.logger.log(entry.level || 'info', entry.message, enhancedEntry);

      // Analyze for anomalies
      if (entry.level === 'error' || entry.level === 'critical') {
        await this.analyzeError(enhancedEntry);
      }

      // Emit event for real-time monitoring
      this.emit('log-entry', enhancedEntry);
    } catch (error) {
      console.error('Failed to log entry:', error);
    }
  }

  async searchLogs(query: LogQuery): Promise<LogEntry[]> {
    try {
      const must: any[] = [
        {
          range: {
            '@timestamp': {
              gte: query.startTime,
              lte: query.endTime,
            },
          },
        },
      ];

      if (query.service) {
        must.push({ term: { service: query.service } });
      }

      if (query.level) {
        must.push({ term: { level: query.level } });
      }

      if (query.traceId) {
        must.push({ term: { traceId: query.traceId } });
      }

      if (query.userId) {
        must.push({ term: { userId: query.userId } });
      }

      if (query.searchText) {
        must.push({
          multi_match: {
            query: query.searchText,
            fields: ['message', 'error.message'],
          },
        });
      }

      const response = await this.elasticsearchClient.search({
        index: this.LOG_INDEX,
        body: {
          query: { bool: { must } },
          sort: [{ '@timestamp': { order: 'desc' } }],
          size: query.limit || 100,
        },
      });

      return response.hits.hits.map((hit: any) => hit._source);
    } catch (error) {
      logger.error('Error searching logs:', error);
      return [];
    }
  }

  async analyzeLogs(params: {
    startTime: Date;
    endTime: Date;
    service?: string;
  }): Promise<LogAnalysis> {
    try {
      // Get error logs
      const errorLogs = await this.searchLogs({
        ...params,
        level: 'error',
        limit: 1000,
      });

      // Analyze error patterns
      const errorPatterns = this.analyzeErrorPatterns(errorLogs);
      
      // Detect anomalies
      const anomalies = await this.detectAnomalies(params);
      
      // Calculate trends
      const trends = await this.calculateTrends(params);

      return {
        errorPatterns,
        anomalies,
        trends,
      };
    } catch (error) {
      logger.error('Error analyzing logs:', error);
      throw error;
    }
  }

  async getServiceHealth(service: string): Promise<{
    healthy: boolean;
    errorRate: number;
    latestErrors: LogEntry[];
    recommendations: string[];
  }> {
    const now = new Date();
    const hourAgo = dayjs(now).subtract(1, 'hour').toDate();

    // Get total logs and error logs
    const [totalLogs, errorLogs] = await Promise.all([
      this.countLogs({ service, startTime: hourAgo, endTime: now }),
      this.searchLogs({ service, level: 'error', startTime: hourAgo, endTime: now, limit: 10 }),
    ]);

    const errorRate = totalLogs > 0 ? errorLogs.length / totalLogs : 0;
    const healthy = errorRate < 0.05; // Less than 5% error rate

    const recommendations = this.generateHealthRecommendations(errorLogs, errorRate);

    return {
      healthy,
      errorRate,
      latestErrors: errorLogs,
      recommendations,
    };
  }

  async aggregateLogs(params: {
    groupBy: 'service' | 'level' | 'hour';
    startTime: Date;
    endTime: Date;
  }): Promise<any[]> {
    try {
      let aggField: string;
      let interval: string | undefined;

      switch (params.groupBy) {
        case 'service':
          aggField = 'service';
          break;
        case 'level':
          aggField = 'level';
          break;
        case 'hour':
          aggField = '@timestamp';
          interval = 'hour';
          break;
        default:
          aggField = 'service';
      }

      const aggs: any = {};

      if (interval) {
        aggs.grouped = {
          date_histogram: {
            field: aggField,
            fixed_interval: interval,
          },
          aggs: {
            levels: {
              terms: { field: 'level' },
            },
          },
        };
      } else {
        aggs.grouped = {
          terms: {
            field: aggField,
            size: 100,
          },
          aggs: {
            levels: {
              terms: { field: 'level' },
            },
          },
        };
      }

      const response = await this.elasticsearchClient.search({
        index: this.LOG_INDEX,
        body: {
          query: {
            range: {
              '@timestamp': {
                gte: params.startTime,
                lte: params.endTime,
              },
            },
          },
          aggs,
          size: 0,
        },
      });

      return response.aggregations.grouped.buckets;
    } catch (error) {
      logger.error('Error aggregating logs:', error);
      return [];
    }
  }

  async exportLogs(params: {
    query: LogQuery;
    format: 'json' | 'csv';
  }): Promise<string> {
    const logs = await this.searchLogs(params.query);

    if (params.format === 'json') {
      return JSON.stringify(logs, null, 2);
    } else {
      // CSV format
      const headers = ['timestamp', 'level', 'service', 'message', 'traceId', 'userId'];
      const rows = logs.map(log => [
        log.timestamp,
        log.level,
        log.service,
        log.message,
        log.traceId || '',
        log.userId || '',
      ]);

      return [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');
    }
  }

  private async setupIndexTemplate(): Promise<void> {
    try {
      await this.elasticsearchClient.indices.putTemplate({
        name: 'reskflow-logs-template',
        body: {
          index_patterns: [`${this.LOG_INDEX}-*`],
          settings: {
            number_of_shards: 3,
            number_of_replicas: 1,
            'index.lifecycle.name': 'reskflow-logs-policy',
            'index.lifecycle.rollover_alias': this.LOG_INDEX,
          },
          mappings: {
            properties: {
              '@timestamp': { type: 'date' },
              level: { type: 'keyword' },
              service: { type: 'keyword' },
              message: { type: 'text' },
              traceId: { type: 'keyword' },
              spanId: { type: 'keyword' },
              userId: { type: 'keyword' },
              requestId: { type: 'keyword' },
              environment: { type: 'keyword' },
              hostname: { type: 'keyword' },
              processId: { type: 'integer' },
              error: {
                properties: {
                  message: { type: 'text' },
                  stack: { type: 'text' },
                  code: { type: 'keyword' },
                },
              },
              metadata: { type: 'object', enabled: false },
            },
          },
        },
      });

      // Create lifecycle policy for log rotation
      await this.elasticsearchClient.ilm.putLifecycle({
        name: 'reskflow-logs-policy',
        body: {
          policy: {
            phases: {
              hot: {
                actions: {
                  rollover: {
                    max_size: '50GB',
                    max_age: '7d',
                  },
                },
              },
              warm: {
                min_age: '7d',
                actions: {
                  shrink: {
                    number_of_shards: 1,
                  },
                  forcemerge: {
                    max_num_segments: 1,
                  },
                },
              },
              delete: {
                min_age: '30d',
                actions: {
                  delete: {},
                },
              },
            },
          },
        },
      });
    } catch (error) {
      logger.error('Error setting up index template:', error);
    }
  }

  private analyzeErrorPatterns(logs: LogEntry[]): any[] {
    const patterns = new Map<string, any>();

    logs.forEach(log => {
      const errorMessage = log.error?.message || log.message;
      
      for (const [patternName, regex] of this.ERROR_PATTERNS) {
        if (regex.test(errorMessage)) {
          if (!patterns.has(patternName)) {
            patterns.set(patternName, {
              pattern: patternName,
              count: 0,
              services: new Set<string>(),
              firstSeen: log.timestamp,
              lastSeen: log.timestamp,
            });
          }

          const pattern = patterns.get(patternName)!;
          pattern.count++;
          pattern.services.add(log.service);
          pattern.lastSeen = log.timestamp;
        }
      }
    });

    return Array.from(patterns.values()).map(p => ({
      ...p,
      services: Array.from(p.services),
    }));
  }

  private async detectAnomalies(params: any): Promise<any[]> {
    const anomalies: any[] = [];

    // Check for sudden spike in errors
    const errorSpike = await this.detectErrorSpike(params);
    if (errorSpike) {
      anomalies.push(errorSpike);
    }

    // Check for new error types
    const newErrors = await this.detectNewErrorTypes(params);
    anomalies.push(...newErrors);

    // Check for service unavailability
    const unavailableServices = await this.detectServiceUnavailability(params);
    anomalies.push(...unavailableServices);

    return anomalies;
  }

  private async detectErrorSpike(params: any): Promise<any | null> {
    const hourlyErrors = await this.aggregateLogs({
      groupBy: 'hour',
      startTime: dayjs(params.endTime).subtract(24, 'hour').toDate(),
      endTime: params.endTime,
    });

    const errorCounts = hourlyErrors.map(bucket => {
      const errorLevel = bucket.levels.buckets.find((l: any) => l.key === 'error');
      return errorLevel ? errorLevel.doc_count : 0;
    });

    if (errorCounts.length < 2) return null;

    const average = errorCounts.reduce((a, b) => a + b, 0) / errorCounts.length;
    const latest = errorCounts[errorCounts.length - 1];

    if (latest > average * 2) {
      return {
        type: 'error_spike',
        description: `Error rate is ${Math.round(latest / average * 100)}% of normal`,
        severity: latest > average * 3 ? 'high' : 'medium',
        timestamp: new Date(),
      };
    }

    return null;
  }

  private async detectNewErrorTypes(params: any): Promise<any[]> {
    // This would compare current errors with historical patterns
    // For now, return empty array
    return [];
  }

  private async detectServiceUnavailability(params: any): Promise<any[]> {
    const anomalies: any[] = [];
    
    // Get services that logged in the previous period but not in the current
    const previousPeriod = {
      startTime: dayjs(params.startTime).subtract(1, 'hour').toDate(),
      endTime: params.startTime,
    };

    const [currentServices, previousServices] = await Promise.all([
      this.getActiveServices(params),
      this.getActiveServices(previousPeriod),
    ]);

    previousServices.forEach(service => {
      if (!currentServices.includes(service)) {
        anomalies.push({
          type: 'service_unavailable',
          description: `Service '${service}' has not logged any entries`,
          severity: 'high',
          timestamp: new Date(),
        });
      }
    });

    return anomalies;
  }

  private async calculateTrends(params: any): Promise<any> {
    const currentErrors = await this.countLogs({
      ...params,
      level: 'error',
    });

    const previousPeriod = {
      startTime: dayjs(params.startTime).subtract(
        dayjs(params.endTime).diff(params.startTime),
        'millisecond'
      ).toDate(),
      endTime: params.startTime,
    };

    const previousErrors = await this.countLogs({
      ...previousPeriod,
      level: 'error',
    });

    const errorRate = currentErrors;
    const errorRateChange = previousErrors > 0 
      ? ((currentErrors - previousErrors) / previousErrors) * 100 
      : 0;

    // Get top errors
    const errorLogs = await this.searchLogs({
      ...params,
      level: 'error',
      limit: 100,
    });

    const errorCounts = new Map<string, number>();
    const affectedServices = new Set<string>();

    errorLogs.forEach(log => {
      const errorKey = log.error?.message || log.message;
      errorCounts.set(errorKey, (errorCounts.get(errorKey) || 0) + 1);
      affectedServices.add(log.service);
    });

    const topErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));

    return {
      errorRate,
      errorRateChange,
      topErrors,
      affectedServices: Array.from(affectedServices),
    };
  }

  private async countLogs(query: LogQuery): Promise<number> {
    const response = await this.elasticsearchClient.count({
      index: this.LOG_INDEX,
      body: {
        query: {
          bool: {
            must: [
              {
                range: {
                  '@timestamp': {
                    gte: query.startTime,
                    lte: query.endTime,
                  },
                },
              },
              ...(query.service ? [{ term: { service: query.service } }] : []),
              ...(query.level ? [{ term: { level: query.level } }] : []),
            ],
          },
        },
      },
    });

    return response.count;
  }

  private async getActiveServices(params: any): Promise<string[]> {
    const response = await this.elasticsearchClient.search({
      index: this.LOG_INDEX,
      body: {
        query: {
          range: {
            '@timestamp': {
              gte: params.startTime,
              lte: params.endTime,
            },
          },
        },
        aggs: {
          services: {
            terms: {
              field: 'service',
              size: 100,
            },
          },
        },
        size: 0,
      },
    });

    return response.aggregations.services.buckets.map((b: any) => b.key);
  }

  private generateHealthRecommendations(errors: LogEntry[], errorRate: number): string[] {
    const recommendations: string[] = [];

    if (errorRate > 0.1) {
      recommendations.push('High error rate detected. Investigate root cause immediately.');
    }

    if (errorRate > 0.05) {
      recommendations.push('Error rate above normal threshold. Monitor closely.');
    }

    // Check for specific error patterns
    const databaseErrors = errors.filter(e => 
      this.ERROR_PATTERNS.get('database_connection')?.test(e.message)
    );
    if (databaseErrors.length > 0) {
      recommendations.push('Database connection errors detected. Check database health and connection pool settings.');
    }

    const timeoutErrors = errors.filter(e => 
      this.ERROR_PATTERNS.get('timeout')?.test(e.message)
    );
    if (timeoutErrors.length > 0) {
      recommendations.push('Timeout errors detected. Review service response times and timeout configurations.');
    }

    const memoryErrors = errors.filter(e => 
      this.ERROR_PATTERNS.get('memory')?.test(e.message)
    );
    if (memoryErrors.length > 0) {
      recommendations.push('Memory errors detected. Check memory usage and consider scaling resources.');
    }

    return recommendations;
  }

  private async analyzeError(entry: LogEntry): Promise<void> {
    // Check if this is a critical error
    if (this.isCriticalError(entry)) {
      this.emit('critical-error', entry);
    }

    // Update error statistics
    await this.updateErrorStatistics(entry);
  }

  private isCriticalError(entry: LogEntry): boolean {
    const criticalPatterns = [
      /database.*down/i,
      /payment.*gateway.*unavailable/i,
      /security.*breach/i,
      /data.*corruption/i,
    ];

    const errorMessage = entry.error?.message || entry.message;
    return criticalPatterns.some(pattern => pattern.test(errorMessage));
  }

  private async updateErrorStatistics(entry: LogEntry): Promise<void> {
    // This would update error statistics in a time-series database
    // For now, just emit an event
    this.emit('error-logged', {
      service: entry.service,
      errorType: this.classifyError(entry),
      timestamp: entry.timestamp,
    });
  }

  private classifyError(entry: LogEntry): string {
    const errorMessage = entry.error?.message || entry.message;
    
    for (const [patternName, regex] of this.ERROR_PATTERNS) {
      if (regex.test(errorMessage)) {
        return patternName;
      }
    }
    
    return 'unknown';
  }
}