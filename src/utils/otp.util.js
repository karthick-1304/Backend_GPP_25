// backend/src/utils/otp.util.js
import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';


export const generateAndSaveOTP = async (userId) => {
  const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  const otpHash = await bcrypt.hash(otp, 10);
  const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS) || 600; // 10 minutes
  
  await pool.execute(
    `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, created_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), NOW())
     ON DUPLICATE KEY UPDATE
     otp_hash = VALUES(otp_hash),
     expires_at = VALUES(expires_at),
     created_at = NOW()`,
    [userId, otpHash, OTP_EXPIRY_SECONDS]
  );
  return otp;
};

export const verifyOTP = async (userId, otp) => {
  const [rows] = await pool.execute(
    `SELECT otp_hash FROM password_reset_otps 
     WHERE user_id = ? AND expires_at > NOW() 
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  if (!rows[0]) return false;
  return await bcrypt.compare(otp, rows[0].otp_hash);
};

export const deleteOTP = async (userId) => {
  await pool.execute('DELETE FROM password_reset_otps WHERE user_id = ?', [userId]);
};

export const checkOTPCooldown = async (userId) => {
  const COOLDOWN_SECONDS = Number(process.env.OTP_COOLDOWN_SECONDS) || 120;

  const [rows] = await pool.execute(
    `SELECT created_at FROM password_reset_otps
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (!rows[0]) {
    return {
      canSend: true,
      remainingSeconds: process.env.OTP_COOLDOWN_SECONDS || 120
    };
  }

  const lastSent = new Date(rows[0].created_at).getTime();
  const now = Date.now();

  const elapsedSeconds = Math.floor((now - lastSent) / 1000);
  const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;

  if (remainingSeconds <= 0) {
    return {
      canSend: true,
      remainingSeconds: process.env.OTP_COOLDOWN_SECONDS || 120
    };
  }

  return {
    canSend: false,
    remainingSeconds:remainingSeconds
  };
};
