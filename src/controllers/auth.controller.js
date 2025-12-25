//backend/src/controllers/auth.controller.js
import { pool } from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {UAParser} from 'ua-parser-js';
import { AppError } from '../utils/appError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { successResponse } from '../utils/responseFormatter.js';


import {
  generateAndSaveOTP,
  verifyOTP,
  deleteOTP,
  checkOTPCooldown
} from '../utils/otp.util.js';
import { sendOTPEmail, sendPasswordChangedEmail } from '../services/email.service.js';

const signToken = (user) => jwt.sign(
  { userId: user.user_id, role: user.role, email: user.email },
  process.env.JWT_ACCESS_SECRET,
  { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '24h' }
);

const getAuditInfo = (req) => {
  const parser = new UAParser(req.get('User-Agent'));
  const ua = parser.getResult();

  const browser = `${ua.browser.name || 'Unknown'} ${ua.browser.version?.split('.')[0] || ''}`.trim();
  const os = `${ua.os.name || 'Unknown'} ${ua.os.version || ''}`.trim();
  const deviceType = ua.device.type || 'desktop';
  const device = `${ua.device.vendor || ''} ${ua.device.model || ''}`.trim() || deviceType;

  return {
    ip: req.ip || 'Unknown',
    device: [device, os, browser].filter(Boolean).join(' • ') || 'Unknown Device',
    timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    path: req.originalUrl
  };
};

// 1. Login
export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) return next(new AppError('User registered mail id and password required', 400));

  const [rows] = await pool.execute(
    'SELECT user_id, email, password_hash, role FROM users WHERE email = ?',
    [email]
  );

  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return next(new AppError('Invalid user credentials', 401));
  }

  const token = signToken(user);

  await pool.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);

  return successResponse(res, {
    message: 'Login successful',
    token,
    user: {
      userId: user.user_id,
      email: user.email,
      role: user.role
    }
  });
});

// 2. Logout 
export const logout = (req, res) => successResponse(res, { message: 'Logged out successfully' });

// 3. Change Password (Auth Protected)
export const changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.userId;

  if (!currentPassword || !newPassword) return next(new AppError('Provide current password and new password ', 400));
  if (newPassword.length < 6) return next(new AppError('Password too short. Ensure minimum length 6. ', 400));
  if (currentPassword === newPassword) return next(new AppError('New password must be different', 400));

  const [rows] = await pool.execute('SELECT password_hash, full_name, email FROM users WHERE user_id = ?', [userId]);
  const user = rows[0];
  if (!user) return next(new AppError('User not found', 404));

  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return next(new AppError('Current password incorrect', 401));
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.execute('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE user_id = ?', [newHash, userId]);

  const { ip, device} = getAuditInfo(req);
  await sendPasswordChangedEmail(email, fullName, ip, device);

  return successResponse(res, { message: 'Password changed successfully' });
});

// 4. Send Forgot Password OTP
export const sendForgotPassOTP = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) return next(new AppError('User registered mail id is required', 400));

  const [rows] = await pool.execute('SELECT user_id, full_name FROM users WHERE email = ?', [email]);
  if (!rows[0]) return next(new AppError('User not found', 404));

  const user = rows[0];

  const { canSend, remainingSeconds } = await checkOTPCooldown(user.user_id);
  if (!canSend) {
    return res.status(429).json({
      success: false,
      message: `Too many requests. Please try again after ${remainingSeconds} seconds.`,
      timer: remainingSeconds
    });
  }

  const otp = await generateAndSaveOTP(user.user_id);
  await sendOTPEmail(email, user.full_name, otp);

  return successResponse(res, { message: 'OTP sent successfully', timer: remainingSeconds });
});

// 5. Verify OTP & Reset Password
export const verifyOTPAndResetPassword = catchAsync(async (req, res, next) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return next(new AppError('Request with insufficient data', 400));
  }
  if (newPassword.length < 6) return next(new AppError('Password too short. Ensure minimum length 6. ', 400));
  
  const [rows] = await pool.execute('SELECT user_id, full_name FROM users WHERE email = ?', [email]);
  if (!rows[0]) return next(new AppError('User not found', 404));

  const user = rows[0];

  const isValid = await verifyOTP(user.user_id, otp);
  if (!isValid) return next(new AppError('Invalid or expired OTP', 400));

  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.execute('UPDATE users SET password_hash = ? WHERE user_id = ?', [newHash, user.user_id]);
  await deleteOTP(user.user_id);

  const { ip, device } = getAuditInfo(req);
  await sendPasswordChangedEmail(email, fullName, ip, device);

  return successResponse(res, { message: 'Password reset successful' });
});
