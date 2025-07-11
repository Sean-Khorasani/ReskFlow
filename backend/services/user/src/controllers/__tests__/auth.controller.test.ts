import { Request, Response, NextFunction } from 'express';
import { AuthController } from '../auth.controller';
import { AuthService } from '../../services/auth.service';
import { UserRole } from '@prisma/client';

// Mock the auth service
jest.mock('../../services/auth.service');

describe('AuthController', () => {
  let authController: AuthController;
  let mockAuthService: jest.Mocked<AuthService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    authController = new AuthController();
    mockAuthService = (authController as any).authService;

    mockRequest = {
      body: {},
      params: {},
      headers: {},
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-user-agent')
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();
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

      const mockResult = {
        user: {
          id: 'user-123',
          email: registerData.email,
          role: registerData.role,
          profile: {
            firstName: registerData.firstName,
            lastName: registerData.lastName
          }
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        sessionId: 'session-123'
      };

      mockRequest.body = registerData;
      mockAuthService.register.mockResolvedValue(mockResult as any);

      await authController.register(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockAuthService.register).toHaveBeenCalledWith(registerData);
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Registration successful. Please check your email to verify your account.',
        data: expect.objectContaining({
          user: expect.objectContaining({
            id: mockResult.user.id,
            email: mockResult.user.email
          }),
          accessToken: mockResult.accessToken,
          refreshToken: mockResult.refreshToken
        })
      });
    });

    it('should handle registration errors', async () => {
      const error = new Error('User already exists');
      mockAuthService.register.mockRejectedValue(error);

      await authController.register(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'Test123!@#'
      };

      const mockResult = {
        user: {
          id: 'user-123',
          email: loginData.email,
          role: UserRole.CUSTOMER,
          profile: {}
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        sessionId: 'session-123'
      };

      mockRequest.body = loginData;
      mockAuthService.login.mockResolvedValue(mockResult as any);

      await authController.login(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockAuthService.login).toHaveBeenCalledWith({
        ...loginData,
        ipAddress: '127.0.0.1',
        userAgent: 'test-user-agent'
      });
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Login successful',
        data: expect.objectContaining({
          accessToken: mockResult.accessToken,
          refreshToken: mockResult.refreshToken
        })
      });
    });

    it('should handle 2FA requirement', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'Test123!@#'
      };

      const mockResult = {
        user: { id: 'user-123' },
        requires2FA: true
      };

      mockRequest.body = loginData;
      mockAuthService.login.mockResolvedValue(mockResult as any);

      await authController.login(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        message: '2FA verification required',
        data: {
          userId: 'user-123',
          requires2FA: true
        }
      });
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      mockRequest.user = { userId: 'user-123', email: 'test@example.com', role: 'CUSTOMER' };
      mockRequest.headers = {
        authorization: 'Bearer access-token',
        'x-session-id': 'session-123'
      };

      mockAuthService.logout.mockResolvedValue();

      await authController.logout(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockAuthService.logout).toHaveBeenCalledWith(
        'user-123',
        'access-token',
        'session-123'
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Logged out successfully'
      });
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const refreshToken = 'old-refresh-token';
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token'
      };

      mockRequest.body = { refreshToken };
      mockAuthService.refreshAccessToken.mockResolvedValue(mockResult);

      await authController.refreshToken(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith(refreshToken);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'Token refreshed successfully',
        data: mockResult
      });
    });
  });
});