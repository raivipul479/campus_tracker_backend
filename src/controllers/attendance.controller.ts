import { Request, Response } from 'express';
import { AttendanceService } from '../services/attendance.service.js';

const text = (value: unknown) => (value ? String(value) : undefined);

export class AttendanceController {
  static async students(req: Request, res: Response) {
    res.json(await AttendanceService.students({
      month: text(req.query.month),
      studentId: text(req.query.studentId),
      routeId: text(req.query.routeId)
    }));
  }

  static async drivers(req: Request, res: Response) {
    res.json(await AttendanceService.drivers({
      month: text(req.query.month),
      driverId: text(req.query.driverId)
    }));
  }
}
