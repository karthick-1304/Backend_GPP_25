// backend/src/controllers/admin.controller.js
import { catchAsync } from '../utils/catchAsync.js';
import { successResponse } from '../utils/responseFormatter.js';
import { AppError } from '../utils/appError.js';
import {pool} from '../config/db.js';
import bcrypt from 'bcrypt';


import { parseStudentsExcel, parseStaffExcel } from '../utils/excelParser.util.js';



// 1. Get Participants
export const getParticipants = catchAsync(async (req, res, next) => {
  const { role, dept_code, batch_year } = req.query;

  if (!role || !['Admin', 'Dept Head', 'Staff', 'Student'].includes(role)) {
    return next(new AppError('Valid role is required', 400));
  }

  let query = '';
  let params = [];

  if (role === 'Admin') {
    query = `
      SELECT u.user_id, u.full_name, u.email, u.role
      FROM users u
      WHERE u.role = 'Admin'
      ORDER BY u.full_name
    `;
  }
  else if (role === 'Dept Head') {

    query = `
      SELECT u.user_id, u.full_name, u.email, u.role, d.dept_code
      FROM users u
      JOIN departments d ON u.user_id = d.head_user_id
      WHERE u.role = 'Dept Head'
      ORDER BY u.full_name
    `;
  }
  else if (role === 'Staff') {
    if (!dept_code) {
      return next(new AppError('dept_code is required for Staff', 400));
    }

    query = `
      SELECT u.user_id,  u.full_name, u.email, u.role, d.dept_code, s.is_tutor
      FROM users u
      JOIN staff s ON u.user_id = s.staff_id
      JOIN departments d ON s.dept_id = d.dept_id
      WHERE u.role = 'Staff' AND d.dept_code = ?
      ORDER BY u.full_name
    `;
    params = [dept_code];
  }
  else if (role === 'Student') {
    if (!dept_code || !batch_year) {
      return next(new AppError('dept_code and batch_year are required for Student', 400));
    }

    query = `
      SELECT u.user_id, u.full_name, u.email, u.role,
             st.batch_year, d.dept_code,
             CASE WHEN st.tutor_id IS NOT NULL THEN 1 ELSE 0 END as has_tutor
      FROM users u
      JOIN students st ON u.user_id = st.student_id
      JOIN departments d ON st.dept_id = d.dept_id
      WHERE u.role = 'Student' AND d.dept_code = ? AND st.batch_year = ?
      ORDER BY u.full_name
    `;
    params = [dept_code, batch_year];
  }

  const [participants] = await pool.execute(query, params);

  return successResponse(res, {
    role,
    participants,
    total: participants.length
  });
});


// 2. Get Participant Details
export const getParticipantDetails = catchAsync(async (req, res, next) => {
  const userId = parseInt(req.params.userId);

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  // Get basic user info
  const [userInfo] = await pool.execute(
    `SELECT user_id, full_name, email, phone_number,  role, 
            last_login, created_at
     FROM users WHERE user_id = ?`,
    [userId]
  );

  if (userInfo.length === 0) {
    return next(new AppError('User not found', 404));
  }

  const user = userInfo[0];
  let additionalInfo = {};

  // Get role-specific details
  if (user.role === 'Dept Head') {
    const [deptInfo] = await pool.execute(
      `SELECT d.dept_id, d.dept_name
       FROM departments d
       WHERE d.head_user_id = ?`,
      [userId]
    );
    additionalInfo.department = deptInfo[0] || null;
  }
  else if (user.role === 'Staff') {
    const [staffInfo] = await pool.execute(
      `SELECT s.staff_id, s.dept_id, d.dept_name
              s.is_tutor
       FROM staff s
       LEFT JOIN departments d ON s.dept_id = d.dept_id
       WHERE s.staff_id = ?`,
      [userId]
    );
    additionalInfo.staff_details = staffInfo[0] || null;

    // If tutor, get assigned students
    if (staffInfo[0]?.is_tutor) {
      const [students] = await pool.execute(
        `SELECT st.student_id, u.full_name, u.email, st.batch_year
         FROM students st
         JOIN users u ON st.student_id = u.user_id
         WHERE st.tutor_id = ?`,
        [userId]
      );
      additionalInfo.assigned_students = students;
    }
  }
  else if (user.role === 'Student') {

    const [studentInfo] = await pool.execute(
      `SELECT st.student_id, st.dept_id, d.dept_name
              st.batch_year, st.practice_score, st.test_score,
              st.tutor_id, t.full_name as tutor_name
      FROM students st
      LEFT JOIN departments d ON st.dept_id = d.dept_id
      LEFT JOIN users t ON st.tutor_id = t.user_id
      LEFT JOIN staff s ON t.user_id = s.staff_id
      WHERE st.student_id = ?`,
      [userId]
    );
    additionalInfo.student_details = studentInfo[0] || null;
  }

  return successResponse(res, {
    ...user,
    ...additionalInfo
  });
});


