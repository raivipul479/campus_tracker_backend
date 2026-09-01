import { Request, Response } from 'express';
import { GpsService } from '../services/gps.service.js';

const text = (value: unknown) => (value ? String(value) : undefined);

export class GpsController {
  static async vehicles(_req: Request, res: Response) {
    res.json(await GpsService.vehicles());
  }

  static async vehicle(req: Request, res: Response) {
    res.json(await GpsService.vehicle(String(req.params.vehicle)));
  }

  static async history(req: Request, res: Response) {
    res.json(await GpsService.history(String(req.params.vehicle), {
      from: text(req.query.from),
      to: text(req.query.to),
      limit: text(req.query.limit)
    }));
  }
}
