import { ApiError } from '../errors.js';
import { fromDriverStatus } from '../models/driver.model.js';
import { prisma } from '../prisma.js';
import { schoolDateKey, schoolDayStart } from '../school-time.js';

/**
 * Monthly attendance, derived from transport_logs.
 *
 * There is no separate attendance table: a pickup or drop logged by a driver
 * IS the attendance record, so the report is computed rather than stored and
 * can never drift from the underlying logs.
 *
 * "Operating days" are the distinct dates on which ANY transport was logged
 * across the school. That is the honest denominator — the system has no
 * holiday calendar, so counting weekdays would invent absences for days
 * transport never ran.
 */

function monthRange(value?: string) {
  const text = String(value ?? '').trim();
  const [thisYear, thisMonth] = schoolDateKey(new Date()).split('-').map(Number);
  const match = text.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : thisYear;
  const month = match ? Number(match[2]) : thisMonth;
  if (month < 1 || month > 12) throw new ApiError(400, 'month must be YYYY-MM');

  // Half-open range, from school-local midnight on the 1st to school-local
  // midnight on the 1st of the next month.
  const from = schoolDayStart(year, month, 1);
  const to = month === 12 ? schoolDayStart(year + 1, 1, 1) : schoolDayStart(year, month + 1, 1);
  return { key: `${year}-${String(month).padStart(2, '0')}`, from, to };
}

// Days are the school's calendar days (config.schoolTimeZone), not UTC days,
// so a check-in at 02:00 IST counts on its own date rather than the day before.
const dateKey = schoolDateKey;

interface LogRow {
  studentId: number;
  driverId: number | null;
  action: string;
  recordedAt: Date;
}

async function logsForMonth(from: Date, to: Date): Promise<LogRow[]> {
  return prisma.transportLog.findMany({
    where: { recordedAt: { gte: from, lt: to } },
    select: { studentId: true, driverId: true, action: true, recordedAt: true },
    orderBy: { recordedAt: 'asc' }
  });
}

async function dutyLogsForMonth(from: Date, to: Date) {
  return prisma.driverDutyLog.findMany({
    where: { recordedAt: { gte: from, lt: to } },
    select: { driverId: true, action: true, recordedAt: true },
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }]
  });
}

type DutyDay = { checkIn: string | null; checkOut: string | null };

// Distinct dates on which anything at all was logged.
const operatingDaysFrom = (logs: LogRow[]) =>
  [...new Set(logs.map(log => dateKey(log.recordedAt)))].sort();

export class AttendanceService {
  /**
   * Per-student attendance for a month.
   *
   * A student counts as present on a day if they have at least one log that
   * day, pickup or drop. Students on hold are included but flagged, since a
   * held student legitimately has no logs and should not read as absent.
   */
  static async students(filters: { month?: string; studentId?: string; routeId?: string }) {
    const { key, from, to } = monthRange(filters.month);
    const logs = await logsForMonth(from, to);
    const operatingDays = operatingDaysFrom(logs);

    const routeFilter = filters.routeId
      ? {
          routeAssignments: {
            some: {
              unassignedAt: null,
              route: /^\d+$/.test(filters.routeId)
                ? { id: Number(filters.routeId) }
                : { routeCode: filters.routeId }
            }
          }
        }
      : {};

    const studentId = filters.studentId ? Number(filters.studentId) : undefined;
    if (filters.studentId && (!Number.isInteger(studentId) || (studentId as number) <= 0)) {
      throw new ApiError(400, 'studentId must be a positive integer');
    }

    const students = await prisma.student.findMany({
      where: { ...routeFilter, ...(studentId ? { id: studentId } : {}) },
      select: {
        id: true, fullName: true, registrationNumber: true, className: true,
        section: true, onHold: true, branch: true,
        routeAssignments: {
          where: { unassignedAt: null },
          select: { route: { select: { routeCode: true } } },
          take: 1
        }
      },
      orderBy: { fullName: 'asc' }
    });

    const byStudent = new Map<number, { days: Set<string>; pickups: number; drops: number; last: Date | null }>();
    for (const log of logs) {
      const entry = byStudent.get(log.studentId) ?? { days: new Set<string>(), pickups: 0, drops: 0, last: null };
      entry.days.add(dateKey(log.recordedAt));
      if (log.action === 'Pickup') entry.pickups += 1;
      else entry.drops += 1;
      if (!entry.last || log.recordedAt > entry.last) entry.last = log.recordedAt;
      byStudent.set(log.studentId, entry);
    }

    const rows = students.map(student => {
      const entry = byStudent.get(student.id);
      const present = entry ? entry.days.size : 0;
      const absent = Math.max(operatingDays.length - present, 0);
      return {
        studentId: student.id,
        student: student.fullName,
        regNo: student.registrationNumber,
        class: [student.className, student.section].filter(Boolean).join(' '),
        branch: student.branch ?? '',
        route: student.routeAssignments[0]?.route?.routeCode ?? '',
        onHold: student.onHold,
        presentDays: present,
        absentDays: student.onHold ? 0 : absent,
        pickups: entry?.pickups ?? 0,
        drops: entry?.drops ?? 0,
        // Percentage of the days transport actually ran.
        attendancePct: operatingDays.length ? Math.round((present / operatingDays.length) * 100) : 0,
        lastSeen: entry?.last ? entry.last.toISOString() : null,
        dates: entry ? [...entry.days].sort() : []
      };
    });

    return {
      month: key,
      operatingDays: operatingDays.length,
      dates: operatingDays,
      totalStudents: rows.length,
      rows
    };
  }

