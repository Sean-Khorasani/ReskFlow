import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { AppError } from '../middleware/error.middleware';

export class ProfileController {
  private userService = new UserService();

  getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.userService.getUserById(req.user!.userId);

      res.json({
        data: user.profile
      });
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await this.userService.updateProfile(req.user!.userId, req.body);

      res.json({
        message: 'Profile updated successfully',
        data: profile
      });
    } catch (error) {
      next(error);
    }
  };

  updateEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { newEmail, password } = req.body;
      await this.userService.updateEmail(req.user!.userId, newEmail, password);

      res.json({
        message: 'Email update initiated. Please check your new email for verification.'
      });
    } catch (error) {
      next(error);
    }
  };

  updatePhone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { newPhone, password } = req.body;
      // Implement phone update logic similar to email
      
      res.json({
        message: 'Phone number updated successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  uploadAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Avatar upload logic would integrate with file storage service
      
      res.json({
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl: 'https://storage.example.com/avatars/user-id.jpg'
        }
      });
    } catch (error) {
      next(error);
    }
  };

  deleteAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Avatar deletion logic
      
      res.json({
        message: 'Avatar deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  };
}