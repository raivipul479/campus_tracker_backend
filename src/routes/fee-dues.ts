import { Router } from 'express';
import { FeeDueController } from '../controllers/fee-due.controller.js';
import { FeeSheetController } from '../controllers/fee-sheet.controller.js';
import { asyncHandler } from '../errors.js';

export const feeDuesRouter = Router();

feeDuesRouter.get('/', asyncHandler(FeeDueController.list));
feeDuesRouter.get('/summary', asyncHandler(FeeDueController.summary));
feeDuesRouter.get('/report', asyncHandler(FeeDueController.report));
// The office's own fee summary sheet, read and written verbatim.
feeDuesRouter.get('/sheet/columns', asyncHandler(FeeSheetController.columns));
feeDuesRouter.get('/sheet/export', asyncHandler(FeeSheetController.export));
feeDuesRouter.post('/sheet/import', asyncHandler(FeeSheetController.import));
feeDuesRouter.post('/generate', asyncHandler(FeeDueController.generate));
// Declared after the literal paths so "sheet" is never taken for an id.
feeDuesRouter.patch('/:id', asyncHandler(FeeDueController.adjust));
