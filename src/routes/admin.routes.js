// backend/src/routes/admin.routes.js
import express from 'express';
import {
  getParticipants,
  getParticipantDetails,
  editParticipantDetails,
  addStudent,
  bulkAddStudentsFromExcel,
  addStaff,
  bulkAddStaffFromExcel,
  createDepartment,
  removeStaff,
  removeStudent,
  largeRemoveStudents,
  createAdmin,
  distinctDepartments
} from '../controllers/admin.controller.js';
import { protect, restrictTo } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);

// Participant management
router.get('/participants', restrictTo('Admin'), getParticipants);
router.get('/participants/:userId', restrictTo('Admin'), getParticipantDetails);
router.patch('/participants/:userId', restrictTo('Admin'), editParticipantDetails);

// Student management
router.post('/students', restrictTo('Admin'), addStudent);
router.post('/students/bulk', restrictTo('Admin'), bulkAddStudentsFromExcel);
router.delete('/students/:userId', restrictTo('Admin'), removeStudent);
router.post('/students/bulk-remove', restrictTo('Admin'), largeRemoveStudents);

// Staff management
router.post('/staff', restrictTo('Admin'), addStaff);
router.post('/staff/bulk', restrictTo('Admin'), bulkAddStaffFromExcel);
router.delete('/staff/:userId', restrictTo('Admin'), removeStaff);

// Department management
router.post('/departments',restrictTo('Admin'), createDepartment);
router.get('/departments',distinctDepartments);

// Admin management
router.post('/admins', restrictTo('Admin'), createAdmin);

export default router;