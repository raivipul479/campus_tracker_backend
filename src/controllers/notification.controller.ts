import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.js';

export class NotificationController {
  // POST /api/notifications/fee-reminder
  // Body: { studentId } for one student, or { all: true } for every student with dues.
  static async feeReminder(req: Request, res: Response) {
    res.json(
      await NotificationService.sendFeeReminder({
        studentId: req.body?.studentId,
        all: req.body?.all
      })
    );
  }
}
