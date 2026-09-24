import { Router } from 'express';
import { DriverPortalController } from '../controllers/driver-portal.controller.js';
import { asyncHandler } from '../errors.js';
import { requireDriverSession } from '../middleware/require-scoped-session.js';

export const driverPortalRouter = Router();

driverPortalRouter.use(requireDriverSession);
driverPortalRouter.get('/me', asyncHandler(DriverPortalController.me));
driverPortalRouter.get('/roster', asyncHandler(DriverPortalController.roster));
// Scoped to this driver's own bus. The fleet-wide /api/gps routes stay behind
// super-admin auth, so a driver token sent there is rejected with a 401.
driverPortalRouter.get('/vehicle-positions', asyncHandler(DriverPortalController.vehiclePositions));
driverPortalRouter.get('/vehicle-positions/history', asyncHandler(DriverPortalController.vehicleHistory));
// Duty check-in / check-out. Also moves drivers.status to On duty / Off duty.
driverPortalRouter.get('/duty', asyncHandler(DriverPortalController.duty));
driverPortalRouter.post('/duty', asyncHandler(DriverPortalController.recordDuty));
driverPortalRouter.post('/transport-logs', asyncHandler(DriverPortalController.createTransportLog));
driverPortalRouter.post('/device-token', asyncHandler(DriverPortalController.registerDevice));
