import { Router } from 'express';
import { GpsController } from '../controllers/gps.controller.js';
import { asyncHandler } from '../errors.js';

export const gpsRouter = Router();

gpsRouter.get('/vehicles', asyncHandler(GpsController.vehicles));
