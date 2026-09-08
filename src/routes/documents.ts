import { Router } from 'express';
import multer from 'multer';
import { tmpdir } from 'node:os';
import { DocumentController } from '../controllers/document.controller.js';
import { asyncHandler } from '../errors.js';
import { config } from '../config.js';

// Disk storage, not memory: a 10MB file per concurrent request held in RAM is
// avoidable. multer writes to a temp name and the service validates the
// contents before moving it into the uploads volume.
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: config.uploads.maxBytes, files: 1 }
});

export const documentsRouter = Router();

documentsRouter.get('/', asyncHandler(DocumentController.list));
documentsRouter.post('/', upload.single('file'), asyncHandler(DocumentController.create));
documentsRouter.get('/:id/file', asyncHandler(DocumentController.download));
documentsRouter.delete('/:id', asyncHandler(DocumentController.remove));
