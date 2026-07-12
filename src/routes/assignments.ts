import { Router } from 'express';
import { AssignmentController } from '../controllers/assignment.controller.js';
import { asyncHandler } from '../errors.js';

export const assignmentsRouter = Router();

assignmentsRouter.get('/', asyncHandler(AssignmentController.list));
assignmentsRouter.get('/driver-history/:driverId', asyncHandler(AssignmentController.driverHistory));
assignmentsRouter.get('/vehicle-history/:vehicleId', asyncHandler(AssignmentController.vehicleHistory));
assignmentsRouter.get('/student-history/:studentId', asyncHandler(AssignmentController.studentHistory));
assignmentsRouter.post('/driver', asyncHandler(AssignmentController.assignDriver));
assignmentsRouter.delete('/driver/by-driver/:driverId', asyncHandler(AssignmentController.unassignDriverByDriverId));
assignmentsRouter.delete('/driver/:assignmentId', asyncHandler(AssignmentController.unassignDriver));
assignmentsRouter.post('/student', asyncHandler(AssignmentController.assignStudent));
assignmentsRouter.post('/students/bulk', asyncHandler(AssignmentController.assignStudentsBulk));
assignmentsRouter.delete('/student/:assignmentId', asyncHandler(AssignmentController.unassignStudent));
