// backend/src/controllers/user.controller.js
import { pool } from '../config/db.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/appError.js';
import { successResponse } from '../utils/responseFormatter.js';


// 1. Dashboard Summary (Lightweight)
export const getMyBasicProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.userId;
  const role = req.user.role;

  let query = '';
  let values = [userId];

  switch (role) {
    case 'Student':
      query = `
        SELECT 
          u.full_name,
          COALESCE(s.practice_score, 0) AS practice_score,
          COALESCE(s.test_score, 0) AS test_score,
          d.dept_code
        FROM users u
        LEFT JOIN students s ON u.user_id = s.student_id
        LEFT JOIN departments d ON s.dept_id = d.dept_id
        WHERE u.user_id = ? AND u.role = 'Student'
      `;
      break;

    case 'Staff':
      query = `
        SELECT u.full_name, d.dept_code
        FROM users u
        LEFT JOIN staff st ON u.user_id = st.staff_id
        LEFT JOIN departments d ON st.dept_id = d.dept_id
        WHERE u.user_id = ? AND u.role = 'Staff'
      `;
      break;

    case 'Dept Head':
      query = `
        SELECT u.full_name , d.dept_code
        FROM users u
        LEFT JOIN departments d ON d.head_user_id = u.user_id
        WHERE u.user_id = ? AND u.role = 'Dept Head'
      `;
      break;

    case 'Admin':
      query = `
        SELECT full_name
        FROM users 
        WHERE user_id = ? AND role = 'Admin'
      `;
      break;

    default:
      return next(new AppError('Invalid user role', 400));
  }

  const [rows] = await pool.execute(query, values);
  if (!rows[0]) return next(new AppError('Profile not found', 404));

  const data = rows[0];

  const response = {
    full_name: data.full_name,
    dashboard: { role: role }
  };
  if (role=='Student'||role === 'Staff' || role === 'Dept Head') {
    response.dashboard.dept_code = data.dept_code || null;
  }

  if (role === 'Student') {
    response.dashboard = {
      practice_score: Number(data.practice_score),
      test_score: Number(data.test_score)
    };
  }
  return successResponse(res, response, 'Profile fetched successfully');
});

// 2. Complete Profile
export const getMyCompleteProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.userId;
  const role = req.user.role;

  const BASE_USER_FIELDS = `
  u.user_id,
  u.full_name,
  u.email,
  u.phone_number
`;

  let query = '';
  let values = [userId];

  switch (role) {
    case 'Student':
      query = `
        SELECT 
          ${BASE_USER_FIELDS},
          d.dept_name,
          s.batch_year,
          COALESCE(s.practice_score, 0) AS practice_score,
          COALESCE(s.test_score, 0) AS test_score,
          tutor.full_name AS tutor_name
        FROM users u
        LEFT JOIN students s ON u.user_id = s.student_id
        LEFT JOIN departments d ON s.dept_id = d.dept_id
        LEFT JOIN users tutor ON s.tutor_id = tutor.user_id
        WHERE u.user_id = ? AND u.role = 'Student'
      `;
      break;

    case 'Staff':
      query = `
        SELECT 
          ${BASE_USER_FIELDS},
          d.dept_name,
          st.is_tutor
        FROM users u
        LEFT JOIN staff st ON u.user_id = st.staff_id
        LEFT JOIN departments d ON st.dept_id = d.dept_id
        WHERE u.user_id = ? AND u.role = 'Staff'
      `;
      break;

    case 'Dept Head':
      query = `
        SELECT 
          ${BASE_USER_FIELDS},
          d.dept_name
        FROM users u
        LEFT JOIN departments d ON d.head_user_id = u.user_id
        WHERE u.user_id = ? AND u.role = 'Dept Head'
      `;
      break;

    case 'Admin':
      query = `
        SELECT ${BASE_USER_FIELDS}
        FROM users 
        WHERE user_id = ? AND role = 'Admin'
      `;
      break;

    default:
      return next(new AppError('Invalid role', 400));
  }

  const [rows] = await pool.execute(query, values);
  if (!rows[0]) return next(new AppError('Profile not found', 404));

  const u = rows[0];

  const profile = {
    user_id: u.user_id,
    full_name: u.full_name,
    email: u.email,
    phone_number: u.phone_number || null,
  };

  // Role-specific extensions
  if (role === 'Student') {
    Object.assign(profile, {
      dept_name: u.dept_name || null,
      batch_year: u.batch_year || null,
      practice_score: Number(u.practice_score),
      test_score: Number(u.test_score),
      tutor_name: u.tutor_name || null
    });
  }

  if (role === 'Staff') {
    Object.assign(profile, {
      dept_name: u.dept_name || null,
      is_tutor: !!u.is_tutor
    });
  }

  if (role === 'Dept Head') {
    Object.assign(profile, {
      dept_name: u.dept_name || null,
    });
  }

  return successResponse(res, profile, 'Complete profile fetched');
});