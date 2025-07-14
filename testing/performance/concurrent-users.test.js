/**
 * K6 Performance Test: Concurrent Users Simulation
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';
import { baseURL, getHeaders, generateTestUser, generateTestOrder } from './k6-config.js';
import { shouldSkipTest, waitForServices } from './health-check.js';
import exec from 'k6/execution';

// Custom metrics
const activeUsers = new Gauge('active_users');
const userActions = new Counter('user_actions');
const actionSuccessRate = new Rate('action_success_rate');
const userSessionDuration = new Trend('user_session_duration');
const concurrentOrderProcessing = new Gauge('concurrent_orders');

// Test configuration - Simulating real-world concurrent user behavior
export const options = {
  scenarios: {
    // Scenario 1: Regular daily traffic pattern
    daily_pattern: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },  // Morning ramp-up
        { duration: '3m', target: 300 },  // Lunch rush
        { duration: '2m', target: 500 },  // Peak lunch
        { duration: '3m', target: 300 },  // After lunch
        { duration: '2m', target: 200 },  // Afternoon
        { duration: '3m', target: 600 },  // Dinner rush
        { duration: '2m', target: 800 },  // Peak dinner
        { duration: '3m', target: 400 },  // Late evening
        { duration: '2m', target: 100 },  // Night wind-down
      ],
      gracefulRampDown: '30s',
    },
    // Scenario 2: Flash sale / promotional event
    flash_sale: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { duration: '30s', target: 10 },   // Normal traffic
        { duration: '10s', target: 500 },  // Sale announcement spike
        { duration: '2m', target: 800 },   // Sustained high traffic
        { duration: '30s', target: 100 },  // Sale ends
      ],
      startTime: '10m', // Start after daily pattern
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
    action_success_rate: ['rate>0.95'],
    user_session_duration: ['p(95)<300000'], // 95% of sessions under 5 minutes
  },
};

// User personas with different behavior patterns
const userPersonas = {
  browser: {
    weight: 0.4,
    actions: ['browse', 'search', 'viewMerchant', 'viewMenu'],
    sessionDuration: { min: 60, max: 180 },
  },
  regularCustomer: {
    weight: 0.3,
    actions: ['login', 'browse', 'order', 'track'],
    sessionDuration: { min: 120, max: 300 },
  },
  quickOrder: {
    weight: 0.2,
    actions: ['login', 'quickReorder', 'track'],
    sessionDuration: { min: 30, max: 90 },
  },
  newUser: {
    weight: 0.1,
    actions: ['register', 'browse', 'firstOrder'],
    sessionDuration: { min: 180, max: 420 },
  },
};

// Required services for this test
const REQUIRED_SERVICES = ['gateway', 'auth', 'user', 'catalog', 'order'];

// Setup function to check services
export function setup() {
  // Wait for services to be ready
  if (!waitForServices(baseURL, REQUIRED_SERVICES)) {
    return { skip: true, reason: 'Required services not available' };
  }
  
  return { skip: false };
}

// Simulate user session
export default function(data) {
  // Skip test execution if services are not healthy
  if (shouldSkipTest(data)) {
    console.log('Skipping test execution due to unhealthy services');
    return;
  }
  const sessionStartTime = Date.now();
  const vuId = exec.vu.idInTest;
  activeUsers.add(1);
  
  // Select user persona based on weights
  const persona = selectPersona();
  const sessionDuration = randomBetween(
    persona.sessionDuration.min,
    persona.sessionDuration.max
  );
  
  // Execute user session
  try {
    switch (persona) {
      case 'browser':
        browserSession();
        break;
      case 'regularCustomer':
        regularCustomerSession();
        break;
      case 'quickOrder':
        quickOrderSession();
        break;
      case 'newUser':
        newUserSession();
        break;
    }
  } finally {
    // Session cleanup
    const actualDuration = Date.now() - sessionStartTime;
    userSessionDuration.add(actualDuration);
    activeUsers.add(-1);
  }
}

// Browser persona - just browsing, no purchase
function browserSession() {
  group('Browser Session', () => {
    // Search for restaurants
    const searchRes = performAction('search', () => 
      http.get(`${baseURL}/api/merchants?cuisine=any&limit=20`, {
        headers: getHeaders(),
        tags: { name: 'browse_search' },
      })
    );
    
    if (searchRes.status === 200) {
      const merchants = JSON.parse(searchRes.body).data;
      
      // Browse 2-5 merchants
      const browsCount = randomBetween(2, 5);
      for (let i = 0; i < browsCount && i < merchants.length; i++) {
        sleep(randomBetween(3, 8)); // Reading time
        
        // View merchant details
        performAction('viewMerchant', () =>
          http.get(`${baseURL}/api/merchants/${merchants[i].id}`, {
            headers: getHeaders(),
            tags: { name: 'browse_merchant' },
          })
        );
        
        sleep(randomBetween(2, 5));
        
        // View menu
        performAction('viewMenu', () =>
          http.get(`${baseURL}/api/merchants/${merchants[i].id}/menu`, {
            headers: getHeaders(),
            tags: { name: 'browse_menu' },
          })
        );
        
        sleep(randomBetween(5, 15)); // Considering options
      }
    }
  });
}

// Regular customer session - knows what they want
function regularCustomerSession() {
  group('Regular Customer Session', () => {
    // Login
    const user = getUserCredentials();
    const loginRes = performAction('login', () =>
      http.post(`${baseURL}/api/auth/login`, JSON.stringify({
        email: user.email,
        password: user.password,
      }), {
        headers: getHeaders(),
        tags: { name: 'regular_login' },
      })
    );
    
    if (loginRes.status !== 200) return;
    
    const tokens = JSON.parse(loginRes.body).tokens;
    sleep(2);
    
    // Get favorite merchants
    const favoritesRes = performAction('getFavorites', () =>
      http.get(`${baseURL}/api/users/favorites/merchants`, {
        headers: getHeaders(tokens.accessToken),
        tags: { name: 'get_favorites' },
      })
    );
    
    if (favoritesRes.status === 200) {
      const favorites = JSON.parse(favoritesRes.body).data;
      if (favorites.length > 0) {
        const merchant = favorites[0];
        
        // Quick order from favorite
        concurrentOrderProcessing.add(1);
        const orderRes = performAction('order', () =>
          createOrder(merchant.id, tokens.accessToken)
        );
        concurrentOrderProcessing.add(-1);
        
        if (orderRes.status === 201) {
          const order = JSON.parse(orderRes.body);
          
          // Track order
          trackOrder(order.id, tokens.accessToken);
        }
      }
    }
  });
}

// Quick reorder session - repeat previous order
function quickOrderSession() {
  group('Quick Reorder Session', () => {
    // Login
    const user = getUserCredentials();
    const loginRes = performAction('login', () =>
      http.post(`${baseURL}/api/auth/login`, JSON.stringify({
        email: user.email,
        password: user.password,
      }), {
        headers: getHeaders(),
        tags: { name: 'quick_login' },
      })
    );
    
    if (loginRes.status !== 200) return;
    
    const tokens = JSON.parse(loginRes.body).tokens;
    
    // Get previous orders
    const ordersRes = performAction('getPreviousOrders', () =>
      http.get(`${baseURL}/api/users/orders?limit=5`, {
        headers: getHeaders(tokens.accessToken),
        tags: { name: 'get_previous_orders' },
      })
    );
    
    if (ordersRes.status === 200) {
      const orders = JSON.parse(ordersRes.body).data;
      if (orders.length > 0) {
        // Reorder
        concurrentOrderProcessing.add(1);
        const reorderRes = performAction('reorder', () =>
          http.post(`${baseURL}/api/orders/${orders[0].id}/reorder`, null, {
            headers: getHeaders(tokens.accessToken),
            tags: { name: 'quick_reorder' },
          })
        );
        concurrentOrderProcessing.add(-1);
        
        if (reorderRes.status === 201) {
          const newOrder = JSON.parse(reorderRes.body);
          trackOrder(newOrder.id, tokens.accessToken, 30); // Quick tracking
        }
      }
    }
  });
}

// New user session - registration and first order
function newUserSession() {
  group('New User Session', () => {
    // Register
    const newUser = generateTestUser();
    const registerRes = performAction('register', () =>
      http.post(`${baseURL}/api/auth/register`, JSON.stringify(newUser), {
        headers: getHeaders(),
        tags: { name: 'new_user_register' },
      })
    );
    
    if (registerRes.status !== 201) return;
    
    sleep(5); // Email verification simulation
    
    // Login
    const loginRes = performAction('login', () =>
      http.post(`${baseURL}/api/auth/login`, JSON.stringify({
        email: newUser.email,
        password: newUser.password,
      }), {
        headers: getHeaders(),
        tags: { name: 'new_user_login' },
      })
    );
    
    if (loginRes.status !== 200) return;
    
    const tokens = JSON.parse(loginRes.body).tokens;
    
    // Browse and make first order
    sleep(10); // Tutorial/onboarding time
    
    const searchRes = performAction('search', () =>
      http.get(`${baseURL}/api/merchants?isNew=friendly&limit=10`, {
        headers: getHeaders(tokens.accessToken),
        tags: { name: 'new_user_search' },
      })
    );
    
    if (searchRes.status === 200) {
      const merchants = JSON.parse(searchRes.body).data;
      if (merchants.length > 0) {
        // First order with extra consideration time
        sleep(randomBetween(20, 40));
        
        concurrentOrderProcessing.add(1);
        const orderRes = performAction('firstOrder', () =>
          createOrder(merchants[0].id, tokens.accessToken)
        );
        concurrentOrderProcessing.add(-1);
        
        if (orderRes.status === 201) {
          const order = JSON.parse(orderRes.body);
          trackOrder(order.id, tokens.accessToken, 60); // Anxious tracking
        }
      }
    }
  });
}

// Helper functions
function selectPersona() {
  const random = Math.random();
  let cumulative = 0;
  
  for (const [name, config] of Object.entries(userPersonas)) {
    cumulative += config.weight;
    if (random <= cumulative) {
      return name;
    }
  }
  
  return 'browser'; // Default
}

function performAction(actionName, actionFn) {
  userActions.add(1);
  const response = actionFn();
  const success = response.status >= 200 && response.status < 400;
  actionSuccessRate.add(success);
  
  check(response, {
    [`${actionName} successful`]: (r) => success,
  });
  
  return response;
}

function createOrder(merchantId, token) {
  // Get menu first
  const menuRes = http.get(`${baseURL}/api/merchants/${merchantId}/menu`, {
    headers: getHeaders(token),
  });
  
  if (menuRes.status !== 200) return { status: 400 };
  
  const menuItems = JSON.parse(menuRes.body).items;
  const orderData = generateTestOrder(merchantId, menuItems.slice(0, 2));
  
  return http.post(`${baseURL}/api/orders`, JSON.stringify(orderData), {
    headers: getHeaders(token),
    tags: { name: 'create_order' },
  });
}

function trackOrder(orderId, token, duration = 120) {
  const endTime = Date.now() + (duration * 1000);
  
  while (Date.now() < endTime) {
    sleep(randomBetween(5, 10));
    
    performAction('trackOrder', () =>
      http.get(`${baseURL}/api/orders/${orderId}/tracking`, {
        headers: getHeaders(token),
        tags: { name: 'track_order' },
      })
    );
  }
}

function getUserCredentials() {
  // In real test, would have pre-created users
  return {
    email: `user${exec.vu.idInTest}@example.com`,
    password: 'Test123!@#',
  };
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}