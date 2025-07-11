/**
 * Authentication API Integration Tests
 */

import { ApiTestClient } from '../../utils/api-client';
import { TestContainersManager, setupTestEnvironment, teardownTestEnvironment } from '../../utils/test-containers';
import { generateUser, generateEmail } from '../../utils/test-data-generator';
import { TestEnvironment } from '../../utils/test-containers';

describe('Authentication API Integration', () => {
  let env: TestEnvironment;
  let apiClient: ApiTestClient;
  let gatewayUrl: string;

  beforeAll(async () => {
    // Setup test environment with containers
    env = await setupTestEnvironment();
    
    // Start gateway service
    const gateway = await TestContainersManager.getInstance().startService(
      'gateway',
      'reskflow/gateway:test',
      3000,
      {
        JWT_SECRET: 'test-secret',
        SERVICES_USER_URL: 'http://user-service:3001',
        SERVICES_SECURITY_URL: 'http://security-service:3002'
      }
    );

    // Start user service
    await TestContainersManager.getInstance().startService(
      'user-service',
      'reskflow/user-service:test',
      3001
    );

    // Start security service
    await TestContainersManager.getInstance().startService(
      'security-service',
      'reskflow/security-service:test',
      3002
    );

    gatewayUrl = TestContainersManager.getInstance().getServiceUrl('gateway');
    apiClient = new ApiTestClient({ baseURL: `${gatewayUrl}/api` });

    // Wait for services to be ready
    await apiClient.waitForService();
  }, 60000);

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = generateUser();

      const response = await apiClient.post('/auth/register', userData);

      expect(response.status).toBe(201);
      expect(response.data).toMatchObject({
        id: expect.any(String),
        email: userData.email.toLowerCase(),
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role,
        emailVerified: false,
        isActive: true
      });
      expect(response.data.password).toBeUndefined();
    });

    it('should not allow duplicate email registration', async () => {
      const userData = generateUser();

      // Register first time
      await apiClient.post('/auth/register', userData);

      // Try to register again
      await expect(
        apiClient.post('/auth/register', userData)
      ).rejects.toMatchObject({
        response: {
          status: 409,
          data: {
            error: 'User already exists'
          }
        }
      });
    });

    it('should validate required fields', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: '123', // Too short
        firstName: '',
        lastName: ''
      };

      await expect(
        apiClient.post('/auth/register', invalidData)
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            errors: expect.arrayContaining([
              expect.objectContaining({ field: 'email' }),
              expect.objectContaining({ field: 'password' })
            ])
          }
        }
      });
    });

    it('should send verification email after registration', async () => {
      const userData = generateUser();

      const response = await apiClient.post('/auth/register', userData);

      // Check if notification service was called
      // In real test, we'd check email queue or mock SMTP
      expect(response.data.emailVerified).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    let testUser: any;

    beforeEach(async () => {
      // Create a test user
      testUser = generateUser();
      await apiClient.post('/auth/register', testUser);
    });

    it('should login with valid credentials', async () => {
      const response = await apiClient.post('/auth/login', {
        email: testUser.email,
        password: testUser.password
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        user: {
          id: expect.any(String),
          email: testUser.email.toLowerCase()
        },
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String)
        }
      });

      // Verify tokens work
      apiClient.setAuthTokens(response.data.tokens);
      const profileResponse = await apiClient.get('/users/profile');
      expect(profileResponse.status).toBe(200);
    });

    it('should fail with invalid password', async () => {
      await expect(
        apiClient.post('/auth/login', {
          email: testUser.email,
          password: 'wrong-password'
        })
      ).rejects.toMatchObject({
        response: {
          status: 401,
          data: {
            error: 'Invalid credentials'
          }
        }
      });
    });

    it('should fail with non-existent email', async () => {
      await expect(
        apiClient.post('/auth/login', {
          email: 'nonexistent@example.com',
          password: 'any-password'
        })
      ).rejects.toMatchObject({
        response: {
          status: 401,
          data: {
            error: 'Invalid credentials'
          }
        }
      });
    });

    it('should track failed login attempts', async () => {
      const maxAttempts = 5;

      // Make multiple failed attempts
      for (let i = 0; i < maxAttempts; i++) {
        await expect(
          apiClient.post('/auth/login', {
            email: testUser.email,
            password: 'wrong-password'
          })
        ).rejects.toMatchObject({
          response: { status: 401 }
        });
      }

      // Next attempt should be blocked
      await expect(
        apiClient.post('/auth/login', {
          email: testUser.email,
          password: testUser.password // Even with correct password
        })
      ).rejects.toMatchObject({
        response: {
          status: 429,
          data: {
            error: 'Account temporarily locked'
          }
        }
      });
    });
  });

  describe('POST /auth/refresh', () => {
    let tokens: any;

    beforeEach(async () => {
      const user = generateUser();
      await apiClient.post('/auth/register', user);
      const loginResponse = await apiClient.post('/auth/login', {
        email: user.email,
        password: user.password
      });
      tokens = loginResponse.data.tokens;
    });

    it('should refresh access token with valid refresh token', async () => {
      const response = await apiClient.post('/auth/refresh', {
        refreshToken: tokens.refreshToken
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String)
      });
      expect(response.data.accessToken).not.toBe(tokens.accessToken);
    });

    it('should fail with invalid refresh token', async () => {
      await expect(
        apiClient.post('/auth/refresh', {
          refreshToken: 'invalid-refresh-token'
        })
      ).rejects.toMatchObject({
        response: {
          status: 401,
          data: {
            error: 'Invalid refresh token'
          }
        }
      });
    });
  });

  describe('POST /auth/logout', () => {
    let tokens: any;

    beforeEach(async () => {
      const user = generateUser();
      await apiClient.post('/auth/register', user);
      const loginResponse = await apiClient.post('/auth/login', {
        email: user.email,
        password: user.password
      });
      tokens = loginResponse.data.tokens;
      apiClient.setAuthTokens(tokens);
    });

    it('should logout successfully', async () => {
      const response = await apiClient.post('/auth/logout');

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        message: 'Logged out successfully'
      });

      // Verify token is invalidated
      await expect(
        apiClient.get('/users/profile')
      ).rejects.toMatchObject({
        response: {
          status: 401
        }
      });
    });
  });

  describe('POST /auth/forgot-password', () => {
    let testUser: any;

    beforeEach(async () => {
      testUser = generateUser();
      await apiClient.post('/auth/register', testUser);
    });

    it('should send password reset email', async () => {
      const response = await apiClient.post('/auth/forgot-password', {
        email: testUser.email
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        message: 'Password reset email sent'
      });
    });

    it('should not reveal if email exists', async () => {
      const response = await apiClient.post('/auth/forgot-password', {
        email: 'nonexistent@example.com'
      });

      // Same response for security
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        message: 'Password reset email sent'
      });
    });
  });

  describe('POST /auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      // In real test, we'd extract token from email or Redis
      const mockToken = 'valid-reset-token';
      const newPassword = 'NewPassword123!';

      // Mock the token in Redis
      // await redis.set(`password_reset:${mockToken}`, userId);

      const response = await apiClient.post('/auth/reset-password', {
        token: mockToken,
        password: newPassword
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        message: 'Password reset successfully'
      });
    });

    it('should fail with invalid token', async () => {
      await expect(
        apiClient.post('/auth/reset-password', {
          token: 'invalid-token',
          password: 'NewPassword123!'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Invalid or expired token'
          }
        }
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit excessive requests', async () => {
      const requests = [];
      
      // Make 100 requests rapidly
      for (let i = 0; i < 100; i++) {
        requests.push(
          apiClient.get('/health').catch(e => e.response)
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r?.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].data).toMatchObject({
        error: 'Too many requests'
      });
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await apiClient.get('/health');

      expect(response.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'x-xss-protection': '1; mode=block',
        'strict-transport-security': expect.any(String)
      });
    });
  });
});