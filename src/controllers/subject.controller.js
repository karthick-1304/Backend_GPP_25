// backend/src/controllers/subject.controller.js
import { catchAsync } from "../utils/catchAsync.js";
import { successResponse } from "../utils/responseFormatter.js";
import { AppError } from "../utils/appError.js";
import { pool } from "../config/db.js";
import archiver from "archiver";

import { getAccessibleSubjects, getUnAccessibleSubjects } from "../services/accessService.js";
import {
  sendSubjectCreatedEmail,
  sendSubjectLockToDeptHeads,
  sendSubjectLockToParticipants,
  sendDeptSubLockToParticipants
} from "../services/email.service.js";
import {
  exportSubjectAsExcel,
  generateExcelBuffer
} from "../utils/backup.util.js";

export const getSubjects = catchAsync(async (req, res) => {
  const { userId, role } = req.user;

  const subjects = await getAccessibleSubjects(userId, role);
  const mySubjects = [];
  const otherSubjects = [];

  for (const sub of subjects) {

    if (role === 'Admin') {
      mySubjects.push({
        ...sub,
        canEdit: true,
        canRecord: false,
        superAccess: true
      });
    }

    else if (role === 'Dept Head') {
      mySubjects.push({
        ...sub,
        canEdit: true,
        canRecord: false,
        superAccess: sub.created_by === userId
      });
    }

    else if (role === 'Staff') {
      mySubjects.push({
        ...sub,
        canEdit: false,
        canRecord: false
      });
    }

    else if (role === 'Student') {
      mySubjects.push({
        ...sub,
        canEdit: false,
        canRecord: true
      });
    }
  }
  if(role==='Dept Head'){
    const unAcccessibleSubs = await getUnAccessibleSubjects(userId, role);
    for (const sub of unAcccessibleSubs) {
      otherSubjects.push({
        ...sub,
        canEdit: false,
        canRecord: false
      });
    }
  }

  return successResponse(res, { mySubjects, otherSubjects });
});



