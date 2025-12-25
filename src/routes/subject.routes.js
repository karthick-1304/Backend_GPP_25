// backend/src/routes/subject.routes.js
import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth.middleware.js';
import { attachSubject, restrictToSubjectEditor } from '../middleware/subject.middleware.js';

import subjectMemberRoutes from './subjectMember.routes.js';
import topicRoutes from './topic.routes.js';

import {
  getSubjects,
  createSubject,
  updateSubjectName,
  toggleSubjectLock,
  toggleDeptSubjectLock,
  deleteSubjectWithBackup
} from '../controllers/subject.controller.js';
import { exportSubjectAsExcel } from '../utils/backup.util.js'; 



const router = Router();
router.use(protect);

router.get('/', getSubjects);
router.post('/', restrictTo('Admin', 'Dept Head'), createSubject);


router.use('/:subjectId', attachSubject);


router.patch('/:subjectId/name', restrictToSubjectEditor, updateSubjectName);
router.patch('/:subjectId/toggle-lock', restrictToSubjectEditor, toggleSubjectLock);
router.patch('/:subjectId/dept-toggle-lock', restrictTo('Dept Head'), restrictToSubjectEditor, toggleDeptSubjectLock);
router.get('/:subjectId/export',restrictToSubjectEditor,exportSubjectAsExcel);
router.delete('/:subjectId/delete-with-backup', restrictToSubjectEditor,deleteSubjectWithBackup);

router.use('/:subjectId/members', subjectMemberRoutes);    
router.use('/:subjectId/topics', topicRoutes);  

export default router;