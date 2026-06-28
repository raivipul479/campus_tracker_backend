import { Request, Response } from 'express';
import { StudentService } from '../services/student.service.js';
import { body } from '../validators.js';

export class StudentController {
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
