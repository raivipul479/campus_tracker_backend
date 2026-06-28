import { Request, Response } from 'express';
import { VehicleService } from '../services/vehicle.service.js';
import { body } from '../validators.js';

export class VehicleController {
  static async list(req: Request, res: Response) {
    res.json(await VehicleService.list({
      q: req.query.q ? String(req.query.q) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      driverId: req.query.driverId ? String(req.query.driverId) : undefined,
      routeId: req.query.routeId ? String(req.query.routeId) : undefined,
      assigned: req.query.assigned ? String(req.query.assigned) : undefined
    }));
  }

  static async getById(req: Request, res: Response) {
    res.json(await VehicleService.getById(req.params.id));
  }

  static async roster(req: Request, res: Response) {
    res.json(await VehicleService.roster(req.params.id));
  }

  static async create(req: Request, res: Response) {
    res.status(201).json(await VehicleService.create(body(req.body)));
  }

  static async update(req: Request, res: Response) {
    res.json(await VehicleService.update(req.params.id, body(req.body)));
  }

  static async delete(req: Request, res: Response) {
    await VehicleService.delete(req.params.id);
    res.status(204).send();
  }
}
