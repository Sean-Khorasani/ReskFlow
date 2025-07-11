import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { validate } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import {
  updateProfileSchema,
  updateEmailSchema,
  updatePhoneSchema
} from '../validators/user.validators';

const router = Router();
const profileController = new ProfileController();

// All routes require authentication
router.use(authenticate);

router.get('/', profileController.getProfile);
router.patch('/', validate(updateProfileSchema), profileController.updateProfile);
router.post('/email', validate(updateEmailSchema), profileController.updateEmail);
router.post('/phone', validate(updatePhoneSchema), profileController.updatePhone);
router.post('/avatar', profileController.uploadAvatar);
router.delete('/avatar', profileController.deleteAvatar);

export { router as profileRouter };