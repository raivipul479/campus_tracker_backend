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

// Tight limit — this endpoint is gated by AUTH_TOKEN_SECRET, and throttling
// blocks any attempt to brute-force that secret.
const resetRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many reset attempts. Please wait a few minutes and try again.'
});

authRouter.post('/super-admin/login', loginRateLimit, asyncHandler(AuthController.login));
authRouter.post('/super-admin/reset-password', resetRateLimit, asyncHandler(AuthController.resetPassword));
authRouter.get('/super-admin/me', requireSuperAdmin, asyncHandler(AuthController.me));
