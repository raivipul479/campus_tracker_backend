import { Router } from 'express';
import { VehicleController } from '../controllers/vehicle.controller.js';
import { asyncHandler } from '../errors.js';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', asyncHandler(VehicleController.list));
vehiclesRouter.get('/:id', asyncHandler(VehicleController.getById));
vehiclesRouter.get('/:id/roster', asyncHandler(VehicleController.roster));
vehiclesRouter.post('/', asyncHandler(VehicleController.create));
vehiclesRouter.patch('/:id', asyncHandler(VehicleController.update));
vehiclesRouter.delete('/:id', asyncHandler(VehicleController.delete));
