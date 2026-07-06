import { Request, Response } from 'express';
import { TransportLogService } from '../services/transport-log.service.js';
import { body } from '../validators.js';

export class TransportLogController {
  static async list(req: Request, res: Response) {
    res.json(await TransportLogService.list({
      studentId: req.query.studentId ? String(req.query.studentId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined
    }));
  }

  static async create(req: Request, res: Response) {
    res.status(201).json(await TransportLogService.create(body(req.body)));
  }
}
