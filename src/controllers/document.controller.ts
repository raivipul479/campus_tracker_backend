import { Request, Response } from 'express';
import { DocumentService } from '../services/document.service.js';

const text = (value: unknown) => (value ? String(value) : undefined);

export class DocumentController {
  static async list(req: Request, res: Response) {
    res.json(await DocumentService.list({
      ownerType: text(req.query.ownerType),
      ownerId: text(req.query.ownerId),
      status: text(req.query.status),
      q: text(req.query.q)
    }));
  }

  static async expiring(req: Request, res: Response) {
    res.json(await DocumentService.expiring(text(req.query.days)));
  }

  static async create(req: Request, res: Response) {
    // req.superAdmin is set by requireSuperAdmin, so the uploader is recorded
    // from the session rather than anything the client sends.
    const uploadedBy = req.superAdmin?.email;
    res.status(201).json(await DocumentService.create(req.file, req.body ?? {}, uploadedBy));
  }

  static async download(req: Request, res: Response) {
    const file = await DocumentService.fileFor(req.params.id);
    // attachment + nosniff: these are personal documents, and nothing should
    // render inline in the browser from a user-supplied file.
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition',
      `attachment; filename="${file.fileName.replace(/[^\w.\- ]/g, '_')}"`);
    file.stream.pipe(res);
  }

  static async remove(req: Request, res: Response) {
    res.json(await DocumentService.remove(req.params.id));
  }
}
