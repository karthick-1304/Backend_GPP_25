// backend/src/controllers/set.controller.js
import { catchAsync } from '../utils/catchAsync.js';
import { successResponse } from '../utils/responseFormatter.js';
import { AppError } from '../utils/appError.js';
import {pool} from '../config/db.js';
import archiver from 'archiver';

import { sendSetCreatedEmail } from '../services/email.service.js';
import { exportSetAsExcel,generateExcelBuffer } from '../utils/backup.util.js';
import {makeSafeOrderingSets} from 'utils/ordering.util.js';

export const getLevelsByTopic = catchAsync(async (req, res, next) => {
  const topicId = req.topicId;
  const userId = req.user.userId;
  const role = req.user.role;

  // Get count of sets in each level for this topic
  const [levelCounts] = await pool.execute(
    `SELECT level, COUNT(*) as setCount
     FROM practice_sets 
     WHERE topic_id = ? 
     GROUP BY level 
     ORDER BY level ASC`,
    [topicId]
  );

  const levels = [
    { level: '1',  setCount: 0 },
    { level: '2',  setCount: 0 }
  ];

  // Fill in actual counts
  levelCounts.forEach(lc => {
    const idx = lc.level === '1' ? 0 : 1;
    levels[idx].setCount = Number(lc.setCount);
  });

  // Admin/DeptHead/Staff: Both levels open, no lock
  if (role === 'Admin' || role === 'Dept Head' || role === 'Staff') {
    return successResponse(res, {
      topic_id: topicId,
      levels: levels.map(l => ({
        level: l.level,
        setCount: l.setCount,
        levLocked: false
      }))
    });
  }

  // Student
  if (role === 'Student') {
    const [completedLevel1] = await pool.execute(
      `SELECT topic_id FROM student_topic_levels 
       WHERE student_id = ? AND topic_id = ? AND level = '1' 
       LIMIT 1`,
      [userId, topicId]
    );
    const isLevel1Completed = completedLevel1.length > 0;

    const [level1LastPassed] = await pool.execute(
      `SELECT ps.display_order
       FROM practice_attempts pa
       JOIN practice_sets ps ON pa.set_id = ps.set_id
       WHERE pa.student_id = ? AND ps.topic_id = ? AND ps.level = '1'
       ORDER BY ps.display_order DESC
       LIMIT 1`,
      [userId, topicId]
    );
    const level1LastDisplayOrder = level1LastPassed.length > 0 ? level1LastPassed[0].display_order : 0;

    const level1HasAdditional = isLevel1Completed && (level1LastDisplayOrder < levels[0].setCount);

    let level2HasAdditional = false;
    
    if (isLevel1Completed) {

      const [completedLevel2] = await pool.execute(
        `SELECT topic_id FROM student_topic_levels 
        WHERE student_id = ? AND topic_id = ? AND level = '2' 
        LIMIT 1`,
        [userId, topicId]
      );
      const isLevel2Completed = completedLevel2.length > 0;

      const [level2LastPassed] = await pool.execute(
        `SELECT ps.display_order
         FROM practice_attempts pa
         JOIN practice_sets ps ON pa.set_id = ps.set_id
         WHERE pa.student_id = ? AND ps.topic_id = ? AND ps.level = '2'
         ORDER BY ps.display_order DESC
         LIMIT 1`,
        [userId, topicId]
      );
      const level2LastDisplayOrder = level2LastPassed.length > 0 ? level2LastPassed[0].display_order : 0;

      level2HasAdditional = isLevel2Completed && (level2LastDisplayOrder < levels[1].setCount);
    }

    return successResponse(res, {
      topic_id: topicId,
      levels: [
        {
          level: '1',
          setCount: levels[0].setCount,
          levLocked: false,
          havingAdditional: level1HasAdditional,
        },
        {
          level: '2',
          setCount: levels[1].setCount,
          levLocked: !isLevel1Completed,
          havingAdditional: level2HasAdditional
        }
      ]
    });
  }
});

