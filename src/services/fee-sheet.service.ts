/**
 * Import and export of the school's fee summary sheet.
 *
 * The sheet is what the office and the fee gateway already exchange, so this
 * reads and writes it verbatim rather than inventing a format. Column meanings
 * live in fee-sheet.ts and are shared by both directions.
 */
import { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { reconcileDuePayments } from './fee-due.service.js';
import {
  FEES_CATEGORY,
  FEE_SHEET_COLUMNS,
  feeHeadFor,
  formatSheetDate,
  isMaskedPhone,
  isPaidStatus,
  monthFromFeeHead,
  parseSheetAmount,
  parseSheetDate,
  parseSheetTime
} from './fee-sheet.js';

/**
 * A student's name as the sheet writes it. The sheet appends a trailing "."
 * ("Kashvi singh rao .") and casing is inconsistent, so both are normalised away
 * before matching.
 */
const normaliseName = (value: unknown) =>
  String(value ?? '').trim().replace(/\s*\.\s*$/, '').replace(/\s+/g, ' ').toLowerCase();

const normaliseClass = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export interface FeeSheetRowInput {
  [column: string]: unknown;
}

export class FeeSheetService {
  /** Header row, so the client writes the same columns in the same order. */
  static columns() {
    return [...FEE_SHEET_COLUMNS];
  }

  /**
   * Fee records in sheet order.
   *
   * One row per due. Where a due has several payments the most recent qualifying
   * one supplies the payment columns, because the sheet has a single set of them
   * and the latest receipt is what the office reconciles against.
   */
  static async export(filters: { month?: string; status?: string; studentId?: string }) {
    const where: Prisma.FeeDueWhereInput = {};
    if (filters.month) where.month = String(filters.month).trim().toUpperCase();
    if (filters.status && filters.status !== 'all') where.status = filters.status as any;
    if (filters.studentId) {
      const studentId = Number(filters.studentId);
      if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId must be a positive integer');
      where.studentId = studentId;
    }

    const dues = await prisma.feeDue.findMany({
      where,
      include: {
        student: true,
        payments: {
          where: { status: { in: ['Paid', 'Collected'] } },
          orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
          take: 1
        }
      },
      orderBy: [{ month: 'desc' }, { student: { fullName: 'asc' } }]
    });

    const rows = dues.map(due => {
      const payment = due.payments[0];
      return [
        // Institute and Branch are constant for this deployment and are not
        // stored per student, so they are left for the office to fill.
        '',
        '',
        due.student.fullName,
        due.student.email ?? '',
        due.student.phone,
        [due.student.className, due.student.section].filter(Boolean).join(' '),
        feeHeadFor(due.month),
        formatSheetDate(due.dueDate),
        FEES_CATEGORY,
        Number(due.baseAmount),
        Number(due.fine),
        // The sheet writes these upper case ("PAID").
        String(due.status).toUpperCase(),
        Number(due.discount),
        Number(due.paidAmount),
        Number(due.balance),
        payment ? formatSheetDate(payment.paidOn) : '',
        payment?.paidTime ?? '',
        payment?.referenceNumber ?? '',
        payment?.method ?? ''
      ];
    });

    return { columns: [...FEE_SHEET_COLUMNS], rows, total: rows.length };
  }

  /**
   * Loads sheet rows: raises the dues they describe, then records the payments
   * against them.
   *
   * Each row is its own transaction. A sheet of a thousand rows should not lose
   * nine hundred good ones because row 901 names a student who does not exist,
   * so a bad row is reported and the rest continue.
   *
   * `dryRun` validates and reports without writing, which is how the admin sees
   * what a sheet will do before committing it.
   */
  static async import(rows: FeeSheetRowInput[], options: { dryRun?: boolean } = {}) {
    if (!Array.isArray(rows)) throw new ApiError(400, 'rows must be an array');
    if (rows.length > 2000) throw new ApiError(400, 'at most 2000 rows per request');

    const dryRun = options.dryRun === true;
    const result = {
      dryRun,
      duesCreated: 0,
      duesUpdated: 0,
      paymentsRecorded: 0,
      paymentsSkipped: 0,
      rejected: [] as { row: number; student: string; reason: string }[]
    };

    for (let index = 0; index < rows.length; index += 1) {
      // +2 so the number matches the spreadsheet, which is 1-based and has a
      // header row.
      const rowNumber = index + 2;
      const row = rows[index];
      const studentLabel = String(row['Student Name'] ?? '').trim();

      try {
        await FeeSheetService.importRow(row, dryRun, result);
      } catch (error) {
        result.rejected.push({
          row: rowNumber,
          student: studentLabel,
          reason: error instanceof ApiError ? error.message : (error as Error).message
        });
      }
    }

    return result;
  }

  private static async importRow(row: FeeSheetRowInput, dryRun: boolean, result: {
    duesCreated: number; duesUpdated: number; paymentsRecorded: number; paymentsSkipped: number;
  }) {
    const student = await FeeSheetService.matchStudent(row);

    const dueDate = parseSheetDate(row['Due Date'], 'Due Date');
    const paidDate = parseSheetDate(row['Fees Paid Date'], 'Fees Paid Date');
    const month = monthFromFeeHead(
      String(row['Fee Head'] ?? ''),
      dueDate ?? paidDate,
      new Date().getUTCFullYear()
    );

    const baseAmount = parseSheetAmount(row['Total Amount'], 'Total Amount');
    const fine = parseSheetAmount(row['Late Payment Charges'], 'Late Payment Charges');
    const discount = parseSheetAmount(row['Discount Amount'], 'Discount Amount');
    const paidAmount = parseSheetAmount(row['Paid Amount'], 'Paid Amount');

    if (discount > baseAmount + fine) {
      throw new ApiError(400, `Discount ${discount} is more than the ${baseAmount + fine} owed`);
    }

    const reference = String(row['Qfix Reference Number'] ?? '').trim() || null;
    const paid = isPaidStatus(row['Payment Status']) && paidAmount > 0;
    if (paid && !paidDate) throw new ApiError(400, 'Payment Status is paid but Fees Paid Date is empty');
    if (paid && !reference) throw new ApiError(400, 'Payment Status is paid but Qfix Reference Number is empty');

    const paidTime = parseSheetTime(row['Fees Paid Time'], 'Fees Paid Time');
    const method = String(row['Payment Mode'] ?? '').trim() || 'Unknown';

    if (dryRun) {
      const existing = await prisma.feeDue.findUnique({
        where: { studentId_month: { studentId: student.id, month } },
        select: { id: true }
      });
      if (existing) result.duesUpdated += 1; else result.duesCreated += 1;
      if (paid) {
        const seen = reference
          ? await prisma.payment.findUnique({ where: { referenceNumber: reference }, select: { id: true } })
          : null;
        if (seen) result.paymentsSkipped += 1; else result.paymentsRecorded += 1;
      }
      return;
    }

    await prisma.$transaction(async tx => {
      const existing = await tx.feeDue.findUnique({
        where: { studentId_month: { studentId: student.id, month } },
        select: { id: true }
      });

      // The billed figures come from the sheet; paid_amount, balance and status
      // are never written here — reconcileDuePayments derives them from the
      // payments that actually exist, which is the invariant this system relies
      // on to keep a balance honest.
      const due = existing
        ? await tx.feeDue.update({
            where: { id: existing.id },
            data: { baseAmount, fine, discount, dueDate },
            select: { id: true }
          })
        : await tx.feeDue.create({
            data: {
              studentId: student.id,
              month,
              dueDate,
              baseAmount,
              fine,
              discount,
              balance: Math.max(baseAmount + fine - discount, 0)
            },
            select: { id: true }
          });

      if (existing) result.duesUpdated += 1; else result.duesCreated += 1;

      if (paid) {
        // The gateway reference is the idempotency key: re-importing the same
        // sheet updates that payment instead of paying the due twice.
        const seen = reference
          ? await tx.payment.findUnique({ where: { referenceNumber: reference }, select: { id: true } })
          : null;

        if (seen) {
          await tx.payment.update({
            where: { id: seen.id },
            data: {
              studentId: student.id,
              dueId: due.id,
              studentName: student.fullName,
              amount: paidAmount,
              paidOn: paidDate!,
              paidTime,
              method,
              status: 'Paid'
            }
          });
          result.paymentsSkipped += 1;
        } else {
          await tx.payment.create({
            data: {
              receiptId: await nextReceiptId(tx),
              studentId: student.id,
              dueId: due.id,
              studentName: student.fullName,
              plan: FEES_CATEGORY,
              amount: paidAmount,
              paidOn: paidDate!,
              paidTime,
              method,
              referenceNumber: reference,
              status: 'Paid'
            }
          });
          result.paymentsRecorded += 1;
        }
      }

      await reconcileDuePayments(tx, due.id);
    });
  }

  /**
   * Finds the student a sheet row is about.
   *
   * The sheet carries no registration number, and its Mobile Number column is
   * masked ("*******20"), so name is the only usable key — narrowed by class
   * where two students share a name. An ambiguous or missing match is rejected
   * rather than guessed: the wrong guess bills a real family for another child.
   */
  private static async matchStudent(row: FeeSheetRowInput) {
    const name = normaliseName(row['Student Name']);
    if (!name) throw new ApiError(400, 'Student Name is empty');

    const candidates = await prisma.student.findMany({
      where: { fullName: { contains: name.split(' ')[0] } },
      select: { id: true, fullName: true, className: true, section: true, email: true }
    });

    let matches = candidates.filter(student => normaliseName(student.fullName) === name);

    if (matches.length > 1) {
      const wanted = normaliseClass(row['Standard/Course']);
      if (wanted) {
        const byClass = matches.filter(student =>
          normaliseClass(student.className) === wanted ||
          normaliseClass([student.className, student.section].filter(Boolean).join(' ')) === wanted
        );
        if (byClass.length) matches = byClass;
      }
    }

    if (matches.length === 0) throw new ApiError(404, `No student matches "${String(row['Student Name']).trim()}"`);
    if (matches.length > 1) {
      throw new ApiError(409, `"${String(row['Student Name']).trim()}" matches ${matches.length} students; Standard/Course did not separate them`);
    }

    const student = matches[0];

    // The sheet's email is the one the office corresponds on; fill it in where
    // we have none, but never overwrite one already recorded here.
    const email = String(row['E-Mail Address'] ?? '').trim();
    if (email && !student.email) {
      await prisma.student.update({ where: { id: student.id }, data: { email } });
    }
    // Mobile Number is never written back. The sheet masks it ("*******20"), and
    // the stored number is what the parent app logs in with — overwriting it
    // from here would lock a family out.

    return student;
  }
}

/**
 * Receipt ids for imported payments. The gateway reference is kept separately in
 * `reference_number`; this is the id this system uses internally, and it stays
 * in the same shape as receipts created here.
 */
async function nextReceiptId(tx: Prisma.TransactionClient) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `IMP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 4096).toString(36).toUpperCase()}`;
    const clash = await tx.payment.findUnique({ where: { receiptId: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw new ApiError(500, 'Could not allocate a receipt id');
}
