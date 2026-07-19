import { Router } from 'express';
import { MobileAuthController } from '../controllers/mobile-auth.controller.js';
import { asyncHandler } from '../errors.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export const mobileAuthRouter = Router();

const otpRequestLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many OTP requests. Please wait a few minutes and try again.'
});
const otpVerifyLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many attempts. Please wait a few minutes and try again.'
});

mobileAuthRouter.post('/parent/request-otp', otpRequestLimit, asyncHandler(MobileAuthController.requestParentOtp));
mobileAuthRouter.post('/parent/verify-otp', otpVerifyLimit, asyncHandler(MobileAuthController.verifyParentOtp));
mobileAuthRouter.post('/driver/request-otp', otpRequestLimit, asyncHandler(MobileAuthController.requestDriverOtp));
mobileAuthRouter.post('/driver/verify-otp', otpVerifyLimit, asyncHandler(MobileAuthController.verifyDriverOtp));
