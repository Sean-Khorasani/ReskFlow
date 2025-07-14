/**
 * K6 Performance Test Script
 * Tests the ReskFlow platform under various load conditions
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    errors: ['rate<0.1'],             // Error rate should be below 10%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000/api';

// Test data
const testUsers = {
  customer: { email: 'customer@test.com', password: 'Test123!' },
  merchant: { email: 'merchant@test.com', password: 'Test123!' },
  driver: { email: 'driver@test.com', password: 'Test123!' },
};

// Helper function to login and get token
function login(userType) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify(testUsers[userType]), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  const success = check(res, {
    'login successful': (r) => r.status === 200,
    'token returned': (r) => r.json('token') !== undefined,
  });
  
  errorRate.add(!success);
  
  return res.json('token');
}

// Customer flow scenario
export function customerFlow() {
  // Login
  const token = login('customer');
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  
  // Browse restaurants
  const restaurantsRes = http.get(`${BASE_URL}/merchants?limit=20`, { headers });
  check(restaurantsRes, {
    'restaurants loaded': (r) => r.status === 200,
    'restaurants returned': (r) => r.json('merchants.length') > 0,
  });
  
  sleep(1);
  
  // Select a restaurant and view menu
  const merchants = restaurantsRes.json('merchants');
  if (merchants && merchants.length > 0) {
    const merchantId = merchants[0].id;
    const menuRes = http.get(`${BASE_URL}/merchants/${merchantId}/menu`, { headers });
    check(menuRes, {
      'menu loaded': (r) => r.status === 200,
      'products returned': (r) => r.json('products.length') > 0,
    });
    
    sleep(2);
    
    // Add items to cart
    const products = menuRes.json('products');
    if (products && products.length > 0) {
      const cartRes = http.post(`${BASE_URL}/cart/add`, JSON.stringify({
        productId: products[0].id,
        quantity: 2,
      }), { headers });
      
      check(cartRes, {
        'item added to cart': (r) => r.status === 200,
      });
      
      sleep(1);
      
      // Create order
      const orderRes = http.post(`${BASE_URL}/orders`, JSON.stringify({
        merchantId: merchantId,
        items: [{
          productId: products[0].id,
          quantity: 2,
        }],
        reskflowAddress: '123 Test Street',
        paymentMethod: 'card',
      }), { headers });
      
      check(orderRes, {
        'order created': (r) => r.status === 201,
        'order ID returned': (r) => r.json('id') !== undefined,
      });
    }
  }
  
  sleep(3);
}

// Merchant flow scenario
export function merchantFlow() {
  // Login
  const token = login('merchant');
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  
  // Get pending orders
  const ordersRes = http.get(`${BASE_URL}/merchant/orders?status=pending`, { headers });
  check(ordersRes, {
    'orders loaded': (r) => r.status === 200,
  });
  
  const orders = ordersRes.json('orders');
  if (orders && orders.length > 0) {
    // Accept an order
    const acceptRes = http.put(
      `${BASE_URL}/merchant/orders/${orders[0].id}/accept`,
      null,
      { headers }
    );
    
    check(acceptRes, {
      'order accepted': (r) => r.status === 200,
    });
    
    sleep(2);
    
    // Mark order as ready
    const readyRes = http.put(
      `${BASE_URL}/merchant/orders/${orders[0].id}/ready`,
      null,
      { headers }
    );
    
    check(readyRes, {
      'order marked ready': (r) => r.status === 200,
    });
  }
  
  sleep(2);
}

// Driver flow scenario
export function driverFlow() {
  // Login
  const token = login('driver');
  const headers = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  
  // Go online
  const onlineRes = http.put(`${BASE_URL}/driver/status`, JSON.stringify({
    isAvailable: true,
    location: { latitude: 40.7128, longitude: -74.0060 },
  }), { headers });
  
  check(onlineRes, {
    'driver online': (r) => r.status === 200,
  });
  
  sleep(1);
  
  // Check for reskflow requests
  const requestsRes = http.get(`${BASE_URL}/driver/requests`, { headers });
  check(requestsRes, {
    'requests loaded': (r) => r.status === 200,
  });
  
  const requests = requestsRes.json('requests');
  if (requests && requests.length > 0) {
    // Accept a reskflow
    const acceptRes = http.post(
      `${BASE_URL}/driver/deliveries/${requests[0].id}/accept`,
      null,
      { headers }
    );
    
    check(acceptRes, {
      'reskflow accepted': (r) => r.status === 200,
    });
    
    sleep(3);
    
    // Update location
    http.put(`${BASE_URL}/driver/location`, JSON.stringify({
      latitude: 40.7130,
      longitude: -74.0062,
    }), { headers });
    
    sleep(2);
    
    // Complete reskflow
    const completeRes = http.put(
      `${BASE_URL}/driver/deliveries/${requests[0].id}/complete`,
      JSON.stringify({ proof: 'delivered_to_customer' }),
      { headers }
    );
    
    check(completeRes, {
      'reskflow completed': (r) => r.status === 200,
    });
  }
  
  sleep(2);
}

// Main scenario selection
export default function() {
  const scenario = Math.random();
  
  if (scenario < 0.6) {
    // 60% customer traffic
    customerFlow();
  } else if (scenario < 0.8) {
    // 20% merchant traffic
    merchantFlow();
  } else {
    // 20% driver traffic
    driverFlow();
  }
}

// WebSocket test scenario
export function websocketTest() {
  const ws = new WebSocket(`ws://localhost:3001/customer`);
  
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'auth',
      token: login('customer'),
    }));
    
    // Subscribe to order updates
    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'order_updates',
    }));
  };
  
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    check(data, {
      'valid message': (d) => d.type !== undefined,
    });
  };
  
  sleep(10);
  ws.close();
}

// Stress test scenario
export function stressTest() {
  const iterations = 10;
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health check ok': (r) => r.status === 200,
    });
  }
  
  const duration = Date.now() - start;
  check(duration, {
    'response time acceptable': (d) => d < 1000, // Less than 1 second for 10 requests
  });
}