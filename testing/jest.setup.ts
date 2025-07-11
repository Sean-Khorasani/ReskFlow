/**
 * Jest Global Setup
 */

import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.test' });

// Set test timeouts
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  generateId: () => Math.random().toString(36).substring(7),
  generateEmail: () => `test${Date.now()}@example.com`,
  generatePhone: () => `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Cleanup after all tests
afterAll(async () => {
  // Close database connections
  // Stop containers
  // Clean up test data
});

// Global error handlers
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});