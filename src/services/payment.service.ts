import { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { Body, optionalString, requiredOrExisting, validateText } from '../validators.js';
import { reconcileDuePayments } from './fee-due.service.js';

const allowedStatuses = new Set(['Paid', 'Collected', 'Pending', 'Overdue']);
const allowedMethods = new Set(['UPI', 'Card', 'Cash', 'Bank transfer', '-']);

export class PaymentService {
  static async list(filters: { q?: string; status?: string; studentId?: string; studentIds?: number[]; from?: string; to?: string }) {
    const where: Prisma.PaymentWhereInput = {};
    if (filters.status && filters.status !== 'all') {
      if (!allowedStatuses.has(filters.status)) throw new ApiError(400, 'Unsupported payment status filter');
      where.status = filters.status as any;
    }
    if (filters.studentId) {
      const studentId = Number(filters.studentId);
      if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId filter must be a positive integer');
      where.studentId = studentId;
    }
    if (filters.studentIds) {
      where.studentId = { in: filters.studentIds };
    }
    if (filters.from || filters.to) {
      where.paidOn = {};
      if (filters.from) where.paidOn.gte = parseDate(filters.from, 'from date');
      if (filters.to) where.paidOn.lte = parseDate(filters.to, 'to date');
    }
    if (filters.q) {
      where.OR = [
        { receiptId: { contains: filters.q } },
        { studentName: { contains: filters.q } },
        { plan: { contains: filters.q } }
      ];
    }
    const rows = await prisma.payment.findMany({ where, orderBy: { paidOn: 'desc' } });
    return rows.map(mapPayment);
  }

  static async create(data: Body) {
    const payload = await paymentPayload(data);
    const explicitReceiptId = optionalString(data, ['id', 'receiptId']);
    const maxAttempts = explicitReceiptId ? 1 : 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const created = await prisma.$transaction(async tx => {
          const row = await tx.payment.create({ data: payload });
          if (payload.dueId && ['Paid', 'Collected'].includes(payload.status)) {
            await reconcileDuePayments(tx, payload.dueId);
          }
          return row;
        });
        return mapPayment(created);
      } catch (error) {
        const isReceiptCollision = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === 'P2002'
          && attempt < maxAttempts;
        if (!isReceiptCollision) throw error;
        payload.receiptId = await nextReceiptId();
      }
    }
    throw new ApiError(500, 'Unable to create payment receipt after multiple attempts');
  }

  static async update(idValue: unknown, data: Body) {
    const receiptId = validateText(String(idValue ?? '').trim(), 'payment id', { min: 1, max: 32 });
    const existing = await prisma.payment.findUnique({ where: { receiptId } });
    if (!existing) throw new ApiError(404, 'Payment not found');

    const updateData: Prisma.PaymentUpdateInput = {};

    if (data.status !== undefined) {
      const status = validateText(String(data.status), 'status', { min: 2, max: 20 });
      if (!allowedStatuses.has(status)) throw new ApiError(400, 'Unsupported payment status');
      updateData.status = status as any;
    }
    if (data.method !== undefined) {
      const method = validateText(String(data.method), 'method', { min: 1, max: 40 });
      if (!allowedMethods.has(method)) throw new ApiError(400, 'Unsupported payment method');
      updateData.method = method;
    }
    if (data.amount !== undefined) {
      const amountRaw = String(data.amount).trim();
      if (!/^\d+(\.\d{1,2})?$/.test(amountRaw)) {
        throw new ApiError(400, 'amount must be a positive number with at most 2 decimal places');
      }
      const amount = Number(amountRaw);
      if (amount <= 0) throw new ApiError(400, 'amount must be greater than 0');
      updateData.amount = amount;
    }
    if (data.date !== undefined) {
      updateData.paidOn = parseDate(data.date, 'payment date');
    }

    if (Object.keys(updateData).length === 0) {
      throw new ApiError(400, 'No updatable fields provided (status, method, amount, date)');
    }

    const updated = await prisma.$transaction(async tx => {
      const row = await tx.payment.update({ where: { receiptId }, data: updateData });
      if (row.dueId) {
        await reconcileDuePayments(tx, row.dueId);
      }
      return row;
    });
    return mapPayment(updated);
  }

  /**
   * Removes a wrongly entered receipt.
   *
   * The linked due is recomputed from the payments that remain, inside the same
   * transaction, so deleting the only payment against a due reopens it with the
   * full balance rather than leaving it falsely marked Paid.
   */
  static async delete(idValue: unknown) {
    const receiptId = validateText(String(idValue ?? '').trim(), 'payment id', { min: 1, max: 32 });
    const existing = await prisma.payment.findUnique({ where: { receiptId } });
    if (!existing) throw new ApiError(404, 'Payment not found');

    await prisma.$transaction(async tx => {
      await tx.payment.delete({ where: { receiptId } });
      // Read the dueId from the row captured before deletion — after the delete
      // there is nothing left to read it from.
      if (existing.dueId) await reconcileDuePayments(tx, existing.dueId);
    });

    return { deleted: receiptId, dueRecalculated: existing.dueId ?? null };
  }
}

