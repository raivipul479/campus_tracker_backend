import crypto from 'node:crypto';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createAuthToken } from '../auth/token.js';
import { SuperAdminModel } from '../models/super-admin.model.js';

// Constant-time secret comparison that is safe regardless of input length
// (hashing both sides to a fixed 32 bytes first avoids leaking length).
function secretMatches(provided: string, expected: string) {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export class AuthService {
  static async login(payload: { email?: unknown; password?: unknown }) {
    const email = String(payload.email ?? '').trim().toLowerCase();
    const password = String(payload.password ?? '');

    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required');
    }

    const admin = await SuperAdminModel.findByEmail(email);

    if (!admin || !admin.isActive || !verifyPassword(password, admin.passwordSalt, admin.passwordHash)) {
      throw new ApiError(401, 'Invalid super admin credentials');
    }

    await SuperAdminModel.recordLogin(admin.id);

    return {
      token: createAuthToken({ id: admin.id, email: admin.email }),
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.fullName,
        role: 'super_admin'
      }
    };
  }

  // Resets a super admin's password. Gated by the server's AUTH_TOKEN_SECRET
  // (sent in the request) rather than a bearer token, so it can be used to
  // recover from a lockout. Anyone who knows AUTH_TOKEN_SECRET already controls
  // auth (they can forge tokens), so gating here adds no new exposure.
  static async resetPassword(payload: {
    secret?: unknown;
    email?: unknown;
    newPassword?: unknown;
  }) {
    // Local/dev: no secret required (convenience). Production: the secret is
    // still enforced, so this endpoint can never be used to hijack the admin
    // even if this code reaches the deployed server.
    if (config.isProduction) {
      const secret = String(payload.secret ?? '');
      if (!secret || !secretMatches(secret, config.auth.tokenSecret)) {
        throw new ApiError(401, 'Invalid reset secret');
      }
    }

    const email = String(payload.email ?? '').trim().toLowerCase();
    const newPassword = String(payload.newPassword ?? '');

    if (!email || !newPassword) {
      throw new ApiError(400, 'email and newPassword are required');
    }
    if (newPassword.length < 8) {
      throw new ApiError(400, 'newPassword must be at least 8 characters');
    }

    const admin = await SuperAdminModel.findByEmail(email);
    if (!admin) {
      throw new ApiError(404, 'No super admin exists for that email');
    }

    const { hash, salt } = hashPassword(newPassword);
    await SuperAdminModel.updatePasswordByEmail(email, hash, salt);

    return { email, updated: true };
  }
}
