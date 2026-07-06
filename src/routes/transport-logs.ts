import { Router } from 'express';
import { TransportLogController } from '../controllers/transport-log.controller.js';
import { asyncHandler } from '../errors.js';

export const transportLogsRouter = Router();

transportLogsRouter.get('/', asyncHandler(TransportLogController.list));
transportLogsRouter.post('/', asyncHandler(TransportLogController.create));
