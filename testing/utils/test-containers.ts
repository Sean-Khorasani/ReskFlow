/**
 * TestContainers Setup Utilities
 */

import { GenericContainer, Network, StartedNetwork, StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';

export interface TestEnvironment {
  network: StartedNetwork;
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  kafka: StartedKafkaContainer;
  services: Map<string, StartedTestContainer>;
}

export class TestContainersManager {
  private static instance: TestContainersManager;
  private environment?: TestEnvironment;

  static getInstance(): TestContainersManager {
    if (!TestContainersManager.instance) {
      TestContainersManager.instance = new TestContainersManager();
    }
    return TestContainersManager.instance;
  }

  async setupEnvironment(): Promise<TestEnvironment> {
    if (this.environment) {
      return this.environment;
    }

    console.log('Setting up test environment...');

    // Create network
    const network = await new Network().start();

    // Start PostgreSQL
    const postgres = await new PostgreSqlContainer('postgres:15-alpine')
      .withNetwork(network)
      .withNetworkAliases('postgres')
      .withDatabase('reskflow_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    // Start Redis
    const redis = await new RedisContainer('redis:7-alpine')
      .withNetwork(network)
      .withNetworkAliases('redis')
      .start();

    // Start Kafka
    const kafka = await new KafkaContainer('confluentinc/cp-kafka:7.5.0')
      .withNetwork(network)
      .withNetworkAliases('kafka')
      .start();

    // Initialize services map
    const services = new Map<string, StartedTestContainer>();

    this.environment = {
      network,
      postgres,
      redis,
      kafka,
      services
    };

    console.log('Test environment ready');
    return this.environment;
  }

  async startService(
    name: string, 
    imageName: string, 
    port: number,
    env: Record<string, string> = {}
  ): Promise<StartedTestContainer> {
    if (!this.environment) {
      throw new Error('Environment not initialized');
    }

    const container = await new GenericContainer(imageName)
      .withNetwork(this.environment.network)
      .withNetworkAliases(name)
      .withExposedPorts(port)
      .withEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: `postgresql://test:test@postgres:5432/reskflow_test`,
        REDIS_URL: 'redis://redis:6379',
        KAFKA_BROKERS: 'kafka:9092',
        ...env
      })
      .withWaitStrategy({
        waitUntil: async (container) => {
          // Wait for health check
          const result = await container.exec(['curl', '-f', `http://localhost:${port}/health`]);
          return result.exitCode === 0;
        }
      })
      .start();

    this.environment.services.set(name, container);
    return container;
  }

  async teardownEnvironment(): Promise<void> {
    if (!this.environment) {
      return;
    }

    console.log('Tearing down test environment...');

    // Stop all services
    for (const [name, container] of this.environment.services) {
      await container.stop();
    }

    // Stop infrastructure
    await this.environment.kafka.stop();
    await this.environment.redis.stop();
    await this.environment.postgres.stop();
    await this.environment.network.stop();

    this.environment = undefined;
    console.log('Test environment cleaned up');
  }

  getConnectionString(service: 'postgres' | 'redis' | 'kafka'): string {
    if (!this.environment) {
      throw new Error('Environment not initialized');
    }

    switch (service) {
      case 'postgres':
        return this.environment.postgres.getConnectionString();
      case 'redis':
        return `redis://${this.environment.redis.getHost()}:${this.environment.redis.getMappedPort(6379)}`;
      case 'kafka':
        return `${this.environment.kafka.getHost()}:${this.environment.kafka.getMappedPort(9093)}`;
    }
  }

  getServiceUrl(serviceName: string): string {
    if (!this.environment) {
      throw new Error('Environment not initialized');
    }

    const container = this.environment.services.get(serviceName);
    if (!container) {
      throw new Error(`Service ${serviceName} not found`);
    }

    const port = container.getMappedPort(3000); // Assuming all services run on port 3000
    return `http://${container.getHost()}:${port}`;
  }
}

// Helper functions
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  return TestContainersManager.getInstance().setupEnvironment();
}

export async function teardownTestEnvironment(): Promise<void> {
  return TestContainersManager.getInstance().teardownEnvironment();
}

export function getTestDatabaseUrl(): string {
  return TestContainersManager.getInstance().getConnectionString('postgres');
}

export function getTestRedisUrl(): string {
  return TestContainersManager.getInstance().getConnectionString('redis');
}

export function getTestKafkaUrl(): string {
  return TestContainersManager.getInstance().getConnectionString('kafka');
}