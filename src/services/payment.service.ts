import { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { Body, optionalString, requiredOrExisting, validateText } from '../validators.js';
import { reconcileDuePayments } from './fee-due.service.js';

const allowedStatuses = new Set(['Paid', 'Collected', 'Pending', 'Overdue']);
const allowedMethods = new Set(['UPI', 'Card', 'Cash', 'Bank transfer', '-']);

export class PaymentService {
  static async list(filters: { q?: string; status?: string; studentId?: string; from?: string; to?: string }) {
    const where: Prisma.PaymentWhereInput = {};
    if (filters.status && filters.status !== 'all') where.status = filters.status as any;
    if (filters.studentId) where.studentId = Number(filters.studentId);
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
    const created = await prisma.$transaction(async tx => {
      const row = await tx.payment.create({ data: payload });
      if (payload.dueId && ['Paid', 'Collected'].includes(payload.status)) {
        await reconcileDuePayments(tx, payload.dueId);
      }
      return row;
    });
    return mapPayment(created);
  }
}

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
  if (dueId && plan.toLowerCase() !== 'monthly') {
    throw new ApiError(400, 'Only monthly payments can link to one due; multi-month plans require explicit due allocations');
  }
  const amount = Number(requiredOrExisting(data, ['amount'], 'amount'));
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'amount must be a positive integer');
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
    status: row.status
  };
}
