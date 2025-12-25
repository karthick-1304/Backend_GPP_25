// backend/src/routes/practice.routes.js
import { Router } from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { restrictToSetViewer } from '../middleware/set.middleware.js';
import {
  getStudentPracticeHistory,
  getSetQuestions,
  submitPracticeAttempt
} from '../controllers/practice.controller.js';

const router = Router({ mergeParams: true });

router.use(protect);

router.get('/questions',restrictToSetViewer, getSetQuestions);
router.post('/submit', restrictToSetViewer, submitPracticeAttempt);
router.get('/history',restrictToSetViewer, getStudentPracticeHistory);

export default router;