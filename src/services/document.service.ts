import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { positiveId, validateText } from '../validators.js';

/**
 * Compliance documents: licences, insurance, permits, ID proofs.
 *
 * The file lives on disk under config.uploads.root -- a Docker named volume in
 * production -- and only its metadata is in the database. Files are never
 * served from a static directory: they hold personal data, so every read goes
 * through the authenticated download route.
 */

const OWNER_TYPES = ['Driver', 'Vehicle', 'Student'] as const;
type OwnerType = (typeof OWNER_TYPES)[number];

const STATUSES = ['Verified', 'Pending', 'Expiring', 'Expired'] as const;

/**
 * Accepted types, keyed by the first bytes of the file.
 *
 * Checked against the content, not the browser's Content-Type header, which is
 * supplied by the client and so proves nothing. A .pdf that is really an
 * executable is rejected here.
 */
const MAGIC: { ext: string; mime: string; test: (buf: Buffer) => boolean }[] = [
  { ext: '.pdf', mime: 'application/pdf', test: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { ext: '.jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: '.png',
    mime: 'image/png',
    test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
];

function sniff(buffer: Buffer) {
  return MAGIC.find(type => type.test(buffer)) ?? null;
}

const uploadsRoot = () => resolve(config.uploads.root);

/**
 * Absolute path for a stored file, refusing anything that escapes the uploads
 * root. stored_path is server-generated, so this should never trigger -- it is
 * here so that a future bug cannot turn into arbitrary file reads.
 */
function absolutePathFor(storedPath: string) {
  const root = uploadsRoot();
  const full = resolve(root, storedPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new ApiError(400, 'Invalid document path');
  }
  return full;
}

async function ownerFor(ownerType: OwnerType, ownerIdValue: unknown) {
  const ownerId = positiveId(ownerIdValue, 'ownerId');
  if (ownerType === 'Driver') {
    const driver = await prisma.driver.findUnique({ where: { id: ownerId }, select: { id: true, fullName: true } });
    if (!driver) throw new ApiError(404, 'Driver not found');
    return { driverId: driver.id, vehicleId: null, studentId: null, label: driver.fullName };
  }
  if (ownerType === 'Vehicle') {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: ownerId }, select: { id: true, vehicleCode: true } });
    if (!vehicle) throw new ApiError(404, 'Vehicle not found');
    return { driverId: null, vehicleId: vehicle.id, studentId: null, label: vehicle.vehicleCode };
  }
  const student = await prisma.student.findUnique({ where: { id: ownerId }, select: { id: true, fullName: true } });
  if (!student) throw new ApiError(404, 'Student not found');
  return { driverId: null, vehicleId: null, studentId: student.id, label: student.fullName };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a document has left, from its expiry date.
 *
 * Deliberately derived rather than read from the status column: that is set by
 * hand, and an admin who forgets to change it would leave an expired licence
 * showing as Verified. The date cannot drift.
 */
function expiryState(expiryDate: Date | null, withinDays: number) {
  if (!expiryDate) return { expiryState: 'none' as const, daysLeft: null };
  // Compared date-only, so a document expiring today reads as 0 days rather
  // than a fraction either side of the hour the request happens to arrive.
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const expiry = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
  const daysLeft = Math.round((expiry - today) / DAY_MS);
  if (daysLeft < 0) return { expiryState: 'expired' as const, daysLeft };
  if (daysLeft <= withinDays) return { expiryState: 'expiring' as const, daysLeft };
  return { expiryState: 'ok' as const, daysLeft };
}

function mapDocument(row: any, withinDays = 30) {
  const owner = row.driver?.fullName ?? row.vehicle?.vehicleCode ?? row.student?.fullName ?? '';
  return {
    ...expiryState(row.expiryDate ?? null, withinDays),
    id: row.id,
    owner,
    ownerId: row.driverId ?? row.vehicleId ?? row.studentId ?? null,
    kind: row.ownerType,
    type: row.docType,
    number: row.docNumber,
    expiry: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : null,
    status: row.status,
    files: (row.files ?? []).map((file: any) => ({
      id: file.id,
      fileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sortOrder: file.sortOrder
    })),
    fileCount: (row.files ?? []).length,
    // The first file, so a list can show something without unpacking them all.
    fileName: row.files?.[0]?.originalName ?? '',
    sizeBytes: (row.files ?? []).reduce((total: number, file: any) => total + file.sizeBytes, 0),
    uploadedBy: row.uploadedBy ?? '',
    notes: row.notes ?? '',
    createdAt: row.createdAt.toISOString()
  };
}

const withOwners = {
  driver: { select: { fullName: true } },
  vehicle: { select: { vehicleCode: true } },
  student: { select: { fullName: true } },
  files: { orderBy: { sortOrder: 'asc' } }
} as const;

