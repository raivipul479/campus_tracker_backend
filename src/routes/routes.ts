import { Router } from 'express';
import { RouteController } from '../controllers/route.controller.js';
import { asyncHandler } from '../errors.js';

export const routesRouter = Router();

routesRouter.get('/', asyncHandler(RouteController.list));
routesRouter.get('/:id', asyncHandler(RouteController.getById));
routesRouter.post('/', asyncHandler(RouteController.create));
routesRouter.patch('/:id', asyncHandler(RouteController.update));
routesRouter.delete('/:id', asyncHandler(RouteController.delete));
