import { AuthService } from '../auth.service';
import { prisma } from '../../utils/prisma';
import { redis } from '../../utils/redis';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';

// Mock dependencies
jest.mock('../../utils/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    session: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    },
    $transaction: jest.fn()
  }
}));

jest.mock('../../utils/redis', () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn()
  },
  cacheKeys: {
    userById: jest.fn(id => `user:${id}`),
    loginAttempts: jest.fn(email => `login:attempts:${email}`),
    twoFactorTemp: jest.fn(id => `2fa:temp:${id}`),
    passwordReset: jest.fn(token => `password:reset:${token}`)
  },
  cacheTTL: {
    user: 3600,
    loginAttempts: 900,
    twoFactorTemp: 300,
    passwordReset: 3600
  }
}));

jest.mock('bcryptjs');
jest.mock('../../utils/message-queue');

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const registerData = {
        email: 'test@example.com',
        password: 'Test123!@#',
        role: UserRole.CUSTOMER,
        firstName: 'John',
        lastName: 'Doe'
      };

      const mockUser = {
        id: 'user-123',
        email: registerData.email,
        role: registerData.role,
        passwordHash: 'hashed-password',
        profile: {
          firstName: registerData.firstName,
          lastName: registerData.lastName
        }
      };

      const mockSession = {
        id: 'session-123',
        userId: mockUser.id,
        token: 'token-123',
        refreshToken: 'refresh-123'
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      (prisma.$transaction as jest.Mock).mockResolvedValue({
        user: mockUser,
        session: mockSession
      });

      const result = await authService.register(registerData);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(registerData.email);
    });

    it('should throw error if user already exists', async () => {
      const registerData = {
        email: 'existing@example.com',
        password: 'Test123!@#',
        role: UserRole.CUSTOMER,
        firstName: 'John',
        lastName: 'Doe'
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-user' });

      await expect(authService.register(registerData)).rejects.toThrow('User already exists');
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'Test123!@#'
      };

      const mockUser = {
        id: 'user-123',
        email: loginData.email,
        passwordHash: 'hashed-password',
        isActive: true,
        emailVerified: true,
        twoFactorEnabled: false,
        profile: {}
      };

      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.session.create as jest.Mock).mockResolvedValue({
        id: 'session-123',
        userId: mockUser.id
      });

      const result = await authService.login(loginData);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(redis.del).toHaveBeenCalled();
    });

    it('should handle 2FA requirement', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'Test123!@#'
      };

      const mockUser = {
        id: 'user-123',
        email: loginData.email,
        passwordHash: 'hashed-password',
        isActive: true,
        emailVerified: true,
        twoFactorEnabled: true,
        profile: {}
      };

      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.login(loginData);

      expect(result).toHaveProperty('requires2FA', true);
      expect(redis.setex).toHaveBeenCalled();
    });

    it('should throw error for invalid credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrong-password'
      };

      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        passwordHash: 'hashed-password'
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(authService.login(loginData)).rejects.toThrow('Invalid credentials');
      expect(redis.incr).toHaveBeenCalled();
    });
  });
});