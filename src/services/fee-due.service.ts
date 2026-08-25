import { FeeDueStatus, Prisma } from '@prisma/client';
import { ApiError, isMissingTable } from '../errors.js';
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

    const students = await studentsForBilling(studentId);
    if (studentId && students.length === 0) throw new ApiError(404, 'Student not found');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const student of students) {
      const assignment = student.routeAssignments[0];
      const route = assignment?.route;
      // The slab the student was assigned to is what they pay. A route with no
      // slabs bills its flat fee — exactly how this worked before slabs existed.
      const baseAmount = assignment?.slab ? Number(assignment.slab.fee) : Number(route?.fee ?? 0);
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
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
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

/** Students with the route and distance slab they are actively assigned to. */
async function studentsForBilling(studentId: number | null) {
  return prisma.student.findMany({
    where: studentId ? { id: studentId } : undefined,
    include: {
      routeAssignments: {
        where: { unassignedAt: null },
        include: { route: true, slab: true },
        take: 1
      }
    },
    orderBy: { fullName: 'asc' }
  });
}

// Fees are billed per QUARTER: a route's `fee` is one quarter's charge, and a
// student gets one due per quarter. The column is still called `month` and is
// VARCHAR(7), which fits "2026-Q3" exactly.
//
// A YYYY-MM value is accepted and folded into the quarter it falls in, so any
// caller still passing a month lands on the right due instead of silently
// creating a parallel monthly one.
function monthValue(value: string) {
  const text = value.trim().toUpperCase();
  if (/^\d{4}-Q[1-4]$/.test(text)) return text;
  const month = text.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const monthNumber = Number(month[2]);
    if (monthNumber < 1 || monthNumber > 12) throw new ApiError(400, 'month must be 01-12');
    return `${month[1]}-Q${Math.floor((monthNumber - 1) / 3) + 1}`;
  }
  throw new ApiError(400, 'period must be YYYY-Qn (e.g. 2026-Q3) or YYYY-MM');
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
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
