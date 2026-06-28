import { Request, Response } from 'express';
import { DashboardService } from '../services/dashboard.service.js';

export class DashboardController {
  static async health(_req: Request, res: Response) {
    res.json(await DashboardService.health());
  }

  static async stats(_req: Request, res: Response) {
    res.json(await DashboardService.stats());
  }
}
