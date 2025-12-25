// backend/src/services/accessService.js
import {pool} from '../config/db.js';
import { AppError } from '../utils/appError.js';

export const getAccessibleSubjects = async (userId, role) => {

  if (role === 'Admin') {
    const [rows] = await pool.execute(`
      SELECT 
        s.subject_id,
        s.subject_name,
        s.locked AS isLocked,
        s.topics_count,
        s.created_by,
        s.creator
      FROM subjects s
      ORDER BY s.subject_name
    `);
    return rows;
  }

  else if (role === 'Dept Head') {
    const [[dept]] = await pool.execute(
      `SELECT dept_id FROM departments WHERE head_user_id = ? LIMIT 1`,
      [userId]
    );
    if (!dept) return [];

    const [rows] = await pool.execute(`
      SELECT 
        s.subject_id,
        s.subject_name,
        s.locked AS isLocked,
        sad.dept_sub_lock AS isDeptSubLocked,
        s.topics_count,
        s.created_by,
        s.creator
      FROM subject_access_dept sad
      JOIN subjects s ON s.subject_id = sad.subject_id
      WHERE sad.dept_id = ?
      ORDER BY s.subject_name
    `, [dept.dept_id]);

    return rows;
  }

  else if(role==='Staff'||role==='Student'){
    // 🔵 STUDENT / STAFF → DEPT SUBJECTS WITH LOCKS
    const table = role === 'Student' ? 'students' : 'staff';
    const idCol = role === 'Student' ? 'student_id' : 'staff_id';

    const [[dept]] = await pool.execute(
      `SELECT dept_id FROM ${table} WHERE ${idCol} = ? LIMIT 1`,
      [userId]
    );
    if (!dept) return [];

    const [rows] = await pool.execute(`
      SELECT 
        s.subject_id,
        s.subject_name,
        s.topics_count,
      FROM subject_access_dept sad
      JOIN subjects s ON s.subject_id = sad.subject_id
      WHERE sad.dept_id = ?
        AND s.locked = 0
        AND sad.dept_sub_lock = 0
      ORDER BY s.subject_name
    `, [dept.dept_id]);

    return rows;
    }

  return [];
};


export const getUnAccessibleSubjects = async (userId, role) => {

  // Only Dept Head can have "other subjects"
  if (role !== 'Dept Head') return [];

  // Get department
  const [[dept]] = await pool.execute(
    `SELECT dept_id
     FROM departments
     WHERE head_user_id = ?
     LIMIT 1`,
    [userId]
  );

  if (!dept) return [];

  // Subjects NOT mapped to dept
  const [rows] = await pool.execute(`
  SELECT
    s.subject_id,
    s.subject_name,
    s.creator,
    s.topics_count
  FROM subjects s
  LEFT JOIN subject_access_dept sad
    ON s.subject_id = sad.subject_id
    AND sad.dept_id = ?
  WHERE sad.subject_id IS NULL
  ORDER BY s.subject_name
`, [dept.dept_id]);
  
  return rows;
};


export const hasSubjectAccess = async (subjectId, userId, role) => {

  // 2️⃣ ADMIN → FULL ACCESS
  if (role === 'Admin') return true;


  // 3️⃣ Get dept_id based on role
  if (role === 'Dept Head') {
    const [rows] = await pool.execute(
      `SELECT dept_id
      FROM departments
      WHERE head_user_id = ?
      LIMIT 1`,
      [userId]
    );

    const deptId = rows[0]?.dept_id;
    if (!deptId) return false;

    const [accessRows] = await pool.execute(
      `SELECT subject_id
      FROM subject_access_dept
      WHERE subject_id = ?
        AND dept_id = ?
      LIMIT 1`,
      [subjectId, deptId]
    );

    return accessRows.length > 0;
  }

  else if (role === 'Student' || role === 'Staff') {
    const [rows] = await pool.execute(
      `SELECT dept_id
      FROM ${role === 'Student' ? 'students' : 'staff'}
      WHERE ${role === 'Student' ? 'student_id' : 'staff_id'} = ?
      LIMIT 1`,
      [userId]
    );

    const deptId = rows[0]?.dept_id;
    if (!deptId) return false;

    const [accessRows] = await pool.execute(
      `SELECT subject_id
      FROM subject_access_dept sd inner join subjects s on sd.subject_id=s.subject_id
      WHERE sd.subject_id = ?
      AND dept_id = ? and s.locked=0 and sd.dept_sub_lock=0
      LIMIT 1`,
      [subjectId, deptId]
    );

    return accessRows.length > 0;
  }
  return false;
};


