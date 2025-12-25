// backend/src/middleware/set.middleware.js
import { AppError } from '../utils/appError.js';
import { pool } from '../config/db.js';
import { hasSubjectAccess } from '../services/accessService.js';
import { catchAsync } from '../utils/catchAsync.js';

export const attachSet = async (req, res, next) => {
  let setId = req.params.setId || req.body.setId;
  if (!setId) return next(new AppError('Set ID required', 400));

  setId = parseInt(setId);
  if (isNaN(setId)) return next(new AppError('Invalid Set ID', 400));

  const [[set]] = await pool.execute(
    `SELECT ps.set_id, ps.display_order, ps.level, ps.topic_id, t.subject_id
     FROM practice_sets ps
     JOIN topics t ON ps.topic_id = t.topic_id
     WHERE ps.set_id = ?`,
    [setId]
  );

  if (!set) return next(new AppError('Practice set not found', 404));

  // Verify hierarchy
  if (!req.topicId || set.topic_id !== req.topicId) {
    return next(new AppError('Set does not belong to this topic', 400));
  }
  if (!req.subjectId || set.subject_id !== req.subjectId) {
    return next(new AppError('Set does not belong to this subject', 400));
  }

  req.set = set;
  req.setId = set.set_id;
  req.levelId = set.level;
  if (!req.topicId) req.topicId = set.topic_id;
  if (!req.subjectId) req.subjectId = set.subject_id;

  next();
};

export const restrictToSetEditor = async (req, res, next) => {
  const { role, userId } = req.user;
  const subjectId = req.set.subject_id;

  if (!['Admin', 'Dept Head'].includes(role)) {
    return next(new AppError('Permission denied', 403));
  }

  const hasAccess = await hasSubjectAccess(subjectId, userId, role);
  if (!hasAccess) {
    return next(new AppError('Not authorized', 403));
  }

  next();
};


export const restrictToSetViewer = catchAsync(async (req, res, next) => {
  const { role, userId } = req.user;
  const setId = req.setId; 
  const subjectId = req.subjectId; 

  const hasSubjectAccess = await hasSubjectAccess(subjectId, userId, role);
  if (!hasSubjectAccess) {
    return next(new AppError('You do not have access to this subject', 403));
  }

  if (role !== 'Student') {
    return next();
  }

  // ------------------- STUDENT ONLY LOGIC -------------------

  const [[setInfo]] = await pool.execute(
    `SELECT ps.topic_id, ps.level
     FROM practice_sets ps
     WHERE ps.set_id = ?`,
    [setId]
  );

  if (!setInfo) {
    return next(new AppError('Set not found', 404));
  }

  const { topic_id: topicId, level } = setInfo;

  const conn = await pool.getConnection();

  try {
    // 1. Fetch ALL set_ids in this topic + level, sorted by display_order
    const [allSets] = await conn.execute(
      `SELECT set_id, display_order
       FROM practice_sets
       WHERE topic_id = ? AND level = ?
       ORDER BY  display_order ASC, set_id ASC`,
      [topicId, level]
    );

    if (allSets.length === 0) {
      return next(new AppError('No sets found in this level', 404));
    }

    const allSetIds = allSets.map(s => s.set_id);

    // 2. Fetch all COMPLETED set_ids for this student in this topic + level, sorted
    const [completedRows] = await conn.execute(
      `SELECT ps.set_id
       FROM practice_attempts pa
       JOIN practice_sets ps ON pa.set_id = ps.set_id
       WHERE pa.student_id = ?
         AND ps.topic_id = ?
         AND ps.level = ?
       ORDER BY ps.display_order ASC, ps.set_id ASC`,
      [userId, topicId, level]
    );

    const completedSetIds = completedRows.map(row => row.set_id);

    // 3. Calculate accessibleSetIds: completed + the next uncompleted one
    const accessibleSetIds = new Set(completedSetIds);

    // Find the first uncompleted set in order
    const nextUncompletedSet = allSets.find(set => !completedSetIds.includes(set.set_id));

    if (nextUncompletedSet) {
      accessibleSetIds.add(nextUncompletedSet.set_id);
    }
    // If all completed → only completed ones are accessible (no revision unless you want)

    // Step 4: Check if requested setId is in accessibleSetIds
    if (!accessibleSetIds.has(setId)) {
      return next(new AppError('You are not allowed to access this set yet. Complete previous sets first.', 403));
    }

    next();

  } catch (err) {
    throw err;
  } finally {
    conn.release();
  }
});

