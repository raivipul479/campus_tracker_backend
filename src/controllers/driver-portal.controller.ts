import { Request, Response } from 'express';
import { DriverPortalService } from '../services/driver-portal.service.js';
import { body } from '../validators.js';

export class DriverPortalController {
  static async me(req: Request, res: Response) {
    res.json(await DriverPortalService.me(req.scopedSession!.phone));
  }

  static async roster(req: Request, res: Response) {
    res.json(await DriverPortalService.roster(req.scopedSession!.phone));
  }

  static async createTransportLog(req: Request, res: Response) {
    res.status(201).json(await DriverPortalService.createTransportLog(req.scopedSession!.phone, body(req.body)));
  }
}
