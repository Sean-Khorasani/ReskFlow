import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { User, UserProfile, Session, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { redis, cacheKeys, cacheTTL } from '../utils/redis';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import { MessageQueue } from '../utils/message-queue';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  verifyEmailToken,
  verifyPasswordResetToken
} from '../utils/jwt';
import { config } from '../config';

interface RegisterData {
  email: string;
  password: string;
  phone?: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
}

interface LoginData {
  email: string;
  password: string;
  deviceId?: string;
  deviceInfo?: any;
  ipAddress?: string;
  userAgent?: string;
}

interface AuthResponse {
  user: User & { profile: UserProfile | null };
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export class AuthService {
  private messageQueue = MessageQueue.getInstance();

  async register(data: RegisterData): Promise<AuthResponse> {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          ...(data.phone ? [{ phone: data.phone }] : [])
        ]
      }
    });

    if (existingUser) {
      throw new AppError(409, 'User already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 12);

    // Create user and profile in transaction
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          passwordHash,
          role: data.role,
          profile: {
            create: {
              firstName: data.firstName,
              lastName: data.lastName,
              dateOfBirth: data.dateOfBirth
            }
          }
        },
        include: { profile: true }
      });

      // Create session
      const session = await tx.session.create({
        data: {
          userId: user.id,
          token: nanoid(32),
          refreshToken: nanoid(64),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      });

      return { user, session };
    });

    // Generate tokens
    const accessToken = generateAccessToken(result.user);
    const refreshToken = generateRefreshToken(result.user, result.session.id);

    // Update session with JWT refresh token
    await prisma.session.update({
      where: { id: result.session.id },
      data: { refreshToken }
    });

    // Cache user data
    await redis.setex(
      cacheKeys.userById(result.user.id),
      cacheTTL.user,
      JSON.stringify(result.user)
    );

    // Send verification email
    const verificationToken = generateEmailVerificationToken(result.user.id, result.user.email);
    await this.messageQueue.publishEvent({
      type: 'USER_CREATED',
      userId: result.user.id,
      data: {
        email: result.user.email,
        verificationToken,
        firstName: data.firstName
      },
      timestamp: new Date()
    });

    logger.info(`New user registered: ${result.user.email}`);

    return {
      user: result.user,
      accessToken,
      refreshToken,
      sessionId: result.session.id
    };
  }

  async login(data: LoginData): Promise<AuthResponse> {
    // Check login attempts
    const attemptsKey = cacheKeys.loginAttempts(data.email);
    const attempts = await redis.get(attemptsKey);
    if (attempts && parseInt(attempts) >= 5) {
      throw new AppError(429, 'Too many login attempts. Please try again later.');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { profile: true }
    });

    if (!user || !await bcrypt.compare(data.password, user.passwordHash)) {
      // Increment login attempts
      await redis.incr(attemptsKey);
      await redis.expire(attemptsKey, cacheTTL.loginAttempts);
      throw new AppError(401, 'Invalid credentials');
    }

    // Clear login attempts
    await redis.del(attemptsKey);

    // Check if user is active
    if (!user.isActive) {
      throw new AppError(403, 'Account is deactivated');
    }

    // Check if email is verified
    if (!user.emailVerified) {
      throw new AppError(403, 'Please verify your email before logging in');
    }

    // Check 2FA
    if (user.twoFactorEnabled) {
      // Store temporary auth data
      const tempKey = cacheKeys.twoFactorTemp(user.id);
      await redis.setex(tempKey, cacheTTL.twoFactorTemp, JSON.stringify({
        userId: user.id,
        deviceId: data.deviceId,
        deviceInfo: data.deviceInfo,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
      }));

      return {
        user,
        accessToken: '',
        refreshToken: '',
        sessionId: '',
        requires2FA: true
      } as any;
    }

    // Create session
    const session = await this.createSession(user, data);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, session.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Cache user data
    await redis.setex(
      cacheKeys.userById(user.id),
      cacheTTL.user,
      JSON.stringify(user)
    );

    // Publish login event
    await this.messageQueue.publishEvent({
      type: 'LOGIN',
      userId: user.id,
      data: {
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        deviceId: data.deviceId
      },
      timestamp: new Date()
    });

    logger.info(`User logged in: ${user.email}`);

    return {
      user,
      accessToken,
      refreshToken,
      sessionId: session.id
    };
  }

  async verify2FA(userId: string, token: string): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user || !user.twoFactorSecret) {
      throw new AppError(404, 'User not found');
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      throw new AppError(401, 'Invalid 2FA token');
    }

    // Get temporary auth data
    const tempKey = cacheKeys.twoFactorTemp(userId);
    const tempData = await redis.get(tempKey);
    if (!tempData) {
      throw new AppError(401, 'Authentication session expired');
    }

    const authData = JSON.parse(tempData);
    await redis.del(tempKey);

    // Create session
    const session = await this.createSession(user, authData);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, session.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    logger.info(`User logged in with 2FA: ${user.email}`);

    return {
      user,
      accessToken,
      refreshToken,
      sessionId: session.id
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);

    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true }
    });

    if (!session || session.refreshToken !== refreshToken) {
      throw new AppError(401, 'Invalid refresh token');
    }

    if (session.expiresAt < new Date()) {
      throw new AppError(401, 'Session expired');
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(session.user);
    const newRefreshToken = generateRefreshToken(session.user, session.id);

    // Update session
    await prisma.session.update({
      where: { id: session.id },
      data: { refreshToken: newRefreshToken }
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }

  async logout(userId: string, accessToken: string, sessionId?: string): Promise<void> {
    // Blacklist current access token
    await redis.setex(`blacklist:${accessToken}`, 86400, '1'); // 24 hours

    if (sessionId) {
      // Delete specific session
      await prisma.session.delete({
        where: {
          id: sessionId,
          userId
        }
      });
    } else {
      // Delete all sessions
      await prisma.session.deleteMany({
        where: { userId }
      });
    }

    // Clear user cache
    await redis.del(cacheKeys.userById(userId));
    await redis.del(cacheKeys.userSessions(userId));

    // Publish logout event
    await this.messageQueue.publishEvent({
      type: 'LOGOUT',
      userId,
      data: { sessionId },
      timestamp: new Date()
    });

    logger.info(`User logged out: ${userId}`);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // Don't reveal if user exists
      return;
    }

    const resetToken = generatePasswordResetToken(user.id, user.email);
    
    // Store token in cache
    await redis.setex(
      cacheKeys.passwordReset(resetToken),
      cacheTTL.passwordReset,
      user.id
    );

    // Send reset email
    await this.messageQueue.publishEvent({
      type: 'PASSWORD_RESET_REQUESTED',
      userId: user.id,
      data: {
        email: user.email,
        resetToken
      },
      timestamp: new Date()
    });

    logger.info(`Password reset requested for: ${email}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId } = verifyPasswordResetToken(token);

    // Check if token is still valid in cache
    const cachedUserId = await redis.get(cacheKeys.passwordReset(token));
    if (!cachedUserId || cachedUserId !== userId) {
      throw new AppError(401, 'Invalid or expired reset token');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    // Invalidate all sessions
    await prisma.session.deleteMany({
      where: { userId }
    });

    // Delete reset token
    await redis.del(cacheKeys.passwordReset(token));

    // Clear user cache
    await redis.del(cacheKeys.userById(userId));

    // Publish event
    await this.messageQueue.publishEvent({
      type: 'PASSWORD_CHANGED',
      userId,
      data: { reason: 'reset' },
      timestamp: new Date()
    });

    logger.info(`Password reset completed for user: ${userId}`);
  }

  async verifyEmail(token: string): Promise<void> {
    const { userId, email } = verifyEmailToken(token);

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || user.email !== email) {
      throw new AppError(400, 'Invalid verification token');
    }

    if (user.emailVerified) {
      throw new AppError(400, 'Email already verified');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true }
    });

    // Clear cache
    await redis.del(cacheKeys.userById(userId));

    // Publish event
    await this.messageQueue.publishEvent({
      type: 'USER_VERIFIED',
      userId,
      data: { email },
      timestamp: new Date()
    });

    logger.info(`Email verified for user: ${email}`);
  }

  async setup2FA(userId: string): Promise<{ secret: string; qrCode: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    if (user.twoFactorEnabled) {
      throw new AppError(400, '2FA is already enabled');
    }

    const secret = speakeasy.generateSecret({
      name: `${config.twoFactor.appName} (${user.email})`
    });

    // Store secret temporarily
    await redis.setex(
      `2fa:setup:${userId}`,
      300, // 5 minutes
      secret.base32
    );

    const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCode
    };
  }

  async enable2FA(userId: string, token: string): Promise<void> {
    const tempSecret = await redis.get(`2fa:setup:${userId}`);
    if (!tempSecret) {
      throw new AppError(400, '2FA setup expired. Please start again.');
    }

    const verified = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      throw new AppError(401, 'Invalid 2FA token');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: tempSecret
      }
    });

    await redis.del(`2fa:setup:${userId}`);
    await redis.del(cacheKeys.userById(userId));

    logger.info(`2FA enabled for user: ${userId}`);
  }

  async disable2FA(userId: string, token: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.twoFactorSecret) {
      throw new AppError(404, 'User not found');
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      throw new AppError(401, 'Invalid 2FA token');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    });

    await redis.del(cacheKeys.userById(userId));

    logger.info(`2FA disabled for user: ${userId}`);
  }

  private async createSession(user: User, data: LoginData): Promise<Session> {
    return prisma.session.create({
      data: {
        userId: user.id,
        token: nanoid(32),
        refreshToken: nanoid(64),
        deviceId: data.deviceId,
        deviceInfo: data.deviceInfo,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    });
  }
}