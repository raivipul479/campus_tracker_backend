import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { validatePhone } from '../validators.js';
import { DeviceRole, DeviceTokenModel } from '../models/device-token.model.js';
import { NotificationModel, NotificationType } from '../models/notification.model.js';
import { sendToTokens } from '../notifications/firebase.js';

const OUTSTANDING_STATUSES = ['Pending', 'Partial', 'Overdue'] as const;

export class NotificationService {
  static async registerToken(
    phone: string,
    role: DeviceRole,
    tokenValue: unknown,
    platformValue: unknown
  ) {
    const normalizedPhone = validatePhone(phone);
    const token = String(tokenValue ?? '').trim();
    if (!token || token.length > 512) {
      throw new ApiError(400, 'token is required and must be at most 512 characters');
    }
    const platform = ['android', 'ios'].includes(String(platformValue))
      ? String(platformValue)
      : 'android';
    await DeviceTokenModel.upsert(normalizedPhone, role, token, platform);
    return { registered: true };
  }

  static async listForParent(phone: string) {
    return NotificationModel.listByPhone(validatePhone(phone));
  }

  static async markAllRead(phone: string) {
    await NotificationModel.markAllRead(validatePhone(phone));
    return { ok: true };
  }

  // Fired after a driver logs a Pickup/Drop for a student.
  static async notifyTransportEvent(studentId: number, action: 'Pickup' | 'Drop') {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) return;

    const phones = uniquePhones([student.phone, student.secondaryPhone]);
    const title = action === 'Pickup' ? 'Child picked up' : 'Child dropped off';
    const verb = action === 'Pickup' ? 'picked up' : 'dropped off';
    const body = `${student.fullName} was ${verb} by the driver.`;

    await NotificationService.deliver(phones, studentId, action, title, body);
  }

  // Admin fee reminder — one student or every student with outstanding dues.
  // Deliberately unthrottled: admins asked to be able to re-send on demand
  // (a parent deletes the notification, registers a new device, or simply
  // needs chasing twice in a day), so there is no per-day cap here or in the UI.
  static async sendFeeReminder(payload: { studentId?: unknown; all?: unknown }) {
    const targets = payload.studentId
      ? await NotificationService.singleTarget(payload.studentId)
      : await NotificationService.allOutstandingTargets();

    let sent = 0;
    for (const target of targets) {
      const body =
        target.balance > 0
          ? `Dear parent, a transport fee of ₹${target.balance.toFixed(2)} is pending for ${target.name}. Kindly clear it at the earliest.`
          : `Dear parent, please clear the pending transport fee for ${target.name}.`;
      await NotificationService.deliver(
        [target.phone],
        target.studentId,
        'FeeReminder',
        'Fee reminder',
        body
      );
      sent += 1;
    }
    return {
      sent,
      students: new Set(targets.map(t => t.studentId)).size
    };
  }

  // Admin-facing history of everything that has been sent, newest first,
  // with the student's name resolved for display. Notification has no Prisma
  // relation to Student, so names are looked up in a second query.
  static async listAll(query: {
    type?: unknown;
    phone?: unknown;
    studentId?: unknown;
    from?: unknown;
    to?: unknown;
    limit?: unknown;
  }) {
    const filters = {
      type: parseType(query.type),
      phone: query.phone ? validatePhone(String(query.phone)) : undefined,
      studentId: parsePositiveInt(query.studentId, 'studentId'),
      from: parseDate(query.from, 'from'),
      to: parseDate(query.to, 'to', true),
      limit: Math.min(Math.max(parsePositiveInt(query.limit, 'limit') ?? 200, 1), 500)
    };

    const [rows, total] = await Promise.all([
      NotificationModel.listAll(filters),
      NotificationModel.countAll(filters)
    ]);

    const studentIds = [
      ...new Set(rows.map(row => row.studentId).filter((id): id is number => id !== null))
    ];
    const students = studentIds.length
      ? await prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, fullName: true }
        })
      : [];
    const nameById = new Map(students.map(student => [student.id, student.fullName]));

    return {
      total,
      returned: rows.length,
      notifications: rows.map(row => ({
        ...row,
        studentName: row.studentId ? nameById.get(row.studentId) ?? null : null
      }))
    };
  }

  private static async singleTarget(studentIdValue: unknown) {
    const studentId = Number(studentIdValue);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new ApiError(400, 'studentId is invalid');
    }
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new ApiError(404, 'Student not found');
    const balance = await NotificationService.outstandingFor(studentId);
    return uniquePhones([student.phone, student.secondaryPhone]).map(phone => ({
      phone,
      studentId,
      name: student.fullName,
      balance
    }));
  }

  private static async allOutstandingTargets() {
    const dues = await prisma.feeDue.findMany({
      where: { status: { in: [...OUTSTANDING_STATUSES] } },
      include: { student: true }
    });

    const byStudent = new Map<number, { name: string; phones: string[]; balance: number }>();
    for (const due of dues) {
      if (!due.student) continue;
      const current = byStudent.get(due.studentId) ?? {
        name: due.student.fullName,
        phones: uniquePhones([due.student.phone, due.student.secondaryPhone]),
        balance: 0
      };
      current.balance += Number(due.balance ?? 0);
      byStudent.set(due.studentId, current);
    }

    const targets: { phone: string; studentId: number; name: string; balance: number }[] = [];
    for (const [studentId, info] of byStudent) {
      for (const phone of info.phones) {
        targets.push({ phone, studentId, name: info.name, balance: info.balance });
      }
    }
    return targets;
  }

  private static async outstandingFor(studentId: number) {
    const dues = await prisma.feeDue.findMany({
      where: { studentId, status: { in: [...OUTSTANDING_STATUSES] } }
    });
    return dues.reduce((sum, due) => sum + Number(due.balance ?? 0), 0);
  }

  // Stores the notification for in-app history and pushes it to the parent's devices.
  private static async deliver(
    phones: string[],
    studentId: number | null,
    type: NotificationType,
    title: string,
    body: string
  ) {
    if (!phones.length) return;

    await NotificationModel.createMany(
      phones.map(phone => ({ phone, studentId, type, title, body }))
    );

    const tokens = await DeviceTokenModel.tokensForPhones(phones);
    if (!tokens.length) return;

    const stale = await sendToTokens(tokens, {
      title,
      body,
      data: { type, studentId: studentId ? String(studentId) : '' }
    });
    if (stale.length) await DeviceTokenModel.deleteTokens(stale);
  }
}

function uniquePhones(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

const NOTIFICATION_TYPES = ['Pickup', 'Drop', 'FeeReminder'] as const;

function parseType(value: unknown): NotificationType | undefined {
  const text = String(value ?? '').trim();
  if (!text || text === 'all') return undefined;
  const match = NOTIFICATION_TYPES.find(type => type === text);
  if (!match) throw new ApiError(400, `type must be one of ${NOTIFICATION_TYPES.join(', ')}`);
  return match;
}

function parsePositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, `${field} must be a positive integer`);
  }
  return parsed;
}

function parseDate(value: unknown, field: string, endOfDay = false): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${field} must be a valid date`);
  }
  // A date-only bound like "2026-08-09" parses to midnight, which as an upper
  // bound would exclude everything sent that day. Push it to the day's end.
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}
