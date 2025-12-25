// backend/src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';   // Fixed
import xss from 'xss-clean';                         // Fixed
import hpp from 'hpp';                               // Fixed

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import subjectRoutes from './routes/subject.routes.js';
import subjectMemberRoutes from './routes/subjectMember.routes.js';
import topicRoutes from './routes/topic.routes.js';
import setRoutes from './routes/set.routes.js';
import practiceRoutes from './routes/practice.routes.js';
import adminRoutes from './routes/admin.routes.js';
import tutorRoutes from './routes/tutor.routes.js';




import { globalErrorHandler } from './middleware/error.middleware.js';
import {AppError} from './utils/appError.js';
import testRoutes from './routes/test.routes.js';
const app = express();

// ======================== SECURITY ========================
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP. Please try again later.',
});
app.use('/api/', limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Security middleware
app.use(mongoSanitize());
app.use(xss());
app.use(hpp({ whitelist: ['batchYear', 'deptId', 'role'] }));

// ======================== ROUTES ========================
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/subjects', subjectRoutes);
app.use('/api/v1/subjects/:subjectId/members', subjectMemberRoutes);
app.use('/api/v1/subjects/:subjectId/topics', topicRoutes);
app.use('/api/v1/subjects/:subjectId/topics/:topicId/sets', setRoutes);
app.use('/api/v1/subjects/:subjectId/topics/:topicId/sets/:setId/practice', practiceRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/tutor', tutorRoutes);
app.use('/api/tests', testRoutes);
// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'GATE PORTAL IS ALIVE AND READY TO CHANGE INDIA',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 404
app.all('*', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

export default app;