//backend/src/utils/backup.util.js

import * as XLSX from 'xlsx';
import archiver from 'archiver';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { catchAsync } from '../utils/catchAsync.js';

const pipelineAsync = promisify(pipeline);

// Helper function to generate Excel buffer
export const generateExcelBuffer = async (exportFunction, req, exportType) => {
  return new Promise(async (resolve, reject) => {
    const originalSend = req.res.send;
    const originalSetHeader = req.res.setHeader;
    
    let buffer = null;
    
    // Override res.send to capture buffer
    req.res.send = function(data) {
      buffer = data;
    };
    
    // Override res.setHeader to prevent actual response
    req.res.setHeader = function() {};
    
    try {
      // Temporarily set query for export type
      const originalQuery = req.query;
      req.query = { ...originalQuery, export_type: exportType };
      
      await exportFunction(req, req.res, (err) => {
        if (err) reject(err);
      });
      
      // Restore original query
      req.query = originalQuery;
      
      // Restore original functions
      req.res.send = originalSend;
      req.res.setHeader = originalSetHeader;
      
      if (buffer) {
        resolve(buffer);
      } else {
        reject(new Error('Failed to generate Excel'));
      }
    } catch (err) {
      req.res.send = originalSend;
      req.res.setHeader = originalSetHeader;
      reject(err);
    }
  });
};
// 1. Export Set As Excel
export const exportSetAsExcel = catchAsync(async (req, res, next) => {
  const setId = req.setId; // from attachSet middleware
  const { export_type } = req.query; // 'content' or 'attempts'

  const conn = await pool.getConnection();

  try {
    // Get set details with related info
    const [setDetails] = await conn.execute(
      `SELECT ps.set_id, ps.topic_id, t.topic_name, t.subject_id, s.subject_name,
              ps.level, ps.display_order, ps.threshold_percentage, ps.total_marks,
              ps.created_by, u.full_name as creator_name
       FROM practice_sets ps
       JOIN topics t ON ps.topic_id = t.topic_id
       JOIN subjects s ON t.subject_id = s.subject_id
       JOIN users u ON ps.created_by = u.user_id
       WHERE ps.set_id = ?`,
      [setId]
    );

    if (setDetails.length === 0) {
      return next(new AppError('Set not found', 404));
    }

    const setInfo = setDetails[0];
    const workbook = XLSX.utils.book_new();

    if (export_type === 'content') {
      // Sheet 1: Set Information
      const setInfoData = [
        ['Set ID', setInfo.set_id],
        ['Topic ID', setInfo.topic_id],
        ['Topic Name', setInfo.topic_name],
        ['Subject ID', setInfo.subject_id],
        ['Subject Name', setInfo.subject_name],
        ['Level', setInfo.level],
        ['Display Order', setInfo.display_order],
        ['Threshold %', setInfo.threshold_percentage],
        ['Total Marks', setInfo.total_marks],
        ['Created By', setInfo.creator_name]
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(setInfoData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Set Info');

      // Sheet 2: Questions
      const [questions] = await conn.execute(
        `SELECT q.question_id, q.question_type, q.question_text,
                q.option_a, q.option_b, q.option_c, q.option_d,
                q.correct_answer, q.marks, q.image_url
         FROM questions q
         JOIN practice_set_questions psq ON q.question_id = psq.question_id
         WHERE psq.set_id = ?
         ORDER BY q.question_id`,
        [setId]
      );

      const questionsData = [
        ['Question ID', 'Type', 'Question Text', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Marks', 'Image URL']
      ];

      questions.forEach(q => {
        questionsData.push([
          q.question_id,
          q.question_type,
          q.question_text,
          q.option_a || '',
          q.option_b || '',
          q.option_c || '',
          q.option_d || '',
          q.correct_answer,
          q.marks,
          q.image_url || ''
        ]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(questionsData);
      XLSX.utils.book_append_sheet(workbook, ws2, 'Questions');

    } else if (export_type === 'attempts') {
      // Sheet 1: Set Information
      const setInfoData = [
        ['Set ID', setInfo.set_id],
        ['Topic ID', setInfo.topic_id],
        ['Topic Name', setInfo.topic_name],
        ['Subject ID', setInfo.subject_id],
        ['Subject Name', setInfo.subject_name],
        ['Level', setInfo.level],
        ['Display Order', setInfo.display_order],
        ['Threshold %', setInfo.threshold_percentage],
        ['Total Marks', setInfo.total_marks],
        ['Created By', setInfo.creator_name]
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(setInfoData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Set Info');

      // Sheet 2: Student Attempts (Best Score)
      const [attempts] = await conn.execute(
        `SELECT pa.student_id, u.full_name, u.email, s.dept_id, d.dept_name, s.batch_year,
                MAX(pa.score) as best_score, COUNT(*) as total_attempts,
                MAX(pa.attempt_at) as last_attempt
         FROM practice_attempts pa
         JOIN users u ON pa.student_id = u.user_id
         JOIN students s ON pa.student_id = s.student_id
         LEFT JOIN departments d ON s.dept_id = d.dept_id
         WHERE pa.set_id = ?
         GROUP BY pa.student_id
         ORDER BY best_score DESC`,
        [setId]
      );

      const attemptsData = [
        ['Student ID', 'Name', 'Email', 'Department', 'Batch Year', 'Best Score', 'Total Attempts', 'Last Attempt']
      ];

      attempts.forEach(a => {
        attemptsData.push([
          a.student_id,
          a.full_name,
          a.email,
          a.dept_name || 'N/A',
          a.batch_year,
          Number(a.best_score),
          a.total_attempts,
          a.last_attempt
        ]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(attemptsData);
      XLSX.utils.book_append_sheet(workbook, ws2, 'Student Attempts');
    }

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=set_${setId}_${export_type}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (err) {
    next(new AppError('Failed to export set', 500));
  } finally {
    conn.release();
  }
});


// 2. Export Topic As Excel
export const exportTopicAsExcel = catchAsync(async (req, res, next) => {
  const topicId = req.topicId; 
  const { export_type } = req.query; 

  const conn = await pool.getConnection();

  try {
    // Get topic details
    const [topicDetails] = await conn.execute(
      `SELECT t.topic_id, t.topic_name, t.subject_id, s.subject_name,
              t.display_order, t.created_by, u.full_name as creator_name
       FROM topics t
       JOIN subjects s ON t.subject_id = s.subject_id
       JOIN users u ON t.created_by = u.user_id
       WHERE t.topic_id = ?`,
      [topicId]
    );

    if (topicDetails.length === 0) {
      return next(new AppError('Topic not found', 404));
    }

    const topicInfo = topicDetails[0];
    const workbook = XLSX.utils.book_new();

    if (export_type === 'content') {
      // Sheet 1: Topic Information
      const topicInfoData = [
        ['Topic ID', topicInfo.topic_id],
        ['Topic Name', topicInfo.topic_name],
        ['Subject ID', topicInfo.subject_id],
        ['Subject Name', topicInfo.subject_name],
        ['Topic Display Order', topicInfo.display_order],
        ['Topic Created By', topicInfo.creator_name]
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(topicInfoData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Topic Info');

      // Sheet 2: Sets Information (Level 1 and Level 2)
      const [sets] = await conn.execute(
        `SELECT set_id, level, display_order, threshold_percentage, total_marks, negative_marking
         FROM practice_sets
         WHERE topic_id = ?
         ORDER BY level, display_order`,
        [topicId]
      );

      const setsData = [
        ['Set ID', 'Level', 'Display Order', 'Threshold %', 'Total Marks', 'Negative Marking']
      ];

      sets.forEach(s => {
        setsData.push([
          s.set_id,
          `Level ${s.level}`,
          s.display_order,
          s.threshold_percentage,
          s.total_marks,
          s.negative_marking ? 'Yes' : 'No'
        ]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(setsData);
      XLSX.utils.book_append_sheet(workbook, ws2, 'Sets Info');

      // Sheet 3: All Questions from all sets
      const [questions] = await conn.execute(
        `SELECT psq.set_id, q.question_id, q.question_type, q.question_text,
                q.option_a, q.option_b, q.option_c, q.option_d,
                q.correct_answer, q.marks, q.image_url
         FROM questions q
         JOIN practice_set_questions psq ON q.question_id = psq.question_id
         JOIN practice_sets ps ON psq.set_id = ps.set_id
         WHERE ps.topic_id = ?
         ORDER BY ps.level, ps.display_order, q.question_id`,
        [topicId]
      );

      const questionsData = [
        ['Set ID', 'Question ID', 'Type', 'Question Text', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Marks', 'Image URL']
      ];

      questions.forEach(q => {
        questionsData.push([
          q.set_id,
          q.question_id,
          q.question_type,
          q.question_text,
          q.option_a || '',
          q.option_b || '',
          q.option_c || '',
          q.option_d || '',
          q.correct_answer,
          q.marks,
          q.image_url || ''
        ]);
      });

      const ws3 = XLSX.utils.aoa_to_sheet(questionsData);
      XLSX.utils.book_append_sheet(workbook, ws3, 'All Questions');

    } else if (export_type === 'attempts') {
      // Sheet 1: Topic Information
      const topicInfoData = [
        ['Topic ID', topicInfo.topic_id],
        ['Topic Name', topicInfo.topic_name],
        ['Subject ID', topicInfo.subject_id],
        ['Subject Name', topicInfo.subject_name],
        ['Topic Display Order', topicInfo.display_order],
        ['Topic Created By', topicInfo.creator_name]
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(topicInfoData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Topic Info');

      // Sheet 2: Sets Information
      const [sets] = await conn.execute(
        `SELECT set_id, level, display_order, threshold_percentage, total_marks
         FROM practice_sets
         WHERE topic_id = ?
         ORDER BY level, display_order`,
        [topicId]
      );

      const setsData = [
        ['Set ID', 'Level', 'Display Order', 'Threshold %', 'Total Marks']
      ];

      sets.forEach(s => {
        setsData.push([
          s.set_id,
          `Level ${s.level}`,
          s.display_order,
          s.threshold_percentage,
          s.total_marks
        ]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(setsData);
      XLSX.utils.book_append_sheet(workbook, ws2, 'Sets Info');

      // Sheet 3: Student Attempts by Level
      const [attempts] = await conn.execute(
        `SELECT ps.level, ps.set_id, pa.student_id, u.full_name, u.email,
                s.dept_id, s.batch_year, d.dept_name, MAX(pa.score) as best_score,
                COUNT(*) as total_attempts
         FROM practice_attempts pa
         JOIN practice_sets ps ON pa.set_id = ps.set_id
         JOIN users u ON pa.student_id = u.user_id
         JOIN students s ON pa.student_id = s.student_id
         LEFT JOIN departments d ON s.dept_id = d.dept_id
         WHERE ps.topic_id = ?
         GROUP BY ps.level, ps.set_id, pa.student_id
         ORDER BY ps.level, ps.set_id, best_score DESC`,
        [topicId]
      );

      const attemptsData = [
        ['Level', 'Set ID', 'Student ID', 'Name', 'Email', 'Department', 'Batch Year', 'Best Score', 'Total Attempts']
      ];

      attempts.forEach(a => {
        attemptsData.push([
          `Level ${a.level}`,
          a.set_id,
          a.student_id,
          a.full_name,
          a.email,
          a.dept_name || 'N/A',
          a.batch_year,
          Number(a.best_score),
          a.total_attempts
        ]);
      });

      const ws3 = XLSX.utils.aoa_to_sheet(attemptsData);
      XLSX.utils.book_append_sheet(workbook, ws3, 'Student Attempts');
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=topic_${topicId}_${export_type}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (err) {
    next(new AppError('Failed to export topic', 500));
  } finally {
    conn.release();
  }
});


// 3. Export Subject As Excel
export const exportSubjectAsExcel = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId; // from attachSubject middleware
  const { export_type } = req.query; // 'content' or 'attempts'

  const conn = await pool.getConnection();

  try {
    // Get subject details
    const [subjectDetails] = await conn.execute(
      `SELECT s.subject_id, s.subject_name, s.created_by, u.full_name as creator_name
       FROM subjects s
       JOIN users u ON s.created_by = u.user_id
       WHERE s.subject_id = ?`,
      [subjectId]
    );

    if (subjectDetails.length === 0) {
      return next(new AppError('Subject not found', 404));
    }

    const subjectInfo = subjectDetails[0];
    const workbook = XLSX.utils.book_new();

    if (export_type === 'content') {
      // Get department access info
      const [deptAccess] = await conn.execute(
        `SELECT d.dept_id, d.dept_name, sad.dept_sub_lock
         FROM subject_access_dept sad
         JOIN departments d ON sad.dept_id = d.dept_id
         WHERE sad.subject_id = ?
         ORDER BY d.dept_name`,
        [subjectId]
      );

      // Sheet 1: Subject Information with Department Access
      const subjectInfoData = [
        ['Subject ID', subjectInfo.subject_id],
        ['Subject Name', subjectInfo.subject_name],
        ['Created By', subjectInfo.creator_name],
        [],
        ['Department Access:'],
        ['Dept ID', 'Department Name', 'Dept-View-Locked']
      ];

      deptAccess.forEach(d => {
        subjectInfoData.push([
          d.dept_id,
          d.dept_name,
          d.dept_sub_lock ? 'Yes' : 'No'
        ]);
      });

      const ws1 = XLSX.utils.aoa_to_sheet(subjectInfoData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Subject Info');

      // Sheet 2: Topics Information
      const [topics] = await conn.execute(
        `SELECT topic_id, topic_name, display_order
         FROM topics
         WHERE subject_id = ?
         ORDER BY display_order`,
        [subjectId]
      );

      const topicsData = [
        ['Topic ID', 'Topic Name', 'Display Order', 'Level 1 Sets', 'Level 2 Sets']
      ];

      for (const topic of topics) {
        const [setCounts] = await conn.execute(
          `SELECT level, COUNT(*) as count
           FROM practice_sets
           WHERE topic_id = ?
           GROUP BY level`,
          [topic.topic_id]
        );

        let level1Count = 0;
        let level2Count = 0;
        setCounts.forEach(sc => {
          if (sc.level === '1') level1Count = sc.count;
          if (sc.level === '2') level2Count = sc.count;
        });

        topicsData.push([
          topic.topic_id,
          topic.topic_name,
          topic.display_order,
          level1Count,
          level2Count
        ]);
      }

      const ws2 = XLSX.utils.aoa_to_sheet(topicsData);
      XLSX.utils.book_append_sheet(workbook, ws2, 'Topics Info');

      // Sheet 3: All Questions from all topics
      const [questions] = await conn.execute(
        `SELECT t.topic_id, t.topic_name, ps.set_id, ps.level,
                q.question_id, q.question_type, q.question_text,
                q.option_a, q.option_b, q.option_c, q.option_d,
                q.correct_answer, q.marks, q.image_url
         FROM questions q
         JOIN practice_set_questions psq ON q.question_id = psq.question_id
         JOIN practice_sets ps ON psq.set_id = ps.set_id
         JOIN topics t ON ps.topic_id = t.topic_id
         WHERE t.subject_id = ?
         ORDER BY t.display_order, ps.level, ps.display_order, q.question_id`,
        [subjectId]
      );

      const questionsData = [
        ['Topic ID', 'Topic Name', 'Set ID', 'Level', 'Question ID', 'Type', 'Question Text', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Marks', 'Image URL']
      ];

      questions.forEach(q => {
        questionsData.push([
          q.topic_id,
          q.topic_name,
          q.set_id,
          `Level ${q.level}`,
          q.question_id,
          q.question_type,
          q.question_text,
          q.option_a || '',
          q.option_b || '',
          q.option_c || '',
          q.option_d || '',
          q.correct_answer,
          q.marks,
          q.image_url || ''
        ]);
      });

      const ws3 = XLSX.utils.aoa_to_sheet(questionsData);
      XLSX.utils.book_append_sheet(workbook, ws3, 'All Questions');

    } else if (export_type === 'attempts') {
      // Sheet 1: Subject Information
      const subjectInfoData = [
        ['Subject ID', subjectInfo.subject_id],
        ['Subject Name', subjectInfo.subject_name],
        ['Created By', subjectInfo.creator_name]
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(subjectInfoData);
      XLSX.utils.book_append_sheet(workbook, ws1, 'Subject Info');

      // Sheet 2: Student Attempts by Topic and Level
      const [attempts] = await conn.execute(
        `SELECT t.topic_id, t.topic_name, ps.level, ps.set_id,
                pa.student_id, u.full_name, u.email, s.dept_id, s.batch_year, d.dept_name,
                MAX(pa.score) as best_score, COUNT(*) as total_attempts
         FROM practice_attempts pa
         JOIN practice_sets ps ON pa.set_id = ps.set_id
         JOIN topics t ON ps.topic_id = t.topic_id
         JOIN users u ON pa.student_id = u.user_id
         JOIN students s ON pa.student_id = s.student_id
         LEFT JOIN departments d ON s.dept_id = d.dept_id
         WHERE t.subject_id = ?
         GROUP BY t.topic_id, ps.level, ps.set_id, pa.student_id
         ORDER BY t.topic_id, ps.level, ps.set_id, best_score DESC`,
        [subjectId]
      );

      const attemptsData = [
        ['Topic ID', 'Topic Name', 'Level', 'Set ID', 'Student ID', 'Name', 'Email', 'Department', 'Batch Year', 'Best Score', 'Total Attempts']
      ];

      attempts.forEach(a => {
        attemptsData.push([
          a.topic_id,
          a.topic_name,
          `Level ${a.level}`,
          a.set_id,
          a.student_id,
          a.full_name,
          a.email,
          a.dept_name || 'N/A',
          a.batch_year || 'N/A',
          Number(a.best_score),
          a.total_attempts
        ]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(attemptsData);
      XLSX.utils.book_append_sheet(workbook, ws2, 'Student Attempts');
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=subject_${subjectId}_${export_type}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (err) {
    next(new AppError('Failed to export subject', 500));
  } finally {
    conn.release();
  }
});