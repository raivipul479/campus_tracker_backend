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
    const text = (value: unknown) => (value ? String(value) : undefined);
    const filters = {
      q: text(req.query.q),
      vehicleId: text(req.query.vehicleId),
      routeId: text(req.query.routeId),
      assigned: text(req.query.assigned),
      className: text(req.query.className),
      tagNo: text(req.query.tagNo)
    };
    // With `limit`, one page as { rows, total, nextOffset, ... } for the admin
    // list's scroll-to-load. Without it, the full array as before, which the
    // other admin screens and older clients rely on.
    if (req.query.limit !== undefined) {
      res.json(await StudentService.page(filters, {
        limit: text(req.query.limit),
        offset: text(req.query.offset),
        sort: text(req.query.sort),
        dir: text(req.query.dir)
      }));
      return;
    }
    res.json(await StudentService.list(filters));
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