// How many quarterly dues each plan covers. Kept in step with the plan options
// on the Record payment form.
export const PLAN_QUARTERS: Record<string, number> = {
  quarterly: 1,
  'half-yearly': 2,
  'half yearly': 2,
  annual: 4
};

async function paymentPayload(data: Body) {
  const dueId = data.dueId === undefined || data.dueId === null || data.dueId === '' ? null : Number(data.dueId);
  if (dueId !== null && (!Number.isInteger(dueId) || dueId <= 0)) throw new ApiError(400, 'dueId must be a positive integer');
  const due = dueId ? await prisma.feeDue.findUnique({ where: { id: dueId }, include: { student: true } }) : null;
  if (dueId && !due) throw new ApiError(404, 'Fee due not found');

  const studentId = data.studentId === undefined || data.studentId === null || data.studentId === ''
    ? due?.studentId ?? null
    : Number(data.studentId);
  if (studentId !== null && (!Number.isInteger(studentId) || studentId <= 0)) throw new ApiError(400, 'studentId must be a positive integer');
  const student = studentId
    ? await prisma.student.findUnique({ where: { id: studentId } })
    : await prisma.student.findFirst({ where: { fullName: validateText(requiredOrExisting(data, ['student'], 'student'), 'student', { min: 2, max: 160 }) } });
  if (!student) throw new ApiError(404, 'Student not found');
  if (due && due.studentId !== student.id) throw new ApiError(400, 'dueId does not belong to studentId');
  const studentName = student.fullName;
  const plan = validateText(requiredOrExisting(data, ['plan'], 'fee plan'), 'fee plan', { min: 2, max: 80 });
  // Fees are billed per quarter, so exactly one quarter maps onto one due.
  // Half-yearly (2 quarters) and Annual (4) span several dues and a payment
  // carries a single dueId, so those are posted one quarter at a time and each
  // instalment links to its own due.
  if (dueId && PLAN_QUARTERS[plan.toLowerCase()] !== 1) {
    throw new ApiError(400, 'Only a Quarterly payment can link to a single due; Half-yearly and Annual cover several quarters and must be posted one quarter at a time');
  }
  const amountRaw = String(requiredOrExisting(data, ['amount'], 'amount')).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw)) {
    throw new ApiError(400, 'amount must be a positive number with at most 2 decimal places');
  }
  const amount = Number(amountRaw);
  if (amount <= 0) throw new ApiError(400, 'amount must be greater than 0');
  const method = validateText(requiredOrExisting(data, ['method'], 'method'), 'method', { min: 1, max: 40 });
  if (!allowedMethods.has(method)) throw new ApiError(400, 'Unsupported payment method');
  const status = validateText(requiredOrExisting(data, ['status'], 'status'), 'status', { min: 2, max: 20 });
  if (!allowedStatuses.has(status)) throw new ApiError(400, 'Unsupported payment status');
  const paidOn = parseDate(requiredOrExisting(data, ['date'], 'payment date'), 'payment date');
  const receiptId = optionalString(data, ['id', 'receiptId']) || await nextReceiptId();

  return {
    receiptId,
    studentId: student.id,
    dueId,
    studentName,
    plan,
    amount,
    paidOn,
    method,
    status: status as any
  };
}

async function nextReceiptId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `RF-${stamp}${random}`.slice(0, 32);
}

function parseDate(value: unknown, label: string) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${label} is invalid`);
  return date;
}

function mapPayment(row: {
  receiptId: string;
  studentId?: number | null;
  dueId?: number | null;
  studentName: string;
  plan: string;
  amount: Prisma.Decimal | number | string;
  paidOn: Date;
  method: string;
  status: string;
  createdAt?: Date;
}) {
  return {
    id: row.receiptId,
    receiptId: row.receiptId,
    studentId: row.studentId ?? null,
    dueId: row.dueId ?? null,
    student: row.studentName,
    plan: row.plan,
    amount: String(Number(row.amount)),
    date: row.paidOn.toISOString().slice(0, 10),
    method: row.method,
    status: row.status,
    // When the receipt was actually entered, as opposed to `date`, which is the
    // payment date the operator typed in. The two differ on back-dated entries,
    // and the audit trail is the point of recording it.
    createdAt: row.createdAt ? row.createdAt.toISOString() : null
  };
}
