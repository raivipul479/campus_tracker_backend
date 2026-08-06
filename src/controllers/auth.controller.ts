import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';

export class AuthController {
  static async login(req: Request, res: Response) {
    res.json(await AuthService.login(req.body));
  }

  static async me(req: Request, res: Response) {
    res.json({ admin: req.superAdmin });
  }

  static async resetPassword(req: Request, res: Response) {
    const secret = req.header('x-admin-reset-secret') ?? req.body?.secret;
    res.json(
      await AuthService.resetPassword({
        secret,
        email: req.body?.email,
        newPassword: req.body?.newPassword
      })
    );
  }
}
