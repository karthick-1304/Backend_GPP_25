// backend/src/middleware/topic.middleware.js
import { AppError } from '../utils/appError.js';
import { pool } from '../config/db.js';
import { hasSubjectAccess } from '../services/accessService.js';

export const attachTopic = async (req, res, next) => {
  let topicId = req.params.topicId || req.body.topicId;
  if (!topicId) return next(new AppError('Topic ID required', 400));

  topicId = parseInt(topicId);
  if (isNaN(topicId)) return next(new AppError('Invalid Topic ID', 400));

  const [[topic]] = await pool.execute(
    'SELECT topic_id, topic_name, subject_id FROM topics WHERE topic_id = ?',
    [topicId]
  );

  if (!topic) return next(new AppError('Topic not found', 404));

  // Verify topic belongs to subject if subjectId exists in params
  if (!req.subjectId || topic.subject_id !== req.subjectId) {
    return next(new AppError('Topic does not belong to this subject', 400));
  }

  req.topic = topic;
  req.topicId = topic.topic_id;
  if (!req.subjectId) req.subjectId = topic.subject_id;
  
  next();
};

export const restrictToTopicEditor = async (req, res, next) => {
  const { role, userId } = req.user;
  const subjectId = req.topic.subject_id;

  if (!['Admin', 'Dept Head'].includes(role)) {
    return next(new AppError('Permission denied', 403));
  }

  if (role === 'Admin') return next();

  const hasAccess = await hasSubjectAccess(subjectId, userId, role);
  if (!hasAccess) {
    return next(new AppError('Not authorized', 403));
  }

  next();
};

export const restrictToTopicViewer = async (req, res, next) => {
  const { role, userId } = req.user;
  const subjectId = req.topic.subject_id;

  const hasAccess = await hasSubjectAccess(subjectId, userId, role);
  
  if (!hasAccess) {
    return next(new AppError('Not authorized', 403));
  }

  next();
};
