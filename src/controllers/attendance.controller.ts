import { Request, Response } from 'express';
import { parsePage } from '../paging.js';
import { AttendanceService } from '../services/attendance.service.js';

const text = (value: unknown) => (value ? String(value) : undefined);

// With `limit`, one page of rows plus `summary` (over every matching row) and
// paging fields for the dashboard's scroll-to-load. Without it, every row,
// which the export uses.
export class AttendanceController {
  static async students(req: Request, res: Response) {
    res.json(await AttendanceService.students({
      month: text(req.query.month),
      studentId: text(req.query.studentId),
      routeId: text(req.query.routeId),
      q: text(req.query.q)
    }, parsePage(req.query)));
  }

  static async drivers(req: Request, res: Response) {
    res.json(await AttendanceService.drivers({
      month: text(req.query.month),
      driverId: text(req.query.driverId),
      q: text(req.query.q)
    }, parsePage(req.query)));
  }
}
