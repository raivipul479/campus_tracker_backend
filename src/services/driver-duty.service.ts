import { DriverDutyAction, DriverStatus, Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { Body, requiredOrExisting } from '../validators.js';

const allowedActions = new Set<string>(['CheckIn', 'CheckOut']);

// Same UTC-date bucketing as the attendance report, so "today" here and a day
// in the report are always the same day. See the note in attendance.service.ts.
const dateKey = (value: Date) => value.toISOString().slice(0, 10);

type DutyRow = {
  id: number;
  action: DriverDutyAction | string;
  recordedAt: Date;
  latitude: Prisma.Decimal | number | string;
  longitude: Prisma.Decimal | number | string;
  accuracy: Prisma.Decimal | number | string;
};

function mapDutyLog(row: DutyRow) {
  return {
    id: row.id,
    action: String(row.action),
    recordedAt: row.recordedAt.toISOString(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: Number(row.accuracy)
  };
}

function numberField(value: unknown, label: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, `${label} is invalid`);
  }
  return number;
}

export class DriverDutyService {
  /**
   * Today's duty state for one driver: the latest check-in, the check-out that
   * closed it (if any), and whether they are on duty right now. A driver can
   * check in again after checking out, so this is the current session, not the
   * first check-in of the day; the attendance report tracks that separately.
   */
  static async today(driverId: number) {
    const now = new Date();
    const from = new Date(`${dateKey(now)}T00:00:00.000Z`);
    const logs = await prisma.driverDutyLog.findMany({
      where: { driverId, recordedAt: { gte: from } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }]
    });
    return DriverDutyService.summarize(logs);
  }

  static summarize(logs: DutyRow[]) {
    const checkIn = [...logs].reverse().find(log => log.action === 'CheckIn') ?? null;
    const last = logs[logs.length - 1] ?? null;
    const checkOut = last?.action === 'CheckOut' ? last : null;
    return {
      onDuty: last?.action === 'CheckIn',
      checkIn: checkIn ? mapDutyLog(checkIn) : null,
      checkOut: checkOut ? mapDutyLog(checkOut) : null
    };
  }

  /**
   * Records a check-in or check-out and moves drivers.status to match, in one
   * transaction so the log and the status the admin sees can never disagree.
   *
   * A check-in is refused while already checked in today, and a check-out is
   * refused unless checked in today. A driver who forgot to check out
   * yesterday can still check in this morning.
   */
  static async record(driverId: number, data: Body) {
    const action = String(requiredOrExisting(data, ['action'], 'action'));
    if (!allowedActions.has(action)) throw new ApiError(400, 'action must be CheckIn or CheckOut');

    const latitude = numberField(data.latitude, 'latitude', -90, 90);
    const longitude = numberField(data.longitude, 'longitude', -180, 180);
    const accuracy = numberField(data.accuracy ?? 0, 'accuracy', 0, 100000);

    const current = await DriverDutyService.today(driverId);
    if (action === 'CheckIn' && current.onDuty) {
      throw new ApiError(409, 'You are already checked in');
    }
    if (action === 'CheckOut' && !current.onDuty) {
      throw new ApiError(409, 'You are not checked in today');
    }

    await prisma.$transaction([
      prisma.driverDutyLog.create({
        data: {
          driverId,
          action: action as DriverDutyAction,
          recordedAt: new Date(),
          latitude,
          longitude,
          accuracy
        }
      }),
      prisma.driver.update({
        where: { id: driverId },
        data: { status: action === 'CheckIn' ? DriverStatus.On_duty : DriverStatus.Off_duty }
      })
    ]);

    return DriverDutyService.today(driverId);
  }
}
