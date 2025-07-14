/**
 * Order API Integration Tests
 */

import { ApiTestClient } from '../../utils/api-client';
import { TestContainersManager, setupTestEnvironment, teardownTestEnvironment } from '../../utils/test-containers';
import { 
  generateUser, 
  generateMerchant, 
  generateMenuItem, 
  generateOrder,
  generatePaymentCard,
  generateUUID 
} from '../../utils/test-data-generator';
import { TestEnvironment } from '../../utils/test-containers';

describe('Order API Integration', () => {
  let env: TestEnvironment;
  let apiClient: ApiTestClient;
  let customerAuth: any;
  let merchantAuth: any;
  let testMerchant: any;
  let testMenuItem: any;
  let gatewayUrl: string;

  beforeAll(async () => {
    env = await setupTestEnvironment();
    
    // Start all required services
    await TestContainersManager.getInstance().startService('gateway', 'reskflow/gateway:test', 3000);
    await TestContainersManager.getInstance().startService('user-service', 'reskflow/user-service:test', 3001);
    await TestContainersManager.getInstance().startService('order-service', 'reskflow/order-service:test', 3002);
    await TestContainersManager.getInstance().startService('payment-service', 'reskflow/payment-service:test', 3003);
    await TestContainersManager.getInstance().startService('merchant-service', 'reskflow/merchant-service:test', 3004);
    await TestContainersManager.getInstance().startService('inventory-service', 'reskflow/inventory-service:test', 3005);
    await TestContainersManager.getInstance().startService('notification-service', 'reskflow/notification-service:test', 3006);

    gatewayUrl = TestContainersManager.getInstance().getServiceUrl('gateway');
    apiClient = new ApiTestClient({ baseURL: `${gatewayUrl}/api` });
    await apiClient.waitForService();

    // Setup test data
    await setupTestData();
  }, 120000);

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  async function setupTestData() {
    // Create customer
    const customer = generateUser('CUSTOMER');
    await apiClient.post('/auth/register', customer);
    const customerLogin = await apiClient.post('/auth/login', {
      email: customer.email,
      password: customer.password
    });
    customerAuth = customerLogin.data.tokens;

    // Create merchant user
    const merchantUser = generateUser('MERCHANT');
    await apiClient.post('/auth/register', merchantUser);
    const merchantLogin = await apiClient.post('/auth/login', {
      email: merchantUser.email,
      password: merchantUser.password
    });
    merchantAuth = merchantLogin.data.tokens;

    // Create merchant
    apiClient.setAuthTokens(merchantAuth);
    const merchantData = generateMerchant();
    const merchantResponse = await apiClient.post('/merchants', merchantData);
    testMerchant = merchantResponse.data;

    // Create menu item
    const menuItemData = generateMenuItem();
    const menuResponse = await apiClient.post(`/merchants/${testMerchant.id}/menu/items`, menuItemData);
    testMenuItem = menuResponse.data;

    // Add payment method for customer
    apiClient.setAuthTokens(customerAuth);
    const paymentCard = generatePaymentCard();
    await apiClient.post('/payments/methods', {
      type: 'card',
      card: paymentCard
    });
  }

  describe('POST /orders', () => {
    beforeEach(() => {
      apiClient.setAuthTokens(customerAuth);
    });

    it('should create order successfully', async () => {
      const orderData = {
        merchantId: testMerchant.id,
        items: [{
          menuItemId: testMenuItem.id,
          quantity: 2,
          price: testMenuItem.price,
          notes: 'No onions please'
        }],
        reskflowAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TC',
          postalCode: '12345',
          latitude: 37.7749,
          longitude: -122.4194
        },
        paymentMethodId: 'default',
        reskflowInstructions: 'Leave at door'
      };

      const response = await apiClient.post('/orders', orderData);

      expect(response.status).toBe(201);
      expect(response.data).toMatchObject({
        id: expect.any(String),
        orderNumber: expect.stringMatching(/^ORD-/),
        status: 'PENDING',
        merchantId: testMerchant.id,
        customerId: expect.any(String),
        items: expect.arrayContaining([
          expect.objectContaining({
            menuItemId: testMenuItem.id,
            quantity: 2,
            price: testMenuItem.price
          })
        ]),
        subtotal: testMenuItem.price * 2,
        tax: expect.any(Number),
        reskflowFee: expect.any(Number),
        total: expect.any(Number)
      });
    });

    it('should validate inventory availability', async () => {
      // Set inventory to 1
      apiClient.setAuthTokens(merchantAuth);
      await apiClient.put(`/merchant/inventory/${testMenuItem.id}`, {
        quantity: 1
      });

      // Try to order 5 items
      apiClient.setAuthTokens(customerAuth);
      await expect(
        apiClient.post('/orders', {
          merchantId: testMerchant.id,
          items: [{
            menuItemId: testMenuItem.id,
            quantity: 5,
            price: testMenuItem.price
          }],
          reskflowAddress: generateUser().address,
          paymentMethodId: 'default'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Insufficient inventory'
          }
        }
      });
    });

    it('should check merchant operating hours', async () => {
      // Update merchant to closed
      apiClient.setAuthTokens(merchantAuth);
      await apiClient.put(`/merchants/${testMerchant.id}/availability`, {
        isOpen: false
      });

      // Try to place order
      apiClient.setAuthTokens(customerAuth);
      await expect(
        apiClient.post('/orders', {
          merchantId: testMerchant.id,
          items: [{
            menuItemId: testMenuItem.id,
            quantity: 1,
            price: testMenuItem.price
          }],
          reskflowAddress: generateUser().address,
          paymentMethodId: 'default'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Merchant is currently closed'
          }
        }
      });

      // Reopen merchant
      apiClient.setAuthTokens(merchantAuth);
      await apiClient.put(`/merchants/${testMerchant.id}/availability`, {
        isOpen: true
      });
    });

    it('should apply minimum order validation', async () => {
      await expect(
        apiClient.post('/orders', {
          merchantId: testMerchant.id,
          items: [{
            menuItemId: testMenuItem.id,
            quantity: 1,
            price: 1.00 // Very low price
          }],
          reskflowAddress: generateUser().address,
          paymentMethodId: 'default'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: expect.stringContaining('Minimum order')
          }
        }
      });
    });
  });

  describe('GET /orders/:id', () => {
    let testOrder: any;

    beforeEach(async () => {
      apiClient.setAuthTokens(customerAuth);
      const orderResponse = await apiClient.post('/orders', {
        merchantId: testMerchant.id,
        items: [{
          menuItemId: testMenuItem.id,
          quantity: 1,
          price: testMenuItem.price
        }],
        reskflowAddress: generateUser().address,
        paymentMethodId: 'default'
      });
      testOrder = orderResponse.data;
    });

    it('should get order details as customer', async () => {
      const response = await apiClient.get(`/orders/${testOrder.id}`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        id: testOrder.id,
        orderNumber: testOrder.orderNumber,
        status: expect.any(String),
        items: expect.any(Array),
        timeline: expect.arrayContaining([
          expect.objectContaining({
            status: 'PLACED',
            timestamp: expect.any(String)
          })
        ])
      });
    });

    it('should get order details as merchant', async () => {
      apiClient.setAuthTokens(merchantAuth);
      const response = await apiClient.get(`/orders/${testOrder.id}`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        id: testOrder.id,
        customerInfo: expect.objectContaining({
          name: expect.any(String),
          phone: expect.any(String)
        })
      });
    });

    it('should not allow unauthorized access', async () => {
      // Create another user
      const otherUser = generateUser();
      await apiClient.post('/auth/register', otherUser);
      const otherLogin = await apiClient.post('/auth/login', {
        email: otherUser.email,
        password: otherUser.password
      });

      apiClient.setAuthTokens(otherLogin.data.tokens);
      
      await expect(
        apiClient.get(`/orders/${testOrder.id}`)
      ).rejects.toMatchObject({
        response: {
          status: 403,
          data: {
            error: 'Forbidden'
          }
        }
      });
    });
  });

  describe('PUT /orders/:id/status', () => {
    let testOrder: any;

    beforeEach(async () => {
      apiClient.setAuthTokens(customerAuth);
      const orderResponse = await apiClient.post('/orders', {
        merchantId: testMerchant.id,
        items: [{
          menuItemId: testMenuItem.id,
          quantity: 1,
          price: testMenuItem.price
        }],
        reskflowAddress: generateUser().address,
        paymentMethodId: 'default'
      });
      testOrder = orderResponse.data;
    });

    it('should update order status as merchant', async () => {
      apiClient.setAuthTokens(merchantAuth);

      // Confirm order
      const response = await apiClient.put(`/orders/${testOrder.id}/status`, {
        status: 'CONFIRMED',
        estimatedTime: 30
      });

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('CONFIRMED');
      expect(response.data.estimatedDeliveryTime).toBeDefined();
    });

    it('should follow valid status transitions', async () => {
      apiClient.setAuthTokens(merchantAuth);

      // Invalid transition from PENDING to DELIVERED
      await expect(
        apiClient.put(`/orders/${testOrder.id}/status`, {
          status: 'DELIVERED'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Invalid status transition'
          }
        }
      });
    });
  });

  describe('POST /orders/:id/cancel', () => {
    let testOrder: any;

    beforeEach(async () => {
      apiClient.setAuthTokens(customerAuth);
      const orderResponse = await apiClient.post('/orders', {
        merchantId: testMerchant.id,
        items: [{
          menuItemId: testMenuItem.id,
          quantity: 1,
          price: testMenuItem.price
        }],
        reskflowAddress: generateUser().address,
        paymentMethodId: 'default'
      });
      testOrder = orderResponse.data;
    });

    it('should cancel order within cancellation window', async () => {
      const response = await apiClient.post(`/orders/${testOrder.id}/cancel`, {
        reason: 'Changed my mind'
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Changed my mind',
        refundStatus: 'PENDING'
      });
    });

    it('should not allow cancellation after confirmation', async () => {
      // Merchant confirms order
      apiClient.setAuthTokens(merchantAuth);
      await apiClient.put(`/orders/${testOrder.id}/status`, {
        status: 'CONFIRMED'
      });

      // Wait to exceed cancellation window
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to cancel
      apiClient.setAuthTokens(customerAuth);
      await expect(
        apiClient.post(`/orders/${testOrder.id}/cancel`, {
          reason: 'Too late'
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Order cannot be cancelled'
          }
        }
      });
    });
  });

  describe('POST /orders/:id/rate', () => {
    let completedOrder: any;

    beforeEach(async () => {
      // Create and complete an order
      apiClient.setAuthTokens(customerAuth);
      const orderResponse = await apiClient.post('/orders', {
        merchantId: testMerchant.id,
        items: [{
          menuItemId: testMenuItem.id,
          quantity: 1,
          price: testMenuItem.price
        }],
        reskflowAddress: generateUser().address,
        paymentMethodId: 'default'
      });
      
      // Simulate order completion
      apiClient.setAuthTokens(merchantAuth);
      await apiClient.put(`/orders/${orderResponse.data.id}/status`, {
        status: 'COMPLETED'
      });
      
      completedOrder = orderResponse.data;
    });

    it('should rate completed order', async () => {
      apiClient.setAuthTokens(customerAuth);
      
      const response = await apiClient.post(`/orders/${completedOrder.id}/rate`, {
        foodRating: 5,
        reskflowRating: 4,
        overallRating: 4,
        comment: 'Great food, reskflow was a bit late'
      });

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        orderId: completedOrder.id,
        foodRating: 5,
        reskflowRating: 4,
        overallRating: 4
      });
    });

    it('should not allow rating incomplete orders', async () => {
      // Create new order (not completed)
      const newOrder = await apiClient.post('/orders', {
        merchantId: testMerchant.id,
        items: [{
          menuItemId: testMenuItem.id,
          quantity: 1,
          price: testMenuItem.price
        }],
        reskflowAddress: generateUser().address,
        paymentMethodId: 'default'
      });

      await expect(
        apiClient.post(`/orders/${newOrder.data.id}/rate`, {
          overallRating: 5
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            error: 'Order must be completed to rate'
          }
        }
      });
    });
  });

  describe('Concurrent Order Processing', () => {
    it('should handle concurrent orders correctly', async () => {
      apiClient.setAuthTokens(customerAuth);
      
      // Create 5 concurrent orders
      const orderPromises = Array(5).fill(null).map(() => 
        apiClient.post('/orders', {
          merchantId: testMerchant.id,
          items: [{
            menuItemId: testMenuItem.id,
            quantity: 1,
            price: testMenuItem.price
          }],
          reskflowAddress: generateUser().address,
          paymentMethodId: 'default'
        })
      );

      const responses = await Promise.all(orderPromises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.data.id).toBeDefined();
      });

      // Order numbers should be unique
      const orderNumbers = responses.map(r => r.data.orderNumber);
      const uniqueOrderNumbers = new Set(orderNumbers);
      expect(uniqueOrderNumbers.size).toBe(orderNumbers.length);
    });
  });
});