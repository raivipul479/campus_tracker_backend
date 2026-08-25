/**
 * The school's fee summary sheet format.
 *
 * This is the layout the fee gateway produces and the office already works in,
 * so export writes it and import reads it. Both directions share this module so
 * a column can never mean one thing going out and another coming back.
 */
import { ApiError } from '../errors.js';

/** Column headers, in the sheet's own order. */
export const FEE_SHEET_COLUMNS = [
  'Institute',
  'Branch',
  'Student Name',
  'E-Mail Address',
  'Mobile Number',
  'Standard/Course',
  'Fee Head',
  'Due Date',
  'Fees Category',
  'Total Amount',
  'Late Payment Charges',
  'Payment Status',
  'Discount Amount',
  'Paid Amount',
  'Remaining Amount',
  'Fees Paid Date',
  'Fees Paid Time',
  'Qfix Reference Number',
  'Payment Mode'
] as const;

const ORDINALS = ['', '1st', '2nd', '3rd', '4th'];

/**
 * "2026-Q2" -> "2nd Quarter Fee", the sheet's Fee Head.
 *
 * `fee_dues.month` already stores the quarter, so the head is derived rather
 * than stored — two places holding the same fact drift.
 */
export function feeHeadFor(month: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(month).trim().toUpperCase());
  if (!match) return String(month);
  return `${ORDINALS[Number(match[2])]} Quarter Fee`;
}

/** The reverse, for import: "2nd Quarter Fee" + a due date -> "2026-Q2". */
export function monthFromFeeHead(feeHead: string, dueDate: Date | null, fallbackYear: number) {
  const text = String(feeHead ?? '').trim().toLowerCase();
  const quarter = ORDINALS.findIndex(ordinal => ordinal && text.startsWith(ordinal.toLowerCase()));
  if (quarter < 1) throw new ApiError(400, `Unrecognised Fee Head "${feeHead}" — expected e.g. "2nd Quarter Fee"`);
  // The sheet has no year column, so it comes from the due date where present.
  // A due date is what the office keys on, so it is the more trustworthy source.
  const year = dueDate ? dueDate.getUTCFullYear() : fallbackYear;
  return `${year}-Q${quarter}`;
}

export const FEES_CATEGORY = 'Quarterly Fees';

/**
 * Dates in this sheet are day-first ("15/07/2026", "05/08/26") — the format the
 * office reads. Parsed as UTC midnight so a date never shifts a day across the
 * server's timezone.
 */
export function parseSheetDate(value: unknown, label: string): Date | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    // A 2-digit year in a school fee sheet is this century, not 1926.
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) {
      throw new ApiError(400, `${label} "${text}" is not a real date`);
    }
    return date;
  }

  // Excel hands back ISO when a cell is a real date rather than text.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  throw new ApiError(400, `${label} "${text}" is not a date the sheet uses (expected DD/MM/YYYY)`);
}

export const formatSheetDate = (value: Date | null | undefined) => {
  if (!value) return '';
  const day = String(value.getUTCDate()).padStart(2, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${value.getUTCFullYear()}`;
};

/** "15:26:00", or "15:26" widened to seconds. Empty when the cell is blank. */
export function parseSheetTime(value: unknown, label: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) throw new ApiError(400, `${label} "${text}" is not a time (expected HH:MM:SS)`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) throw new ApiError(400, `${label} "${text}" is not a real time`);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Money as the sheet writes it: "16500.00", sometimes "1,650.00" or blank.
 * Blank is zero — an empty Discount cell means no discount, not a bad row.
 */
export function parseSheetAmount(value: unknown, label: string): number {
  const text = String(value ?? '').trim().replace(/[,\s₹]/g, '');
  if (!text) return 0;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 99999999.99) {
    throw new ApiError(400, `${label} "${value}" is not a valid amount`);
  }
  return Math.round(amount * 100) / 100;
}

/**
 * The sheet masks mobile numbers ("*******20"), so a masked cell cannot be used
 * to find a student and must not overwrite a real stored number.
 */
export const isMaskedPhone = (value: unknown) => /\*/.test(String(value ?? ''));

const PAID_STATUSES = new Set(['paid', 'collected', 'success', 'successful']);

/** Whether a sheet row represents money actually received. */
export const isPaidStatus = (value: unknown) => PAID_STATUSES.has(String(value ?? '').trim().toLowerCase());
