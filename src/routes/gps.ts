import { Router } from 'express';
import { GpsController } from '../controllers/gps.controller.js';
import { asyncHandler } from '../errors.js';

export const gpsRouter = Router();

gpsRouter.get('/vehicles', asyncHandler(GpsController.vehicles));
// Accepts a vehicle code (BUS-01) or a registration number, with or without
// the spaces the office may have typed. Declared after the literal path.
gpsRouter.get('/vehicles/:vehicle', asyncHandler(GpsController.vehicle));
gpsRouter.get('/vehicles/:vehicle/history', asyncHandler(GpsController.history));
