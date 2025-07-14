/**
 * User Service
 * Manages user accounts, profiles, and authentication
 */

import { PrismaClient, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { redisClient } from '../../config/redis';
import { emailService } from '../notification/email.service';
import { smsService } from '../notification/sms.service';
import { generateOTP, verifyOTP } from '../../utils/otp';
import { uploadToS3 } from '../../utils/s3';

const prisma = new PrismaClient();

interface UserCreateInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: UserRole;
  walletAddress?: string;
}

interface UserUpdateInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  walletAddress?: string;
  avatar?: string;
  dateOfBirth?: Date;
  preferredLanguage?: string;
  notificationPreferences?: NotificationPreferences;
}

interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  orderUpdates: boolean;
  promotions: boolean;
  newsletter: boolean;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: UserRole;
  avatar?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  addresses: any[];
  paymentMethods: any[];
  notificationPreferences?: NotificationPreferences;
}

class UserService extends EventEmitter {
  private readonly SALT_ROUNDS = 10;
  private readonly ACCESS_TOKEN_EXPIRY = '1h';
  private readonly REFRESH_TOKEN_EXPIRY = '30d';
  private readonly OTP_EXPIRY = 10 * 60; // 10 minutes
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 30 * 60; // 30 minutes

  /**
   * Create a new user
   */
  async createUser(data: UserCreateInput): Promise<User> {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() }
      });

      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, this.SALT_ROUNDS);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: data.email.toLowerCase(),
          password: hashedPassword,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: data.role,
          walletAddress: data.walletAddress,
          emailVerified: false,
          phoneVerified: false,
          isActive: true
        }
      });

      // Send verification email
      await this.sendVerificationEmail(user.id, user.email);

      // Emit user created event
      this.emit('user:created', {
        userId: user.id,
        email: user.email,
        role: user.role
      });

      // Track analytics
      await this.trackEvent('user_signup', {
        userId: user.id,
        role: user.role,
        hasPhone: !!data.phone,
        hasWallet: !!data.walletAddress
      });

      return user;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Authenticate user and generate tokens
   */
  async login(email: string, password: string): Promise<{ user: UserProfile; tokens: AuthTokens }> {
    try {
      // Check login attempts
      const attemptsKey = `login_attempts:${email.toLowerCase()}`;
      const attempts = await redisClient.get(attemptsKey);
      
      if (attempts && parseInt(attempts) >= this.MAX_LOGIN_ATTEMPTS) {
        throw new Error('Account temporarily locked due to too many failed login attempts');
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: {
          addresses: true,
          paymentMethods: {
            where: { isDeleted: false }
          }
        }
      });

      if (!user || !user.isActive) {
        await this.incrementLoginAttempts(email);
        throw new Error('Invalid credentials');
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        await this.incrementLoginAttempts(email);
        throw new Error('Invalid credentials');
      }

      // Clear login attempts
      await redisClient.del(attemptsKey);

      // Generate tokens
      const tokens = await this.generateAuthTokens(user.id);

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // Track login
      await this.trackEvent('user_login', {
        userId: user.id,
        method: 'password'
      });

      // Emit login event
      this.emit('user:logged_in', {
        userId: user.id,
        timestamp: new Date()
      });

      const profile = this.formatUserProfile(user);
      return { user: profile, tokens };
    } catch (error) {
      logger.error('Error during login:', error);
      throw error;
    }
  }

  /**
   * Generate authentication tokens
   */
  async generateAuthTokens(userId: string): Promise<AuthTokens> {
    const payload = { userId, type: 'access' };
    
    const accessToken = jwt.sign(
      payload,
      process.env.JWT_SECRET!,
      { expiresIn: this.ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
      { userId, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: this.REFRESH_TOKEN_EXPIRY }
    );

    // Store refresh token in Redis
    await redisClient.setex(
      `refresh_token:${userId}`,
      30 * 24 * 60 * 60, // 30 days
      refreshToken
    );

    return { accessToken, refreshToken };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as any;
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if token exists in Redis
      const storedToken = await redisClient.get(`refresh_token:${decoded.userId}`);
      if (storedToken !== refreshToken) {
        throw new Error('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = await this.generateAuthTokens(decoded.userId);

      return tokens;
    } catch (error) {
      logger.error('Error refreshing token:', error);
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Logout user
   */
  async logout(userId: string): Promise<void> {
    try {
      // Remove refresh token
      await redisClient.del(`refresh_token:${userId}`);

      // Emit logout event
      this.emit('user:logged_out', {
        userId,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error during logout:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<UserProfile | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          addresses: true,
          paymentMethods: {
            where: { isDeleted: false }
          }
        }
      });

      if (!user) return null;

      return this.formatUserProfile(user);
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: UserUpdateInput): Promise<UserProfile> {
    try {
      // Handle avatar upload if provided
      if (data.avatar) {
        const avatarUrl = await this.uploadAvatar(userId, data.avatar);
        data.avatar = avatarUrl;
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...data,
          updatedAt: new Date()
        },
        include: {
          addresses: true,
          paymentMethods: {
            where: { isDeleted: false }
          }
        }
      });

      // Emit profile updated event
      this.emit('user:profile_updated', {
        userId: user.id,
        changes: Object.keys(data)
      });

      return this.formatUserProfile(user);
    } catch (error) {
      logger.error('Error updating user profile:', error);
      throw error;
    }
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    try {
      const otp = generateOTP();
      
      // Store OTP in Redis
      await redisClient.setex(
        `email_otp:${userId}`,
        this.OTP_EXPIRY,
        otp
      );

      // Send email
      await emailService.sendEmail({
        to: email,
        subject: 'Verify your email address',
        template: 'email-verification',
        data: {
          otp,
          expiryMinutes: this.OTP_EXPIRY / 60
        }
      });

      logger.info(`Verification email sent to ${email}`);
    } catch (error) {
      logger.error('Error sending verification email:', error);
      throw error;
    }
  }

  /**
   * Verify email with OTP
   */
  async verifyEmail(userId: string, otp: string): Promise<boolean> {
    try {
      const storedOTP = await redisClient.get(`email_otp:${userId}`);
      
      if (!storedOTP || storedOTP !== otp) {
        throw new Error('Invalid or expired OTP');
      }

      // Update user
      await prisma.user.update({
        where: { id: userId },
        data: {
          emailVerified: true,
          emailVerifiedAt: new Date()
        }
      });

      // Clear OTP
      await redisClient.del(`email_otp:${userId}`);

      // Emit event
      this.emit('user:email_verified', {
        userId,
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      logger.error('Error verifying email:', error);
      throw error;
    }
  }

  /**
   * Send phone verification SMS
   */
  async sendPhoneVerification(userId: string, phone: string): Promise<void> {
    try {
      const otp = generateOTP();
      
      // Store OTP in Redis
      await redisClient.setex(
        `phone_otp:${userId}`,
        this.OTP_EXPIRY,
        otp
      );

      // Send SMS
      await smsService.sendSMS({
        to: phone,
        message: `Your ReskFlow verification code is: ${otp}. Valid for ${this.OTP_EXPIRY / 60} minutes.`
      });

      logger.info(`Verification SMS sent to ${phone}`);
    } catch (error) {
      logger.error('Error sending phone verification:', error);
      throw error;
    }
  }

  /**
   * Verify phone with OTP
   */
  async verifyPhone(userId: string, otp: string): Promise<boolean> {
    try {
      const storedOTP = await redisClient.get(`phone_otp:${userId}`);
      
      if (!storedOTP || storedOTP !== otp) {
        throw new Error('Invalid or expired OTP');
      }

      // Update user
      await prisma.user.update({
        where: { id: userId },
        data: {
          phoneVerified: true,
          phoneVerifiedAt: new Date()
        }
      });

      // Clear OTP
      await redisClient.del(`phone_otp:${userId}`);

      // Emit event
      this.emit('user:phone_verified', {
        userId,
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      logger.error('Error verifying phone:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!user) {
        // Don't reveal if user exists
        return;
      }

      const resetToken = generateOTP(8);
      
      // Store token in Redis
      await redisClient.setex(
        `password_reset:${user.id}`,
        60 * 60, // 1 hour
        resetToken
      );

      // Send email
      await emailService.sendEmail({
        to: user.email,
        subject: 'Reset your password',
        template: 'password-reset',
        data: {
          firstName: user.firstName,
          resetToken,
          resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${user.email}`
        }
      });

      logger.info(`Password reset email sent to ${email}`);
    } catch (error) {
      logger.error('Error requesting password reset:', error);
      throw error;
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!user) {
        throw new Error('Invalid reset token');
      }

      const storedToken = await redisClient.get(`password_reset:${user.id}`);
      
      if (!storedToken || storedToken !== token) {
        throw new Error('Invalid or expired reset token');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

      // Update password
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          passwordChangedAt: new Date()
        }
      });

      // Clear reset token
      await redisClient.del(`password_reset:${user.id}`);

      // Send confirmation email
      await emailService.sendEmail({
        to: user.email,
        subject: 'Password changed successfully',
        template: 'password-changed',
        data: {
          firstName: user.firstName
        }
      });

      // Emit event
      this.emit('user:password_reset', {
        userId: user.id,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error resetting password:', error);
      throw error;
    }
  }

  /**
   * Change password (authenticated)
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid current password');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          passwordChangedAt: new Date()
        }
      });

      // Invalidate all refresh tokens
      await redisClient.del(`refresh_token:${userId}`);

      // Send notification
      await emailService.sendEmail({
        to: user.email,
        subject: 'Password changed successfully',
        template: 'password-changed',
        data: {
          firstName: user.firstName
        }
      });

      // Emit event
      this.emit('user:password_changed', {
        userId,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error changing password:', error);
      throw error;
    }
  }

  /**
   * Delete user account
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new Error('Invalid password');
      }

      // Soft delete - set isActive to false
      await prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          deletedAt: new Date()
        }
      });

      // Clear all user sessions
      await redisClient.del(`refresh_token:${userId}`);

      // Send confirmation email
      await emailService.sendEmail({
        to: user.email,
        subject: 'Account deleted',
        template: 'account-deleted',
        data: {
          firstName: user.firstName
        }
      });

      // Emit event
      this.emit('user:account_deleted', {
        userId,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Error deleting account:', error);
      throw error;
    }
  }

  /**
   * Search users (admin only)
   */
  async searchUsers(params: {
    query?: string;
    role?: UserRole;
    isActive?: boolean;
    emailVerified?: boolean;
    limit?: number;
    offset?: number;
  }) {
    try {
      const { query, role, isActive, emailVerified, limit = 20, offset = 0 } = params;

      const where: any = {};

      if (query) {
        where.OR = [
          { email: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } }
        ];
      }

      if (role) where.role = role;
      if (isActive !== undefined) where.isActive = isActive;
      if (emailVerified !== undefined) where.emailVerified = emailVerified;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count({ where })
      ]);

      return {
        users: users.map(user => this.formatUserProfile(user)),
        total,
        limit,
        offset
      };
    } catch (error) {
      logger.error('Error searching users:', error);
      throw error;
    }
  }

  /**
   * Get user statistics (admin only)
   */
  async getUserStatistics() {
    try {
      const [
        totalUsers,
        activeUsers,
        verifiedUsers,
        usersByRole,
        recentSignups
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ where: { emailVerified: true } }),
        prisma.user.groupBy({
          by: ['role'],
          _count: true
        }),
        prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
            }
          }
        })
      ]);

      return {
        totalUsers,
        activeUsers,
        verifiedUsers,
        usersByRole: usersByRole.reduce((acc, curr) => {
          acc[curr.role] = curr._count;
          return acc;
        }, {} as Record<UserRole, number>),
        recentSignups,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error getting user statistics:', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private async incrementLoginAttempts(email: string): Promise<void> {
    const key = `login_attempts:${email.toLowerCase()}`;
    const current = await redisClient.get(key);
    const attempts = current ? parseInt(current) + 1 : 1;
    
    await redisClient.setex(key, this.LOCKOUT_DURATION, attempts.toString());
  }

  private formatUserProfile(user: any): UserProfile {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      avatar: user.avatar,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      addresses: user.addresses || [],
      paymentMethods: user.paymentMethods || [],
      notificationPreferences: user.notificationPreferences
    };
  }

  private async uploadAvatar(userId: string, base64Data: string): Promise<string> {
    const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const key = `avatars/${userId}/${Date.now()}.jpg`;
    
    const url = await uploadToS3({
      key,
      buffer,
      contentType: 'image/jpeg'
    });

    return url;
  }

  private async trackEvent(event: string, data: any): Promise<void> {
    try {
      // Send to analytics service
      await redisClient.publish('analytics:events', JSON.stringify({
        event,
        data,
        timestamp: new Date()
      }));
    } catch (error) {
      logger.error('Error tracking event:', error);
    }
  }
}

export const userService = new UserService();