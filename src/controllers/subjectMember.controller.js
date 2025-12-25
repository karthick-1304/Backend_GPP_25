// backend/src/controllers/subjectMember.controller.js
import { catchAsync } from '../utils/catchAsync.js';
import { successResponse } from '../utils/responseFormatter.js';
import { AppError } from '../utils/appError.js';
import {pool} from '../config/db.js';


import { hasSubjectAccess } from '../services/accessService.js';
import { sendDeptAddedToSubject, sendDeptRemovedFromSubject, sendSubjectAccessRequestEmail } from '../services/email.service.js';

export const getSubjectMembers = catchAsync(async (req, res, next) => {
  const  subjectId = req.subjectId;
  const {locked}= req.subject;
  const userId = req.user.userId;
  const role = req.user.role;

  const canEdit = await hasSubjectAccess(subjectId, userId, role);

  // Departments WITH access
  const [accessIn] = await pool.execute(
    `SELECT d.dept_id, d.dept_code, d.dept_name
    FROM departments d
    JOIN subject_access_dept sad ON sad.dept_id = d.dept_id
    WHERE sad.subject_id = ?`,
    [subjectId]
  );

  // Dept Head without edit access → return only access-in
  if (role === 'Dept Head' && !canEdit) {
    return successResponse(res, {
      accessIn:accessIn,
      accessOut: []
    });
  }

  // Departments WITHOUT access
  const [accessOut] = await pool.execute(
    `SELECT d.dept_id, d.dept_code, d.dept_name
    FROM departments d
    WHERE d.dept_id NOT IN (
      SELECT dept_id FROM subject_access_dept WHERE subject_id = ?
    )`,
    [subjectId]
  );

  return successResponse(res, { accessIn:accessIn, accessOut:accessOut });
});


// controllers/subjectAccess.controller.js
export const requestSubjectAccess = catchAsync(async (req, res, next) => {
  const { subjectId } = req.params;
  const userId = req.user.userId;
  const role = req.user.role;

  if (role !== 'Dept Head') {
    return next(new AppError('Only Dept Head can request subject access', 403));
  }

  const [[dept]] = await pool.execute(
    `SELECT dept_id, dept_name, dept_code FROM departments WHERE head_user_id = ?`,
    [userId]
  );

  if (!dept) {
    return next(new AppError('Department not found', 404));
  }

  const [[subject]] = await pool.execute(
    `SELECT subject_id, subject_name, created_by FROM subjects WHERE subject_id = ?`,
    [subjectId]
  );

  if (!subject) {
    return next(new AppError('Subject not found', 404));
  }

  const [existingRows] = await pool.execute(
    `SELECT subject_id
    FROM subject_access_dept
    WHERE subject_id = ? AND dept_id = ?
    LIMIT 1`,
    [subjectId, dept.dept_id]
  );

  if (existingRows.length > 0) {
    return next(new AppError('Your department already has access to this subject', 400));
  }


  const [[creator]] = await pool.execute(
    `SELECT u.full_name, u.email 
     FROM users u
     LEFT JOIN departments d ON d.head_user_id = u.user_id
     WHERE u.user_id = ?`,
    [subject.created_by]
  );

  if (!creator) {
    return next(new AppError('Subject creator not found', 404));
  }

  const [[requester]] = await pool.execute(
    `SELECT full_name, email FROM users WHERE user_id = ?`,
    [userId]
  );

  await sendSubjectAccessRequestEmail(
    creator.email,
    creator.full_name,
    requester.full_name,
    requester.email,
    dept.dept_name,
    dept.dept_code,
    subject.subject_name,
    subjectId
  );

  return successResponse(res, null, 'Access request sent successfully');
});


