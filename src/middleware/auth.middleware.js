// backend/src/middleware/auth.middleware.js
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { AppError } from '../utils/appError.js';

export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('You are not logged in. Please log in to get access.', 401));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const [rows] = await pool.execute(
      'SELECT user_id, email, role FROM users WHERE user_id = ?',
      [decoded.userId]
    );

    if (rows.length === 0) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    req.user = {
      userId: rows[0].user_id,
      email: rows[0].email,
      role: rows[0].role,
    };

    next();
  } catch (err) {
    return next(new AppError('Invalid or expired token. Please login again.', 401));
  }
};

export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
};