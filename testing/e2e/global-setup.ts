/**
 * Global Setup for E2E Tests
 * Prepares test environment and test data
 */

import { chromium, FullConfig } from '@playwright/test';
import { setupTestData } from './helpers/test-data-setup';

async function globalSetup(config: FullConfig) {
  console.log('Setting up E2E test environment...');
  
  // Store original environment
  const originalEnv = { ...process.env };
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.BASE_URL = config.projects[0].use?.baseURL || 'http://localhost:3000';
  
  try {
    // Launch a browser to set up test data
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Wait for application to be ready
    await page.goto(process.env.BASE_URL + '/health', { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });
    
    // Set up test data
    const testData = await setupTestData(page);
    
    // Store test data for use in tests
    process.env.TEST_USERS = JSON.stringify(testData.users);
    process.env.TEST_MERCHANTS = JSON.stringify(testData.merchants);
    process.env.TEST_PRODUCTS = JSON.stringify(testData.products);
    
    // Store authentication tokens
    for (const [role, userData] of Object.entries(testData.users)) {
      process.env[`TEST_TOKEN_${role.toUpperCase()}`] = userData.token;
    }
    
    await browser.close();
    
    console.log('✓ E2E test environment setup complete');
    console.log(`  - Created ${Object.keys(testData.users).length} test users`);
    console.log(`  - Created ${testData.merchants.length} test merchants`);
    console.log(`  - Created ${testData.products.length} test products`);
    
  } catch (error) {
    console.error('Failed to set up test environment:', error);
    throw error;
  }
  
  return () => {
    // Cleanup function
    Object.assign(process.env, originalEnv);
  };
}

export default globalSetup;