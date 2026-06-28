import { Router } from 'express';
import { DriverController } from '../controllers/driver.controller.js';
import { asyncHandler } from '../errors.js';

export const driversRouter = Router();

driversRouter.get('/', asyncHandler(DriverController.list));
driversRouter.get('/:id', asyncHandler(DriverController.getById));
driversRouter.post('/', asyncHandler(DriverController.create));
driversRouter.patch('/:id', asyncHandler(DriverController.update));
driversRouter.delete('/:id', asyncHandler(DriverController.delete));
