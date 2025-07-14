/**
 * K6 Performance Test: Order Flow
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { baseURL, getHeaders, checkResponse, generateTestUser, generateTestOrder, scenarios, thresholds } from './k6-config.js';
import { shouldSkipTest, waitForServices } from './health-check.js';

// Custom metrics
const orderCreationRate = new Rate('order_creation_success');
const orderCompletionTime = new Trend('order_completion_time');
const paymentProcessingTime = new Trend('payment_processing_time');

// Required services for this test
const REQUIRED_SERVICES = ['gateway', 'auth', 'user', 'order', 'payment', 'catalog', 'merchant'];

// Test configuration
export const options = {
  scenarios: {
    order_flow: scenarios.stress, // Using stress test to see how system handles high order volume
  },
  thresholds: {
    ...thresholds,
    order_creation_success: ['rate>0.95'], // 95% successful order creation
    order_completion_time: ['p(95)<30000'], // 95% of orders complete within 30 seconds
    payment_processing_time: ['p(95)<2000'], // 95% of payments process within 2 seconds
  },
};

// Test data
let testData = {};

// Setup: Create test data
export function setup() {
  // Wait for services to be ready
  if (!waitForServices(baseURL, REQUIRED_SERVICES)) {
    return { skip: true, reason: 'Required services not available' };
  }
  
  console.log('Setting up test data...');
  
  // Create test customer
  const customer = generateTestUser();
  const registerRes = http.post(
    `${baseURL}/api/auth/register`,
    JSON.stringify(customer),
    { headers: getHeaders() }
  );
  
  if (registerRes.status !== 201) {
    throw new Error('Failed to create test customer');
  }
  
  // Login customer
  const loginRes = http.post(
    `${baseURL}/api/auth/login`,
    JSON.stringify({
      email: customer.email,
      password: customer.password,
    }),
    { headers: getHeaders() }
  );
  
  const customerTokens = JSON.parse(loginRes.body).tokens;
  
  // Get merchants
  const merchantsRes = http.get(
    `${baseURL}/api/merchants?limit=10&isOpen=true`,
    { headers: getHeaders() }
  );
  
  const merchants = JSON.parse(merchantsRes.body).data;
  
  // Get menu items for each merchant
  const merchantMenus = {};
  merchants.forEach(merchant => {
    const menuRes = http.get(
      `${baseURL}/api/merchants/${merchant.id}/menu`,
      { headers: getHeaders() }
    );
    
    if (menuRes.status === 200) {
      merchantMenus[merchant.id] = JSON.parse(menuRes.body).items;
    }
  });
  
  return {
    customer,
    customerTokens,
    merchants,
    merchantMenus,
    skip: false,
  };
}

// Main test scenario
export default function(data) {
  // Skip test execution if services are not healthy
  if (shouldSkipTest(data)) {
    console.log('Skipping test execution due to unhealthy services');
    return;
  }
  
  const { customer, customerTokens, merchants, merchantMenus } = data;
  
  // Select random merchant
  const merchant = merchants[Math.floor(Math.random() * merchants.length)];
  const menuItems = merchantMenus[merchant.id] || [];
  
  if (menuItems.length === 0) {
    console.log(`No menu items for merchant ${merchant.id}`);
    return;
  }
  
  // Create order flow
  group('Order Creation Flow', () => {
    const orderStartTime = Date.now();
    
    // Step 1: Browse merchant menu (simulate user browsing)
    const menuRes = http.get(
      `${baseURL}/api/merchants/${merchant.id}/menu`,
      {
        headers: getHeaders(customerTokens.accessToken),
        tags: { name: 'browse_menu' },
      }
    );
    
    check(menuRes, checkResponse(menuRes, 200, 'Browse Menu'));
    sleep(2); // User browsing time
    
    // Step 2: Check merchant availability
    const availabilityRes = http.get(
      `${baseURL}/api/merchants/${merchant.id}/availability`,
      {
        headers: getHeaders(customerTokens.accessToken),
        tags: { name: 'check_availability' },
      }
    );
    
    check(availabilityRes, checkResponse(availabilityRes, 200, 'Check Availability'));
    
    // Step 3: Create order
    const orderData = generateTestOrder(merchant.id, menuItems.slice(0, 3));
    const paymentStartTime = Date.now();
    
    const orderRes = http.post(
      `${baseURL}/api/orders`,
      JSON.stringify(orderData),
      {
        headers: getHeaders(customerTokens.accessToken),
        tags: { name: 'create_order' },
      }
    );
    
    const orderChecks = check(orderRes, {
      'Order created': (r) => r.status === 201,
      'Has order ID': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.id !== undefined;
        } catch (e) {
          return false;
        }
      },
      'Has order number': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.orderNumber !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
    
    orderCreationRate.add(orderChecks);
    
    if (orderRes.status === 201) {
      const paymentEndTime = Date.now();
      paymentProcessingTime.add(paymentEndTime - paymentStartTime);
      
      const order = JSON.parse(orderRes.body);
      
      // Step 4: Track order status
      sleep(1);
      
      const trackRes = http.get(
        `${baseURL}/api/orders/${order.id}`,
        {
          headers: getHeaders(customerTokens.accessToken),
          tags: { name: 'track_order' },
        }
      );
      
      check(trackRes, checkResponse(trackRes, 200, 'Track Order'));
      
      // Step 5: Get real-time updates (simulate WebSocket with polling)
      let orderStatus = 'PENDING';
      let attempts = 0;
      const maxAttempts = 10;
      
      while (orderStatus !== 'DELIVERED' && orderStatus !== 'CANCELLED' && attempts < maxAttempts) {
        sleep(3); // Poll every 3 seconds
        
        const statusRes = http.get(
          `${baseURL}/api/orders/${order.id}/status`,
          {
            headers: getHeaders(customerTokens.accessToken),
            tags: { name: 'check_order_status' },
          }
        );
        
        if (statusRes.status === 200) {
          orderStatus = JSON.parse(statusRes.body).status;
        }
        
        attempts++;
      }
      
      const orderEndTime = Date.now();
      orderCompletionTime.add(orderEndTime - orderStartTime);
      
      // Step 6: Rate order (if completed)
      if (orderStatus === 'DELIVERED') {
        sleep(1);
        
        const ratingRes = http.post(
          `${baseURL}/api/orders/${order.id}/rate`,
          JSON.stringify({
            foodRating: Math.floor(Math.random() * 2) + 4, // 4-5 stars
            reskflowRating: Math.floor(Math.random() * 2) + 4,
            overallRating: Math.floor(Math.random() * 2) + 4,
            comment: 'Great food and fast reskflow!',
          }),
          {
            headers: getHeaders(customerTokens.accessToken),
            tags: { name: 'rate_order' },
          }
        );
        
        check(ratingRes, checkResponse(ratingRes, 200, 'Rate Order'));
      }
    }
  });
  
  // Simulate user behavior between orders
  sleep(Math.random() * 10 + 5); // 5-15 seconds between orders
}

// Teardown: Cleanup and report
export function teardown(data) {
  console.log('Order flow test completed.');
  console.log('Test Summary:');
  console.log(`- Total merchants tested: ${data.merchants.length}`);
  console.log(`- Customer: ${data.customer.email}`);
}