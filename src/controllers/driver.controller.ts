import { Request, Response } from 'express';
import { DriverService } from '../services/driver.service.js';
import { body } from '../validators.js';

export class DriverController {
  static async list(req: Request, res: Response) {
    res.json(await DriverService.list({
      q: req.query.q ? String(req.query.q) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      docs: req.query.docs ? String(req.query.docs) : undefined,
      vehicleId: req.query.vehicleId ? String(req.query.vehicleId) : undefined
    }));
  }

  static async getById(req: Request, res: Response) {
    res.json(await DriverService.getById(req.params.id));
  }

  static async create(req: Request, res: Response) {
    res.status(201).json(await DriverService.create(body(req.body)));
  }

  static async update(req: Request, res: Response) {
    res.json(await DriverService.update(req.params.id, body(req.body)));
  }

  static async delete(req: Request, res: Response) {
    await DriverService.delete(req.params.id);
    res.status(204).send();
  }
}