export const getSetsByLevel = catchAsync(async (req, res, next) => {
  const topicId = req.topicId;
  const level = req.params.level; // '1' or '2'
  const { userId, role } = req.user;

  if (isNaN(topicId) || !['1', '2'].includes(level)) {
    return next(new AppError('Invalid topicId or level', 400));
  }

  const conn = await pool.getConnection();

  try {
    // 1. Get all sets in this topic + level, sorted properly
    const [allSets] = await conn.execute(
      `SELECT set_id, display_order
       FROM practice_sets
       WHERE topic_id = ? AND level = ?
       ORDER BY display_order ASC, set_id ASC`,
      [topicId, level]
    );

    if (allSets.length === 0) {
      return next(new AppError(`No practice sets found for topic ${topicId}, level ${level}`, 404));
    }

    const allSetIds = allSets.map(s => s.set_id);
    const totalSets = allSets.length;

    // Non-student: full access
    if (role !== 'Student') {
      return successResponse(res, {
        topic_id: topicId,
        level,
        total_sets: totalSets,
        accessible_sets: allSetIds,
        all_sets: allSetIds
      });
    }

    // ------------------- STUDENT ONLY -------------------

    // Level 2: Must have completed Level 1
    if (level === '2') {
      const [rows] = await conn.execute(
        `SELECT student_id
         FROM student_topic_levels
         WHERE student_id = ? AND topic_id = ? AND level = '1'
         LIMIT 1`,
        [userId, topicId]
      );

      if (rows.length === 0) {
        return next(new AppError('You must complete Level 1 before accessing Level 2', 403));
      }
    }

    // Get completed sets for this student
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
    const completedCount = completedSetIds.length;

    let accessibleSetIds = new Set();
    const completedMap = new Set(completedSetIds);

    for (const set of allSets) {
      if (completedMap.has(set.set_id)) {
        accessibleSetIds.add(set.set_id);
      } else {
        accessibleSetIds.add(set.set_id);
        break;
      }
    }

    return successResponse(res, {
      topic_id: topicId,
      level,
      total_sets: totalSets,
      accessible_sets: Array.from(accessibleSetIds),
      all_sets: allSetIds
    });

  } finally {
    conn.release();
  }
});

