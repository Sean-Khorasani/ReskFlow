import request from 'supertest';
import { Express } from 'express';
import app from '../../index';
import { prisma } from '../../utils/prisma';
import { redis } from '../../utils/redis';
import { UserRole } from '@prisma/client';

// Mock external services
jest.mock('../../utils/message-queue');

describe('User Journey E2E Tests', () => {
  let server: Express;
  let userEmail: string;
  let userPassword: string;
  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  beforeAll(() => {
    server = app;
    userEmail = `test-${Date.now()}@example.com`;
    userPassword = 'Test123!@#';
  });

  beforeEach(async () => {
    // Clear test data
    await redis.flushall();
  });

  afterAll(async () => {
    // Cleanup
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.address.deleteMany({ where: { userId } });
      await prisma.userProfile.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('Complete User Journey', () => {
    it('1. Should register a new user', async () => {
      const response = await request(server)
        .post('/auth/register')
        .send({
          email: userEmail,
          password: userPassword,
          firstName: 'John',
          lastName: 'Doe',
          role: UserRole.CUSTOMER
        })
        .expect(201);

      expect(response.body.message).toContain('Registration successful');
      expect(response.body.data.user.email).toBe(userEmail);
      
      userId = response.body.data.user.id;
      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('2. Should verify email (simulated)', async () => {
      // Simulate email verification
      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true }
      });

      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      expect(user?.emailVerified).toBe(true);
    });

    it('3. Should login with verified account', async () => {
      const response = await request(server)
        .post('/auth/login')
        .send({
          email: userEmail,
          password: userPassword
        })
        .expect(200);

      expect(response.body.message).toBe('Login successful');
      expect(response.body.data.accessToken).toBeTruthy();
      
      // Update tokens for subsequent requests
      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('4. Should get user profile', async () => {
      const response = await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.email).toBe(userEmail);
      expect(response.body.data.profile).toBeTruthy();
    });

    it('5. Should update user profile', async () => {
      const response = await request(server)
        .patch('/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          phone: '+1234567890',
          preferences: {
            notifications: true,
            newsletter: false,
            language: 'en'
          },
          dietary: {
            vegetarian: true,
            glutenFree: false
          }
        })
        .expect(200);

      expect(response.body.message).toBe('Profile updated successfully');
    });

    it('6. Should add an address', async () => {
      const response = await request(server)
        .post('/addresses')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'HOME',
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'US',
          latitude: 40.7128,
          longitude: -74.0060,
          isDefault: true
        })
        .expect(201);

      expect(response.body.message).toBe('Address created successfully');
      expect(response.body.data.isDefault).toBe(true);
    });

    it('7. Should get all addresses', async () => {
      const response = await request(server)
        .get('/addresses')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('8. Should refresh access token', async () => {
      // Wait a bit to ensure token timestamps differ
      await new Promise(resolve => setTimeout(resolve, 1000));

      const response = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.data.accessToken).toBeTruthy();
      expect(response.body.data.accessToken).not.toBe(accessToken);
      
      // Update token for next requests
      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;
    });

    it('9. Should change password', async () => {
      const newPassword = 'NewTest123!@#';
      
      await request(server)
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: userPassword,
          newPassword: newPassword
        })
        .expect(200);

      // Should be able to login with new password
      const loginResponse = await request(server)
        .post('/auth/login')
        .send({
          email: userEmail,
          password: newPassword
        })
        .expect(200);

      expect(loginResponse.body.data.accessToken).toBeTruthy();
      
      // Update password for cleanup
      userPassword = newPassword;
    });

    it('10. Should setup 2FA', async () => {
      const setupResponse = await request(server)
        .get('/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(setupResponse.body.data.secret).toBeTruthy();
      expect(setupResponse.body.data.qrCode).toBeTruthy();
    });

    it('11. Should get active sessions', async () => {
      const response = await request(server)
        .get('/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('12. Should logout from all sessions', async () => {
      await request(server)
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Previous token should no longer work
      await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  describe('Error Scenarios', () => {
    it('Should handle rate limiting', async () => {
      // Make multiple failed login attempts
      for (let i = 0; i < 6; i++) {
        await request(server)
          .post('/auth/login')
          .send({
            email: 'nonexistent@example.com',
            password: 'wrongpassword'
          });
      }

      // Should be rate limited
      const response = await request(server)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        })
        .expect(429);

      expect(response.body.error.message).toContain('Too many');
    });

    it('Should validate input data', async () => {
      const response = await request(server)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'weak',
          firstName: 'J',
          lastName: ''
        })
        .expect(400);

      expect(response.body.error.message).toBe('Validation failed');
    });
  });
});