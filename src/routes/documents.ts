import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DocumentController } from '../controllers/document.controller.js';
import { asyncHandler } from '../errors.js';
import { config } from '../config.js';

// Staged inside the uploads volume rather than the OS temp directory. In
// production /tmp is the container's own filesystem and the uploads root is a
// mounted volume -- different devices, so rename() fails with EXDEV. Staging
// here keeps the move within one filesystem, where it is also atomic.
const stagingDirectory = resolve(config.uploads.root, '.staging');
mkdirSync(stagingDirectory, { recursive: true });

// Disk storage, not memory: a 10MB file per concurrent request held in RAM is
// avoidable. multer writes a temporary name and the service validates the
// contents before moving it to its final path.
const upload = multer({
  dest: stagingDirectory,
  limits: { fileSize: config.uploads.maxBytes, files: 1 }
});

export const documentsRouter = Router();

documentsRouter.get('/', asyncHandler(DocumentController.list));
documentsRouter.post('/', upload.single('file'), asyncHandler(DocumentController.create));
documentsRouter.get('/:id/file', asyncHandler(DocumentController.download));
documentsRouter.delete('/:id', asyncHandler(DocumentController.remove));
