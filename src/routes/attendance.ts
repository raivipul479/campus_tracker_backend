import { Router } from 'express';
import { AttendanceController } from '../controllers/attendance.controller.js';
import { asyncHandler } from '../errors.js';

export const attendanceRouter = Router();

attendanceRouter.get('/students', asyncHandler(AttendanceController.students));
attendanceRouter.get('/drivers', asyncHandler(AttendanceController.drivers));
