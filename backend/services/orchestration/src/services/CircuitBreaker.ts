import { EventEmitter } from 'events';
import { logger } from '@reskflow/shared';

interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
  volumeThreshold: number;
  errorFilter?: (error: any) => boolean;
}

interface CircuitBreakerStats {
  requests: number;
  failures: number;
  successes: number;
  rejections: number;
  timeouts: number;
  fallbacks: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker extends EventEmitter {
  private readonly name: string;
  private readonly options: CircuitBreakerOptions;
  private state: CircuitState = 'CLOSED';
  private stats: CircuitBreakerStats;
  private resetTimer?: NodeJS.Timeout;
  private stateChangeTime: Date;
  private requestVolume: number[] = [];
  private readonly rollingWindow = 10000; // 10 seconds

  constructor(name: string, options: Partial<CircuitBreakerOptions> = {}) {
    super();
    this.name = name;
    this.options = {
      failureThreshold: options.failureThreshold || 50, // 50% failure rate
      successThreshold: options.successThreshold || 5, // 5 successful requests to close
      timeout: options.timeout || 3000, // 3 second timeout
      resetTimeout: options.resetTimeout || 30000, // 30 seconds before retry
      volumeThreshold: options.volumeThreshold || 10, // Minimum 10 requests
      errorFilter: options.errorFilter,
    };
    
    this.stats = {
      requests: 0,
      failures: 0,
      successes: 0,
      rejections: 0,
      timeouts: 0,
      fallbacks: 0,
    };
    
    this.stateChangeTime = new Date();
  }

  async execute<T>(
    command: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      this.stats.rejections++;
      
      if (fallback) {
        this.stats.fallbacks++;
        return this.executeFallback(fallback);
      }
      
      throw new Error(`Circuit breaker is OPEN for ${this.name}`);
    }

    // Record request
    this.recordRequest();
    this.stats.requests++;

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(command);
      
      // Record success
      this.onSuccess();
      
      return result;
    } catch (error) {
      // Check if error should trip the circuit
      if (this.shouldRecordFailure(error)) {
        this.onFailure();
      }
      
      // Use fallback if available
      if (fallback) {
        this.stats.fallbacks++;
        return this.executeFallback(fallback);
      }
      
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitBreakerStats & { state: CircuitState; errorRate: number } {
    const recentRequests = this.getRecentRequestCount();
    const errorRate = recentRequests > 0 
      ? (this.stats.failures / recentRequests) * 100 
      : 0;

    return {
      ...this.stats,
      state: this.state,
      errorRate,
    };
  }

  reset(): void {
    this.state = 'CLOSED';
    this.stats = {
      requests: 0,
      failures: 0,
      successes: 0,
      rejections: 0,
      timeouts: 0,
      fallbacks: 0,
    };
    this.requestVolume = [];
    
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
    
    this.stateChangeTime = new Date();
    this.emit('state-change', { name: this.name, state: 'CLOSED' });
    
    logger.info(`Circuit breaker ${this.name} manually reset`);
  }

  private async executeWithTimeout<T>(command: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;
      let completed = false;

      // Set timeout
      timeoutHandle = setTimeout(() => {
        if (!completed) {
          completed = true;
          this.stats.timeouts++;
          reject(new Error(`Timeout after ${this.options.timeout}ms`));
        }
      }, this.options.timeout);

      // Execute command
      command()
        .then(result => {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutHandle);
            resolve(result);
          }
        })
        .catch(error => {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutHandle);
            reject(error);
          }
        });
    });
  }

  private async executeFallback<T>(fallback: () => Promise<T>): Promise<T> {
    try {
      const result = await fallback();
      this.emit('fallback-success', { name: this.name });
      return result;
    } catch (error) {
      this.emit('fallback-failure', { name: this.name, error });
      throw error;
    }
  }

  private onSuccess(): void {
    this.stats.successes++;
    this.stats.lastSuccessTime = new Date();

    if (this.state === 'HALF_OPEN') {
      // Check if we should close the circuit
      if (this.stats.successes >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
      }
    }

    this.emit('success', { name: this.name });
  }

  private onFailure(): void {
    this.stats.failures++;
    this.stats.lastFailureTime = new Date();

    if (this.state === 'HALF_OPEN') {
      // Failure in half-open state, open the circuit
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      // Check if we should open the circuit
      const errorRate = this.calculateErrorRate();
      const recentRequests = this.getRecentRequestCount();

      if (
        recentRequests >= this.options.volumeThreshold &&
        errorRate >= this.options.failureThreshold
      ) {
        this.transitionTo('OPEN');
      }
    }

    this.emit('failure', { name: this.name });
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.stateChangeTime = new Date();

    logger.info(`Circuit breaker ${this.name} transitioned from ${oldState} to ${newState}`);
    this.emit('state-change', { 
      name: this.name, 
      oldState, 
      newState,
      stats: this.getStats(),
    });

    // Handle state-specific actions
    switch (newState) {
      case 'OPEN':
        this.scheduleReset();
        break;
      case 'HALF_OPEN':
        // Reset success counter for half-open test
        this.stats.successes = 0;
        break;
      case 'CLOSED':
        // Clear any pending reset timer
        if (this.resetTimer) {
          clearTimeout(this.resetTimer);
          this.resetTimer = undefined;
        }
        // Reset stats
        this.stats.failures = 0;
        this.stats.successes = 0;
        break;
    }
  }

  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      logger.info(`Circuit breaker ${this.name} attempting reset`);
      this.transitionTo('HALF_OPEN');
    }, this.options.resetTimeout);
  }

  private shouldRecordFailure(error: any): boolean {
    // Apply error filter if provided
    if (this.options.errorFilter) {
      return this.options.errorFilter(error);
    }

    // Default: record all errors except specific ones
    const ignoredErrors = [
      'CANCELLED',
      'INVALID_ARGUMENT',
      'NOT_FOUND',
    ];

    return !ignoredErrors.includes(error.code);
  }

  private recordRequest(): void {
    const now = Date.now();
    this.requestVolume.push(now);
    
    // Clean old entries
    const cutoff = now - this.rollingWindow;
    this.requestVolume = this.requestVolume.filter(time => time > cutoff);
  }

  private getRecentRequestCount(): number {
    const now = Date.now();
    const cutoff = now - this.rollingWindow;
    return this.requestVolume.filter(time => time > cutoff).length;
  }

  private calculateErrorRate(): number {
    const recentRequests = this.getRecentRequestCount();
    if (recentRequests === 0) return 0;
    
    // Count recent failures (approximate based on total stats)
    const recentFailureRate = this.stats.failures / this.stats.requests;
    return recentFailureRate * 100;
  }
}

