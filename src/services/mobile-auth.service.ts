import crypto from 'node:crypto';
import { config } from '../config.js';
import { createScopedToken } from '../auth/token.js';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { Body, validatePhone } from '../validators.js';

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

// In-memory OTP store. Fine for a single-process deployment; if this ever runs
// as multiple instances, move this to the DB or a shared cache (Redis).
const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
// Strict in production; lenient in local/dev so testing isn't blocked.
const MAX_REQUESTS_PER_HOUR = config.isProduction ? 5 : 100;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function otpKey(role: 'parent' | 'driver', phone: string) {
  return `${role}:${phone}`;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function isDemoMode() {
  return !config.isProduction || process.env.OTP_DEMO_MODE === 'true';
}

function checkRequestRate(key: string) {
  const now = Date.now();
  const entry = requestCounts.get(key);
  if (!entry || entry.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  if (entry.count >= MAX_REQUESTS_PER_HOUR) {
    throw new ApiError(429, 'Too many OTP requests for this phone number. Please try again later.');
  }
  entry.count += 1;
}

function issueOtp(role: 'parent' | 'driver', phone: string) {
  checkRequestRate(otpKey(role, phone));
  const code = generateOtp();
  otpStore.set(otpKey(role, phone), { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });

  const demoMode = isDemoMode();
  if (demoMode) {
    // No SMS provider is configured. This is a demo/internal-use fallback only —
    // see BUG_ANALYSIS.md (C4) for what a real deployment still needs (SMS delivery).
    console.warn(`[otp] Demo mode — OTP for ${role} ${phone}: ${code} (expires in ${OTP_TTL_MS / 1000}s)`);
  } else {
    console.warn(`[otp] OTP generated for ${role} ${phone} but no SMS provider is configured; it cannot be delivered.`);
  }

  return {
    sent: true,
    expiresInSeconds: OTP_TTL_MS / 1000,
    ...(demoMode ? { devOtp: code } : {})
  };
}

function verifyOtp(role: 'parent' | 'driver', phone: string, otp: string) {
  const key = otpKey(role, phone);
  const entry = otpStore.get(key);
  if (!entry) throw new ApiError(400, 'Request a new OTP before verifying');
  if (entry.expiresAt < Date.now()) {
    otpStore.delete(key);
    throw new ApiError(400, 'OTP has expired. Request a new one.');
  }
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    otpStore.delete(key);
    throw new ApiError(429, 'Too many incorrect attempts. Request a new OTP.');
  }
  if (entry.code !== otp.trim()) {
    entry.attempts += 1;
    throw new ApiError(401, 'Incorrect OTP');
  }
  otpStore.delete(key);
}

function requiredPhone(data: Body) {
  const raw = String(data.phone ?? '').trim();
  if (!raw) throw new ApiError(400, 'phone is required');
  return validatePhone(raw, 'phone');
}

export class MobileAuthService {
  static async requestParentOtp(data: Body) {
    const phone = requiredPhone(data);
    const exists = await prisma.student.findFirst({
      where: { OR: [{ phone }, { secondaryPhone: phone }] },
      select: { id: true }
    });
    if (!exists) throw new ApiError(404, 'No student is linked to this phone number');
    return issueOtp('parent', phone);
  }

  static async requestDriverOtp(data: Body) {
    const phone = requiredPhone(data);
    const exists = await prisma.driver.findFirst({ where: { phone }, select: { id: true } });
    if (!exists) throw new ApiError(404, 'No driver is linked to this phone number');
    return issueOtp('driver', phone);
  }

  static async verifyParentOtp(data: Body) {
    const phone = requiredPhone(data);
    verifyOtp('parent', phone, String(data.otp ?? ''));
    return { token: createScopedToken({ role: 'parent', phone }), phone };
  }

  static async verifyDriverOtp(data: Body) {
    const phone = requiredPhone(data);
    verifyOtp('driver', phone, String(data.otp ?? ''));
    return { token: createScopedToken({ role: 'driver', phone }), phone };
  }
}