export const createSubject = catchAsync(async (req, res, next) => {
  const { subject_name, dept_ids = [], notifyDeptHeads = false } = req.body;
  const creatorId = req.user.userId;
  const role = req.user.role;

  if (!subject_name?.trim()) {
    return next(new AppError("Subject name is required", 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {

    let creatorTitle='';
    if(role==='Admin'){
      creatorTitle='Admin';
    }
    else if(role==='Dept Head'){
      const [dept] =  await conn.execute(
        `SELECT dept_code FROM departments WHERE head_user_id = ?`,
        [creatorId]
      );
      creatorTitle = dept[0]?.dept_code || '';
    }
    
    const [result] = await conn.execute(
      `INSERT INTO subjects (subject_name, created_by, creator, updated_by) VALUES (?, ?, ?, ?)`,
      [subject_name.trim(), creatorId, creatorTitle, creatorId]
    );
    const subjectId = result.insertId;

    if (dept_ids.length > 0) {
      const placeholders = dept_ids.map(() => "(?, ?)").join(", ");
      const values = [];
      dept_ids.forEach((id) => values.push(subjectId, id));
      await conn.execute(
        `INSERT IGNORE INTO subject_access_dept (subject_id, dept_id) VALUES ${placeholders}`,
        values
      );
    }

    await conn.commit();

    // Get creator info
    const [[creator]] = await pool.execute(
      `SELECT u.full_name
       FROM users u 
       WHERE u.user_id = ?`,
      [creatorId]
    );

    // Get added departments
    const [addedDepts] =
      dept_ids.length > 0
        ? await pool.execute(
            `SELECT dept_name, dept_code FROM departments WHERE dept_id IN (${dept_ids.join(",")})`
          )
        : [[]];

    // Send notifications
    if (notifyDeptHeads) {
      const [deptHeads] = await pool.execute(
        `SELECT u.email, u.full_name 
         FROM users u 
         WHERE u.role = 'Dept Head'`
      );
      await sendSubjectCreatedEmail(
        deptHeads,
        subject_name.trim(),
        subjectId,
        creator.full_name,
        addedDepts
      );
    }

    return successResponse(
      res,
      {
        subject_id: subjectId,
        subject_name: subject_name.trim(),
      },
      "Subject created",
      201
    );
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

export const updateSubjectName = catchAsync(async (req, res, next) => {
  const { subject_name } = req.body;
  const subjectId = req.subjectId;
  const userId = req.user.userId;

  if (!subject_name?.trim()) {
    return next(new AppError("Subject name is required", 400));
  }

  const trimmed = subject_name.trim();
  const [current] = await pool.execute(
    "SELECT subject_name FROM subjects WHERE subject_id = ?",
    [subjectId]
  );

  if (current[0].subject_name === trimmed) {
    return next(new AppError("New name is same as current. Must be different.", 400));
  }

  await pool.execute(
    "UPDATE subjects SET subject_name = ?, updated_by = ? WHERE subject_id = ?",
    [trimmed, userId, subjectId]
  );

  return successResponse(res, { subject_id: subjectId, subject_name: trimmed });
});

// 4. TOGGLE SUBJECT LOCK
export const toggleSubjectLock = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;
  const userId = req.user.userId;
  const { notifyDeptHeads = false, notifyParticipants = false } = req.body;

  const [[subject]] = await pool.execute(
    "SELECT locked, subject_name FROM subjects WHERE subject_id = ?",
    [subjectId]
  );

  const newLocked = subject.locked === 1 ? 0 : 1;

  await pool.execute(
    "UPDATE subjects SET locked = ?, updated_by = ? WHERE subject_id = ?",
    [newLocked, userId, subjectId]
  );

  // Get locker info
  const [[locker]] = await pool.execute(
    `SELECT u.full_name
     FROM users u 
     WHERE u.user_id = ?`,
    [userId]
  );

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
    await sendSubjectLockToDeptHeads(
      deptHeads,
      subject.subject_name,
      newLocked === 1,
      locker.full_name
    );
  }

  if (notifyParticipants) {
    const [participants] = await pool.execute(
      `SELECT DISTINCT u.email, u.full_name 
       FROM users u 
       LEFT JOIN students s ON u.user_id = s.student_id 
       LEFT JOIN staff st ON u.user_id = st.staff_id
       JOIN subject_access_dept sad ON (sad.dept_id = s.dept_id OR sad.dept_id = st.dept_id)
       WHERE sad.subject_id = ? AND u.role IN ('Student', 'Staff')`,
      [subjectId]
    );
    await sendSubjectLockToParticipants(
      participants,
      subject.subject_name,
      newLocked === 1
    );
  }

  return successResponse(
    res,
    {
      subject_id: subjectId,
      isLocked: newLocked === 1,
    },
    newLocked === 1 ? "Subject locked" : "Subject unlocked"
  );
});

// 5. TOGGLE DEPT SUBJECT LOCK
export const toggleDeptSubjectLock = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;
  const subject = req.subject;
  const userId = req.user.userId;
  const { notifyParticipants = false } = req.body;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

   if (role !== 'Dept Head') {
    return next(new AppError('Only Dept Head can toggle DeptSubjectLock', 403));
  }

  try {
    const [[dept]] = await conn.execute(
      `SELECT dept_id, dept_name FROM departments WHERE head_user_id = ?`,
      [userId]
    );

    if (!dept) {
      await conn.rollback();
      return next(new AppError("Department not found", 404));
    }

    const [[access]] = await conn.execute(
      `SELECT dept_sub_lock FROM subject_access_dept WHERE subject_id = ? AND dept_id = ?`,
      [subjectId, dept.dept_id]
    );

    if (!access) {
      await conn.rollback();
      return next(new AppError("Subject access not found", 404));
    }

    const newLocked = access.dept_sub_lock === 1 ? 0 : 1;

    await conn.execute(
      `UPDATE subject_access_dept SET dept_sub_lock = ? WHERE subject_id = ? AND dept_id = ?`,
      [newLocked, subjectId, dept.dept_id]
    );

    if (notifyParticipants) {
      const [participants] = await conn.execute(
        `SELECT u.email, u.full_name
          FROM users u
          INNER JOIN students s ON u.user_id = s.student_id AND s.dept_id = ?
          WHERE u.role = 'Student'

          UNION

        SELECT u.email, u.full_name
          FROM users u
          INNER JOIN staff st ON u.user_id = st.staff_id AND st.dept_id = ?
          WHERE u.role = 'Staff'`,
        [dept.dept_id, dept.dept_id]
      );
      await sendDeptSubLockToParticipants(
        participants,
        subject.subject_name,
        dept.dept_name,
        newLocked === 1
      );
    }

    await conn.commit();

    return successResponse(
      res,
      {
        subject_id: subjectId,
        dept_id: dept.dept_id,
        isDeptSubLocked: newLocked === 1,
      },
      newLocked === 1
        ? "Department access locked"
        : "Department access unlocked"
    );
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

export const deleteSubjectWithBackup = catchAsync(async (req, res, next) => {
  const subjectId = req.subjectId;
  const userId = req.user.userId;
  const role = req.user.role;

  const conn = await pool.getConnection();

  try {
    // Check if user has permission to delete
    const [subjectInfo] = await conn.execute(
      `SELECT created_by FROM subjects WHERE subject_id = ?`,
      [subjectId]
    );

    if (subjectInfo.length === 0) {
      return next(new AppError("Subject not found", 404));
    }

    const canDelete =
      role === "Admin" ||
      (role === "Dept Head" && subjectInfo[0].created_by === userId);

    if (!canDelete) {
      return next(
        new AppError("You do not have permission to delete this subject", 403)
      );
    }

    // Generate Excel exports
    const contentBuffer = await generateExcelBuffer(
      exportSubjectAsExcel,
      req,
      "content"
    );
    const attemptsBuffer = await generateExcelBuffer(
      exportSubjectAsExcel,
      req,
      "attempts"
    );

    // Create ZIP archive
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      throw err;
    });

    // Set response headers
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=subject_${subjectId}_backup.zip`
    );

    // Pipe archive to response
    archive.pipe(res);

    // Add files to archive
    archive.append(contentBuffer, {
      name: `subject_${subjectId}_content.xlsx`,
    });
    archive.append(attemptsBuffer, {
      name: `subject_${subjectId}_attempts.xlsx`,
    });

    // Finalize archive
    await archive.finalize();

    // Delete subject from database (CASCADE will handle related data)
    await conn.execute(`DELETE FROM subjects WHERE subject_id = ?`, [
      subjectId,
    ]);

    conn.release();

    // Note: Response is already sent via archive.pipe(res)
  } catch (err) {
    conn.release();
    next(
      err instanceof AppError
        ? err
        : new AppError("Failed to delete subject", 500)
    );
  }
});
