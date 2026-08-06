import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller.js';
import { asyncHandler } from '../errors.js';

export const notificationsRouter = Router();

notificationsRouter.post('/fee-reminder', asyncHandler(NotificationController.feeReminder));
