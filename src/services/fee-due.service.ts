import { FeeDueStatus, Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { Body, optionalBoundedNumber, optionalString, positiveId } from '../validators.js';

const statusValues = new Set(['Pending', 'Partial', 'Paid', 'Overdue', 'Waived']);

export class FeeDueService {
  static async list(filters: { month?: string; status?: string; studentId?: string; studentIds?: number[]; q?: string }) {
    const where = dueWhere(filters);
    const rows = await prisma.feeDue.findMany({
      where,
      include: dueInclude(),
      orderBy: [{ month: 'desc' }, { student: { fullName: 'asc' } }]
    });
    return rows.map(mapDue);
  }

  static async generate(data: Body) {
    const month = monthValue(optionalString(data, ['month']) || currentMonth());
    const overwrite = data.overwrite === true || data.overwrite === 'true';
    const studentIdRaw = data.studentId;
    const studentId = studentIdRaw === undefined || studentIdRaw === null || studentIdRaw === ''
      ? null
      : positiveId(studentIdRaw, 'studentId');

    const students = await prisma.student.findMany({
      where: studentId ? { id: studentId } : undefined,
      include: {
        routeAssignments: {
          where: { unassignedAt: null },
          include: { route: true },
          take: 1
        }
      },
      orderBy: { fullName: 'asc' }
    });
    if (studentId && students.length === 0) throw new ApiError(404, 'Student not found');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const student of students) {
      const assignment = student.routeAssignments[0];
      const route = assignment?.route;
      const baseAmount = Number(route?.fee ?? 0);
      if (!route || baseAmount <= 0) {
        skipped += 1;
        continue;
      }

      const existing = await prisma.feeDue.findUnique({
        where: { studentId_month: { studentId: student.id, month } }
      });

      if (existing && !overwrite) {
        skipped += 1;
        continue;
      }

      const paidAmount = existing ? Number(existing.paidAmount) : 0;
      const discount = existing ? Number(existing.discount) : 0;
      const fine = existing ? Number(existing.fine) : 0;
      const balance = Math.max(baseAmount + fine - discount - paidAmount, 0);
      const status = statusFor(balance, paidAmount, baseAmount + fine - discount);

      await prisma.feeDue.upsert({
        where: { studentId_month: { studentId: student.id, month } },
        create: {
          studentId: student.id,
          routeId: route.id,
          month,
          baseAmount,
          discount,
          fine,
          paidAmount,
          balance,
          status
        },
        update: {
          routeId: route.id,
          baseAmount,
          balance,
          status
        }
      });

      if (existing) updated += 1;
      else created += 1;
    }

    return {
      month,
      created,
      updated,
      skipped,
      dues: await FeeDueService.list(studentId ? { month, studentId: String(studentId) } : { month })
    };
  }

  static async adjust(idValue: unknown, data: Body) {
    const id = positiveId(idValue, 'due id');
    const existing = await prisma.feeDue.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Fee due not found');

    const discount = optionalBoundedNumber(data, ['discount'], 'discount', { min: 0, max: 99999999.99 }) ?? Number(existing.discount);
    const fine = optionalBoundedNumber(data, ['fine'], 'fine', { min: 0, max: 99999999.99 }) ?? Number(existing.fine);
    const total = Number(existing.baseAmount) + fine - discount;
    const paidAmount = Number(existing.paidAmount);
    const balance = Math.max(total - paidAmount, 0);
    const status = statusFor(balance, paidAmount, total);

    const updated = await prisma.feeDue.update({
      where: { id },
      data: { discount, fine, balance, status },
      include: dueInclude()
    });
    return mapDue(updated);
  }

  static async summary(filters: { month?: string }) {
    const month = monthValue(filters.month || currentMonth());
    const dues = await prisma.feeDue.findMany({ where: { month } });
    const billed = dues.reduce((sum, row) => sum + Number(row.baseAmount) + Number(row.fine) - Number(row.discount), 0);
    const paid = dues.reduce((sum, row) => sum + Number(row.paidAmount), 0);
    const pending = dues.reduce((sum, row) => sum + Number(row.balance), 0);
    return {
      month,
      billed,
      paid,
      pending,
      records: dues.length,
      paidStudents: dues.filter(row => row.status === 'Paid').length,
      pendingStudents: dues.filter(row => row.status !== 'Paid' && row.status !== 'Waived').length
    };
  }

  static async report(filters: { from?: string; to?: string; status?: string; studentId?: string }) {
    const dueWhereInput: Prisma.FeeDueWhereInput = {};
    if (filters.studentId) {
      const studentId = Number(filters.studentId);
      if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId filter must be a positive integer');
      dueWhereInput.studentId = studentId;
    }
    if (filters.status && filters.status !== 'all') {
      if (!statusValues.has(filters.status)) throw new ApiError(400, 'Unsupported due status');
      dueWhereInput.status = filters.status as FeeDueStatus;
    }
    if (filters.from || filters.to) {
      dueWhereInput.generatedAt = {};
      if (filters.from) dueWhereInput.generatedAt.gte = parseDate(filters.from, 'from date');
      if (filters.to) dueWhereInput.generatedAt.lte = endOfDay(parseDate(filters.to, 'to date'));
    }

    const dues = await prisma.feeDue.findMany({
      where: dueWhereInput,
      include: dueInclude(),
      orderBy: { generatedAt: 'desc' }
    });

    return dues.map(due => ({
      id: `DUE-${due.id}`,
      date: due.generatedAt.toISOString().slice(0, 10),
      month: due.month,
      studentId: due.studentId,
      student: due.student.fullName,
      type: 'Generated due',
      status: due.status,
      amount: Number(due.balance),
      billed: Number(due.baseAmount) + Number(due.fine) - Number(due.discount),
      paid: Number(due.paidAmount)
    }));
  }
}