export class CircuitBreakerManager {
  private static instance: CircuitBreakerManager;
  private breakers: Map<string, CircuitBreaker>;

  private constructor() {
    this.breakers = new Map();
  }

  static getInstance(): CircuitBreakerManager {
    if (!CircuitBreakerManager.instance) {
      CircuitBreakerManager.instance = new CircuitBreakerManager();
    }
    return CircuitBreakerManager.instance;
  }

  getBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, options);
      this.breakers.set(name, breaker);
      
      // Setup monitoring
      this.setupMonitoring(breaker);
    }
    
    return this.breakers.get(name)!;
  }

  getAllBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  getStats(): Array<{ name: string; stats: any }> {
    return Array.from(this.breakers.entries()).map(([name, breaker]) => ({
      name,
      stats: breaker.getStats(),
    }));
  }

  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }

  private setupMonitoring(breaker: CircuitBreaker): void {
    breaker.on('state-change', (data) => {
      logger.warn(`Circuit breaker state change: ${JSON.stringify(data)}`);
      
      // Could send metrics or alerts here
      if (data.newState === 'OPEN') {
        // Alert that service is experiencing issues
        this.sendAlert({
          severity: 'high',
          service: data.name,
          message: `Circuit breaker opened for ${data.name}`,
          stats: data.stats,
        });
      }
    });

    breaker.on('fallback-success', (data) => {
      logger.info(`Fallback successful for ${data.name}`);
    });

    breaker.on('fallback-failure', (data) => {
      logger.error(`Fallback failed for ${data.name}:`, data.error);
    });
  }

  private sendAlert(alert: any): void {
    // Integration with monitoring service
    logger.error(`ALERT: ${JSON.stringify(alert)}`);
  }
}