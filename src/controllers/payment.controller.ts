import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service.js';
import { body } from '../validators.js';

export class PaymentController {
  static async list(req: Request, res: Response) {
    res.json(await PaymentService.list({
      q: req.query.q ? String(req.query.q) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      studentId: req.query.studentId ? String(req.query.studentId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined
    }));
  }

  static async create(req: Request, res: Response) {
    res.status(201).json(await PaymentService.create(body(req.body)));
  }
}
