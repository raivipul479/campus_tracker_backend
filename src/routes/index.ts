import { Router } from 'express';
import { DashboardController } from '../controllers/dashboard.controller.js';
import { asyncHandler } from '../errors.js';
import { assignmentsRouter } from './assignments.js';
import { authRouter } from './auth.js';
import { mobileAuthRouter } from './mobile-auth.js';
import { parentPortalRouter } from './parent-portal.js';
import { driverPortalRouter } from './driver-portal.js';
import { driversRouter } from './drivers.js';
import { feeDuesRouter } from './fee-dues.js';
import { routesRouter } from './routes.js';
import { paymentsRouter } from './payments.js';
import { studentsRouter } from './students.js';
import { transportLogsRouter } from './transport-logs.js';
import { vehiclesRouter } from './vehicles.js';
import { requireSuperAdmin } from '../middleware/require-super-admin.js';

export const router = Router();

router.get('/health', asyncHandler(DashboardController.health));
router.use('/auth', authRouter);
router.use('/mobile-auth', mobileAuthRouter);
router.use('/parent', parentPortalRouter);
router.use('/driver', driverPortalRouter);

router.use(requireSuperAdmin);
router.get('/stats', asyncHandler(DashboardController.stats));

router.use('/students', studentsRouter);
router.use('/routes', routesRouter);
router.use('/drivers', driversRouter);
router.use('/vehicles', vehiclesRouter);
router.use('/fee-dues', feeDuesRouter);
router.use('/payments', paymentsRouter);
router.use('/transport-logs', transportLogsRouter);
router.use('/assignments', assignmentsRouter);
