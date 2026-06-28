import { Router } from 'express';
import { AssignmentController } from '../controllers/assignment.controller.js';
import { asyncHandler } from '../errors.js';

export const assignmentsRouter = Router();

assignmentsRouter.get('/', asyncHandler(AssignmentController.list));
assignmentsRouter.post('/driver', asyncHandler(AssignmentController.assignDriver));
assignmentsRouter.delete('/driver/by-driver/:driverId', asyncHandler(AssignmentController.unassignDriverByDriverId));
assignmentsRouter.delete('/driver/:assignmentId', asyncHandler(AssignmentController.unassignDriver));
assignmentsRouter.post('/student', asyncHandler(AssignmentController.assignStudent));
assignmentsRouter.delete('/student/:assignmentId', asyncHandler(AssignmentController.unassignStudent));
