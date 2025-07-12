/**
 * K6 Performance Test: Authentication Flow
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { baseURL, getHeaders, checkResponse, generateTestUser, scenarios, thresholds } from './k6-config.js';
import { setupWithHealthCheck, shouldSkipTest, waitForServices } from './health-check.js';

// Custom metrics
const loginFailureRate = new Rate('login_failures');
const tokenRefreshRate = new Rate('token_refresh_success');

// Required services for this test
const REQUIRED_SERVICES = ['gateway', 'auth', 'user'];

// Test configuration
export const options = {
  scenarios: {
    auth_flow: scenarios.load,
  },
  thresholds: {
    ...thresholds,
    login_failures: ['rate<0.01'], // Less than 1% login failures
    token_refresh_success: ['rate>0.99'], // More than 99% successful token refreshes
  },
};

// Test data
let testUsers = [];

// Setup: Create test users
export function setup() {
  // Wait for services to be ready
  if (!waitForServices(baseURL, REQUIRED_SERVICES)) {
    return { skip: true, reason: 'Required services not available' };
  }
  
  console.log('Creating test users...');
  
  const setupUsers = [];
  for (let i = 0; i < 10; i++) {
    const user = generateTestUser();
    
    // Register user
    const registerRes = http.post(
      `${baseURL}/api/auth/register`,
      JSON.stringify(user),
      { headers: getHeaders() }
    );
    
    if (registerRes.status === 201) {
      setupUsers.push(user);
    }
  }
  
  return { users: setupUsers, skip: false };
}

// Main test scenario
export default function(data) {
  // Skip test execution if services are not healthy
  if (shouldSkipTest(data)) {
    console.log('Skipping test execution due to unhealthy services');
    return;
  }
  
  const users = data.users;
  if (!users || users.length === 0) {
    console.error('No test users available');
    return;
  }
  
  const user = users[Math.floor(Math.random() * users.length)];
  
  // Test 1: User Registration (for new users during test)
  const newUser = generateTestUser();
  const registerRes = http.post(
    `${baseURL}/api/auth/register`,
    JSON.stringify(newUser),
    {
      headers: getHeaders(),
      tags: { name: 'register' },
    }
  );
  
  check(registerRes, checkResponse(registerRes, 201, 'Registration'));
  
  sleep(1);
  
  // Test 2: User Login
  const loginRes = http.post(
    `${baseURL}/api/auth/login`,
    JSON.stringify({
      email: user.email,
      password: user.password,
    }),
    {
      headers: getHeaders(),
      tags: { name: 'login' },
    }
  );
  
  const loginChecks = check(loginRes, {
    'Login successful': (r) => r.status === 200,
    'Has access token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.tokens && body.tokens.accessToken;
      } catch (e) {
        return false;
      }
    },
    'Has refresh token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.tokens && body.tokens.refreshToken;
      } catch (e) {
        return false;
      }
    },
  });
  
  loginFailureRate.add(!loginChecks);
  
  if (loginRes.status !== 200) {
    return; // Skip remaining tests if login failed
  }
  
  const tokens = JSON.parse(loginRes.body).tokens;
  
  sleep(2);
  
  // Test 3: Access Protected Resource
  const profileRes = http.get(
    `${baseURL}/api/users/profile`,
    {
      headers: getHeaders(tokens.accessToken),
      tags: { name: 'get_profile' },
    }
  );
  
  check(profileRes, checkResponse(profileRes, 200, 'Get Profile'));
  
  sleep(1);
  
  // Test 4: Refresh Token
  const refreshRes = http.post(
    `${baseURL}/api/auth/refresh`,
    JSON.stringify({
      refreshToken: tokens.refreshToken,
    }),
    {
      headers: getHeaders(),
      tags: { name: 'refresh_token' },
    }
  );
  
  const refreshChecks = check(refreshRes, {
    'Token refresh successful': (r) => r.status === 200,
    'Has new access token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.accessToken && body.accessToken !== tokens.accessToken;
      } catch (e) {
        return false;
      }
    },
  });
  
  tokenRefreshRate.add(refreshChecks);
  
  if (refreshRes.status === 200) {
    const newTokens = JSON.parse(refreshRes.body);
    tokens.accessToken = newTokens.accessToken;
  }
  
  sleep(1);
  
  // Test 5: Update Profile
  const updateRes = http.put(
    `${baseURL}/api/users/profile`,
    JSON.stringify({
      firstName: 'Updated',
      lastName: 'Name',
    }),
    {
      headers: getHeaders(tokens.accessToken),
      tags: { name: 'update_profile' },
    }
  );
  
  check(updateRes, checkResponse(updateRes, 200, 'Update Profile'));
  
  sleep(1);
  
  // Test 6: Logout
  const logoutRes = http.post(
    `${baseURL}/api/auth/logout`,
    null,
    {
      headers: getHeaders(tokens.accessToken),
      tags: { name: 'logout' },
    }
  );
  
  check(logoutRes, checkResponse(logoutRes, 200, 'Logout'));
  
  sleep(1);
  
  // Test 7: Verify Token is Invalid After Logout
  const invalidTokenRes = http.get(
    `${baseURL}/api/users/profile`,
    {
      headers: getHeaders(tokens.accessToken),
      tags: { name: 'invalid_token_check' },
    }
  );
  
  check(invalidTokenRes, {
    'Token invalid after logout': (r) => r.status === 401,
  });
}

// Teardown: Cleanup
export function teardown(data) {
  console.log('Test completed. Cleaning up...');
}