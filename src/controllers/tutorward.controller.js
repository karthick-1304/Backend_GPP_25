// backend/src/controllers/tutorward.controller.js
import { pool } from '../config/db.js';
import { catchAsync } from '../utils/catchAsync.js';
import {AppError} from '../utils/appError.js';

// 1. Get all students assigned to current tutor
export const getMyTutorStudents = catchAsync(async (req, res, next) => {
  const tutorId = req.user.userId;

  const [students] = await pool.execute(`
    SELECT s.student_id, u.full_name, u.email, s.batch_year, d.dept_name
    FROM students s
    JOIN users u ON s.student_id = u.user_id
    LEFT JOIN departments d ON s.dept_id = d.dept_id
    WHERE s.tutor_id = ?
    ORDER BY s.batch_year DESC, u.full_name
  `, [tutorId]);

  res.status(200).json({
    status: 'success',
    data: { students }
  });
});

// 2. Get unassigned students by batch + dept
export const getUnassignedStudents = catchAsync(async (req, res, next) => {
  const { batchYear, deptId } = req.query;

  if (!batchYear || !deptId) {
    return next(new AppError('Batch year and department are required', 400));
  }

  const [students] = await pool.execute(`
    SELECT s.student_id, u.full_name, u.email, s.batch_year, d.dept_name
    FROM students s
    JOIN users u ON s.student_id = u.user_id
    LEFT JOIN departments d ON s.dept_id = d.dept_id
    WHERE s.tutor_id IS NULL
      AND s.batch_year = ?
      AND s.dept_id = ?
    ORDER BY u.full_name
  `, [batchYear, deptId]);

  res.status(200).json({
    status: 'success',
    data: { students }
  });
});
// controllers/tutorController.js

// Helper: Update is_tutor flag based on current ward count
const updateTutorStatus = async (tutorId, conn) => {
  const [count] = await conn.execute(
    `SELECT COUNT(*) as wardCount FROM students WHERE tutor_id = ?`,
    [tutorId]
  );

  const hasWards = count[0].wardCount > 0;

  await conn.execute(
    `UPDATE staff SET is_tutor = ? WHERE staff_id = ?`,
    [hasWards ? 1 : 0, tutorId]
  );
};

// 3. Assign student to tutor (Auto-enable is_tutor)
export const assignStudentToTutor = catchAsync(async (req, res, next) => {
  const { studentId } = req.params;
  const tutorId = req.user.userId;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const [result] = await conn.execute(
      `UPDATE students SET tutor_id = ? WHERE student_id = ? AND tutor_id IS NULL`,
      [tutorId, studentId]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return next(new AppError('Student already has a tutor or not found', 400));
    }

    // Auto-update is_tutor = 1 (since they now have at least 1 ward)
    await updateTutorStatus(tutorId, conn);

    await conn.commit();

    res.status(200).json({
      status: 'success',
      message: 'Student assigned successfully',
      data: { is_tutor_now: true }
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// 4. Remove student from tutor (Auto-disable is_tutor if no wards left)
export const removeStudentFromTutor = catchAsync(async (req, res, next) => {
  const { studentId } = req.params;
  const tutorId = req.user.userId;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const [result] = await conn.execute(
      `UPDATE students SET tutor_id = NULL WHERE student_id = ? AND tutor_id = ?`,
      [studentId, tutorId]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return next(new AppError('Student not assigned to you or not found', 404));
    }

    // Re-check if tutor has any remaining wards
    await updateTutorStatus(tutorId, conn);

    // Get new status for response
    const [status] = await conn.execute(
      `SELECT is_tutor FROM staff WHERE staff_id = ?`,
      [tutorId]
    );

    await conn.commit();

    res.status(200).json({
      status: 'success',
      message: 'Student removed from your ward',
      data: {
        is_tutor_now: status[0]?.is_tutor === 1
      }
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// Add to tutorController.js
export const bulkAssignStudentsToTutor = catchAsync(async (req, res, next) => {
  const { studentIds } = req.body; // array
  const tutorId = req.user.userId;

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return next(new AppError('studentIds array required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const placeholders = studentIds.map(() => '?').join(',');
    const [result] = await conn.execute(
      `UPDATE students SET tutor_id = ? WHERE student_id IN (${placeholders}) AND tutor_id IS NULL`,
      [tutorId, ...studentIds]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return next(new AppError('No students were assignable (already assigned)?', 400));
    }

    await updateTutorStatus(tutorId, conn);
    await conn.commit();

    res.status(200).json({
      status: 'success',
      message: `${result.affectedRows} students assigned to you`,
      data: { assignedCount: result.affectedRows }
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

