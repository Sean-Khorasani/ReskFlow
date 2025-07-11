import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { AppError } from '../middleware/error.middleware';

export class UserController {
  private userService = new UserService();

  getCurrentUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.userService.getUserById(req.user!.userId);

      res.json({
        data: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isActive: user.isActive,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          lastLoginAt: user.lastLoginAt,
          profile: user.profile,
          createdAt: user.createdAt
        }
      });
    } catch (error) {
      next(error);
    }
  };

  getUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, limit, role, isActive, search, sortBy, sortOrder } = req.query;

      const result = await this.userService.getUsers(
        {
          role: role as any,
          isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
          search: search as string
        },
        {
          page: Number(page),
          limit: Number(limit),
          sortBy: sortBy as string,
          sortOrder: sortOrder as 'asc' | 'desc'
        }
      );

      res.json({
        data: result.users,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          pages: result.pages
        }
      });
    } catch (error) {
      next(error);
    }
  };

  getUserById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const user = await this.userService.getUserById(userId);

      res.json({
        data: user
      });
    } catch (error) {
      next(error);
    }
  };

  getMySessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessions = await this.userService.getSessions(req.user!.userId);

      res.json({
        data: sessions.map(session => ({
          id: session.id,
          deviceId: session.deviceId,
          deviceInfo: session.deviceInfo,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt
        }))
      });
    } catch (error) {
      next(error);
    }
  };

  revokeMySession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId } = req.params;
      await this.userService.revokeSession(req.user!.userId, sessionId);

      res.json({
        message: 'Session revoked successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  revokeAllMySessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentSessionId = req.headers['x-session-id'] as string;
      await this.userService.revokeAllSessions(req.user!.userId, currentSessionId);

      res.json({
        message: 'All other sessions revoked successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  activateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: true }
      });

      res.json({
        message: 'User activated successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  deactivateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      
      await prisma.user.update({
        where: { id: userId },
        data: { isActive: false }
      });

      await this.userService.revokeAllSessions(userId);

      res.json({
        message: 'User deactivated successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  revokeUserSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      await this.userService.revokeAllSessions(userId);

      res.json({
        message: 'All user sessions revoked successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  deactivateMyAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password, reason } = req.body;
      await this.userService.deactivateAccount(req.user!.userId, password, reason);

      res.json({
        message: 'Account deactivated successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  deleteMyAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password, reason } = req.body;
      await this.userService.deleteAccount(req.user!.userId, password, reason);

      res.json({
        message: 'Account deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  };
}

// Import prisma here to avoid circular dependency
import { prisma } from '../utils/prisma';