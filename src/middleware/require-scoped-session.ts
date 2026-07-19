import { NextFunction, Request, Response } from 'express';
import { verifyScopedToken } from '../auth/token.js';
import { ApiError } from '../errors.js';

declare global {
  namespace Express {
    interface Request {
      scopedSession?: {
        role: 'parent' | 'driver';
        phone: string;
      };
    }
  }
}

function requireScopedSession(role: 'parent' | 'driver') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authorization = req.get('authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';

      if (!token) {
        throw new ApiError(401, 'Login is required');
      }

      const payload = verifyScopedToken(token);
      if (payload.role !== role) {
        throw new ApiError(403, 'This session is not authorized for this resource');
      }

      req.scopedSession = { role: payload.role, phone: payload.phone };
      next();
    } catch (error) {
      next(error instanceof ApiError ? error : new ApiError(401, 'Login is required'));
    }
  };
}

export const requireParentSession = requireScopedSession('parent');
export const requireDriverSession = requireScopedSession('driver');
