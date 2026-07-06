import { Request, Response } from 'express';
import { FeeDueService } from '../services/fee-due.service.js';
import { body } from '../validators.js';

export class FeeDueController {
  static async list(req: Request, res: Response) {
    res.json(await FeeDueService.list({
      month: req.query.month ? String(req.query.month) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      studentId: req.query.studentId ? String(req.query.studentId) : undefined,
      q: req.query.q ? String(req.query.q) : undefined
    }));
  }

  static async generate(req: Request, res: Response) {
    res.status(201).json(await FeeDueService.generate(body(req.body)));
  }

  static async adjust(req: Request, res: Response) {
    res.json(await FeeDueService.adjust(req.params.id, body(req.body)));
  }

  static async summary(req: Request, res: Response) {
    res.json(await FeeDueService.summary({
      month: req.query.month ? String(req.query.month) : undefined
    }));
  }

  static async report(req: Request, res: Response) {
    res.json(await FeeDueService.report({
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      studentId: req.query.studentId ? String(req.query.studentId) : undefined
    }));
  }
}
