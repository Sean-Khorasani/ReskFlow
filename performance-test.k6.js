import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const reskflowCreationRate = new Rate('reskflow_creation_success');
const trackingUpdateRate = new Rate('tracking_update_success');

// Test configuration
export const options = {
  scenarios: {
    // Smoke test
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
    },
    // Load test
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 100 },   // Ramp up to 100 users
        { duration: '10m', target: 100 },  // Stay at 100 users
        { duration: '5m', target: 200 },   // Ramp up to 200 users
        { duration: '10m', target: 200 },  // Stay at 200 users
        { duration: '5m', target: 0 },     // Ramp down to 0 users
      ],
      gracefulRampDown: '30s',
    },
    // Stress test
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
        { duration: '10m', target: 0 },
      ],
    },
    // Spike test
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1000 }, // Spike to 1000 users
        { duration: '3m', target: 1000 },  // Stay at 1000 users
        { duration: '10s', target: 0 },    // Drop to 0 users
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.05'],                  // Error rate under 5%
    errors: ['rate<0.1'],                            // Custom error rate under 10%
    reskflow_creation_success: ['rate>0.95'],        // 95% success rate
    tracking_update_success: ['rate>0.95'],          // 95% success rate
  },
};

// Test data
const testUsers = new SharedArray('users', function () {
  return JSON.parse(open('./test-data/users.json'));
});

const testAddresses = new SharedArray('addresses', function () {
  return JSON.parse(open('./test-data/addresses.json'));
});

// Base URL
const BASE_URL = __ENV.BASE_URL || 'https://api.ReskFlow.com';

// Helper functions
function randomUser() {
  return testUsers[Math.floor(Math.random() * testUsers.length)];
}

function randomAddress() {
  return testAddresses[Math.floor(Math.random() * testAddresses.length)];
}

function generateDeliveryData() {
  return {
    pickupAddressId: randomAddress().id,
    reskflowAddressId: randomAddress().id,
    packageDetails: {
      description: 'Test package',
      weight: Math.random() * 10 + 1,
      dimensions: {
        length: Math.random() * 50 + 10,
        width: Math.random() * 50 + 10,
        height: Math.random() * 50 + 10,
      },
      value: Math.random() * 1000 + 10,
      fragile: Math.random() > 0.5,
      category: ['DOCUMENTS', 'ELECTRONICS', 'CLOTHING', 'OTHER'][Math.floor(Math.random() * 4)],
    },
    priority: Math.floor(Math.random() * 5),
  };
}

// Main test function
export default function () {
  const user = randomUser();
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${user.token}`,
    },
  };

  // Scenario 1: User login
  let loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: user.email,
      password: user.password,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(loginRes, {
    'login successful': (r) => r.status === 200,
    'login response has token': (r) => r.json('token') !== '',
  });

  if (loginRes.status === 200) {
    params.headers.Authorization = `Bearer ${loginRes.json('token')}`;
  }

  sleep(1);

  // Scenario 2: Create reskflow
  const reskflowData = generateDeliveryData();
  let createRes = http.post(
    `${BASE_URL}/deliveries`,
    JSON.stringify(reskflowData),
    params
  );

  const createSuccess = check(createRes, {
    'reskflow created': (r) => r.status === 201,
    'has tracking number': (r) => r.json('trackingNumber') !== '',
    'has blockchain ID': (r) => r.json('blockchainId') !== '',
  });

  reskflowCreationRate.add(createSuccess);
  errorRate.add(!createSuccess);

  if (createRes.status === 201) {
    const reskflowId = createRes.json('id');
    const trackingNumber = createRes.json('trackingNumber');

    sleep(2);

    // Scenario 3: Track reskflow
    let trackRes = http.get(
      `${BASE_URL}/tracking/${trackingNumber}`,
      params
    );

    check(trackRes, {
      'tracking successful': (r) => r.status === 200,
      'has reskflow info': (r) => r.json('reskflow.id') === reskflowId,
    });

    // Scenario 4: Real-time tracking simulation
    if (__ENV.TEST_WEBSOCKET === 'true') {
      // WebSocket test would go here
      // k6 doesn't have native WebSocket support, use k6-websocket extension
    }

    // Scenario 5: List deliveries
    let listRes = http.get(
      `${BASE_URL}/deliveries?limit=20&page=1`,
      params
    );

    check(listRes, {
      'list deliveries successful': (r) => r.status === 200,
      'has deliveries array': (r) => Array.isArray(r.json('data')),
    });

    sleep(1);

    // Scenario 6: Route optimization (driver scenario)
    if (user.role === 'DRIVER') {
      let optimizeRes = http.post(
        `${BASE_URL}/optimize-route`,
        JSON.stringify({
          reskflowIds: [reskflowId],
          startLocation: {
            latitude: 40.7128,
            longitude: -74.0060,
          },
        }),
        params
      );

      check(optimizeRes, {
        'route optimization successful': (r) => r.status === 200,
        'has optimized route': (r) => r.json('optimizedRoute') !== null,
      });
    }
  }

  sleep(Math.random() * 3 + 1);
}

// Setup function
export function setup() {
  // Verify API is accessible
  let res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`API is not accessible: ${res.status}`);
  }

  // Create test data if needed
  console.log('Performance test setup complete');
}

// Teardown function
export function teardown(data) {
  console.log('Performance test completed');
  
  // Could send results to monitoring system
  if (__ENV.SEND_RESULTS === 'true') {
    http.post(
      `${BASE_URL}/monitoring/performance-test-results`,
      JSON.stringify({
        timestamp: new Date(),
        results: data,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': __ENV.MONITORING_API_KEY,
        },
      }
    );
  }
}

// Custom scenarios for specific features
export function testBlockchainPerformance() {
  const iterations = 100;
  const results = [];

  for (let i = 0; i < iterations; i++) {
    const start = new Date();
    
    // Create reskflow with blockchain recording
    const res = http.post(
      `${BASE_URL}/deliveries`,
      JSON.stringify(generateDeliveryData()),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${__ENV.TEST_TOKEN}`,
        },
      }
    );

    const duration = new Date() - start;
    results.push({
      iteration: i,
      duration: duration,
      status: res.status,
      hasBlockchainId: res.json('blockchainId') !== '',
    });

    sleep(0.5);
  }

  // Calculate metrics
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / iterations;
  const successRate = results.filter(r => r.status === 201).length / iterations;
  const blockchainRate = results.filter(r => r.hasBlockchainId).length / iterations;

  console.log(`Blockchain Performance Test Results:
    Average Duration: ${avgDuration}ms
    Success Rate: ${successRate * 100}%
    Blockchain Recording Rate: ${blockchainRate * 100}%
  `);

  check(null, {
    'avg blockchain recording under 2s': () => avgDuration < 2000,
    'blockchain success rate > 95%': () => blockchainRate > 0.95,
  });
}