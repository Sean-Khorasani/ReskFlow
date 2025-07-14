import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma, redis } from '@reskflow/shared';
import { app } from '../../backend/gateway/src/app';
import { generateTestUser, generateTestDelivery, cleanupTestData } from '../utils/testHelpers';

describe('Delivery API Integration Tests', () => {
  let authToken: string;
  let testUser: any;
  let testDriver: any;

  beforeAll(async () => {
    // Setup test database
    await prisma.$connect();
    await redis.client.flushdb();

    // Create test users
    testUser = await generateTestUser('customer');
    testDriver = await generateTestUser('driver');

    // Get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: 'TestPassword123!',
      });

    authToken = loginResponse.body.token;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
    await redis.disconnect();
  });

  beforeEach(async () => {
    // Clear any test deliveries
    await prisma.reskflow.deleteMany({
      where: {
        OR: [
          { senderId: testUser.id },
          { driverId: testDriver.id },
        ],
      },
    });
  });

  describe('POST /api/deliveries', () => {
    it('should create a new reskflow', async () => {
      const reskflowData = generateTestDelivery(testUser.id);

      const response = await request(app)
        .post('/api/deliveries')
        .set('Authorization', `Bearer ${authToken}`)
        .send(reskflowData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('trackingNumber');
      expect(response.body.status).toBe('CREATED');
      expect(response.body.senderId).toBe(testUser.id);
    });

    it('should calculate price based on distance and weight', async () => {
      const reskflowData = generateTestDelivery(testUser.id);

      const response = await request(app)
        .post('/api/deliveries')
        .set('Authorization', `Bearer ${authToken}`)
        .send(reskflowData);

      expect(response.status).toBe(201);
      expect(response.body.price).toBeGreaterThan(0);
      expect(response.body.price).toBeLessThan(1000);
    });

    it('should create blockchain record', async () => {
      const reskflowData = generateTestDelivery(testUser.id);

      const response = await request(app)
        .post('/api/deliveries')
        .set('Authorization', `Bearer ${authToken}`)
        .send(reskflowData);

      expect(response.status).toBe(201);
      
      // Wait for blockchain transaction
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check blockchain record was created
      const reskflow = await prisma.reskflow.findUnique({
        where: { id: response.body.id },
      });

      expect(reskflow?.blockchainId).toBeTruthy();
      expect(reskflow?.ipfsHash).toBeTruthy();
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/deliveries')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should require authentication', async () => {
      const reskflowData = generateTestDelivery(testUser.id);

      const response = await request(app)
        .post('/api/deliveries')
        .send(reskflowData);

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/deliveries/:id', () => {
    let testDelivery: any;

    beforeEach(async () => {
      testDelivery = await prisma.reskflow.create({
        data: generateTestDelivery(testUser.id),
      });
    });

    it('should get reskflow details', async () => {
      const response = await request(app)
        .get(`/api/deliveries/${testDelivery.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(testDelivery.id);
      expect(response.body.trackingNumber).toBe(testDelivery.trackingNumber);
    });

    it('should include related data', async () => {
      const response = await request(app)
        .get(`/api/deliveries/${testDelivery.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.sender).toBeDefined();
      expect(response.body.pickupAddress).toBeDefined();
      expect(response.body.reskflowAddress).toBeDefined();
    });

    it('should restrict access to authorized users', async () => {
      // Create another user
      const otherUser = await generateTestUser('customer');
      const otherAuthResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: otherUser.email,
          password: 'TestPassword123!',
        });

      const response = await request(app)
        .get(`/api/deliveries/${testDelivery.id}`)
        .set('Authorization', `Bearer ${otherAuthResponse.body.token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/deliveries/:id/status', () => {
    let testDelivery: any;
    let driverToken: string;

    beforeEach(async () => {
      // Create reskflow and assign driver
      testDelivery = await prisma.reskflow.create({
        data: {
          ...generateTestDelivery(testUser.id),
          driverId: testDriver.id,
          status: 'ASSIGNED',
        },
      });

      // Get driver auth token
      const driverLoginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testDriver.email,
          password: 'TestPassword123!',
        });

      driverToken = driverLoginResponse.body.token;
    });

    it('should update reskflow status', async () => {
      const response = await request(app)
        .put(`/api/deliveries/${testDelivery.id}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          status: 'PICKED_UP',
          location: {
            latitude: 40.7128,
            longitude: -74.0060,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('PICKED_UP');
    });

    it('should create tracking event', async () => {
      await request(app)
        .put(`/api/deliveries/${testDelivery.id}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          status: 'IN_TRANSIT',
          location: {
            latitude: 40.7589,
            longitude: -73.9851,
          },
        });

      const trackingEvents = await prisma.trackingEvent.findMany({
        where: { reskflowId: testDelivery.id },
      });

      expect(trackingEvents.length).toBeGreaterThan(0);
      expect(trackingEvents[0].status).toBe('IN_TRANSIT');
    });

    it('should validate status transitions', async () => {
      const response = await request(app)
        .put(`/api/deliveries/${testDelivery.id}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          status: 'DELIVERED', // Invalid transition from ASSIGNED
        });

      expect(response.status).toBe(400);
    });

    it('should only allow assigned driver to update', async () => {
      const anotherDriver = await generateTestUser('driver');
      const anotherDriverAuth = await request(app)
        .post('/api/auth/login')
        .send({
          email: anotherDriver.email,
          password: 'TestPassword123!',
        });

      const response = await request(app)
        .put(`/api/deliveries/${testDelivery.id}/status`)
        .set('Authorization', `Bearer ${anotherDriverAuth.body.token}`)
        .send({
          status: 'PICKED_UP',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('Real-time tracking', () => {
    it('should emit location updates via WebSocket', async (done) => {
      // This would be tested with a WebSocket client
      // Example implementation would connect to socket.io
      // and verify location updates are received
      done();
    });
  });

  describe('Route optimization', () => {
    it('should optimize route for multiple deliveries', async () => {
      // Create multiple deliveries
      const deliveries = await Promise.all(
        Array(5).fill(null).map(() =>
          prisma.reskflow.create({
            data: {
              ...generateTestDelivery(testUser.id),
              driverId: testDriver.id,
              status: 'ASSIGNED',
            },
          })
        )
      );

      const response = await request(app)
        .post('/api/optimize-route')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          reskflowIds: deliveries.map(d => d.id),
          startLocation: {
            latitude: 40.7128,
            longitude: -74.0060,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.optimizedRoute).toHaveLength(deliveries.length);
      expect(response.body.totalDistance).toBeGreaterThan(0);
      expect(response.body.savings).toBeGreaterThan(0);
    });
  });
});