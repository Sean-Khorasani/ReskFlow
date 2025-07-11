import { Router } from 'express';
import { SessionController } from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const sessionController = new SessionController();

// All routes require authentication
router.use(authenticate);

router.get('/', sessionController.getSessions);
router.get('/current', sessionController.getCurrentSession);
router.delete('/:sessionId', sessionController.revokeSession);
router.delete('/', sessionController.revokeAllSessions);

export { router as sessionRouter };