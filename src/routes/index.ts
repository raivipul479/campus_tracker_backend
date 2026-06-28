import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard.controller.js';
import { asyncHandler } from '../errors.js';
import { assignmentsRouter } from './assignments.js';
import { driversRouter } from './drivers.js';
import { routesRouter } from './routes.js';
import { studentsRouter } from './students.js';
import { vehiclesRouter } from './vehicles.js';

export const router = Router();

router.get('/health', asyncHandler(DashboardController.health));
router.get('/stats', asyncHandler(DashboardController.stats));

router.use('/students', studentsRouter);
router.use('/routes', routesRouter);
router.use('/drivers', driversRouter);
router.use('/vehicles', vehiclesRouter);
router.use('/assignments', assignmentsRouter);
