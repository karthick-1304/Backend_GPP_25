// backend/src/routes/subjectMember.routes.js
import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { attachSubject, restrictToSubjectEditor } from '../middleware/subject.middleware.js';

import {
  getSubjectMembers,
  requestSubjectAccess,
  addSubjectMember,
  removeSubjectMember,
  leaveSubjectMember
} from '../controllers/subjectMember.controller.js';

const router = Router({ mergeParams: true });


router.get('/', restrictTo('Admin', 'Dept Head'), getSubjectMembers);
router.post('/request-access', restrictTo('Dept Head'), requestSubjectAccess);
router.post('/:deptId', restrictToSubjectEditor, addSubjectMember); 
router.delete('/:deptId', restrictToSubjectEditor, removeSubjectMember);
router.post('/leave', restrictTo('Dept Head'),restrictToSubjectEditor,leaveSubjectMember);

export default router;