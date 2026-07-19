import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../errors.js';
import { requireSuperAdmin } from '../middleware/require-super-admin.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export const authRouter = Router();

const loginRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: 'Too many login attempts. Please wait a few minutes and try again.'
});

authRouter.post('/super-admin/login', loginRateLimit, asyncHandler(AuthController.login));
authRouter.get('/super-admin/me', requireSuperAdmin, asyncHandler(AuthController.me));
