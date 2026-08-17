import { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { Body, requiredOrExisting } from '../validators.js';

const allowedActions = new Set(['Pickup', 'Drop']);

export class TransportLogService {
  static async list(filters: { studentId?: string; studentIds?: number[]; from?: string; to?: string }) {
    const where: Prisma.TransportLogWhereInput = {};
    if (filters.studentId) {
      const studentId = Number(filters.studentId);
      if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId filter must be a positive integer');
      where.studentId = studentId;
    }
    if (filters.studentIds) {
      where.studentId = { in: filters.studentIds };
    }
    if (filters.from || filters.to) {
      where.recordedAt = {};
      if (filters.from) where.recordedAt.gte = parseDate(filters.from, 'from date');
      if (filters.to) where.recordedAt.lte = parseDate(filters.to, 'to date');
    }

    const rows = await prisma.transportLog.findMany({
      where,
      include: { student: true },
      orderBy: { recordedAt: 'desc' }
    });
    return rows.map(mapTransportLog);
  }

  static async create(data: Body) {
    const studentId = Number(requiredOrExisting(data, ['studentId'], 'studentId'));
    if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId is invalid');
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new ApiError(404, 'Student not found');

    const action = String(requiredOrExisting(data, ['action'], 'action'));
    if (!allowedActions.has(action)) throw new ApiError(400, 'action must be Pickup or Drop');

    const latitude = numberField(data.latitude, 'latitude', -90, 90);
    const longitude = numberField(data.longitude, 'longitude', -180, 180);
    const accuracy = numberField(data.accuracy ?? 0, 'accuracy', 0, 100000);
    const recordedAt = parseDate(data.recordedAt ?? new Date().toISOString(), 'recordedAt');

    // Recorded so driver attendance can be reported. The driver portal supplies
    // it; a log created any other way stays unattributed rather than being
    // guessed from the student's current route, since vehicle and driver
    // assignments change over time.
    const driverIdRaw = data.driverId;
    const driverId = driverIdRaw === undefined || driverIdRaw === null || driverIdRaw === ''
      ? null
      : Number(driverIdRaw);
    if (driverId !== null && (!Number.isInteger(driverId) || driverId <= 0)) {
      throw new ApiError(400, 'driverId is invalid');
    }

    const created = await prisma.transportLog.create({
      data: {
        studentId,
        driverId,
        action: action as any,
        recordedAt,
        latitude,
        longitude,
        accuracy
      },
      include: { student: true }
    });
    return mapTransportLog(created);
  }
}

function numberField(value: unknown, label: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, `${label} is invalid`);
  }
  return number;
}

function parseDate(value: unknown, label: string) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${label} is invalid`);
  return date;
}

function mapTransportLog(row: {
  id: number;
  studentId: number;
  action: string;
  recordedAt: Date;
  latitude: Prisma.Decimal | number | string;
  longitude: Prisma.Decimal | number | string;
  accuracy: Prisma.Decimal | number | string;
  student?: { fullName: string } | null;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    student: row.student?.fullName ?? '',
    action: row.action,
    recordedAt: row.recordedAt.toISOString(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: Number(row.accuracy)
  };
}
