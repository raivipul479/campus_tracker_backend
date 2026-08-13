import { Request, Response } from 'express';
import { ApiError } from '../errors.js';
import { StudentService } from '../services/student.service.js';
import { StudentImportService } from '../services/student-import.service.js';
import { body } from '../validators.js';

export class StudentController {
  // Bulk import from the transport spreadsheet. Defaults to a dry run so the
  // dashboard can show what would happen before anything is written.
  static async importSheet(req: Request, res: Response) {
    const payload = body(req.body);
    const commit = payload.commit === true || payload.commit === 'true';
    const rowOffset = Number(payload.rowOffset ?? 0);
    if (!Number.isInteger(rowOffset) || rowOffset < 0) {
      throw new ApiError(400, 'rowOffset must be a non-negative integer');
    }
    res.json(await StudentImportService.run(payload.rows, commit, rowOffset));
  }

  static async list(req: Request, res: Response) {
    res.json(await StudentService.list({
      q: req.query.q ? String(req.query.q) : undefined,
      vehicleId: req.query.vehicleId ? String(req.query.vehicleId) : undefined,
      routeId: req.query.routeId ? String(req.query.routeId) : undefined,
      assigned: req.query.assigned ? String(req.query.assigned) : undefined,
      className: req.query.className ? String(req.query.className) : undefined,
      tagNo: req.query.tagNo ? String(req.query.tagNo) : undefined
    }));
  }

  static async getById(req: Request, res: Response) {
    res.json(await StudentService.getById(req.params.id));
  }

  static async create(req: Request, res: Response) {
    res.status(201).json(await StudentService.create(body(req.body)));
  }

  static async update(req: Request, res: Response) {
    res.json(await StudentService.update(req.params.id, body(req.body)));
  }

  static async delete(req: Request, res: Response) {
    await StudentService.delete(req.params.id);
    res.status(204).send();
  }
}
