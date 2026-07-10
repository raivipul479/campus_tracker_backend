import { Request, Response } from 'express';
import { AssignmentService } from '../services/assignment.service.js';
import { body } from '../validators.js';

export class AssignmentController {
  static async list(_req: Request, res: Response) {
    res.json(await AssignmentService.list());
  }

  static async assignDriver(req: Request, res: Response) {
    res.status(201).json(await AssignmentService.assignDriver(body(req.body)));
  }

  static async unassignDriver(req: Request, res: Response) {
    await AssignmentService.unassignDriver(req.params.assignmentId);
    res.status(204).send();
  }

  static async unassignDriverByDriverId(req: Request, res: Response) {
    await AssignmentService.unassignDriverByDriverId(req.params.driverId);
    res.status(204).send();
  }

  static async assignStudent(req: Request, res: Response) {
    res.status(201).json(await AssignmentService.assignStudent(body(req.body)));
  }

  static async unassignStudent(req: Request, res: Response) {
    await AssignmentService.unassignStudent(req.params.assignmentId);
    res.status(204).send();
  }

  static async driverHistory(req: Request, res: Response) {
    res.json(await AssignmentService.driverHistory(req.params.driverId));
  }

  static async vehicleHistory(req: Request, res: Response) {
    res.json(await AssignmentService.vehicleHistory(req.params.vehicleId));
  }

  static async studentHistory(req: Request, res: Response) {
    res.json(await AssignmentService.studentHistory(req.params.studentId));
  }
}
