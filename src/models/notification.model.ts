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

  // Admin-facing history across every recipient. Newest first, capped so a
  // large school can't pull the whole table in one request.
  static async listAll(filters: NotificationListFilters = {}) {
    const { type, phone, studentId, from, to, limit = 200 } = filters;
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;

    const rows = await prisma.notification.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(phone ? { phone } : {}),
        ...(studentId ? { studentId } : {}),
        ...(from || to ? { createdAt } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return rows.map(mapNotification);
  }

  static async countAll(filters: NotificationListFilters = {}) {
    const { type, phone, studentId, from, to } = filters;
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;

    return prisma.notification.count({
      where: {
        ...(type ? { type } : {}),
        ...(phone ? { phone } : {}),
        ...(studentId ? { studentId } : {}),
        ...(from || to ? { createdAt } : {})
      }
    });
  }
}

export interface NotificationListFilters {
  type?: NotificationType;
  phone?: string;
  studentId?: number;
  from?: Date;
  to?: Date;
  limit?: number;
}

function mapNotification(row: {
  id: number;
  phone: string;
  studentId: number | null;
  type: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    phone: row.phone,
    studentId: row.studentId,
    type: row.type,
    title: row.title,
    body: row.body,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString()
  };
}
