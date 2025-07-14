# ReskFlow Testing Guide

This guide provides detailed instructions for writing and maintaining tests for the ReskFlow platform.

## Table of Contents

1. [Test Writing Guidelines](#test-writing-guidelines)
2. [Testing Patterns](#testing-patterns)
3. [Service-Specific Testing](#service-specific-testing)
4. [Test Data Management](#test-data-management)
5. [Mocking Strategies](#mocking-strategies)
6. [Debugging Tests](#debugging-tests)
7. [Performance Testing Guide](#performance-testing-guide)
8. [Security Testing Guide](#security-testing-guide)

## Test Writing Guidelines

### General Principles

1. **Test Behavior, Not Implementation**
   ```typescript
   // ❌ Bad: Testing implementation details
   it('should call calculateTax with correct parameters', () => {
     const spy = jest.spyOn(service, 'calculateTax');
     service.createOrder(orderData);
     expect(spy).toHaveBeenCalledWith(100, 0.08);
   });
   
   // ✅ Good: Testing behavior
   it('should create order with correct total including tax', () => {
     const order = await service.createOrder(orderData);
     expect(order.total).toBe(108); // 100 + 8% tax
   });
   ```

2. **Use Descriptive Test Names**
   ```typescript
   // ❌ Bad
   it('should work', () => {});
   it('test user creation', () => {});
   
   // ✅ Good
   it('should create user with valid email and password', () => {});
   it('should reject user creation when email already exists', () => {});
   ```

3. **Follow AAA Pattern**
   ```typescript
   it('should update user profile successfully', async () => {
     // Arrange
     const user = await createTestUser();
     const updateData = { firstName: 'Updated' };
     
     // Act
     const result = await userService.updateProfile(user.id, updateData);
     
     // Assert
     expect(result.firstName).toBe('Updated');
     expect(result.updatedAt).toBeDefined();
   });
   ```

## Testing Patterns

### 1. Testing Async Operations

```typescript
// Using async/await
it('should fetch user orders', async () => {
  const orders = await orderService.getUserOrders(userId);
  expect(orders).toHaveLength(3);
  expect(orders[0]).toMatchObject({
    userId,
    status: expect.any(String)
  });
});

// Testing rejected promises
it('should throw error for invalid user', async () => {
  await expect(orderService.getUserOrders('invalid-id'))
    .rejects
    .toThrow('User not found');
});
```

### 2. Testing Event Emitters

```typescript
it('should emit order.created event', async () => {
  const eventSpy = jest.fn();
  orderService.on('order.created', eventSpy);
  
  const order = await orderService.createOrder(orderData);
  
  expect(eventSpy).toHaveBeenCalledWith({
    orderId: order.id,
    userId: order.userId,
    total: order.total
  });
});
```

### 3. Testing Time-Dependent Code

```typescript
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

it('should expire order after 30 minutes', () => {
  const order = orderService.createPendingOrder();
  
  jest.advanceTimersByTime(30 * 60 * 1000);
  
  const updatedOrder = orderService.getOrder(order.id);
  expect(updatedOrder.status).toBe('EXPIRED');
});
```

## Service-Specific Testing

### User Service Testing

```typescript
describe('UserService', () => {
  let userService: UserService;
  let mockPrisma: any;
  
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    userService = new UserService(mockPrisma);
  });
  
  describe('Authentication', () => {
    it('should hash password on user creation', async () => {
      const userData = generateUser();
      mockPrisma.user.create.mockResolvedValue({
        ...userData,
        password: 'hashed_password'
      });
      
      const user = await userService.createUser(userData);
      
      expect(user.password).not.toBe(userData.password);
      expect(bcrypt.hash).toHaveBeenCalled();
    });
    
    it('should validate JWT token', async () => {
      const token = 'valid.jwt.token';
      const decoded = { userId: '123', role: 'CUSTOMER' };
      
      jest.spyOn(jwt, 'verify').mockReturnValue(decoded);
      
      const result = await userService.verifyToken(token);
      
      expect(result).toEqual(decoded);
    });
  });
});
```

### Order Service Testing

```typescript
describe('OrderService', () => {
  describe('Order Creation', () => {
    it('should validate merchant availability', async () => {
      mockMerchantService.isOpen.mockResolvedValue(false);
      
      await expect(orderService.createOrder({
        merchantId: 'closed-merchant',
        items: [{ id: 'item1', quantity: 1 }]
      })).rejects.toThrow('Merchant is currently closed');
    });
    
    it('should calculate order totals correctly', async () => {
      const items = [
        { id: 'item1', quantity: 2, price: 10.00 }, // 20.00
        { id: 'item2', quantity: 1, price: 15.00 }  // 15.00
      ];
      
      const order = await orderService.createOrder({
        merchantId: 'merchant1',
        items,
        reskflowFee: 3.99
      });
      
      expect(order.subtotal).toBe(35.00);
      expect(order.tax).toBe(2.80); // 8% tax
      expect(order.reskflowFee).toBe(3.99);
      expect(order.total).toBe(41.79);
    });
  });
});
```

## Test Data Management

### Using Test Data Factories

```typescript
// test-data-generator.ts
import { faker } from '@faker-js/faker';

export function generateUser(overrides?: Partial<User>): User {
  return {
    id: faker.datatype.uuid(),
    email: faker.internet.email(),
    firstName: faker.name.firstName(),
    lastName: faker.name.lastName(),
    phone: faker.phone.number(),
    role: 'CUSTOMER',
    createdAt: new Date(),
    ...overrides
  };
}

export function generateOrder(overrides?: Partial<Order>): Order {
  return {
    id: faker.datatype.uuid(),
    orderNumber: `ORD-${faker.datatype.number({ min: 1000, max: 9999 })}`,
    status: 'PENDING',
    items: [generateOrderItem()],
    subtotal: faker.datatype.float({ min: 10, max: 100 }),
    ...overrides
  };
}

// Usage in tests
it('should update order status', async () => {
  const order = generateOrder({ status: 'PENDING' });
  await orderService.updateStatus(order.id, 'CONFIRMED');
  // ...
});
```

### Database Seeding for Integration Tests

```typescript
// test-setup.ts
export async function seedTestDatabase() {
  // Clear existing data
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await prisma.merchant.deleteMany();
  
  // Create test data
  const testUsers = await Promise.all([
    prisma.user.create({ data: generateUser({ role: 'CUSTOMER' }) }),
    prisma.user.create({ data: generateUser({ role: 'MERCHANT' }) }),
    prisma.user.create({ data: generateUser({ role: 'DRIVER' }) })
  ]);
  
  const testMerchants = await Promise.all([
    prisma.merchant.create({ 
      data: generateMerchant({ 
        userId: testUsers[1].id,
        isOpen: true 
      }) 
    })
  ]);
  
  return { users: testUsers, merchants: testMerchants };
}
```

## Mocking Strategies

### Mocking External Services

```typescript
// Mock Redis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn()
  }));
});

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded'
      })
    }
  }));
});
```

### Creating Reusable Mocks

```typescript
// __mocks__/services/NotificationService.ts
export class MockNotificationService {
  sendEmail = jest.fn().mockResolvedValue({ messageId: 'test-123' });
  sendSMS = jest.fn().mockResolvedValue({ messageId: 'sms-123' });
  sendPushNotification = jest.fn().mockResolvedValue({ success: true });
}

// Usage in tests
import { MockNotificationService } from '../__mocks__/services/NotificationService';

beforeEach(() => {
  const mockNotificationService = new MockNotificationService();
  orderService = new OrderService({ 
    notificationService: mockNotificationService 
  });
});
```

## Debugging Tests

### Using Debug Output

```typescript
// Add debug logging
it('should process complex order flow', async () => {
  console.log('Starting order creation...');
  
  const order = await orderService.createOrder(orderData);
  console.log('Order created:', JSON.stringify(order, null, 2));
  
  const payment = await paymentService.processPayment(order.id);
  console.log('Payment processed:', payment.status);
  
  // Use debug module
  const debug = require('debug')('test:order');
  debug('Order flow completed', { orderId: order.id });
});

// Run with: DEBUG=test:* npm test
```

### Interactive Debugging

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Jest Tests",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": [
        "--runInBand",
        "--no-coverage",
        "${relativeFile}"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

## Performance Testing Guide

### Writing K6 Performance Tests

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    errors: ['rate<0.1'],             // Error rate under 10%
  },
};

export default function() {
  // Test scenario
  const response = http.get('http://localhost:3000/api/merchants');
  
  // Validate response
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  errorRate.add(!success);
  
  sleep(1); // Think time
}
```

### Load Testing Best Practices

1. **Start Small**: Begin with a small number of virtual users
2. **Gradual Ramp-up**: Increase load gradually to identify breaking points
3. **Monitor Resources**: Watch CPU, memory, and database connections
4. **Test Different Scenarios**: Include read-heavy and write-heavy operations
5. **Use Realistic Data**: Test with production-like data volumes

## Security Testing Guide

### OWASP Security Tests

```yaml
# security-test-config.yaml
tests:
  - name: "SQL Injection"
    endpoints:
      - url: "/api/merchants"
        params:
          search: "'; DROP TABLE users; --"
        expected: 
          status: 200
          noError: true
          
  - name: "Authentication Bypass"
    endpoints:
      - url: "/api/users/profile"
        headers:
          Authorization: "Bearer invalid-token"
        expected:
          status: 401
          
  - name: "Rate Limiting"
    endpoints:
      - url: "/api/auth/login"
        method: POST
        iterations: 10
        expected:
          rateLimitAfter: 5
```

### Security Test Implementation

```typescript
describe('Security Tests', () => {
  describe('Input Validation', () => {
    it('should sanitize user input to prevent XSS', async () => {
      const maliciousInput = '<script>alert("XSS")</script>';
      
      const result = await api.post('/api/merchants/1/reviews', {
        comment: maliciousInput,
        rating: 5
      });
      
      expect(result.data.comment).not.toContain('<script>');
      expect(result.data.comment).toBe('&lt;script&gt;alert("XSS")&lt;/script&gt;');
    });
  });
  
  describe('Authorization', () => {
    it('should prevent access to other users data', async () => {
      const user1Token = await loginAs('user1');
      const user2Id = 'user2-id';
      
      const response = await api.get(`/api/users/${user2Id}/orders`, {
        headers: { Authorization: `Bearer ${user1Token}` }
      });
      
      expect(response.status).toBe(403);
    });
  });
});
```

## Continuous Improvement

1. **Regular Review**: Review and update tests regularly
2. **Coverage Analysis**: Monitor test coverage trends
3. **Performance Baselines**: Update performance thresholds based on real data
4. **Security Updates**: Keep security test rules up to date
5. **Documentation**: Keep test documentation current

---

Remember: Good tests are an investment in code quality and team productivity. Take the time to write them well!