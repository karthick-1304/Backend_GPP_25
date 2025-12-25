// backend/src/controllers/topic.controller.js
import { catchAsync } from '../utils/catchAsync.js';
import { successResponse } from '../utils/responseFormatter.js';
import { AppError } from '../utils/appError.js';
import {pool} from '../config/db.js';
import archiver from 'archiver';

import { sendTopicCreatedEmail } from '../services/email.service.js';
import { exportTopicAsExcel,generateExcelBuffer } from '../utils/backup.util.js';

import {makeSafeOrderingTopics} from '../utils/ordering.util.js'

export const getTopicsBySubject = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;

  const [topics] = await pool.execute(
    `SELECT topic_id, topic_name, display_order
     FROM topics 
     WHERE subject_id = ?
     ORDER BY display_order ASC, topic_id ASC`,
    [subjectId]
  );

  return successResponse(res, {
    subjectId: subjectId,
    no_of_topics: topics.length,
    topics: topics.map((t,idx) => ({
      topic_id: t.topic_id,
      topic_name: t.topic_name,
      display_order: t.display_order ?? idx + 1
    }))
  });
});

export const createTopic = catchAsync(async (req, res, next) => {
  const { topic_name, notifyDeptHeads = false, notifyParticipants = false } = req.body;
  const subjectId = req.subjectId;
  const userId = req.user.userId;

  if (!topic_name?.trim()) {
    return next(new AppError('Topic name is required', 400));
  }

  const [order] = await pool.execute(
    `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM topics WHERE subject_id = ?`,
    [subjectId]
  );

  const [result] = await pool.execute(
    `INSERT INTO topics (subject_id, topic_name, display_order, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?)`,
    [subjectId, topic_name.trim(), order[0].next_order, userId, userId]
  );

  await pool.execute('update subjects set topics_count = topics_count + 1 where subject_id = ?', [subjectId]);

  // Get creator and subject info
  const [[creator]] = await pool.execute(
    `SELECT u.full_name
     FROM users u 
     WHERE u.user_id = ?`,
    [userId]
  );

  const [[subject]] = await pool.execute('SELECT subject_name FROM subjects WHERE subject_id = ?', [subjectId]);

  // Send notifications
  if (notifyDeptHeads) {
    const [deptHeads] = await pool.execute(
      `SELECT DISTINCT u.email, u.full_name 
       FROM users u 
       JOIN departments d ON d.head_user_id = u.user_id 
       JOIN subject_access_dept sad ON sad.dept_id = d.dept_id 
       WHERE sad.subject_id = ?`,
      [subjectId]
    );
    await sendTopicCreatedEmail(deptHeads, topic_name.trim(), subject.subject_name, creator.full_name);
  }

  if (notifyParticipants) {
    const [participants] = await pool.execute(
      `SELECT DISTINCT u.email, u.full_name 
       FROM users u 
       JOIN students s ON u.user_id = s.student_id 
       JOIN subject_access_dept sad ON sad.dept_id = s.dept_id 
       WHERE sad.subject_id = ? AND u.role = 'Student'`,
      [subjectId]
    );
    await sendTopicCreatedEmail(participants, topic_name.trim(), subject.subject_name, creator.full_name);
  }

  return successResponse(res, {
    topic_id: result.insertId,
    topic_name: topic_name.trim(),
    display_order: order[0].next_order
  }, 'Topic created', 201);
});


export const updateTopicName = catchAsync(async (req, res, next) => {
  const { topic_name } = req.body;
  const topicId = req.topicId;
  const subjectId = req.subjectId;
  const userId = req.user.userId;

  if (!topic_name?.trim()) {
    return next(new AppError('Topic name is required', 400));
  }

  const trimmedName = topic_name.trim();

  const [current] = await pool.execute(
    'SELECT topic_name FROM topics WHERE topic_id = ? AND subject_id = ?',
    [topicId, subjectId]
  );

  if (current[0].topic_name === trimmedName) {
    return next(new AppError('New name must be different than old name', 400));
  }

  await pool.execute(
    `UPDATE topics 
     SET topic_name = ?, updated_by = ?
     WHERE topic_id = ? AND subject_id = ?`,
    [trimmedName, userId, topicId, subjectId]
  );

  return successResponse(res, {
    topic_id: parseInt(topicId),
    topic_name: trimmedName
  }, 'Topic name updated');
});

export const reorderTopics = catchAsync(async (req, res, next) => {
  const { ordered_topic_ids } = req.body;
  const subjectId = req.subjectId;
  const userId = req.user.userId;

  if (!Array.isArray(ordered_topic_ids) || ordered_topic_ids.length === 0) {
    return next(new AppError('Ordered_topic_ids array is required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const placeholders = ordered_topic_ids.map(() => '?').join(',');
    const [existing] = await conn.execute(
      `SELECT topic_id FROM topics 
       WHERE subject_id = ? AND topic_id IN (${placeholders})`,
      [subjectId, ...ordered_topic_ids]
    );

    if (existing.length !== ordered_topic_ids.length) {
      throw new AppError('Invalid topic IDs', 400);
    }


    await conn.execute(
      `INSERT INTO topics (topic_id, display_order, updated_by)
       VALUES ${ordered_topic_ids.map((id, i) => `(?, ?, ?)`).join(',')}
       ON DUPLICATE KEY UPDATE
         display_order = VALUES(display_order),
         updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      ordered_topic_ids.flatMap((id, i) => [id, i + 1, userId])
    );

    await conn.commit();
    return successResponse(res, null, 'Topics reordered successfully');
  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to reorder topics', 500));
  } finally {
    conn.release();
  }
});

export const deleteTopicWithBackup = catchAsync(async (req, res, next) => {
  const topicId = req.topicId;
  const subjectId = req.subjectId;
  const userId = req.user.userId;
  const role = req.user.role;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // 1. Permission check
    const [[subjectInfo]] = await conn.execute(
      `SELECT created_by FROM subjects WHERE subject_id = ?`,
      [subjectId]
    );

    if (!subjectInfo) {
      await conn.rollback();
      return next(new AppError('Subject not found', 404));
    }

    const canDelete = role === 'Admin' || (role === 'Dept Head' && subjectInfo.created_by === userId);
    if (!canDelete) {
      await conn.rollback();
      return next(new AppError('You do not have permission to delete this topic', 403));
    }

    // 2. Generate Excel backups
    const contentBuffer = await generateExcelBuffer(exportTopicAsExcel, req, 'content');
    const attemptsBuffer = await generateExcelBuffer(exportTopicAsExcel, req, 'attempts');

    // 3. Create and stream ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      throw err;
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=topic_${topicId}_backup.zip`);

    archive.pipe(res);

    archive.append(contentBuffer, { name: `topic_${topicId}_content.xlsx` });
    archive.append(attemptsBuffer, { name: `topic_${topicId}_attempts.xlsx` });

    await archive.finalize(); // Sends file to client

    // 4. Now delete the topic (after backup is sent)
    await conn.execute(`DELETE FROM topics WHERE topic_id = ?`, [topicId]);

    // 5. Update topics_count in subjects table
    await conn.execute(
      `UPDATE subjects 
       SET topics_count = topics_count - 1 
       WHERE subject_id = ?`,
      [subjectId]
    );

    // 6. Reorder remaining topics in this subject to remove gaps
    await makeSafeOrderingTopics(conn, subjectId);

    // 7. Commit transaction
    await conn.commit();

    // Response already sent via streaming — do nothing here

  } catch (err) {
    await conn.rollback();
    throw err; // Will be handled by catchAsync
  } finally {
    conn.release();
  }
});