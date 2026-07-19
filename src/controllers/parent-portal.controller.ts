import { Request, Response } from 'express';
import { ParentPortalService } from '../services/parent-portal.service.js';

export class ParentPortalController {
  static async children(req: Request, res: Response) {
    res.json(await ParentPortalService.children(req.scopedSession!.phone));
  }

  static async vehicles(req: Request, res: Response) {
    res.json(await ParentPortalService.vehicles(req.scopedSession!.phone));
  }

  static async feeDues(req: Request, res: Response) {
    res.json(await ParentPortalService.feeDues(req.scopedSession!.phone, req.query.month ? String(req.query.month) : undefined));
  }

  static async payments(req: Request, res: Response) {
    res.json(await ParentPortalService.payments(req.scopedSession!.phone));
  }

  static async transportLogs(req: Request, res: Response) {
    res.json(await ParentPortalService.transportLogs(req.scopedSession!.phone, req.query.studentId ? String(req.query.studentId) : undefined));
  }
}