export async function reconcileDuePayments(tx: Prisma.TransactionClient, dueId: number) {
  const due = await tx.feeDue.findUnique({ where: { id: dueId } });
  if (!due) throw new ApiError(404, 'Fee due not found');
  const payments = await tx.payment.aggregate({
    where: { dueId, status: { in: ['Paid', 'Collected'] } },
    _sum: { amount: true }
  });
  const paidAmount = Number(payments._sum.amount ?? 0);
  const total = Number(due.baseAmount) + Number(due.fine) - Number(due.discount);
  const balance = Math.max(total - paidAmount, 0);
  await tx.feeDue.update({
    where: { id: dueId },
    data: {
      paidAmount,
      balance,
      status: statusFor(balance, paidAmount, total)
    }
  });
}

function dueWhere(filters: { month?: string; status?: string; studentId?: string; studentIds?: number[]; q?: string }) {
  const where: Prisma.FeeDueWhereInput = {};
  if (filters.month) where.month = monthValue(filters.month);
  if (filters.status && filters.status !== 'all') {
    if (!statusValues.has(filters.status)) throw new ApiError(400, 'Unsupported due status');
    where.status = filters.status as FeeDueStatus;
  }
  if (filters.studentId) {
    const studentId = Number(filters.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId filter must be a positive integer');
    where.studentId = studentId;
  }
  if (filters.studentIds) {
    where.studentId = { in: filters.studentIds };
  }
  if (filters.q) {
    where.OR = [
      { student: { fullName: { contains: filters.q } } },
      { route: { routeCode: { contains: filters.q } } },
      { route: { name: { contains: filters.q } } }
    ];
  }
  return where;
}

function dueInclude() {
  return { student: true, route: true } as const;
}

function mapDue(row: any) {
  const billed = Number(row.baseAmount) + Number(row.fine) - Number(row.discount);
  return {
    id: row.id,
    dueId: row.id,
    studentId: row.studentId,
    student: row.student?.fullName ?? '',
    routeId: row.routeId,
    route: row.route?.routeCode ?? '',
    routeName: row.route?.name ?? '',
    month: row.month,
    baseAmount: Number(row.baseAmount),
    discount: Number(row.discount),
    fine: Number(row.fine),
    billed,
    paidAmount: Number(row.paidAmount),
    balance: Number(row.balance),
    status: row.status,
    generatedAt: row.generatedAt.toISOString()
  };
}

function statusFor(balance: number, paidAmount: number, total: number): FeeDueStatus {
  if (total <= 0) return 'Waived';
  if (balance <= 0) return 'Paid';
  if (paidAmount > 0) return 'Partial';
  return 'Pending';
}

function monthValue(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new ApiError(400, 'month must be YYYY-MM');
  return value;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseDate(value: unknown, label: string) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${label} is invalid`);
  return date;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}
