import { Request, Response } from 'express';
import { RouteService } from '../services/route.service.js';
import { body } from '../validators.js';

export class RouteController {
  static async list(req: Request, res: Response) {
    res.json(await RouteService.list({
      q: req.query.q ? String(req.query.q) : undefined,
      vehicleId: req.query.vehicleId ? String(req.query.vehicleId) : undefined,
      assigned: req.query.assigned ? String(req.query.assigned) : undefined
    }));
  }

  static async getById(req: Request, res: Response) {
    res.json(await RouteService.getById(req.params.id));
  }

  static async create(req: Request, res: Response) {
    res.status(201).json(await RouteService.create(body(req.body)));
  }

  static async update(req: Request, res: Response) {
    res.json(await RouteService.update(req.params.id, body(req.body)));
  }

  static async delete(req: Request, res: Response) {
    await RouteService.delete(req.params.id);
    res.status(204).send();
  }
}
