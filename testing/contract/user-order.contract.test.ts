/**
 * Contract Tests: User Service <-> Order Service
 */

import { Pact, InteractionObject } from '@pact-foundation/pact';
import path from 'path';
import { ApiTestClient } from '../utils/api-client';
import { generateUser, generateUUID } from '../utils/test-data-generator';

describe('User Service <-> Order Service Contract', () => {
  const provider = new Pact({
    consumer: 'OrderService',
    provider: 'UserService',
    port: 8080,
    log: path.resolve(process.cwd(), 'logs', 'pact.log'),
    dir: path.resolve(process.cwd(), 'pacts'),
    logLevel: 'warn',
    spec: 2
  });

  const EXPECTED_USER = {
    id: generateUUID(),
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    phone: '+1234567890',
    role: 'CUSTOMER',
    isActive: true,
    emailVerified: true
  };

  beforeAll(() => provider.setup());
  afterEach(() => provider.verify());
  afterAll(() => provider.finalize());

  describe('when order service requests user details', () => {
    it('should receive valid user data', async () => {
      // Define the expected interaction
      const interaction: InteractionObject = {
        state: 'user exists',
        uponReceiving: 'a request for user details',
        withRequest: {
          method: 'GET',
          path: `/users/${EXPECTED_USER.id}`,
          headers: {
            'Authorization': 'Bearer valid-token',
            'Accept': 'application/json'
          }
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: EXPECTED_USER
        }
      };

      await provider.addInteraction(interaction);

      // Execute the request
      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'valid-token', refreshToken: '' });

      const response = await client.get(`/users/${EXPECTED_USER.id}`);

      expect(response.status).toBe(200);
      expect(response.data).toEqual(EXPECTED_USER);
    });

    it('should handle non-existent user', async () => {
      const nonExistentId = generateUUID();

      const interaction: InteractionObject = {
        state: 'user does not exist',
        uponReceiving: 'a request for non-existent user',
        withRequest: {
          method: 'GET',
          path: `/users/${nonExistentId}`,
          headers: {
            'Authorization': 'Bearer valid-token'
          }
        },
        willRespondWith: {
          status: 404,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            error: 'User not found'
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'valid-token', refreshToken: '' });

      await expect(client.get(`/users/${nonExistentId}`)).rejects.toMatchObject({
        response: {
          status: 404,
          data: { error: 'User not found' }
        }
      });
    });

    it('should validate user eligibility for ordering', async () => {
      const interaction: InteractionObject = {
        state: 'user is eligible to order',
        uponReceiving: 'a request to check order eligibility',
        withRequest: {
          method: 'POST',
          path: `/users/${EXPECTED_USER.id}/check-eligibility`,
          headers: {
            'Authorization': 'Bearer valid-token',
            'Content-Type': 'application/json'
          },
          body: {
            orderType: 'DELIVERY',
            merchantId: generateUUID()
          }
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            eligible: true,
            user: EXPECTED_USER,
            restrictions: []
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'valid-token', refreshToken: '' });

      const response = await client.post(`/users/${EXPECTED_USER.id}/check-eligibility`, {
        orderType: 'DELIVERY',
        merchantId: generateUUID()
      });

      expect(response.status).toBe(200);
      expect(response.data.eligible).toBe(true);
      expect(response.data.user).toEqual(EXPECTED_USER);
    });

    it('should handle suspended user', async () => {
      const suspendedUser = {
        ...EXPECTED_USER,
        isActive: false,
        suspensionReason: 'Policy violation'
      };

      const interaction: InteractionObject = {
        state: 'user is suspended',
        uponReceiving: 'a request for suspended user eligibility',
        withRequest: {
          method: 'POST',
          path: `/users/${suspendedUser.id}/check-eligibility`,
          headers: {
            'Authorization': 'Bearer valid-token',
            'Content-Type': 'application/json'
          },
          body: {
            orderType: 'DELIVERY',
            merchantId: generateUUID()
          }
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            eligible: false,
            user: suspendedUser,
            restrictions: ['ACCOUNT_SUSPENDED']
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'valid-token', refreshToken: '' });

      const response = await client.post(`/users/${suspendedUser.id}/check-eligibility`, {
        orderType: 'DELIVERY',
        merchantId: generateUUID()
      });

      expect(response.status).toBe(200);
      expect(response.data.eligible).toBe(false);
      expect(response.data.restrictions).toContain('ACCOUNT_SUSPENDED');
    });
  });

  describe('when order service updates user order count', () => {
    it('should update order statistics', async () => {
      const interaction: InteractionObject = {
        state: 'user has order history',
        uponReceiving: 'a request to update order count',
        withRequest: {
          method: 'POST',
          path: `/users/${EXPECTED_USER.id}/order-stats`,
          headers: {
            'Authorization': 'Bearer service-token',
            'Content-Type': 'application/json'
          },
          body: {
            orderId: generateUUID(),
            orderTotal: 25.99,
            completedAt: '2024-01-15T10:30:00Z'
          }
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            userId: EXPECTED_USER.id,
            totalOrders: 11,
            totalSpent: 289.99,
            lastOrderDate: '2024-01-15T10:30:00Z',
            loyaltyPoints: 290
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'service-token', refreshToken: '' });

      const response = await client.post(`/users/${EXPECTED_USER.id}/order-stats`, {
        orderId: generateUUID(),
        orderTotal: 25.99,
        completedAt: '2024-01-15T10:30:00Z'
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        userId: EXPECTED_USER.id,
        totalOrders: expect.any(Number),
        totalSpent: expect.any(Number)
      });
    });
  });
});

