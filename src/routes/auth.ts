import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../errors.js';
import { requireSuperAdmin } from '../middleware/require-super-admin.js';

export const authRouter = Router();

authRouter.post('/super-admin/login', asyncHandler(AuthController.login));
authRouter.get('/super-admin/me', requireSuperAdmin, asyncHandler(AuthController.me));
