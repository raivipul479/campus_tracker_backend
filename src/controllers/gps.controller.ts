import { Request, Response } from 'express';
import { GpsService } from '../services/gps.service.js';

export class GpsController {
  static async vehicles(_req: Request, res: Response) {
    res.json(await GpsService.vehicles());
  }
}
