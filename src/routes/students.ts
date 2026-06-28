import { Router } from 'express';
import { StudentController } from '../controllers/student.controller.js';
import { asyncHandler } from '../errors.js';

export const studentsRouter = Router();

studentsRouter.get('/', asyncHandler(StudentController.list));
studentsRouter.get('/:id', asyncHandler(StudentController.getById));
studentsRouter.post('/', asyncHandler(StudentController.create));
studentsRouter.patch('/:id', asyncHandler(StudentController.update));
studentsRouter.delete('/:id', asyncHandler(StudentController.delete));