export const addSubjectMember = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;
  const { deptId } = req.params;
  const { notifyDeptHead = false } = req.body;
  const userId = req.user.userId;

  await pool.execute(
    `INSERT IGNORE INTO subject_access_dept (subject_id, dept_id) VALUES (?, ?)`,
    [subjectId, deptId]
  );

  // Get adder and subject info
  const [[adder]] = await pool.execute(
    `SELECT u.full_name, d.dept_name 
     FROM users u 
     LEFT JOIN departments d ON d.head_user_id = u.user_id 
     WHERE u.user_id = ?`,
    [userId]
  );

  const [[subject]] = await pool.execute('SELECT subject_name FROM subjects WHERE subject_id = ?', [subjectId]);
  const [[targetDept]] = await pool.execute('SELECT dept_name FROM departments WHERE dept_id = ?', [deptId]);

  // Send notifications
  if (notifyDeptHead) {
    const [[deptHead]] = await pool.execute(
      `SELECT u.email, u.full_name 
       FROM users u 
       JOIN departments d ON d.head_user_id = u.user_id 
       WHERE d.dept_id = ?`,
      [deptId]
    );
    if (deptHead) {
      await sendDeptAddedToSubject([deptHead], subject.subject_name, targetDept.dept_name, adder.full_name);
    }
  }

  return successResponse(res, null, 'Department added to subject');
});



export const removeSubjectMember = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;
  const { deptId } = req.params;
  const { notifyDeptHead = false } = req.body;
  const userId = req.user.userId;

  const [[subject]] = await pool.execute(
    `SELECT created_by, subject_name FROM subjects WHERE subject_id = ?`,
    [subjectId]
  );

  const [[creatorDept]] = await pool.execute(
    `SELECT dept_id FROM departments WHERE head_user_id = ?`,
    [subject.created_by]
  );

  if (creatorDept?.dept_id == deptId) {
    return next(new AppError('Cannot remove creator department', 400));
  }

  await pool.execute(
    `DELETE FROM subject_access_dept WHERE subject_id = ? AND dept_id = ?`,
    [subjectId, deptId]
  );

  // Get remover info
  const [[remover]] = await pool.execute(
    `SELECT u.full_name
     FROM users u 
     LEFT JOIN departments d ON d.head_user_id = u.user_id 
     WHERE u.user_id = ?`,
    [userId]
  );

  const [[targetDept]] = await pool.execute('SELECT dept_name FROM departments WHERE dept_id = ?', [deptId]);

  // Send notifications
  if (notifyDeptHead) {
    const [[deptHead]] = await pool.execute(
      `SELECT u.email, u.full_name 
       FROM users u 
       JOIN departments d ON d.head_user_id = u.user_id 
       WHERE d.dept_id = ?`,
      [deptId]
    );
    if (deptHead) {
      await sendDeptRemovedFromSubject([deptHead], subject.subject_name, targetDept.dept_name, remover.full_name);
    }
  }

  if (notifyParticipants) {
    const [participants] = await pool.execute(
      `SELECT u.email, u.full_name 
       FROM users u 
       JOIN students s ON u.user_id = s.student_id 
       WHERE s.dept_id = ? AND u.role = 'Student'`,
      [deptId]
    );
    await sendDeptRemovedFromSubject(participants, subject.subject_name, targetDept.dept_name, remover.full_name, remover.dept_name);
  }

  return successResponse(res, null, 'Department removed from subject');
});



export const leaveSubjectMember = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;
  const userId = req.user.userId;
  const role = req.user.role;

  if (role !== 'Dept Head') {
    return next(new AppError('Only Dept Head can leave subject', 403));
  }

  const [[subject]] = await pool.execute(
    `SELECT created_by FROM subjects WHERE subject_id = ?`,
    [subjectId]
  );

  if (subject.created_by === userId) {
    return next(new AppError('Subject creator department cannot be leave', 400));
  }

  const [[userDept]] = await pool.execute(
    `SELECT dept_id FROM departments WHERE head_user_id = ?`,
    [userId]
  );

  await pool.execute(
    `DELETE FROM subject_access_dept WHERE subject_id = ? AND dept_id = ?`,
    [subjectId, userDept.dept_id]
  );

  return successResponse(res, null, 'You have left the subject');
});
