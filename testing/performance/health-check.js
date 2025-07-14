/**
 * Health Check Utilities for K6 Performance Tests
 */

import http from 'k6/http';
import { check } from 'k6';

export const SERVICE_ENDPOINTS = {
  gateway: '/',
  auth: '/api/auth/health',
  user: '/api/users/health',
  order: '/api/orders/health',
  payment: '/api/payments/health',
  notification: '/api/notifications/health',
  catalog: '/api/catalog/health',
  merchant: '/api/merchants/health',
};

/**
 * Check if a service is healthy
 * @param {string} baseURL - The base URL of the service
 * @param {string} serviceName - The name of the service to check
 * @returns {boolean} - Whether the service is healthy
 */
export function isServiceHealthy(baseURL, serviceName) {
  const endpoint = SERVICE_ENDPOINTS[serviceName] || '/health';
  const url = `${baseURL}${endpoint}`;
  
  try {
    const res = http.get(url, {
      timeout: '5s',
      tags: { name: 'health_check' },
    });
    
    return res.status === 200;
  } catch (error) {
    console.error(`Health check failed for ${serviceName}: ${error}`);
    return false;
  }
}

/**
 * Check if all required services are healthy
 * @param {string} baseURL - The base URL
 * @param {string[]} requiredServices - Array of required service names
 * @returns {Object} - Health check results
 */
export function checkRequiredServices(baseURL, requiredServices) {
  console.log('Performing health checks...');
  
  const results = {
    healthy: true,
    services: {},
  };
  
  for (const service of requiredServices) {
    const isHealthy = isServiceHealthy(baseURL, service);
    results.services[service] = isHealthy;
    
    if (!isHealthy) {
      results.healthy = false;
      console.error(`❌ ${service} service is not healthy`);
    } else {
      console.log(`✅ ${service} service is healthy`);
    }
  }
  
  return results;
}

/**
 * Setup function to check services before running tests
 * @param {string} baseURL - The base URL
 * @param {string[]} requiredServices - Array of required service names
 * @returns {Object} - Setup data or null if services are not ready
 */
export function setupWithHealthCheck(baseURL, requiredServices, setupFunction) {
  const healthCheck = checkRequiredServices(baseURL, requiredServices);
  
  if (!healthCheck.healthy) {
    console.error('🚨 Required services are not healthy. Skipping test execution.');
    console.error('Health check results:', JSON.stringify(healthCheck, null, 2));
    return { skip: true, reason: 'Services not healthy', healthCheck };
  }
  
  console.log('✅ All required services are healthy. Proceeding with test setup...');
  
  // Call the original setup function if provided
  if (setupFunction) {
    return setupFunction();
  }
  
  return { skip: false };
}

/**
 * Check if test should be skipped based on setup data
 * @param {Object} data - Setup data
 * @returns {boolean} - Whether to skip the test
 */
export function shouldSkipTest(data) {
  return data && data.skip === true;
}

/**
 * Wait for services to be ready with retries
 * @param {string} baseURL - The base URL
 * @param {string[]} requiredServices - Array of required service names
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} retryDelay - Delay between retries in seconds
 * @returns {boolean} - Whether all services are ready
 */
export function waitForServices(baseURL, requiredServices, maxRetries = 30, retryDelay = 2) {
  console.log(`Waiting for services to be ready (max ${maxRetries} attempts)...`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const healthCheck = checkRequiredServices(baseURL, requiredServices);
    
    if (healthCheck.healthy) {
      console.log(`✅ All services ready after ${attempt} attempts`);
      return true;
    }
    
    if (attempt < maxRetries) {
      console.log(`⏳ Attempt ${attempt}/${maxRetries} - Waiting ${retryDelay}s before retry...`);
      const sleepMs = retryDelay * 1000;
      const end = Date.now() + sleepMs;
      while (Date.now() < end) {
        // Busy wait to avoid using k6's sleep in setup
      }
    }
  }
  
  console.error(`❌ Services not ready after ${maxRetries} attempts`);
  return false;
}