  /**
   * Per-driver attendance for a month.
   *
   * A driver counts as present on a day if they checked in for duty or logged
   * at least one pickup or drop. Logs written before driver_id existed have no
   * driver and are counted separately as unattributed rather than being
   * assigned to someone.
   *
   * Operating days here also include days on which any driver checked in, so a
   * day with check-ins but no pickups still counts. The student report keeps
   * using transport days only: a check-in alone says nothing about students.
   */
  static async drivers(filters: { month?: string; driverId?: string }) {
    const { key, from, to } = monthRange(filters.month);
    const [logs, dutyLogs] = await Promise.all([logsForMonth(from, to), dutyLogsForMonth(from, to)]);
    const operatingDays = [...new Set([
      ...operatingDaysFrom(logs),
      ...dutyLogs.filter(log => log.action === 'CheckIn').map(log => dateKey(log.recordedAt))
    ])].sort();

    const driverId = filters.driverId ? Number(filters.driverId) : undefined;
    if (filters.driverId && (!Number.isInteger(driverId) || (driverId as number) <= 0)) {
      throw new ApiError(400, 'driverId must be a positive integer');
    }

    const drivers = await prisma.driver.findMany({
      where: driverId ? { id: driverId } : {},
      select: {
        id: true, fullName: true, phone: true, status: true,
        vehicleAssignments: {
          where: { unassignedAt: null },
          select: { vehicle: { select: { vehicleCode: true } } },
          take: 1
        }
      },
      orderBy: { fullName: 'asc' }
    });

    const byDriver = new Map<number, { days: Set<string>; trips: number; students: Set<number>; last: Date | null }>();
    let unattributed = 0;
    for (const log of logs) {
      if (log.driverId === null) { unattributed += 1; continue; }
      const entry = byDriver.get(log.driverId)
        ?? { days: new Set<string>(), trips: 0, students: new Set<number>(), last: null };
      entry.days.add(dateKey(log.recordedAt));
      entry.trips += 1;
      entry.students.add(log.studentId);
      if (!entry.last || log.recordedAt > entry.last) entry.last = log.recordedAt;
      byDriver.set(log.driverId, entry);
    }

    // First check-in of each day, and the check-out that ended the day. A
    // check-in after a check-out clears it, so a day that ends on duty (or with
    // a forgotten check-out) shows no check-out rather than an earlier one.
    const dutyByDriver = new Map<number, Map<string, DutyDay>>();
    const lastDutyAt = new Map<number, string>();
    for (const log of dutyLogs) {
      const days = dutyByDriver.get(log.driverId) ?? new Map<string, DutyDay>();
      const day = dateKey(log.recordedAt);
      const entry = days.get(day) ?? { checkIn: null, checkOut: null };
      const at = log.recordedAt.toISOString();
      if (log.action === 'CheckIn') {
        if (!entry.checkIn) entry.checkIn = at;
        entry.checkOut = null;
      } else {
        entry.checkOut = at;
      }
      days.set(day, entry);
      dutyByDriver.set(log.driverId, days);
      lastDutyAt.set(log.driverId, at); // logs are in time order
    }

    const rows = drivers.map(driver => {
      const entry = byDriver.get(driver.id);
      const duty = dutyByDriver.get(driver.id) ?? new Map<string, DutyDay>();
      const checkInDays = [...duty].filter(([, day]) => day.checkIn).map(([date]) => date);
      const days = new Set([...(entry?.days ?? []), ...checkInDays]);
      const present = days.size;
      // ISO strings sort chronologically, so the max is the latest activity.
      const lastSeen = [entry?.last?.toISOString(), lastDutyAt.get(driver.id)]
        .filter((value): value is string => Boolean(value)).sort().pop() ?? null;
      return {
        driverId: driver.id,
        driver: driver.fullName,
        phone: driver.phone,
        status: fromDriverStatus(driver.status),
        vehicle: driver.vehicleAssignments[0]?.vehicle?.vehicleCode ?? '',
        presentDays: present,
        absentDays: Math.max(operatingDays.length - present, 0),
        trips: entry?.trips ?? 0,
        studentsHandled: entry?.students.size ?? 0,
        dutyDays: checkInDays.length,
        attendancePct: operatingDays.length ? Math.round((present / operatingDays.length) * 100) : 0,
        lastSeen,
        dates: [...days].sort(),
        // { 'YYYY-MM-DD': { checkIn, checkOut } } as ISO timestamps, for the
        // day-by-day view in the admin dashboard.
        duty: Object.fromEntries(duty)
      };
    });

    return {
      month: key,
      operatingDays: operatingDays.length,
      dates: operatingDays,
      totalDrivers: rows.length,
      // Logs with no driver recorded — pre-migration rows, or logs created
      // outside the driver portal.
      unattributedLogs: unattributed,
      rows
    };
  }
}
