import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';

export class AuthController {
  static async login(req: Request, res: Response) {
    res.json(await AuthService.login(req.body));
  }

  static async me(req: Request, res: Response) {
    res.json({ admin: req.superAdmin });
  }
}
