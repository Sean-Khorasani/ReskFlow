import bcrypt from 'bcryptjs';
import { User, UserProfile, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { redis, cacheKeys, cacheTTL } from '../utils/redis';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import { MessageQueue } from '../utils/message-queue';

interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  phone?: string;
  preferences?: any;
  dietary?: any;
}

interface UserFilter {
  role?: UserRole;
  isActive?: boolean;
  search?: string;
}

interface PaginationOptions {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export class UserService {
  private messageQueue = MessageQueue.getInstance();

  async getUserById(userId: string): Promise<User & { profile: UserProfile | null }> {
    // Check cache first
    const cached = await redis.get(cacheKeys.userById(userId));
    if (cached) {
      return JSON.parse(cached);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Cache user data
    await redis.setex(
      cacheKeys.userById(userId),
      cacheTTL.user,
      JSON.stringify(user)
    );

    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    // Check cache first
    const cached = await redis.get(cacheKeys.userByEmail(email));
    if (cached) {
      return JSON.parse(cached);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    });

    if (user) {
      // Cache user data
      await redis.setex(
        cacheKeys.userByEmail(email),
        cacheTTL.user,
        JSON.stringify(user)
      );
    }

    return user;
  }

  async getUsers(
    filter: UserFilter,
    pagination: PaginationOptions
  ): Promise<{ users: User[]; total: number; pages: number }> {
    const { page, limit, sortBy, sortOrder } = pagination;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.UserWhereInput = {};
    
    if (filter.role) {
      where.role = filter.role;
    }
    
    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }
    
    if (filter.search) {
      where.OR = [
        { email: { contains: filter.search, mode: 'insensitive' } },
        { phone: { contains: filter.search, mode: 'insensitive' } },
        {
          profile: {
            OR: [
              { firstName: { contains: filter.search, mode: 'insensitive' } },
              { lastName: { contains: filter.search, mode: 'insensitive' } }
            ]
          }
        }
      ];
    }

    // Execute query
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { profile: true },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.user.count({ where })
    ]);

    return {
      users,
      total,
      pages: Math.ceil(total / limit)
    };
  }

  async updateProfile(userId: string, data: UpdateProfileData): Promise<UserProfile> {
    // Validate phone number if provided
    if (data.phone) {
      const existingUser = await prisma.user.findFirst({
        where: {
          phone: data.phone,
          id: { not: userId }
        }
      });

      if (existingUser) {
        throw new AppError(409, 'Phone number already in use');
      }
    }

    // Update user and profile in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update phone if provided
      if (data.phone) {
        await tx.user.update({
          where: { id: userId },
          data: { phone: data.phone }
        });
      }

      // Update or create profile
      const profile = await tx.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          dateOfBirth: data.dateOfBirth,
          preferences: data.preferences,
          dietary: data.dietary
        },
        update: {
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: data.dateOfBirth,
          preferences: data.preferences,
          dietary: data.dietary
        }
      });

      return profile;
    });

    // Clear cache
    await redis.del(cacheKeys.userById(userId));

    // Publish event
    await this.messageQueue.publishEvent({
      type: 'USER_UPDATED',
      userId,
      data: { fields: Object.keys(data) },
      timestamp: new Date()
    });

    logger.info(`Profile updated for user: ${userId}`);

    return result;
  }

  async updateEmail(userId: string, newEmail: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, 'Invalid password');
    }

    // Check if email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email: newEmail }
    });

    if (existingUser) {
      throw new AppError(409, 'Email already in use');
    }

    // Update email
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: newEmail,
        emailVerified: false
      }
    });

    // Clear cache
    await redis.del(cacheKeys.userById(userId));
    await redis.del(cacheKeys.userByEmail(user.email));

    // Send verification email
    await this.messageQueue.publishEvent({
      type: 'EMAIL_CHANGED',
      userId,
      data: {
        oldEmail: user.email,
        newEmail
      },
      timestamp: new Date()
    });

    logger.info(`Email updated for user: ${userId}`);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, 'Invalid current password');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    // Invalidate all sessions except current
    await prisma.session.deleteMany({
      where: {
        userId,
        id: { not: undefined } // This will be replaced with current session ID
      }
    });

    // Clear cache
    await redis.del(cacheKeys.userById(userId));

    // Publish event
    await this.messageQueue.publishEvent({
      type: 'PASSWORD_CHANGED',
      userId,
      data: { reason: 'user_request' },
      timestamp: new Date()
    });

    logger.info(`Password changed for user: ${userId}`);
  }

  async deactivateAccount(userId: string, password: string, reason?: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, 'Invalid password');
    }

    // Deactivate account
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false }
    });

    // Invalidate all sessions
    await prisma.session.deleteMany({
      where: { userId }
    });

    // Clear cache
    await redis.del(cacheKeys.userById(userId));
    await redis.del(cacheKeys.userByEmail(user.email));

    // Publish event
    await this.messageQueue.publishEvent({
      type: 'USER_DEACTIVATED',
      userId,
      data: { reason },
      timestamp: new Date()
    });

    logger.info(`Account deactivated for user: ${userId}`);
  }

  async deleteAccount(userId: string, password: string, reason?: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, 'Invalid password');
    }

    // Soft delete - anonymize user data
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@deleted.com`,
        phone: null,
        passwordHash: '',
        isActive: false,
        emailVerified: false,
        phoneVerified: false,
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    });

    // Delete profile
    await prisma.userProfile.deleteMany({
      where: { userId }
    });

    // Delete all sessions
    await prisma.session.deleteMany({
      where: { userId }
    });

    // Clear all cache
    await redis.del(cacheKeys.userById(userId));
    await redis.del(cacheKeys.userByEmail(user.email));
    await redis.del(cacheKeys.userSessions(userId));

    // Publish event
    await this.messageQueue.publishEvent({
      type: 'USER_DELETED',
      userId,
      data: { reason },
      timestamp: new Date()
    });

    logger.info(`Account deleted for user: ${userId}`);
  }

  async getSessions(userId: string): Promise<Session[]> {
    return prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        userId
      }
    });

    if (!session) {
      throw new AppError(404, 'Session not found');
    }

    await prisma.session.delete({
      where: { id: sessionId }
    });

    // Blacklist the tokens
    if (session.token) {
      await redis.setex(`blacklist:${session.token}`, 86400, '1');
    }

    logger.info(`Session revoked: ${sessionId} for user: ${userId}`);
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    const sessions = await prisma.session.findMany({
      where: {
        userId,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {})
      }
    });

    // Blacklist all tokens
    for (const session of sessions) {
      if (session.token) {
        await redis.setex(`blacklist:${session.token}`, 86400, '1');
      }
    }

    // Delete sessions
    await prisma.session.deleteMany({
      where: {
        userId,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {})
      }
    });

    logger.info(`All sessions revoked for user: ${userId}`);
  }
}