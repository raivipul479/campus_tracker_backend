import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
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

function mapDocument(row: any) {
  const owner = row.driver?.fullName ?? row.vehicle?.vehicleCode ?? row.student?.fullName ?? '';
  return {
    id: row.id,
    owner,
    ownerId: row.driverId ?? row.vehicleId ?? row.studentId ?? null,
    kind: row.ownerType,
    type: row.docType,
    number: row.docNumber,
    expiry: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : null,
    status: row.status,
    fileName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy ?? '',
    notes: row.notes ?? '',
    createdAt: row.createdAt.toISOString()
  };
}

const withOwners = {
  driver: { select: { fullName: true } },
  vehicle: { select: { vehicleCode: true } },
  student: { select: { fullName: true } }
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
  static async create(file: Express.Multer.File | undefined, body: Record<string, unknown>, uploadedBy?: string) {
    if (!file) throw new ApiError(400, 'A file is required');

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

      // Read the head for a magic-byte check, and hash the whole file.
      const head = await readHead(file.path, 8);
      const kind = sniff(head);
      if (!kind) throw new ApiError(400, 'Only PDF, JPEG and PNG files are accepted');
      const checksum = await sha256(file.path);

      // Date-sharded so no single directory accumulates thousands of entries.
      const now = new Date();
      const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const storedPath = `${folder}/${randomUUID()}${kind.ext}`;
      const destination = absolutePathFor(storedPath);
      await mkdir(dirname(destination), { recursive: true });
      await rename(file.path, destination);

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
          // Kept for display only. The path above is generated, never derived
          // from this, so a name like "../../server.js" is inert.
          originalName: String(file.originalname ?? 'document').slice(0, 255),
          storedPath,
          mimeType: kind.mime,
          sizeBytes: file.size,
          checksum,
          uploadedBy: uploadedBy ?? null,
          notes: body.notes ? String(body.notes).slice(0, 255) : null
        },
        include: withOwners
      });
      return mapDocument(created);
    } catch (error) {
      // Never leave an orphan behind when the request is rejected.
      await rm(file.path, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** The file itself, for streaming to an authenticated caller. */
  static async fileFor(idValue: unknown) {
    const id = positiveId(idValue, 'document id');
    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) throw new ApiError(404, 'Document not found');

    const path = absolutePathFor(document.storedPath);
    try {
      await stat(path);
    } catch {
      // The row outliving its file means the volume was lost or replaced --
      // worth saying plainly rather than returning an empty download.
      throw new ApiError(410, 'The stored file is missing. It may have been removed from the server.');
    }
    return {
      stream: createReadStream(path),
      fileName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes
    };
  }

  static async remove(idValue: unknown) {
    const id = positiveId(idValue, 'document id');
    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) throw new ApiError(404, 'Document not found');

    await prisma.document.delete({ where: { id } });
    // After the row, so a failed delete cannot leave a record pointing at a
    // file that is already gone. An orphaned file is the safer failure.
    await rm(absolutePathFor(document.storedPath), { force: true }).catch(() => {});
    return { deleted: id };
  }
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
