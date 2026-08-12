import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.js';

export class NotificationController {
  // GET /api/notifications
  // Query: type, phone, studentId, from, to, limit — every sent notification,
  // newest first, across all recipients.
  static async list(req: Request, res: Response) {
    res.json(
      await NotificationService.listAll({
        type: req.query.type,
        phone: req.query.phone,
        studentId: req.query.studentId,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit
      })
    );
  }

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
