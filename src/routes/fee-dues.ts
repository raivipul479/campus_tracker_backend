import { Router } from 'express';
import { FeeDueController } from '../controllers/fee-due.controller.js';
import { asyncHandler } from '../errors.js';

export const feeDuesRouter = Router();

feeDuesRouter.get('/', asyncHandler(FeeDueController.list));
feeDuesRouter.get('/summary', asyncHandler(FeeDueController.summary));
feeDuesRouter.get('/report', asyncHandler(FeeDueController.report));
feeDuesRouter.post('/generate', asyncHandler(FeeDueController.generate));
feeDuesRouter.patch('/:id', asyncHandler(FeeDueController.adjust));
