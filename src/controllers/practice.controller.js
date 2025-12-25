// backend/src/controllers/practice.controller.js
import { catchAsync } from '../utils/catchAsync.js';
import { successResponse } from '../utils/responseFormatter.js';
import { AppError } from '../utils/appError.js';
import {pool} from '../config/db.js';


import { evaluateAnswers } from '../utils/practiceEvaluator.js';

// 1. Get Set Questions
export const getSetQuestions = catchAsync(async (req, res, next) => {
  const setId = req.setId; // from attachSet middleware

  // Get set info including negative_marking
  const [setInfo] = await pool.execute(
    `SELECT negative_marking FROM practice_sets WHERE set_id = ?`,
    [setId]
  );

  if (setInfo.length === 0) {
    return next(new AppError('Set not found', 404));
  }

  const negativeMarking = Boolean(setInfo[0].negative_marking===1);

  // Get all questions for this set
  const [questions] = await pool.execute(
    `SELECT q.question_id, q.question_type, q.question_text, 
            q.option_a, q.option_b, q.option_c, q.option_d, 
            q.marks, q.image_url
     FROM questions q
     JOIN practice_set_questions psq ON q.question_id = psq.question_id
     WHERE psq.set_id = ?
     ORDER BY q.question_id`,
    [setId]
  );

  const formattedQuestions = questions.map(q => {
    const base = {
      question_id: q.question_id,
      question_type: q.question_type,
      question_text: q.question_text,
      marks: q.marks,
      image_url: q.image_url
    };

    // Include options only for MCQ and MSQ
    if (q.question_type === 'MCQ' || q.question_type === 'MSQ') {
      base.option_a = q.option_a;
      base.option_b = q.option_b;
      base.option_c = q.option_c;
      base.option_d = q.option_d;
    }

    return base;
  });

  return successResponse(res, {
    set_id: setId,
    negative_marking: negativeMarking,
    questions: formattedQuestions,
    total_questions: formattedQuestions.length
  });
});


// 2. Get Student Practice History
export const getStudentPracticeHistory = catchAsync(async (req, res, next) => {
  const setId = req.setId; // from attachSet middleware
  const userId = req.user.userId;
  const role = req.user.role;

  if (role !== 'Student') {
    return next(new AppError('Only students can view practice history', 403));
  }

  // Get all attempts for this set by this student
  const [attempts] = await pool.execute(
    `SELECT practice_id, score, attempt_at
     FROM practice_attempts
     WHERE student_id = ? AND set_id = ?
     ORDER BY attempt_at DESC`,
    [userId, setId]
  );

  let bestScore = 0;
  if (attempts.length > 0) {
    bestScore = Math.max(...attempts.map(a => Number(a.score)));
  }

  return successResponse(res, {
    set_id: setId,
    attempts: attempts.map(a => ({
      practice_id: a.practice_id,
      score: Number(a.score),
      attempt_at: a.attempt_at
    })),
    best_score: bestScore,
    total_attempts: attempts.length
  });
});

