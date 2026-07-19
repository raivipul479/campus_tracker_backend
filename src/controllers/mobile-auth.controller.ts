import { Request, Response } from 'express';
import { MobileAuthService } from '../services/mobile-auth.service.js';
import { body } from '../validators.js';

export class MobileAuthController {
  static async requestParentOtp(req: Request, res: Response) {
    res.json(await MobileAuthService.requestParentOtp(body(req.body)));
  }

  static async verifyParentOtp(req: Request, res: Response) {
    res.json(await MobileAuthService.verifyParentOtp(body(req.body)));
  }

  static async requestDriverOtp(req: Request, res: Response) {
    res.json(await MobileAuthService.requestDriverOtp(body(req.body)));
  }

  static async verifyDriverOtp(req: Request, res: Response) {
    res.json(await MobileAuthService.verifyDriverOtp(body(req.body)));
  }
}
