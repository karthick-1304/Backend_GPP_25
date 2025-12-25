// backend/routes/auth.routes.js
import { Router } from 'express';
import { 
  login, 
  logout, 
  changePassword, 
  sendForgotPassOTP, 
  verifyOTPAndResetPassword
} from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';


const router = Router();

// Public routes
router.post('/login', login); 
router.post('/forgot-password', sendForgotPassOTP);
router.post('/reset-password', verifyOTPAndResetPassword);

// Protected routes
router.post('/logout', protect, logout);  
router.patch('/change-password', protect, changePassword);

export default router;