// 3. Submit Practice Attempt
export const submitPracticeAttempt = catchAsync(async (req, res, next) => {
  const setId = req.setId; // from attachSet middleware
  const userId = req.user.userId;
  const role = req.user.role;
  const { user_answers } = req.body;

  if (!Array.isArray(user_answers) || user_answers.length === 0) {
    return next(new AppError('user_answers array is required and must not be empty', 400));
  }

  // Get all questions with correct answers, marks, and set settings
  const [questions] = await pool.execute(
    `SELECT 
       q.question_id, 
       q.question_type, 
       q.correct_answer, 
       q.marks,
       ps.threshold_percentage, 
       ps.negative_marking
     FROM questions q
     JOIN practice_set_questions psq ON q.question_id = psq.question_id
     JOIN practice_sets ps ON psq.set_id = ps.set_id
     WHERE ps.set_id = ?
     ORDER BY psq.order_in_set`,
    [setId]
  );

  if (questions.length === 0) {
    return next(new AppError('No questions found for this practice set', 404));
  }

  const negativeMarking = questions[0].negative_marking === 1;

  // Evaluate answers (now supports real fractional negative marking)
  const evaluation = evaluateAnswers(questions, user_answers, negativeMarking);

  const evaluationResponse = {
    results: evaluation.results,
    total_marks: evaluation.total_marks,
    scored_marks: evaluation.scored_marks,
    threshold_percentage: evaluation.threshold_percentage,
    threshold_marks: evaluation.threshold_marks,
    passed: evaluation.passed
  };

  // Only save attempt and update score if Student AND passed
  if (role === 'Student' && evaluation.passed) {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const currentScore = evaluation.scored_marks;

      // Get student's best previous score for this set
      const [prevRows] = await conn.execute(
        `SELECT MAX(score) AS best_score 
         FROM practice_attempts 
         WHERE student_id = ? AND set_id = ?`,
        [userId, setId]
      );

      const bestScore = prevRows[0]?.best_score ? Number(prevRows[0].best_score) : 0;
      const isFirstAttempt = bestScore === 0;

      // Calculate how much to add to practice_score
      let scoreIncrement = 0;
      if (isFirstAttempt) {
        scoreIncrement = currentScore;
      } else if (currentScore > bestScore) {
        scoreIncrement = currentScore - bestScore;
      }

      // Save the attempt (with decimal score)
      await conn.execute(
        `INSERT INTO practice_attempts (student_id, set_id, score, attempt_at)
         VALUES (?, ?, ?, NOW())`,
        [userId, setId, currentScore]
      );

      // Update student's overall practice_score if improved
      if (scoreIncrement > 0) {
        await conn.execute(
          `UPDATE students 
           SET practice_score = practice_score + ? 
           WHERE student_id = ?`,
          [scoreIncrement, userId]
        );
      }

      // Check if student has passed ALL sets in this topic-level
      const [[setInfo]] = await conn.execute(
        `SELECT topic_id, level FROM practice_sets WHERE set_id = ?`,
        [setId]
      );

      const { topic_id: topicId, level } = setInfo;

      const [[totalSets]] = await conn.execute(
        `SELECT COUNT(*) AS total 
         FROM practice_sets 
         WHERE topic_id = ? AND level = ?`,
        [topicId, level]
      );

      const [[passedSets]] = await conn.execute(
        `SELECT COUNT(DISTINCT pa.set_id) AS passed_count
         FROM practice_attempts pa
         WHERE pa.student_id = ?
           AND pa.set_id IN (
             SELECT set_id FROM practice_sets WHERE topic_id = ? AND level = ?
           )
           )`,
        [userId, topicId, level]
      );
      let levelCompletion=false;
      // If all sets in this level are passed → mark level complete
      if (passedSets.passed_count === totalSets.total) {
        levelCompletion=true
        await conn.execute(
          `INSERT INTO student_topic_levels (student_id, topic_id, level, updated_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [userId, topicId, level]
        );
      }

      await conn.commit();

      const studentResponse = {
        total_marks: evaluation.total_marks,
        scored_marks: evaluation.scored_marks,
        threshold_percentage: evaluation.threshold_percentage,
        threshold_marks: evaluation.threshold_marks,
        passed: evaluation.passed
      };
      return successResponse(res, {
        evaluation: studentResponse,
        saved: true,
        score_increment: scoreIncrement,
        previous_best_score: bestScore,
        current_score: currentScore,
        level_completed: levelCompletion
      }, 'Practice attempt saved and score updated successfully');

      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

  // For Staff preview, failed attempts, or non-Students → just evaluate
  return successResponse(res, {
    evaluation: evaluationResponse,
    saved: false
  }, evaluation.passed 
    ? 'Evaluation complete (not saved — only passing student attempts are recorded)' 
    : 'Evaluation complete (failed — not saved)'
  );
});