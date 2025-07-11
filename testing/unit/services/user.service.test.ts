/**
 * User Service Unit Tests
 */

import { UserService } from '../../../backend/src/services/user/user.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { generateUser, generateEmail } from '../../utils/test-data-generator';

// Mock dependencies
jest.mock('@prisma/client');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('ioredis');

describe('UserService', () => {
  let userService: UserService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock Prisma
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      }
    };

    // Mock Redis
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      expire: jest.fn()
    };

    // Mock EventEmitter
    mockEventEmitter = {
      emit: jest.fn()
    };

    // Initialize service with mocks
    userService = new UserService();
    (userService as any).prisma = mockPrisma;
    (userService as any).redis = mockRedis;
    (userService as any).eventEmitter = mockEventEmitter;
  });

  describe('createUser', () => {
    it('should create a new user successfully', async () => {
      const userData = generateUser();
      const hashedPassword = 'hashed_password';
      const createdUser = { id: '123', ...userData, password: hashedPassword };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockPrisma.user.create.mockResolvedValue(createdUser);

      const result = await userService.createUser(userData);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: userData.email.toLowerCase() }
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(userData.password, expect.any(Number));
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: userData.email.toLowerCase(),
          password: hashedPassword
        })
      });
      expect(result).toEqual(createdUser);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.created', createdUser);
    });

    it('should throw error if user already exists', async () => {
      const userData = generateUser();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(userService.createUser(userData)).rejects.toThrow('User already exists');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should validate email format', async () => {
      const userData = { ...generateUser(), email: 'invalid-email' };

      await expect(userService.createUser(userData)).rejects.toThrow('Invalid email format');
    });
  });

  describe('login', () => {
    it('should login user with valid credentials', async () => {
      const email = generateEmail();
      const password = 'Test123!';
      const user = {
        id: '123',
        email,
        password: 'hashed_password',
        isActive: true,
        emailVerified: true
      };
      const tokens = {
        accessToken: 'access_token',
        refreshToken: 'refresh_token'
      };

      mockPrisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwt.sign as jest.Mock).mockReturnValue(tokens.accessToken);
      jest.spyOn(userService as any, 'generateRefreshToken').mockResolvedValue(tokens.refreshToken);

      const result = await userService.login(email, password);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: email.toLowerCase() }
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(password, user.password);
      expect(result).toEqual(expect.objectContaining({
        user: expect.objectContaining({ id: user.id }),
        tokens
      }));
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.login', expect.any(Object));
    });

    it('should throw error for invalid credentials', async () => {
      const email = generateEmail();
      const password = 'wrong_password';

      mockPrisma.user.findUnique.mockResolvedValue({
        id: '123',
        password: 'hashed_password'
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(userService.login(email, password)).rejects.toThrow('Invalid credentials');
    });

    it('should throw error for inactive user', async () => {
      const email = generateEmail();
      const password = 'Test123!';

      mockPrisma.user.findUnique.mockResolvedValue({
        id: '123',
        password: 'hashed_password',
        isActive: false
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(userService.login(email, password)).rejects.toThrow('Account is disabled');
    });

    it('should track failed login attempts', async () => {
      const email = generateEmail();
      const password = 'wrong_password';

      mockPrisma.user.findUnique.mockResolvedValue({
        id: '123',
        password: 'hashed_password',
        isActive: true
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      mockRedis.get.mockResolvedValue('4'); // 4 previous attempts

      await expect(userService.login(email, password)).rejects.toThrow('Invalid credentials');
      
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('login_attempts'),
        '5',
        'EX',
        expect.any(Number)
      );
    });

    it('should block login after max attempts', async () => {
      const email = generateEmail();
      const password = 'any_password';

      mockRedis.get.mockResolvedValue('5'); // Max attempts reached

      await expect(userService.login(email, password)).rejects.toThrow('Account temporarily locked');
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('should update user profile successfully', async () => {
      const userId = '123';
      const updates = {
        firstName: 'Updated',
        lastName: 'Name',
        phone: '+1234567890'
      };
      const updatedUser = { id: userId, ...updates };

      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await userService.updateProfile(userId, updates);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: updates
      });
      expect(result).toEqual(updatedUser);
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining(userId));
    });

    it('should not allow email update without verification', async () => {
      const userId = '123';
      const updates = { email: 'new@example.com' };

      await expect(userService.updateProfile(userId, updates)).rejects.toThrow(
        'Email cannot be updated directly'
      );
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      const userId = '123';
      const token = 'valid_token';
      const email = generateEmail();

      mockRedis.get.mockResolvedValue(JSON.stringify({ userId, email }));
      mockPrisma.user.update.mockResolvedValue({ id: userId, email, emailVerified: true });

      const result = await userService.verifyEmail(token);

      expect(mockRedis.get).toHaveBeenCalledWith(`email_verification:${token}`);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { email, emailVerified: true }
      });
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith(`email_verification:${token}`);
    });

    it('should throw error for invalid token', async () => {
      const token = 'invalid_token';
      mockRedis.get.mockResolvedValue(null);

      await expect(userService.verifyEmail(token)).rejects.toThrow('Invalid or expired token');
    });
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      const userId = '123';
      const currentPassword = 'OldPass123!';
      const newPassword = 'NewPass123!';
      const user = {
        id: userId,
        password: 'hashed_old_password'
      };

      mockPrisma.user.findUnique.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_new_password');
      mockPrisma.user.update.mockResolvedValue({ ...user, password: 'hashed_new_password' });

      await userService.changePassword(userId, currentPassword, newPassword);

      expect(bcrypt.compare).toHaveBeenCalledWith(currentPassword, user.password);
      expect(bcrypt.hash).toHaveBeenCalledWith(newPassword, expect.any(Number));
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { password: 'hashed_new_password' }
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.password.changed', { userId });
    });

    it('should validate password strength', async () => {
      const userId = '123';
      const currentPassword = 'OldPass123!';
      const weakPassword = '123456';

      await expect(
        userService.changePassword(userId, currentPassword, weakPassword)
      ).rejects.toThrow('Password does not meet requirements');
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user', async () => {
      const userId = '123';
      const deletedUser = {
        id: userId,
        isActive: false,
        deletedAt: new Date()
      };

      mockPrisma.user.update.mockResolvedValue(deletedUser);

      const result = await userService.deleteUser(userId);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          isActive: false,
          deletedAt: expect.any(Date)
        }
      });
      expect(result).toEqual(deletedUser);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('user.deleted', { userId });
    });
  });

  describe('getUserByEmail', () => {
    it('should get user by email', async () => {
      const email = generateEmail();
      const user = { id: '123', email };

      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await userService.getUserByEmail(email);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: email.toLowerCase() }
      });
      expect(result).toEqual(user);
    });

    it('should use cache for subsequent requests', async () => {
      const email = generateEmail();
      const user = { id: '123', email };

      mockRedis.get.mockResolvedValue(JSON.stringify(user));

      const result = await userService.getUserByEmail(email);

      expect(mockRedis.get).toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(user);
    });
  });
});