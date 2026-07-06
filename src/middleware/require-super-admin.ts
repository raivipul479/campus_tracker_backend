import { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from '../auth/token.js';
import { ApiError } from '../errors.js';
import { SuperAdminModel } from '../models/super-admin.model.js';

declare global {
  namespace Express {
    interface Request {
      superAdmin?: {
        id: number;
        email: string;
        name: string;
        role: 'super_admin';
      };
    }
  }
}

export async function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const authorization = req.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';

    if (!token) {
      throw new ApiError(401, 'Super admin login is required');
    }

    const payload = verifyAuthToken(token);
    const admin = await SuperAdminModel.findById(payload.sub);

    if (!admin || !admin.isActive) {
      throw new ApiError(401, 'Super admin login is required');
    }

    req.superAdmin = {
      id: admin.id,
      email: admin.email,
      name: admin.fullName,
      role: 'super_admin'
    };
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, 'Super admin login is required'));
  }
}
