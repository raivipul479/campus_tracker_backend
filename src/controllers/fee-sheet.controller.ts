import { Request, Response } from 'express';
import { FeeSheetService } from '../services/fee-sheet.service.js';
import { body } from '../validators.js';

const text = (value: unknown) => (value ? String(value) : undefined);

export class FeeSheetController {
  static async columns(_req: Request, res: Response) {
    res.json({ columns: FeeSheetService.columns() });
  }

  static async export(req: Request, res: Response) {
    res.json(await FeeSheetService.export({
      month: text(req.query.month),
      status: text(req.query.status),
      studentId: text(req.query.studentId)
    }));
  }

  static async import(req: Request, res: Response) {
    const payload = body(req.body);
    const dryRun = payload.dryRun === true || payload.dryRun === 'true';
    res.json(await FeeSheetService.import((payload.rows ?? []) as any[], { dryRun }));
  }
}
