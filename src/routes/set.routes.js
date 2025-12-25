// backend/src/routes/set.routes.js
import { Router } from 'express';

import { protect } from '../middleware/auth.middleware.js';
import { attachSet, restrictToSetEditor, restrictToSetViewer } from '../middleware/set.middleware.js';
import {restrictToTopicViewer,restrictToTopicEditor} from '../middleware/topic.middleware.js';
import practiceRoutes from './practice.routes.js';

import {
  getLevelsByTopic,
  getSetsByLevel,
  createSetWithQuestions,
  parseExcelAndReturnQuestions,
  updateSetQuestion,  
  deleteSetWithBackup
} from '../controllers/set.controller.js';

import { exportSetAsExcel } from '../utils/backup.util.js';
import multer from 'multer';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || file.mimetype.includes('excel') || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files allowed'));
    }
  }
});

const router = Router({ mergeParams: true });

router.use(protect);

router.get('/',restrictToTopicViewer, getLevelsByTopic);
router.get('/:level', restrictToTopicViewer, getSetsByLevel);

router.post('/parse-bulk', restrictToTopicEditor, upload.single('file'), parseExcelAndReturnQuestions);
router.post('/new-set', restrictToTopicEditor, createSetWithQuestions);


router.use('/:setId', attachSet);


router.get('/:setId/export', restrictToSetEditor,exportSetAsExcel);
router.delete('/:setId/delete-with-backup', restrictToSetEditor, deleteSetWithBackup);
router.patch('/:setId/questions', restrictToSetEditor, updateSetQuestion);

router.use('/:setId/practice', practiceRoutes);
export default router;