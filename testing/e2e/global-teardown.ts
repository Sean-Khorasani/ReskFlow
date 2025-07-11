/**
 * Global Teardown for E2E Tests
 * Cleans up test environment and data
 */

import { FullConfig } from '@playwright/test';
import axios from 'axios';

async function globalTeardown(config: FullConfig) {
  console.log('Cleaning up E2E test environment...');
  
  const baseURL = process.env.BASE_URL || 'http://localhost:3000';
  
  try {
    // Clean up test data if admin token is available
    if (process.env.TEST_TOKEN_ADMIN) {
      await axios.post(
        `${baseURL}/api/admin/test-data/cleanup`,
        {},
        {
          headers: {
            Authorization: `Bearer ${process.env.TEST_TOKEN_ADMIN}`
          }
        }
      );
      console.log('✓ Test data cleaned up');
    }
  } catch (error) {
    console.warn('Failed to clean up test data:', error.message);
    // Don't fail teardown if cleanup fails
  }
  
  // Clear environment variables
  delete process.env.TEST_USERS;
  delete process.env.TEST_MERCHANTS;
  delete process.env.TEST_PRODUCTS;
  
  // Clear tokens
  ['CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN'].forEach(role => {
    delete process.env[`TEST_TOKEN_${role}`];
  });
  
  console.log('✓ E2E test environment cleanup complete');
}

export default globalTeardown;