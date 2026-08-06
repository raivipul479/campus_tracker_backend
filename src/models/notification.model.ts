import { prisma } from '../prisma.js';

export type NotificationType = 'Pickup' | 'Drop' | 'FeeReminder';

interface NotificationEntry {
  phone: string;
  studentId?: number | null;
  type: NotificationType;
  title: string;
  body: string;
}

export class NotificationModel {
  static async createMany(entries: NotificationEntry[]) {
    if (!entries.length) return;
    await prisma.notification.createMany({
      data: entries.map(entry => ({
        phone: entry.phone,
        studentId: entry.studentId ?? null,
        type: entry.type,
        title: entry.title,
        body: entry.body
      }))
    });
  }

  static async listByPhone(phone: string, limit = 100) {
    const rows = await prisma.notification.findMany({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return rows.map(mapNotification);
  }

  static async markAllRead(phone: string) {
    await prisma.notification.updateMany({
      where: { phone, readAt: null },
      data: { readAt: new Date() }
    });
  }

  // Student ids that already received a notification of this type today
  // (local calendar day), used to enforce a once-per-day send limit.
  static async remindedSince(studentIds: number[], type: NotificationType, since: Date) {
    if (!studentIds.length) return new Set<number>();
    const rows = await prisma.notification.findMany({
      where: {
        studentId: { in: studentIds },
        type,
        createdAt: { gte: since }
      },
      select: { studentId: true },
      distinct: ['studentId']
    });
    return new Set(rows.map(row => row.studentId).filter((id): id is number => id !== null));
  }
}

function mapNotification(row: {
  id: number;
  studentId: number | null;
  type: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    studentId: row.studentId,
    type: row.type,
    title: row.title,
    body: row.body,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString()
  };
}