export class DocumentService {
  static async list(filters: { ownerType?: string; ownerId?: string; status?: string; q?: string }) {
    const where: any = {};
    if (filters.ownerType) {
      if (!OWNER_TYPES.includes(filters.ownerType as OwnerType)) {
        throw new ApiError(400, `ownerType must be one of ${OWNER_TYPES.join(', ')}`);
      }
      where.ownerType = filters.ownerType;
    }
    if (filters.ownerId) {
      const ownerId = positiveId(filters.ownerId, 'ownerId');
      // Which column holds the id depends on the type, so a type is required
      // alongside it rather than searching all three.
      if (!filters.ownerType) throw new ApiError(400, 'ownerType is required when filtering by ownerId');
      where[`${String(filters.ownerType).toLowerCase()}Id`] = ownerId;
    }
    if (filters.status) where.status = filters.status;
    if (filters.q) {
      const q = String(filters.q).trim();
      where.OR = [{ docType: { contains: q } }, { docNumber: { contains: q } }, { originalName: { contains: q } }];
    }

    const rows = await prisma.document.findMany({
      where,
      include: withOwners,
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(mapDocument);
  }

  /**
   * Records an already-uploaded file.
   *
   * multer has written it to a temporary name; this validates the contents,
   * moves it to its final path and only then writes the row. If validation
   * fails the temporary file is removed, so a rejected upload leaves nothing
   * behind on disk.
   */
  /**
   * Records an uploaded document and its files.
   *
   * A document can be several files -- the front and back of a licence, the
   * pages of a certificate. Each is validated by content and moved into place;
   * if any one fails the whole upload is rejected and every file already moved
   * is removed, so a half-stored document never exists.
   */
  static async create(files: Express.Multer.File[] | undefined, body: Record<string, unknown>, uploadedBy?: string) {
    const uploads = files ?? [];
    if (!uploads.length) throw new ApiError(400, 'At least one file is required');

    const moved: string[] = [];
    try {
      const ownerType = String(body.ownerType ?? '') as OwnerType;
      if (!OWNER_TYPES.includes(ownerType)) {
        throw new ApiError(400, `ownerType must be one of ${OWNER_TYPES.join(', ')}`);
      }
      const owner = await ownerFor(ownerType, body.ownerId);

      const docType = validateText(String(body.docType ?? '').trim(), 'document type', { min: 2, max: 80 });
      const docNumber = validateText(String(body.docNumber ?? '').trim(), 'document number', { min: 1, max: 64 });

      const statusRaw = String(body.status ?? 'Pending');
      if (!STATUSES.includes(statusRaw as any)) {
        throw new ApiError(400, `status must be one of ${STATUSES.join(', ')}`);
      }

      let expiryDate: Date | null = null;
      if (body.expiryDate) {
        expiryDate = new Date(String(body.expiryDate));
        if (Number.isNaN(expiryDate.getTime())) throw new ApiError(400, 'expiryDate is not a valid date');
      }

      const prepared = await Promise.all(uploads.map((file, index) => prepareFile(file, index)));
      prepared.forEach(file => moved.push(file.storedPath));

      const created = await prisma.document.create({
        data: {
          ownerType,
          driverId: owner.driverId,
          vehicleId: owner.vehicleId,
          studentId: owner.studentId,
          docType,
          docNumber,
          expiryDate,
          status: statusRaw as any,
          uploadedBy: uploadedBy ?? null,
          notes: body.notes ? String(body.notes).slice(0, 255) : null,
          files: { create: prepared }
        },
        include: withOwners
      });
      return mapDocument(created);
    } catch (error) {
      // Remove whatever was already moved, then the staged temporaries, so a
      // rejected upload leaves nothing behind.
      await Promise.all(moved.map(path => rm(absolutePathFor(path), { force: true }).catch(() => {})));
      throw error;
    } finally {
      await Promise.all(uploads.map(file => rm(file.path, { force: true }).catch(() => {})));
    }
  }

  /** Adds more files to a document that already exists. */
  static async addFiles(idValue: unknown, files: Express.Multer.File[] | undefined) {
    const id = positiveId(idValue, 'document id');
    const uploads = files ?? [];
    if (!uploads.length) throw new ApiError(400, 'At least one file is required');

    const document = await prisma.document.findUnique({ where: { id }, include: { files: true } });
    if (!document) throw new ApiError(404, 'Document not found');

    const moved: string[] = [];
    try {
      const startAt = document.files.length;
      const prepared = await Promise.all(uploads.map((file, index) => prepareFile(file, startAt + index)));
      prepared.forEach(file => moved.push(file.storedPath));
      await prisma.documentFile.createMany({ data: prepared.map(file => ({ ...file, documentId: id })) });
      const updated = await prisma.document.findUnique({ where: { id }, include: withOwners });
      return mapDocument(updated);
    } catch (error) {
      await Promise.all(moved.map(path => rm(absolutePathFor(path), { force: true }).catch(() => {})));
      throw error;
    } finally {
      await Promise.all(uploads.map(file => rm(file.path, { force: true }).catch(() => {})));
    }
  }

  /** Removes one file from a document, keeping the document itself. */
  static async removeFile(idValue: unknown, fileIdValue: unknown) {
    const id = positiveId(idValue, 'document id');
    const fileId = positiveId(fileIdValue, 'file id');
    const file = await prisma.documentFile.findFirst({ where: { id: fileId, documentId: id } });
    if (!file) throw new ApiError(404, 'File not found on this document');

    const remaining = await prisma.documentFile.count({ where: { documentId: id } });
    if (remaining <= 1) {
      // A document with no files is a record of nothing. Deleting the last one
      // should be deleting the document, which is a different, deliberate act.
      throw new ApiError(400, 'This is the document\'s only file. Delete the document instead.');
    }

    await prisma.documentFile.delete({ where: { id: fileId } });
    await rm(absolutePathFor(file.storedPath), { force: true }).catch(() => {});
    return { deleted: fileId };
  }

  /**
   * Documents already expired  /**
   * Documents already expired or expiring soon, soonest first.
   *
   * Documents with no expiry date are left out entirely -- there is nothing to
   * warn about, and including them would bury the ones that matter.
   */
  static async expiring(daysValue?: string) {
    const days = Number(daysValue ?? 30);
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      throw new ApiError(400, 'days must be between 0 and 3650');
    }
    const cutoff = new Date(Date.now() + days * DAY_MS);
    const rows = await prisma.document.findMany({
      where: { expiryDate: { not: null, lte: cutoff } },
      include: withOwners,
      orderBy: { expiryDate: 'asc' }
    });
    const documents = rows.map(row => mapDocument(row, days));
    return {
      withinDays: days,
      expired: documents.filter(doc => doc.expiryState === 'expired').length,
      expiring: documents.filter(doc => doc.expiryState === 'expiring').length,
      documents
    };
  }

  /**
   * One file, for streaming to an authenticated caller.
   *
   * Without a fileId this returns the document's first file, which is what a
   * list row wants when it offers a single download.
   */
  static async fileFor(idValue: unknown, fileIdValue?: unknown) {
    const id = positiveId(idValue, 'document id');
    const file = fileIdValue === undefined
      ? await prisma.documentFile.findFirst({ where: { documentId: id }, orderBy: { sortOrder: 'asc' } })
      : await prisma.documentFile.findFirst({ where: { id: positiveId(fileIdValue, 'file id'), documentId: id } });
    if (!file) throw new ApiError(404, 'Document file not found');

    const path = absolutePathFor(file.storedPath);
    try {
      await stat(path);
    } catch {
      // The row outliving its file means the volume was lost or replaced --
      // worth saying plainly rather than returning an empty download.
      throw new ApiError(410, 'The stored file is missing. It may have been removed from the server.');
    }
    return {
      stream: createReadStream(path),
      fileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes
    };
  }

  static async remove(idValue: unknown) {
    const id = positiveId(idValue, 'document id');
    const document = await prisma.document.findUnique({ where: { id }, include: { files: true } });
    if (!document) throw new ApiError(404, 'Document not found');

    // The rows go first (the child rows cascade), then the files. An orphaned
    // file on disk is a better failure than a record pointing at nothing.
    await prisma.document.delete({ where: { id } });
    await Promise.all(document.files.map(file =>
      rm(absolutePathFor(file.storedPath), { force: true }).catch(() => {})));
    return { deleted: id, filesRemoved: document.files.length };
  }
}

/**
 * Move a file, falling back to copy when rename cannot cross a filesystem.
 *
 * Staging happens inside the uploads volume so rename normally suffices, but a
 * differently configured UPLOADS_ROOT would put the two on separate devices,
 * where rename fails with EXDEV rather than copying.
 */
async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

/**
 * Validate one uploaded file by its contents and move it into the uploads
 * root, returning the row to store. The caller owns cleanup on failure.
 */
async function prepareFile(file: Express.Multer.File, sortOrder: number) {
  const head = await readHead(file.path, 8);
  const kind = sniff(head);
  if (!kind) {
    throw new ApiError(400, `"${file.originalname}" is not a PDF, JPEG or PNG`);
  }
  const checksum = await sha256(file.path);

  // Date-sharded so no single directory accumulates thousands of entries.
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storedPath = `${folder}/${randomUUID()}${kind.ext}`;
  const destination = absolutePathFor(storedPath);
  await mkdir(dirname(destination), { recursive: true });
  await moveFile(file.path, destination);

  return {
    // Kept for display only. The path above is generated, never derived from
    // this, so a name like "../../server.js" is inert.
    originalName: String(file.originalname ?? 'document').slice(0, 255),
    storedPath,
    mimeType: kind.mime,
    sizeBytes: file.size,
    checksum,
    sortOrder
  };
}

async function readHead(path: string, bytes: number) {
  return new Promise<Buffer>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(path, { start: 0, end: Math.max(bytes, 16) - 1 });
    stream.on('data', chunk => chunks.push(chunk as Buffer));
    stream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function sha256(path: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export const uploadsDirectory = () => join(uploadsRoot());