// 3. Edit Participant Details
export const editParticipantDetails = catchAsync(async (req, res, next) => {
  const userId = parseInt(req.params.userId);
  const { full_name, email, phone_number, batch_year, dept_code, remove_tutor } = req.body;

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Get user role
    const [userInfo] = await conn.execute(
      `SELECT role FROM users WHERE user_id = ?`,
      [userId]
    );

    if (userInfo.length === 0) {
      throw new AppError('User not found', 404);
    }

    const role = userInfo[0].role;

    // Update common fields
    const updates = [];
    const params = [];

    if (full_name) {
      updates.push('full_name = ?');
      params.push(full_name.trim());
    }
    if (email) {
      updates.push('email = ?');
      params.push(email.trim());
    }
    if (phone_number !== undefined) {
      updates.push('phone_number = ?');
      params.push(phone_number || null);
    }


    if (updates.length > 0) {
      params.push(userId);
      await conn.execute(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE user_id = ?`,
        params
      );
    }

    // Role-specific updates
    if (role === 'Student') {
      const studentUpdates = [];
      const studentParams = [];

      if (batch_year) {
        studentUpdates.push('batch_year = ?');
        studentParams.push(batch_year);
      }

      if (dept_code) {
        const [dept] = await conn.execute(
          `SELECT dept_id FROM departments WHERE dept_code = ?`,
          [dept_code]
        );
        if (dept.length > 0) {
          studentUpdates.push('dept_id = ?');
          studentParams.push(dept[0].dept_id);
        }
      }

      if (remove_tutor === true) {
        studentUpdates.push('tutor_id = NULL');
      }

      if (studentUpdates.length > 0) {
        studentParams.push(userId);
        await conn.execute(
          `UPDATE students SET ${studentUpdates.join(', ')} WHERE student_id = ?`,
          studentParams
        );
      }
    }
    else if (role === 'Staff') {
      const staffUpdates = [];
      const staffParams = [];

      if (dept_code) {
        const [dept] = await conn.execute(
          `SELECT dept_id FROM departments WHERE dept_code = ?`,
          [dept_code]
        );
        if (dept.length > 0) {
          staffUpdates.push('dept_id = ?');
          staffParams.push(dept[0].dept_id);
        }
      }

      if (staffUpdates.length > 0) {
        staffParams.push(userId);
        await conn.execute(
          `UPDATE staff SET ${staffUpdates.join(', ')} WHERE staff_id = ?`,
          staffParams
        );
      }
    }

    await conn.commit();
    return successResponse(res, null, 'Participant details updated successfully');

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to update participant details', 500));
  } finally {
    conn.release();
  }
});


// 4. Add Student
export const addStudent = catchAsync(async (req, res, next) => {
  const { full_name, email, password, phone_number, dept_code, batch_year, tutor_id } = req.body;

  if (!full_name || !email || !password || !dept_code || !batch_year || !phone_number) {
    return next(new AppError('full_name, email, password, phone_number, dept_code, and batch_year are required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Get dept_id
    const [dept] = await conn.execute(
      `SELECT dept_id FROM departments WHERE dept_code = ?`,
      [dept_code]
    );

    if (dept.length === 0) {
      throw new AppError('Department not found', 404);
    }

    const deptId = dept[0].dept_id;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user
    const [userResult] = await conn.execute(
      `INSERT INTO users (full_name, email, password_hash, phone_number, role)
       VALUES (?, ?, ?, ?, 'Student')`,
      [full_name.trim(), email.trim(), passwordHash, phone_number]
    );

    const userId = userResult.insertId;

    // Insert student
    await conn.execute(
      `INSERT INTO students (student_id, dept_id, batch_year, tutor_id)
       VALUES (?, ?, ?, ?)`,
      [userId, deptId, batch_year, tutor_id || null]
    );

    await conn.commit();
    return successResponse(res, { user_id: userId }, 'Student added successfully', 201);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to add student', 500));
  } finally {
    conn.release();
  }
});


// 5. Bulk Add Students
export const bulkAddStudentsFromExcel = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError('Excel file is required', 400));
  }

  const students = parseStudentsExcel(req.file.buffer);
  
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const results = [];

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      
      const [dept] = await conn.execute(
        `SELECT dept_id FROM departments WHERE dept_code = ?`,
        [student.dept_code]
      );

      if (dept.length === 0) {
        throw new AppError(`Department ${student.dept_code} not found`, 400);
      }

      const passwordHash = await bcrypt.hash(student.password, 12);

      const [userResult] = await conn.execute(
        `INSERT INTO users (full_name, email, password_hash, phone_number, role)
         VALUES (?, ?, ?, ?, 'Student')`,
        [student.full_name, student.email, passwordHash, student.phone_number]
      );

      await conn.execute(
        `INSERT INTO students (student_id, dept_id, batch_year, tutor_id)
         VALUES (?, ?, ?, ?)`,
        [userResult.insertId, dept[0].dept_id, student.batch_year, student.tutor_id]
      );

      results.push({ user_id: userResult.insertId, email: student.email });
    }

    await conn.commit();
    return successResponse(res, {
      added: results,
      total: results.length
    }, 'All students added successfully', 201);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to add students', 500));
  } finally {
    conn.release();
  }
});



// 6. Add Staff
export const addStaff = catchAsync(async (req, res, next) => {
  const { full_name, email, password, phone_number, dept_code } = req.body;

  if (!full_name || !email || !password || !dept_code || !phone_number) {
    return next(new AppError('full_name, email, password, phone_number, and dept_code are required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Get dept_id
    const [dept] = await conn.execute(
      `SELECT dept_id FROM departments WHERE dept_code = ?`,
      [dept_code]
    );

    if (dept.length === 0) {
      throw new AppError('Department not found', 404);
    }

    const deptId = dept[0].dept_id;
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user
    const [userResult] = await conn.execute(
      `INSERT INTO users (full_name, email, password_hash, phone_number, role)
       VALUES (?, ?, ?, ?, 'Staff')`,
      [full_name.trim(), email.trim(), passwordHash, phone_number]
    );

    const userId = userResult.insertId;

    // Insert staff
    await conn.execute(
      `INSERT INTO staff (staff_id, dept_id)
       VALUES (?, ?)`,
      [userId, deptId]
    );

    await conn.commit();
    return successResponse(res, { user_id: userId }, 'Staff added successfully', 201);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to add staff', 500));
  } finally {
    conn.release();
  }
});


// 7. Bulk Add Staff
export const bulkAddStaffFromExcel = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError('Excel file is required', 400));
  }

  const staff = parseStaffExcel(req.file.buffer);
  
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const results = [];

    for (let i = 0; i < staff.length; i++) {
      const member = staff[i];
      
      const [dept] = await conn.execute(
        `SELECT dept_id FROM departments WHERE dept_code = ?`,
        [member.dept_code]
      );

      if (dept.length === 0) {
        throw new AppError(`Department ${member.dept_code} not found`, 400);
      }

      const passwordHash = await bcrypt.hash(member.password, 12);

      const [userResult] = await conn.execute(
        `INSERT INTO users (full_name, email, password_hash, phone_number, role)
         VALUES (?, ?, ?, ?, 'Staff')`,
        [member.full_name, member.email, passwordHash, member.phone_number]
      );

      await conn.execute(
        `INSERT INTO staff (staff_id, dept_id)
         VALUES (?, ?)`,
        [userResult.insertId, dept[0].dept_id]
      );

      results.push({ user_id: userResult.insertId, email: member.email });
    }

    await conn.commit();
    return successResponse(res, {
      added: results,
      total: results.length
    }, 'All staff added successfully', 201);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to add staff', 500));
  } finally {
    conn.release();
  }
});

// 8. Create Department
export const createDepartment = catchAsync(async (req, res, next) => {
  const { dept_name, dept_code, head_full_name, head_email, head_password, head_phone_number } = req.body;

  if (!dept_name || !dept_code || !head_full_name || !head_email || !head_password ) {
    return next(new AppError('dept_name, dept_code, head_full_name, head_email, and head_password are required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {

    const passwordHash = await bcrypt.hash(head_password, 12);

     const [userResult] = await conn.execute(
      `INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES (?, ?, ?, ?, 'Dept Head')`,
      [head_full_name.trim(), head_email.trim(), passwordHash, head_phone_number || null]
    );

    const headUserId = userResult.insertId;
    

    const [result] = await conn.execute(
      `INSERT INTO departments (dept_name, dept_code, head_user_id)
       VALUES (?, ?, ?)`,
      [dept_name.trim(), dept_code.trim(), headUserId]
    );

    await conn.commit();
    return successResponse(res, { 
      dept_id: result.insertId,
      head_user_id: headUserId 
    }, 'Department created successfully', 201);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to create department', 500));
  } finally {
    conn.release();
  }
});

// 9. Remove Staff
export const removeStaff = catchAsync(async (req, res, next) => {
  const userId = parseInt(req.params.userId);

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Verify user is staff
    const [user] = await conn.execute(
      `SELECT role FROM users WHERE user_id = ?`,
      [userId]
    );

    if (user.length === 0) {
      throw new AppError('User not found', 404);
    }

    if (user[0].role !== 'Staff') {
      throw new AppError('User is not a staff member', 400);
    }

    // Delete user (CASCADE will handle staff table)
    await conn.execute(`DELETE FROM users WHERE user_id = ?`, [userId]);

    await conn.commit();
    return successResponse(res, null, 'Staff removed successfully');

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to remove staff', 500));
  } finally {
    conn.release();
  }
});


// 10. Remove Student
export const removeStudent = catchAsync(async (req, res, next) => {
  const userId = parseInt(req.params.userId);

  if (!userId) {
    return next(new AppError('User ID is required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Verify user is student
    const [user] = await conn.execute(
      `SELECT role FROM users WHERE user_id = ?`,
      [userId]
    );

    if (user.length === 0) {
      throw new AppError('User not found', 404);
    }

    if (user[0].role !== 'Student') {
      throw new AppError('User is not a student', 400);
    }

    // Delete user (CASCADE will handle students table)
    await conn.execute(`DELETE FROM users WHERE user_id = ?`, [userId]);

    await conn.commit();
    return successResponse(res, null, 'Student removed successfully');

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to remove student', 500));
  } finally {
    conn.release();
  }
});


// 11. Large Remove Students
export const largeRemoveStudents = catchAsync(async (req, res, next) => {
  const { dept_code, batch_year } = req.body;

  if (!dept_code || !batch_year) {
    return next(new AppError('dept_code and batch_year are required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Get dept_id
    const [dept] = await conn.execute(
      `SELECT dept_id FROM departments WHERE dept_code = ?`,
      [dept_code]
    );

    if (dept.length === 0) {
      throw new AppError('Department not found', 404);
    }

    const deptId = dept[0].dept_id;

    // Get student IDs to be removed
    const [students] = await conn.execute(
      `SELECT student_id FROM students WHERE dept_id = ? AND batch_year = ?`,
      [deptId, batch_year]
    );

    if (students.length === 0) {
      throw new AppError('No students found for the given criteria', 404);
    }

    const studentIds = students.map(s => s.student_id);

    // Delete users (CASCADE will handle students table)
    await conn.execute(
      `DELETE FROM users WHERE user_id IN (${studentIds.join(',')})`,
      []
    );

    await conn.commit();
    return successResponse(res, {
      removed_count: students.length,
      dept_code,
      batch_year
    }, `${students.length} students removed successfully`);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to remove students', 500));
  } finally {
    conn.release();
  }
});


// 12. Create Admin
export const createAdmin = catchAsync(async (req, res, next) => {
  const { full_name, email, password, phone_number } = req.body;

  if (!full_name || !email || !password) {
    return next(new AppError('full_name, email, and password are required', 400));
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert admin user
    const [result] = await conn.execute(
      `INSERT INTO users (full_name, email, password_hash, phone_number, role)
       VALUES (?, ?, ?, ?, 'Admin')`,
      [full_name.trim(), email.trim(), passwordHash, phone_number || null]
    );

    await conn.commit();
    return successResponse(res, { user_id: result.insertId }, 'Admin created successfully', 201);

  } catch (err) {
    await conn.rollback();
    next(err instanceof AppError ? err : new AppError('Failed to create admin', 500));
  } finally {
    conn.release();
  }
});

// 13. Distinct Departments
export const distinctDepartments = catchAsync(async (req, res, next) => {
  try {
    const [departments] = await pool.execute(
      `SELECT DISTINCT dept_name, dept_code FROM departments ORDER BY dept_name`
    );
    return successResponse(res, departments, 'Departments retrieved successfully');
  } catch (err) {
    next(err instanceof AppError ? err : new AppError('Failed to retrieve departments', 500));
  }
});