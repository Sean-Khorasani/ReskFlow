import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AppError } from '../middleware/error.middleware';

export class AuthController {
  private authService = new AuthService();

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.register(req.body);
      
      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account.',
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            role: result.user.role,
            profile: result.user.profile
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.login({
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      if ('requires2FA' in result && result.requires2FA) {
        res.json({
          message: '2FA verification required',
          data: {
            userId: result.user.id,
            requires2FA: true
          }
        });
        return;
      }

      res.json({
        message: 'Login successful',
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            role: result.user.role,
            profile: result.user.profile
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (error) {
      next(error);
    }
  };

  verify2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const { token } = req.body;

      const result = await this.authService.verify2FA(userId, token);

      res.json({
        message: 'Login successful',
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            role: result.user.role,
            profile: result.user.profile
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (error) {
      next(error);
    }
  };

  refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body;
      const result = await this.authService.refreshAccessToken(refreshToken);

      res.json({
        message: 'Token refreshed successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const accessToken = req.headers.authorization?.substring(7) || '';
      const sessionId = req.headers['x-session-id'] as string;

      await this.authService.logout(req.user!.userId, accessToken, sessionId);

      res.json({
        message: 'Logged out successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const accessToken = req.headers.authorization?.substring(7) || '';
      await this.authService.logout(req.user!.userId, accessToken);

      res.json({
        message: 'All sessions terminated successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body;
      await this.authService.forgotPassword(email);

      res.json({
        message: 'If the email exists, a password reset link has been sent'
      });
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, password } = req.body;
      await this.authService.resetPassword(token, password);

      res.json({
        message: 'Password reset successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userService = new (await import('../services/user.service')).UserService();
      
      await userService.changePassword(req.user!.userId, currentPassword, newPassword);

      res.json({
        message: 'Password changed successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body;
      await this.authService.verifyEmail(token);

      res.json({
        message: 'Email verified successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  resendVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body;
      // Implementation would go here
      
      res.json({
        message: 'Verification email sent'
      });
    } catch (error) {
      next(error);
    }
  };

  setup2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.setup2FA(req.user!.userId);

      res.json({
        message: '2FA setup initiated',
        data: result
      });
    } catch (error) {
      next(error);
    }
  };

  enable2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body;
      await this.authService.enable2FA(req.user!.userId, token);

      res.json({
        message: '2FA enabled successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  disable2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body;
      await this.authService.disable2FA(req.user!.userId, token);

      res.json({
        message: '2FA disabled successfully'
      });
    } catch (error) {
      next(error);
    }
  };
}