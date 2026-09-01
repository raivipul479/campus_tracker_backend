import { Router } from 'express';
import { ParentPortalController } from '../controllers/parent-portal.controller.js';
import { asyncHandler } from '../errors.js';
import { requireParentSession } from '../middleware/require-scoped-session.js';

export const parentPortalRouter = Router();

parentPortalRouter.use(requireParentSession);
parentPortalRouter.get('/children', asyncHandler(ParentPortalController.children));
parentPortalRouter.get('/vehicles', asyncHandler(ParentPortalController.vehicles));
// Scoped to this parent's own children's bus. The fleet-wide /api/gps routes
// stay behind super-admin auth.
parentPortalRouter.get('/vehicle-positions', asyncHandler(ParentPortalController.vehiclePositions));
parentPortalRouter.get('/fee-dues', asyncHandler(ParentPortalController.feeDues));
parentPortalRouter.get('/payments', asyncHandler(ParentPortalController.payments));
parentPortalRouter.get('/transport-logs', asyncHandler(ParentPortalController.transportLogs));
parentPortalRouter.get('/notifications', asyncHandler(ParentPortalController.notifications));
parentPortalRouter.post('/notifications/read', asyncHandler(ParentPortalController.markNotificationsRead));
parentPortalRouter.post('/device-token', asyncHandler(ParentPortalController.registerDevice));
