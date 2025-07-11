import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { prisma } from '../utils/prisma';

export class SessionController {
  private userService = new UserService();

  getSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
          expiresAt: session.expiresAt,
          isCurrent: session.id === req.headers['x-session-id']
        }))
      });
    } catch (error) {
      next(error);
    }
  };

  getCurrentSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.headers['x-session-id'] as string;
      
      if (!sessionId) {
        res.json({ data: null });
        return;
      }

      const session = await prisma.session.findFirst({
        where: {
          id: sessionId,
          userId: req.user!.userId
        }
      });

      if (!session) {
        res.json({ data: null });
        return;
      }

      res.json({
        data: {
          id: session.id,
          deviceId: session.deviceId,
          deviceInfo: session.deviceInfo,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt
        }
      });
    } catch (error) {
      next(error);
    }
  };

  revokeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

  revokeAllSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentSessionId = req.headers['x-session-id'] as string;
      const keepCurrent = req.query.keepCurrent === 'true';

      await this.userService.revokeAllSessions(
        req.user!.userId,
        keepCurrent ? currentSessionId : undefined
      );

      res.json({
        message: keepCurrent 
          ? 'All other sessions revoked successfully'
          : 'All sessions revoked successfully'
      });
    } catch (error) {
      next(error);
    }
  };
}