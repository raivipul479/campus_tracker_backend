import { Request, Response } from 'express';
import { DriverPortalService } from '../services/driver-portal.service.js';
import { NotificationService } from '../services/notification.service.js';
import { body } from '../validators.js';

export class DriverPortalController {
  static async me(req: Request, res: Response) {
    res.json(await DriverPortalService.me(req.scopedSession!.phone));
  }

  static async roster(req: Request, res: Response) {
    res.json(await DriverPortalService.roster(req.scopedSession!.phone));
  }

  static async vehiclePositions(req: Request, res: Response) {
    res.json(await DriverPortalService.vehiclePositions(req.scopedSession!.phone));
  }

  static async vehicleHistory(req: Request, res: Response) {
    res.json(await DriverPortalService.vehicleHistory(req.scopedSession!.phone, {
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: req.query.limit ? String(req.query.limit) : undefined
    }));
  }

  static async createTransportLog(req: Request, res: Response) {
    res.status(201).json(await DriverPortalService.createTransportLog(req.scopedSession!.phone, body(req.body)));
  }

  static async registerDevice(req: Request, res: Response) {
    res.json(
      await NotificationService.registerToken(
        req.scopedSession!.phone,
        'driver',
        req.body?.token,
        req.body?.platform
      )
    );
  }
}
