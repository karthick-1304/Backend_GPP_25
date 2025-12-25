// backend/src/middleware/subject.middleware.js
import { AppError } from '../utils/appError.js';
import { hasSubjectAccess } from '../services/accessService.js';
import {pool} from '../config/db.js';

export const attachSubject = async (req, res, next) => {
  let subjectId = req.params.subjectId || req.body.subjectId;
  if (!subjectId) return next(new AppError('Subject ID is required', 400));

  subjectId = parseInt(subjectId);
  if (isNaN(subjectId)) return next(new AppError('Invalid Subject ID', 400));

  const [rows] = await pool.execute(
    'SELECT subject_id, subject_name, locked FROM subjects WHERE subject_id = ?',
    [subjectId]
  );
  
  if (!rows[0]) return next(new AppError('Subject not found', 404));

  req.subject = rows[0];
  req.subjectId = rows[0].subject_id;
  next();
};

export const restrictToSubjectEditor = async (req, res, next) => {
  const { role, userId } = req.user;
  const  subjectId  = req.subjectId;

  if (!['Admin', 'Dept Head'].includes(role)) {
    return next(new AppError('Permission denied', 403));
  }

  const hasAccess = await hasSubjectAccess(subjectId, userId, role);
  if (!hasAccess) {
    return next(new AppError('You are not authorized to perform this action', 403));
  }
  next();
};

export const restrictToSubjectViewer = async (req, res, next) => {
  const { role, userId } = req.user;
  const subjectId = req.subjectId;

  const hasAccess = await hasSubjectAccess(subjectId, userId, role);
  if (!hasAccess) {
    return next(
      new AppError('You are not authorized to perform this action', 403)
    );
  }
  next();
};