export const createSetWithQuestions = catchAsync(async (req, res, next) => {
  const topicId = req.topicId;
  const { level, threshold_percentage = 50, questions = [], is_negative_marking = false, notifyDeptHeads = false, notifyParticipants = false } = req.body;
  const userId = req.user.userId;

  if (!level || !['1', '2'].includes(level)) {
    return next(new AppError('Valid level (1 or 2) is required', 400));
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return next(new AppError('Questions are required for creation of set', 400));
  }

  const neg_mark=is_negative_marking ? 1 : 0;

  // Validate each question
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qNum = i + 1;

    // Question type must be valid
    if (!q.question_type || !['MCQ', 'MSQ', 'NAT'].includes(q.question_type.toUpperCase())) {
      return next(new AppError(`Question ${qNum}: question_type must be MCQ, MSQ, or NAT`, 400));
    }

    // Question text must exist
    if (!q.question_text || !q.question_text.trim()) {
      return next(new AppError(`Question ${qNum}: question_text is required`, 400));
    }

    // Correct answer must exist
    if (!q.correct_answer || !q.correct_answer.toString().trim()) {
      return next(new AppError(`Question ${qNum}: correct_answer is required`, 400));
    }

    // Marks must be 1 or 2
    const marks = Number(q.marks);
    if (!marks || (marks !== 1 && marks !== 2)) {
      return next(new AppError(`Question ${qNum}: marks must be 1 or 2`, 400));
    }

    const qType = q.question_type.toUpperCase();
    const correctAns = q.correct_answer.toString().trim().toLowerCase();

    if (qType === 'MCQ') {
      // Four options must exist
      if (!q.option_a?.trim() || !q.option_b?.trim() || !q.option_c?.trim() || !q.option_d?.trim()) {
        return next(new AppError(`Question ${qNum}: MCQ must have all four options (a, b, c, d)`, 400));
      }

      // Correct answer must be single char: a, b, c, or d
      if (!/^[abcd]$/.test(correctAns) || correctAns.length !== 1) {
        return next(new AppError(`Question ${qNum}: MCQ correct_answer must be one of: a, b, c, d`, 400));
      }
    }
    else if (qType === 'MSQ') {
      // Four options must exist
      if (!q.option_a?.trim() || !q.option_b?.trim() || !q.option_c?.trim() || !q.option_d?.trim()) {
        return next(new AppError(`Question ${qNum}: MSQ must have all four options (a, b, c, d)`, 400));
      }

      // Correct answer must be one or more chars from a, b, c, d
      if (!/^[abcd]+$/.test(correctAns) || correctAns.length === 0) {
        return next(new AppError(`Question ${qNum}: MSQ correct_answer must contain one or more of: a, b, c, d`, 400));
      }
    }
    else if (qType === 'NAT') {
      // Four options should NOT exist
      if (q.option_a || q.option_b || q.option_c || q.option_d) {
        return next(new AppError(`Question ${qNum}: NAT should not have options`, 400));
      }

      // Correct answer must be a valid number (int or float)
      if (isNaN(Number(correctAns))) {
        return next(new AppError(`Question ${qNum}: NAT correct_answer must be a number (int or float)`, 400));
      }
    }
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Get next display_order for this topic and level
    const [orderRes] = await conn.execute(
      'SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM practice_sets WHERE topic_id = ? AND level = ?',
      [topicId, level]
    );

    // Calculate total_marks from questions
    const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);

    // Insert practice_set
    const [setRes] = await conn.execute(
      `INSERT INTO practice_sets (topic_id, level, display_order, negative_marking, threshold_percentage, total_marks, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [topicId, level, orderRes[0].next_order, neg_mark, threshold_percentage, totalMarks, userId, userId]
    );
    const setId = setRes.insertId;

    // Prepare question values
    const questionValues = questions.map(q => [
      q.question_type.toUpperCase(),
      q.question_text.trim(),
      q.option_a?.trim() || null,
      q.option_b?.trim() || null,
      q.option_c?.trim() || null,
      q.option_d?.trim() || null,
      q.correct_answer.toString().trim().toLowerCase(),
      Number(q.marks),
      q.image_url || null,
      userId,
      userId
    ]);

    // Insert questions
    const [qRes] = await conn.query(
      `INSERT INTO questions 
       (question_type, question_text, option_a, option_b, option_c, option_d, correct_answer, marks, image_url, created_by, updated_by)
       VALUES ?`,
      [questionValues]
    );

    const firstQId = qRes.insertId;
    const linkValues = Array.from({ length: questions.length }, (_, i) => [setId, firstQId + i]);

    // Link questions to set
    await conn.query(`INSERT INTO practice_set_questions (set_id, question_id) VALUES ?`, [linkValues]);

    await conn.commit();

    // Get creator, topic, and subject info
    const [[creator]] = await pool.execute(
      `SELECT u.full_name 
       FROM users u 
       LEFT JOIN departments d ON d.head_user_id = u.user_id 
       WHERE u.user_id = ?`,
      [userId]
    );

    const [[topicInfo]] = await pool.execute(
      `SELECT t.topic_name, s.subject_id, s.subject_name 
       FROM topics t 
       JOIN subjects s ON t.subject_id = s.subject_id 
       WHERE t.topic_id = ?`,
      [topicId]
    );

    // Send notifications
    if (notifyDeptHeads) {
      const [deptHeads] = await pool.execute(
        `SELECT DISTINCT u.email, u.full_name 
         FROM users u 
         JOIN departments d ON d.head_user_id = u.user_id 
         JOIN subject_access_dept sad ON sad.dept_id = d.dept_id 
         WHERE sad.subject_id = ?`,
        [topicInfo.subject_id]
      );
      await sendSetCreatedEmail(deptHeads, level, topicInfo.topic_name, topicInfo.subject_name, questions.length, creator.full_name);
    }

    if (notifyParticipants) {
      const [participants] = await pool.execute(
        `SELECT DISTINCT u.email, u.full_name 
         FROM users u 
         JOIN students s ON u.user_id = s.student_id 
         JOIN subject_access_dept sad ON sad.dept_id = s.dept_id 
         WHERE sad.subject_id = ? AND u.role = 'Student'`,
        [topicInfo.subject_id]
      );
      await sendSetCreatedEmail(participants, level, topicInfo.topic_name, topicInfo.subject_name, questions.length, creator.full_name);
    }

    return successResponse(res, {
      set_id: setId,
      level,
      display_order: orderRes[0].next_order,
      total_marks: totalMarks,
      questions_count: questions.length
    }, 'Set created successfully', 201);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});




export const parseExcelAndReturnQuestions = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError('Excel file is required', 400));
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet);

    if (!rawData || rawData.length === 0) {
      return next(new AppError('Excel file is empty', 400));
    }

    const questions = [];
    const errors = [];

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 2; // Excel rows start at 1, header usually row 1 → data starts at row 2

      let hasError = false;

      const questionType = row.question_type?.toString().toUpperCase().trim();
      const questionText = row.question_text?.toString().trim();
      const optionA = row.option_a?.toString().trim() || null;
      const optionB = row.option_b?.toString().trim() || null;
      const optionC = row.option_c?.toString().trim() || null;
      const optionD = row.option_d?.toString().trim() || null;
      const correctAnswer = row.correct_answer?.toString().trim();
      const marks = Number(row.marks);
      const imageUrl = row.image_url?.toString().trim() || null;

      // Validate required fields
      if (!questionType || !['MCQ', 'MSQ', 'NAT'].includes(questionType)) {
        errors.push(`Row ${rowNum}: question_type must be MCQ, MSQ, or NAT`);
        hasError = true;
      }

      if (!questionText) {
        errors.push(`Row ${rowNum}: question_text is required`);
        hasError = true;
      }

      if (!correctAnswer) {
        errors.push(`Row ${rowNum}: correct_answer is required`);
        hasError = true;
      }

      if (isNaN(marks) || ![1, 2].includes(marks)) {
        errors.push(`Row ${rowNum}: marks must be 1 or 2`);
        hasError = true;
      }

      const correctAnsLower = correctAnswer?.toLowerCase();

      if (questionType === 'MCQ') {
        if (!optionA || !optionB || !optionC || !optionD) {
          errors.push(`Row ${rowNum}: MCQ must have all four options (a, b, c, d)`);
          hasError = true;
        }
        if (!correctAnsLower || !/^[abcd]$/.test(correctAnsLower) || correctAnsLower.length !== 1) {
          errors.push(`Row ${rowNum}: MCQ correct_answer must be exactly one of: a, b, c, d`);
          hasError = true;
        }
      }
      else if (questionType === 'MSQ') {
        if (!optionA || !optionB || !optionC || !optionD) {
          errors.push(`Row ${rowNum}: MSQ must have all four options (a, b, c, d)`);
          hasError = true;
        }
        if (!correctAnsLower || !/^[abcd]+$/.test(correctAnsLower) || correctAnsLower.length === 0) {
          errors.push(`Row ${rowNum}: MSQ correct_answer must contain one or more of: a, b, c, d (e.g., ab, acd)`);
          hasError = true;
        }
      }
      else if (questionType === 'NAT') {
        if (optionA || optionB || optionC || optionD) {
          errors.push(`Row ${rowNum}: NAT questions should not have any options`);
          hasError = true;
        }
        if (isNaN(Number(correctAnswer))) {
          errors.push(`Row ${rowNum}: NAT correct_answer must be a valid number`);
          hasError = true;
        }
      }

      // If any error in this row → mark for rejection
      if (hasError) {
        continue; // skip adding to questions
      }

      // Only add if NO errors in this row
      questions.push({
        question_type: questionType,
        question_text: questionText,
        option_a: optionA,
        option_b: optionB,
        option_c: optionC,
        option_d: optionD,
        correct_answer: correctAnswer, // keep original case
        marks: marks,
        image_url: imageUrl
      });
    }

    // STRICT MODE: If ANY error exists → reject entire file
    if (errors.length > 0) {
      return next(new AppError(
        `Excel upload rejected due to ${errors.length} error(s). Fix all errors and try again:\n• ${errors.join('\n• ')}`,
        400
      ));
    }

    // Only reach here if ZERO errors
    return successResponse(res, {
      questions,
      total_parsed: questions.length
    }, 'Excel parsed successfully. All questions are valid.');

  } catch (err) {
    return next(new AppError('Failed to parse Excel file: ' + err.message, 500));
  }
});



export const reorderSets = catchAsync(async (req, res, next) => {
  const topicId = req.topicId;
  const { level, ordered_set_ids } = req.body;
  const userId = req.user.userId;

  if (!level || !['1', '2'].includes(level)) {
    return next(new AppError('Valid level (1 or 2) is required', 400));
  }

  if (!Array.isArray(ordered_set_ids) || ordered_set_ids.length === 0) {
    return next(new AppError('ordered_set_ids array is required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Verify all set_ids belong to the given topic and level
    const placeholders = ordered_set_ids.map(() => '?').join(',');
    const [existing] = await conn.execute(
      `SELECT set_id FROM practice_sets 
       WHERE topic_id = ? AND level = ? AND set_id IN (${placeholders})`,
      [topicId, level, ...ordered_set_ids]
    );

    if (existing.length !== ordered_set_ids.length) {
      throw new AppError('Invalid or unauthorized set IDs', 400);
    }

    // Update display_order using CASE statement
    const caseStatements = ordered_set_ids.map((id, i) => `WHEN ${id} THEN ${i + 1}`).join(' ');
    
    await conn.execute(
      `UPDATE practice_sets 
       SET display_order = CASE set_id ${caseStatements} END,
           updated_by = ?,
           updated_at = NOW()
       WHERE set_id IN (${placeholders})`,
      [userId, ...ordered_set_ids]
    );

    await conn.commit();
    return successResponse(res, null, 'Sets reordered successfully');
  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to reorder sets', 500));
  } finally {
    conn.release();
  }
});




// 1. Update Set Question
export const updateSetQuestion = catchAsync(async (req, res, next) => {
  const { questionId } = req.body;
  const subjectId = req.subjectId;
  const userId = req.user.userId;

  if (!questionId) {
    return next(new AppError('Question ID is required', 400));
  }

  const q = req.body;

  // Validate question type
  const qType = q.question_type?.toString().toUpperCase().trim();
  if (!qType || !['MCQ', 'MSQ', 'NAT'].includes(qType)) {
    return next(new AppError('question_type must be MCQ, MSQ, or NAT', 400));
  }

  // Validate question text
  const questionText = q.question_text?.toString().trim();
  if (!questionText) {
    return next(new AppError('question_text is required', 400));
  }

  // Validate marks
  const marks = Number(q.marks);
  if (isNaN(marks) || ![1, 2].includes(marks)) {
    return next(new AppError('marks must be 1 or 2', 400));
  }

  // Validate correct_answer existence
  const correctAnswerRaw = q.correct_answer?.toString().trim();
  if (!correctAnswerRaw) {
    return next(new AppError('correct_answer is required', 400));
  }

  // Type-specific validation
  let correctAnswerForDB = correctAnswerRaw; // default: store as-is
  let correctAnsNormalized = correctAnswerRaw.toLowerCase();

  if (qType === 'MCQ') {
    if (!q.option_a?.trim() || !q.option_b?.trim() || !q.option_c?.trim() || !q.option_d?.trim()) {
      return next(new AppError('MCQ must have all four options (a, b, c, d)', 400));
    }
    if (!/^[abcd]$/.test(correctAnsNormalized)) {
      return next(new AppError('MCQ correct_answer must be exactly one of: a, b, c, d', 400));
    }
    // Store as lowercase for consistency (optional, but recommended)
    correctAnswerForDB = correctAnsNormalized;
  }
  else if (qType === 'MSQ') {
    if (!q.option_a?.trim() || !q.option_b?.trim() || !q.option_c?.trim() || !q.option_d?.trim()) {
      return next(new AppError('MSQ must have all four options (a, b, c, d)', 400));
    }
    if (!/^[abcd]+$/.test(correctAnsNormalized) || correctAnsNormalized.length === 0) {
      return next(new AppError('MSQ correct_answer must contain one or more of: a, b, c, d (e.g., "ab", "acd")', 400));
    }
    correctAnswerForDB = correctAnsNormalized;
  }
  else if (qType === 'NAT') {
    // Do NOT lowercase NAT answers
    if (q.option_a?.trim() || q.option_b?.trim() || q.option_c?.trim() || q.option_d?.trim()) {
      return next(new AppError('NAT questions should not have any options', 400));
    }
    if (isNaN(Number(correctAnswerRaw))) {
      return next(new AppError('NAT correct_answer must be a valid number (e.g., 42, 3.14, -5)', 400));
    }
    // Store exact value (supports decimals, negative, scientific notation if needed)
    correctAnswerForDB = correctAnswerRaw;
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Verify question exists and belongs to this subject's practice set
    const [checkRows] = await conn.execute(
      `SELECT q.question_id
       FROM questions q
       JOIN practice_set_questions psq ON q.question_id = psq.question_id
       JOIN practice_sets ps ON psq.set_id = ps.set_id
       JOIN topics t ON ps.topic_id = t.topic_id
       WHERE q.question_id = ? AND t.subject_id = ?
       LIMIT 1`,
      [questionId, subjectId]
    );

    if (checkRows.length === 0) {
      await conn.rollback();
      return next(new AppError('Question not found or does not belong to this subject', 404));
    }

    // Perform update
    await conn.execute(
      `UPDATE questions 
       SET question_type = ?,
           question_text = ?,
           option_a = ?,
           option_b = ?,
           option_c = ?,
           option_d = ?,
           correct_answer = ?,
           marks = ?,
           image_url = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE question_id = ?`,
      [
        qType,
        questionText,
        q.option_a?.trim() || null,
        q.option_b?.trim() || null,
        q.option_c?.trim() || null,
        q.option_d?.trim() || null,
        correctAnswerForDB,        // normalized for MCQ/MSQ, original for NAT
        marks,
        q.image_url?.trim() || null,
        userId,
        questionId
      ]
    );

    await conn.commit();

    return successResponse(res, { question_id: questionId }, 'Question updated successfully');

  } catch (err) {
    await conn.rollback();
    throw err instanceof AppError ? err : new AppError('Failed to update question', 500);
  } finally {
    conn.release();
  }
});

export const deleteSetWithBackup = catchAsync(async (req, res, next) => {
  const setId = req.setId;
  const topicId = req.topicId;
  const level = req.set.level; // from attachSet (you already select level)
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
      return next(new AppError('You do not have permission to delete this set', 403));
    }

    // 2. Generate Excel backups
    const contentBuffer = await generateExcelBuffer(exportSetAsExcel, req, 'content');
    const attemptsBuffer = await generateExcelBuffer(exportSetAsExcel, req, 'attempts');

    // 3. Create and send ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      throw err;
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=set_${setId}_backup.zip`);

    archive.pipe(res);

    archive.append(contentBuffer, { name: `set_${setId}_content.xlsx` });
    archive.append(attemptsBuffer, { name: `set_${setId}_attempts.xlsx` });

    await archive.finalize(); // This sends the file to client

    // 4. Now delete the set (after backup is sent)
    await conn.execute(`DELETE FROM practice_sets WHERE set_id = ?`, [setId]);

    // 5. Reorder remaining sets in the same topic + level
    await makeSafeOrderingSets(conn, topicId, level);

    // 6. Commit transaction
    await conn.commit();

    // Note: Response already sent via archive.pipe(res)
    // So we don't call successResponse here

  } catch (err) {
    await conn.rollback();
    throw err; // Will be caught by catchAsync and sent as error
  } finally {
    conn.release();
  }
});