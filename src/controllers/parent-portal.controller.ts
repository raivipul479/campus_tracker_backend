import { Request, Response } from 'express';
import { ParentPortalService } from '../services/parent-portal.service.js';
import { NotificationService } from '../services/notification.service.js';

export class ParentPortalController {
  static async children(req: Request, res: Response) {
    res.json(await ParentPortalService.children(req.scopedSession!.phone));
  }

  static async vehicles(req: Request, res: Response) {
    res.json(await ParentPortalService.vehicles(req.scopedSession!.phone));
  }

  static async vehiclePositions(req: Request, res: Response) {
    res.json(await ParentPortalService.vehiclePositions(req.scopedSession!.phone));
  }

  static async feeDues(req: Request, res: Response) {
    res.json(await ParentPortalService.feeDues(req.scopedSession!.phone, req.query.month ? String(req.query.month) : undefined));
  }

  static async payments(req: Request, res: Response) {
    res.json(await ParentPortalService.payments(req.scopedSession!.phone));
  }

  static async transportLogs(req: Request, res: Response) {
    res.json(await ParentPortalService.transportLogs(req.scopedSession!.phone, req.query.studentId ? String(req.query.studentId) : undefined));
  }

  static async registerDevice(req: Request, res: Response) {
    res.json(
      await NotificationService.registerToken(
        req.scopedSession!.phone,
        'parent',
        req.body?.token,
        req.body?.platform
      )
    );
  }

  static async notifications(req: Request, res: Response) {
    res.json(await NotificationService.listForParent(req.scopedSession!.phone));
  }

  static async markNotificationsRead(req: Request, res: Response) {
    res.json(await NotificationService.markAllRead(req.scopedSession!.phone));
  }
}
