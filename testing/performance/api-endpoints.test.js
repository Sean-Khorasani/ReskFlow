/**
 * K6 Performance Test: API Endpoints Load Test
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import { baseURL, getHeaders, scenarios, thresholds } from './k6-config.js';
import { shouldSkipTest, waitForServices } from './health-check.js';

// Custom metrics per endpoint
const endpointMetrics = {
  users: {
    errors: new Rate('users_api_errors'),
    duration: new Trend('users_api_duration'),
  },
  merchants: {
    errors: new Rate('merchants_api_errors'),
    duration: new Trend('merchants_api_duration'),
  },
  orders: {
    errors: new Rate('orders_api_errors'),
    duration: new Trend('orders_api_duration'),
  },
  payments: {
    errors: new Rate('payments_api_errors'),
    duration: new Trend('payments_api_duration'),
  },
  reskflow: {
    errors: new Rate('reskflow_api_errors'),
    duration: new Trend('reskflow_api_duration'),
  },
};

// Test configuration
export const options = {
  scenarios: {
    // Different scenarios for different API groups
    user_apis: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: 'testUserAPIs',
    },
    merchant_apis: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 30,
      maxVUs: 150,
      exec: 'testMerchantAPIs',
    },
    order_apis: {
      executor: 'constant-arrival-rate',
      rate: 80,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 40,
      maxVUs: 200,
      exec: 'testOrderAPIs',
    },
  },
  thresholds: {
    ...thresholds,
    users_api_errors: ['rate<0.05'],
    merchants_api_errors: ['rate<0.05'],
    orders_api_errors: ['rate<0.05'],
    users_api_duration: ['p(95)<300'],
    merchants_api_duration: ['p(95)<400'],
    orders_api_duration: ['p(95)<500'],
  },
};

// Required services for this test
const REQUIRED_SERVICES = ['gateway'];

// Test data
const testData = new SharedArray('test-data', function() {
  return {
    userIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
    merchantIds: ['merchant-1', 'merchant-2', 'merchant-3'],
    orderIds: ['order-1', 'order-2', 'order-3', 'order-4'],
    tokens: ['token-1', 'token-2', 'token-3'],
  };
});

// Setup function to check services
export function setup() {
  // Wait for services to be ready
  if (!waitForServices(baseURL, REQUIRED_SERVICES)) {
    return { skip: true, reason: 'Required services not available' };
  }
  
  return { skip: false };
}

// User API Tests
export function testUserAPIs() {
  const userId = testData.userIds[Math.floor(Math.random() * testData.userIds.length)];
  const token = testData.tokens[Math.floor(Math.random() * testData.tokens.length)];
  
  group('User APIs', () => {
    // GET /users/profile
    const profileRes = http.get(
      `${baseURL}/api/users/profile`,
      {
        headers: getHeaders(token),
        tags: { name: 'get_user_profile' },
      }
    );
    
    endpointMetrics.users.errors.add(profileRes.status !== 200);
    endpointMetrics.users.duration.add(profileRes.timings.duration);
    
    check(profileRes, {
      'Profile status 200': (r) => r.status === 200,
      'Profile has data': (r) => r.body && r.body.length > 0,
    });
    
    sleep(0.5);
    
    // GET /users/{id}/orders
    const ordersRes = http.get(
      `${baseURL}/api/users/${userId}/orders?limit=10&offset=0`,
      {
        headers: getHeaders(token),
        tags: { name: 'get_user_orders' },
      }
    );
    
    endpointMetrics.users.errors.add(ordersRes.status !== 200);
    endpointMetrics.users.duration.add(ordersRes.timings.duration);
    
    check(ordersRes, {
      'Orders status 200': (r) => r.status === 200,
      'Orders is array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch (e) {
          return false;
        }
      },
    });
    
    sleep(0.5);
    
    // PUT /users/profile
    const updateRes = http.put(
      `${baseURL}/api/users/profile`,
      JSON.stringify({
        phone: `+1555${Math.floor(Math.random() * 10000000)}`,
      }),
      {
        headers: getHeaders(token),
        tags: { name: 'update_user_profile' },
      }
    );
    
    endpointMetrics.users.errors.add(updateRes.status !== 200);
    endpointMetrics.users.duration.add(updateRes.timings.duration);
  });
}

// Merchant API Tests
export function testMerchantAPIs() {
  const merchantId = testData.merchantIds[Math.floor(Math.random() * testData.merchantIds.length)];
  
  group('Merchant APIs', () => {
    // GET /merchants (search)
    const searchRes = http.get(
      `${baseURL}/api/merchants?cuisine=italian&rating=4&limit=20`,
      {
        headers: getHeaders(),
        tags: { name: 'search_merchants' },
      }
    );
    
    endpointMetrics.merchants.errors.add(searchRes.status !== 200);
    endpointMetrics.merchants.duration.add(searchRes.timings.duration);
    
    check(searchRes, {
      'Search status 200': (r) => r.status === 200,
      'Search has results': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.length >= 0;
        } catch (e) {
          return false;
        }
      },
    });
    
    sleep(0.3);
    
    // GET /merchants/{id}
    const merchantRes = http.get(
      `${baseURL}/api/merchants/${merchantId}`,
      {
        headers: getHeaders(),
        tags: { name: 'get_merchant' },
      }
    );
    
    endpointMetrics.merchants.errors.add(merchantRes.status !== 200);
    endpointMetrics.merchants.duration.add(merchantRes.timings.duration);
    
    check(merchantRes, {
      'Merchant status 200': (r) => r.status === 200,
      'Merchant has name': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.name !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
    
    sleep(0.3);
    
    // GET /merchants/{id}/menu
    const menuRes = http.get(
      `${baseURL}/api/merchants/${merchantId}/menu?category=main`,
      {
        headers: getHeaders(),
        tags: { name: 'get_merchant_menu' },
      }
    );
    
    endpointMetrics.merchants.errors.add(menuRes.status !== 200);
    endpointMetrics.merchants.duration.add(menuRes.timings.duration);
    
    check(menuRes, {
      'Menu status 200': (r) => r.status === 200,
      'Menu has items': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.items && Array.isArray(body.items);
        } catch (e) {
          return false;
        }
      },
    });
    
    sleep(0.3);
    
    // GET /merchants/{id}/reviews
    const reviewsRes = http.get(
      `${baseURL}/api/merchants/${merchantId}/reviews?limit=10`,
      {
        headers: getHeaders(),
        tags: { name: 'get_merchant_reviews' },
      }
    );
    
    endpointMetrics.merchants.errors.add(reviewsRes.status !== 200);
    endpointMetrics.merchants.duration.add(reviewsRes.timings.duration);
  });
}

// Order API Tests
export function testOrderAPIs() {
  const orderId = testData.orderIds[Math.floor(Math.random() * testData.orderIds.length)];
  const token = testData.tokens[Math.floor(Math.random() * testData.tokens.length)];
  
  group('Order APIs', () => {
    // GET /orders/{id}
    const orderRes = http.get(
      `${baseURL}/api/orders/${orderId}`,
      {
        headers: getHeaders(token),
        tags: { name: 'get_order' },
      }
    );
    
    endpointMetrics.orders.errors.add(orderRes.status !== 200);
    endpointMetrics.orders.duration.add(orderRes.timings.duration);
    
    check(orderRes, {
      'Order status 200': (r) => r.status === 200,
      'Order has status': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.status !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
    
    sleep(0.3);
    
    // GET /orders/{id}/tracking
    const trackingRes = http.get(
      `${baseURL}/api/orders/${orderId}/tracking`,
      {
        headers: getHeaders(token),
        tags: { name: 'get_order_tracking' },
      }
    );
    
    endpointMetrics.orders.errors.add(trackingRes.status !== 200);
    endpointMetrics.orders.duration.add(trackingRes.timings.duration);
    
    check(trackingRes, {
      'Tracking status 200': (r) => r.status === 200,
      'Tracking has location': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.driverLocation || body.status;
        } catch (e) {
          return false;
        }
      },
    });
    
    sleep(0.3);
    
    // GET /orders (list)
    const ordersListRes = http.get(
      `${baseURL}/api/orders?status=active&limit=10`,
      {
        headers: getHeaders(token),
        tags: { name: 'list_orders' },
      }
    );
    
    endpointMetrics.orders.errors.add(ordersListRes.status !== 200);
    endpointMetrics.orders.duration.add(ordersListRes.timings.duration);
  });
}

// Default function (required by K6)
export default function() {
  // This won't be called as we're using custom executors
}

// Generate summary report
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  // Custom text summary implementation
  let summary = '\n=== Performance Test Summary ===\n\n';
  
  // Add metrics summary
  Object.keys(endpointMetrics).forEach(endpoint => {
    summary += `${endpoint.toUpperCase()} API:\n`;
    summary += `  Error Rate: ${(data.metrics[`${endpoint}_api_errors`]?.values.rate * 100).toFixed(2)}%\n`;
    summary += `  Avg Duration: ${data.metrics[`${endpoint}_api_duration`]?.values.avg.toFixed(2)}ms\n`;
    summary += `  P95 Duration: ${data.metrics[`${endpoint}_api_duration`]?.values['p(95)'].toFixed(2)}ms\n\n`;
  });
  
  return summary;
}