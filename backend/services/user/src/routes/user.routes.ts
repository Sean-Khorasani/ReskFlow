import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { validate, validateQuery } from '../middleware/validation.middleware';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
  getUsersQuerySchema,
  deleteAccountSchema
} from '../validators/user.validators';
import { UserRole } from '@prisma/client';

const router = Router();
const userController = new UserController();

// Protected routes
router.get('/me', authenticate, userController.getCurrentUser);
router.get('/me/sessions', authenticate, userController.getMySessions);
router.delete('/me/sessions/:sessionId', authenticate, userController.revokeMySession);
router.delete('/me/sessions', authenticate, userController.revokeAllMySessions);
router.post('/me/deactivate', authenticate, validate(deleteAccountSchema), userController.deactivateMyAccount);
router.delete('/me', authenticate, validate(deleteAccountSchema), userController.deleteMyAccount);

// Admin routes
router.get('/', authenticate, authorize(UserRole.ADMIN), validateQuery(getUsersQuerySchema), userController.getUsers);
router.get('/:userId', authenticate, authorize(UserRole.ADMIN), userController.getUserById);
router.patch('/:userId/activate', authenticate, authorize(UserRole.ADMIN), userController.activateUser);
router.patch('/:userId/deactivate', authenticate, authorize(UserRole.ADMIN), userController.deactivateUser);
router.delete('/:userId/sessions', authenticate, authorize(UserRole.ADMIN), userController.revokeUserSessions);

export { router as userRouter };