describe('Order Service <-> Payment Service Contract', () => {
  const provider = new Pact({
    consumer: 'OrderService',
    provider: 'PaymentService',
    port: 8081,
    log: path.resolve(process.cwd(), 'logs', 'pact-payment.log'),
    dir: path.resolve(process.cwd(), 'pacts'),
    logLevel: 'warn',
    spec: 2
  });

  beforeAll(() => provider.setup());
  afterEach(() => provider.verify());
  afterAll(() => provider.finalize());

  describe('when order service requests payment', () => {
    it('should process payment successfully', async () => {
      const orderId = generateUUID();
      const userId = generateUUID();
      
      const interaction: InteractionObject = {
        state: 'payment method exists',
        uponReceiving: 'a payment request',
        withRequest: {
          method: 'POST',
          path: '/payments',
          headers: {
            'Authorization': 'Bearer service-token',
            'Content-Type': 'application/json'
          },
          body: {
            orderId,
            userId,
            amount: 35.99,
            currency: 'USD',
            paymentMethodId: 'pm_default',
            description: `Payment for order ${orderId}`
          }
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            paymentId: generateUUID(),
            orderId,
            status: 'COMPLETED',
            amount: 35.99,
            currency: 'USD',
            transactionId: 'txn_123456',
            processedAt: '2024-01-15T10:30:00Z'
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'service-token', refreshToken: '' });

      const response = await client.post('/payments', {
        orderId,
        userId,
        amount: 35.99,
        currency: 'USD',
        paymentMethodId: 'pm_default',
        description: `Payment for order ${orderId}`
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        orderId,
        status: 'COMPLETED',
        amount: 35.99
      });
    });

    it('should handle payment failure', async () => {
      const orderId = generateUUID();
      
      const interaction: InteractionObject = {
        state: 'payment will fail',
        uponReceiving: 'a payment request that will fail',
        withRequest: {
          method: 'POST',
          path: '/payments',
          headers: {
            'Authorization': 'Bearer service-token',
            'Content-Type': 'application/json'
          },
          body: {
            orderId,
            userId: generateUUID(),
            amount: 1000.00,
            currency: 'USD',
            paymentMethodId: 'pm_invalid'
          }
        },
        willRespondWith: {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            error: 'Payment failed',
            code: 'INSUFFICIENT_FUNDS',
            details: 'The payment method has insufficient funds'
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'service-token', refreshToken: '' });

      await expect(
        client.post('/payments', {
          orderId,
          userId: generateUUID(),
          amount: 1000.00,
          currency: 'USD',
          paymentMethodId: 'pm_invalid'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Payment failed',
            code: 'INSUFFICIENT_FUNDS'
          }
        }
      });
    });
  });

  describe('when order service requests refund', () => {
    it('should process refund successfully', async () => {
      const paymentId = generateUUID();
      const orderId = generateUUID();
      
      const interaction: InteractionObject = {
        state: 'payment exists and is refundable',
        uponReceiving: 'a refund request',
        withRequest: {
          method: 'POST',
          path: `/payments/${paymentId}/refund`,
          headers: {
            'Authorization': 'Bearer service-token',
            'Content-Type': 'application/json'
          },
          body: {
            amount: 10.00,
            reason: 'Item unavailable'
          }
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            refundId: generateUUID(),
            paymentId,
            orderId,
            amount: 10.00,
            status: 'COMPLETED',
            processedAt: '2024-01-15T11:00:00Z'
          }
        }
      };

      await provider.addInteraction(interaction);

      const client = new ApiTestClient({
        baseURL: `http://localhost:${provider.port}`
      });
      client.setAuthTokens({ accessToken: 'service-token', refreshToken: '' });

      const response = await client.post(`/payments/${paymentId}/refund`, {
        amount: 10.00,
        reason: 'Item unavailable'
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        paymentId,
        amount: 10.00,
        status: 'COMPLETED'
      });
    });
  });
});