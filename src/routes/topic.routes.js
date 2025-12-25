// backend/src/routes/topic.routes.js
import { Router } from 'express';
import { protect} from '../middleware/auth.middleware.js';

import { restrictToSubjectEditor,restrictToSubjectViewer } from '../middleware/subject.middleware.js';
import { attachTopic,restrictToTopicEditor,restrictToTopicViewer } from '../middleware/topic.middleware.js';
import setRoutes from './set.routes.js';

import {
  getTopicsBySubject,
  createTopic,
  updateTopicName,
  reorderTopics,
  deleteTopicWithBackup
} from '../controllers/topic.controller.js';
import { exportTopicAsExcel } from '../utils/backup.util.js';

const router = Router({ mergeParams: true });


router.use(protect);

router.get('/', restrictToSubjectViewer, getTopicsBySubject);
router.post('/', restrictToSubjectEditor, createTopic);
router.patch('/reorder', restrictToSubjectEditor, reorderTopics);


router.use('/:topicId', attachTopic);


router.patch('/:topicId/name', restrictToTopicEditor, updateTopicName);
router.get('/:topicId/export', restrictToTopicEditor,exportTopicAsExcel);
router.delete('/:topicId/delete-with-backup', restrictToTopicEditor,deleteTopicWithBackup);


router.use('/:topicId/sets', setRoutes);
export default router;