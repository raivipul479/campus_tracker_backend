import { Router } from 'express';
import { DriverPortalController } from '../controllers/driver-portal.controller.js';
import { asyncHandler } from '../errors.js';
import { requireDriverSession } from '../middleware/require-scoped-session.js';

export const driverPortalRouter = Router();

driverPortalRouter.use(requireDriverSession);
driverPortalRouter.get('/me', asyncHandler(DriverPortalController.me));
driverPortalRouter.get('/roster', asyncHandler(DriverPortalController.roster));
driverPortalRouter.post('/transport-logs', asyncHandler(DriverPortalController.createTransportLog));
