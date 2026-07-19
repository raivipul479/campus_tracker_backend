import { ApiError } from '../errors.js';
import { verifyPassword } from '../auth/password.js';
import { createAuthToken } from '../auth/token.js';
import { SuperAdminModel } from '../models/super-admin.model.js';

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
}
