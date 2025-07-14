/**
 * K6 Performance Test Configuration
 */

export const baseURL = __ENV.BASE_URL || 'http://localhost:3000';
export const apiKey = __ENV.API_KEY || '';

// Test thresholds
export const thresholds = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% of requests must complete below 500ms
  http_req_failed: ['rate<0.1'], // Error rate must be below 10%
  http_reqs: ['rate>100'], // Throughput must be above 100 RPS
};

// Test scenarios
export const scenarios = {
  // Smoke test: Minimal load to verify system works
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '1m',
  },

  // Load test: Normal expected load
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m', target: 50 }, // Ramp up to 50 users
      { duration: '5m', target: 50 }, // Stay at 50 users
      { duration: '2m', target: 0 },  // Ramp down to 0 users
    ],
    gracefulRampDown: '30s',
  },

  // Stress test: Beyond normal load
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '2m', target: 100 },
      { duration: '5m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '5m', target: 200 },
      { duration: '2m', target: 300 },
      { duration: '5m', target: 300 },
      { duration: '5m', target: 0 },
    ],
    gracefulRampDown: '30s',
  },

  // Spike test: Sudden load increase
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 100 },
      { duration: '1m', target: 100 },
      { duration: '10s', target: 1000 }, // Spike to 1000 users
      { duration: '3m', target: 1000 },
      { duration: '10s', target: 100 },
      { duration: '3m', target: 100 },
      { duration: '10s', target: 0 },
    ],
    gracefulRampDown: '30s',
  },

  // Soak test: Extended period under normal load
  soak: {
    executor: 'constant-vus',
    vus: 100,
    duration: '2h',
  },

  // Breakpoint test: Gradually increase load until system breaks
  breakpoint: {
    executor: 'ramping-arrival-rate',
    startRate: 100,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 1000,
    stages: [
      { duration: '5m', target: 100 },
      { duration: '5m', target: 200 },
      { duration: '5m', target: 300 },
      { duration: '5m', target: 400 },
      { duration: '5m', target: 500 },
      { duration: '5m', target: 600 },
      { duration: '5m', target: 700 },
      { duration: '5m', target: 800 },
    ],
  },
};

// Common headers
export function getHeaders(token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

// Response validation
export function checkResponse(response, expectedStatus = 200, testName = '') {
  const checks = {
    [`${testName} - status is ${expectedStatus}`]: response.status === expectedStatus,
    [`${testName} - response time < 500ms`]: response.timings.duration < 500,
  };
  
  if (response.status === 200 || response.status === 201) {
    checks[`${testName} - has response body`] = response.body !== null && response.body.length > 0;
  }
  
  return checks;
}

// Test data generators
export function generateTestUser() {
  const timestamp = new Date().getTime();
  const random = Math.floor(Math.random() * 10000);
  
  return {
    email: `test.user.${timestamp}.${random}@example.com`,
    password: 'Test123!@#',
    firstName: 'Test',
    lastName: 'User',
    phone: `+1555${String(timestamp).slice(-7)}`,
    role: 'CUSTOMER',
  };
}

export function generateTestOrder(merchantId, menuItems) {
  return {
    merchantId,
    items: menuItems.map(item => ({
      menuItemId: item.id,
      quantity: Math.floor(Math.random() * 3) + 1,
      price: item.price,
    })),
    reskflowAddress: {
      street: '123 Test Street',
      city: 'Test City',
      state: 'TC',
      postalCode: '12345',
      latitude: 37.7749,
      longitude: -122.4194,
    },
    paymentMethodId: 'default',
    reskflowInstructions: 'Leave at door',
  };
}

// Sleep function for pacing
export function sleepBetweenRequests(min = 1, max = 3) {
  const sleepTime = Math.random() * (max - min) + min;
  sleep(sleepTime);
}