import request from 'supertest';
import { Express } from 'express';
import { prisma } from '../../utils/prisma';
import { redis } from '../../utils/redis';
import app from '../../index';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';

// Mock external dependencies
jest.mock('../../utils/message-queue');

describe('Auth Integration Tests', () => {
  let server: Express;

  beforeAll(() => {
    server = app;
  });

  beforeEach(async () => {
    // Clear database
    await prisma.session.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
    
    // Clear Redis
    await redis.flushall();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('POST /auth/register', () => {
    it('should register a new user', async () => {
      const userData = {
        email: 'newuser@example.com',
        password: 'Test123!@#',
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.CUSTOMER
      };

      const response = await request(server)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.user.email).toBe(userData.email);

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: userData.email },
        include: { profile: true }
      });
      expect(user).toBeTruthy();
      expect(user?.profile?.firstName).toBe(userData.firstName);
    });

    it('should reject duplicate email', async () => {
      // Create existing user
      await prisma.user.create({
        data: {
          email: 'existing@example.com',
          passwordHash: await bcrypt.hash('password', 10),
          role: UserRole.CUSTOMER
        }
      });

      const response = await request(server)
        .post('/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'Test123!@#',
          firstName: 'John',
          lastName: 'Doe',
          role: UserRole.CUSTOMER
        })
        .expect(409);

      expect(response.body.error.message).toBe('User already exists');
    });

    it('should validate password strength', async () => {
      const response = await request(server)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak',
          firstName: 'John',
          lastName: 'Doe',
          role: UserRole.CUSTOMER
        })
        .expect(400);

      expect(response.body.error.message).toBe('Validation failed');
    });
  });

  describe('POST /auth/login', () => {
    let testUser: any;

    beforeEach(async () => {
      // Create test user
      testUser = await prisma.user.create({
        data: {
          email: 'test@example.com',
          passwordHash: await bcrypt.hash('Test123!@#', 10),
          role: UserRole.CUSTOMER,
          emailVerified: true,
          profile: {
            create: {
              firstName: 'Test',
              lastName: 'User'
            }
          }
        },
        include: { profile: true }
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(server)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Test123!@#'
        })
        .expect(200);

      expect(response.body.message).toBe('Login successful');
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.user.id).toBe(testUser.id);
    });

    it('should reject invalid password', async () => {
      const response = await request(server)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword123!'
        })
        .expect(401);

      expect(response.body.error.message).toBe('Invalid credentials');
    });

    it('should reject unverified email', async () => {
      await prisma.user.update({
        where: { id: testUser.id },
        data: { emailVerified: false }
      });

      const response = await request(server)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Test123!@#'
        })
        .expect(403);

      expect(response.body.error.message).toBe('Please verify your email before logging in');
    });

    it('should handle 2FA requirement', async () => {
      await prisma.user.update({
        where: { id: testUser.id },
        data: {
          twoFactorEnabled: true,
          twoFactorSecret: 'test-secret'
        }
      });

      const response = await request(server)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Test123!@#'
        })
        .expect(200);

      expect(response.body.data.requires2FA).toBe(true);
      expect(response.body.data.userId).toBe(testUser.id);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token', async () => {
      // Register and login first
      const registerResponse = await request(server)
        .post('/auth/register')
        .send({
          email: 'refresh@example.com',
          password: 'Test123!@#',
          firstName: 'John',
          lastName: 'Doe',
          role: UserRole.CUSTOMER
        });

      // Mark email as verified
      await prisma.user.update({
        where: { email: 'refresh@example.com' },
        data: { emailVerified: true }
      });

      const loginResponse = await request(server)
        .post('/auth/login')
        .send({
          email: 'refresh@example.com',
          password: 'Test123!@#'
        });

      const { refreshToken } = loginResponse.body.data;

      const response = await request(server)
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.refreshToken).not.toBe(refreshToken);
    });
  });

  describe('Protected routes', () => {
    let accessToken: string;
    let userId: string;

    beforeEach(async () => {
      // Create and login user
      const user = await prisma.user.create({
        data: {
          email: 'protected@example.com',
          passwordHash: await bcrypt.hash('Test123!@#', 10),
          role: UserRole.CUSTOMER,
          emailVerified: true,
          profile: {
            create: {
              firstName: 'Protected',
              lastName: 'User'
            }
          }
        }
      });
      userId = user.id;

      const loginResponse = await request(server)
        .post('/auth/login')
        .send({
          email: 'protected@example.com',
          password: 'Test123!@#'
        });

      accessToken = loginResponse.body.data.accessToken;
    });

    it('should access protected route with valid token', async () => {
      const response = await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.id).toBe(userId);
      expect(response.body.data.email).toBe('protected@example.com');
    });

    it('should reject request without token', async () => {
      await request(server)
        .get('/users/me')
        .expect(401);
    });

    it('should logout successfully', async () => {
      await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Token should be blacklisted
      await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });
});