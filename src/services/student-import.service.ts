import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { normalizeRouteCode } from '../validators.js';

/**
 * Bulk student import from the school's transport spreadsheet.
 *
 * The client sends the sheet as a raw 2D grid of strings (it only has to turn
 * .xlsx/.csv into cells); every interpretation decision lives here, so the
 * rules are enforced identically no matter what uploads the data.
 *
 * Columns are mapped BY POSITION, not by header name, because the source sheet
 * has two columns called "S NO." (A and B) and two phone columns that differ
 * only by case ("Phone Number" / "PHONE NUMBER"). Case-insensitive header
 * matching collides on both, silently losing the registration number and the
 * secondary phone.
 */

export const COLUMNS = [
  'S NO.',
  'S NO. (registration)',
  "STUDENT'S NAME",
  'CLASS',
  'SEC.',
  "FATHER'S/MOTHER'S NAME",
  'ADDRESS',
  'Phone Number',
  'PHONE NUMBER',
  'ROUTE NO',
  'Slab KMS',
  '1 PM DROP',
  'FEES'
] as const;

const COL = {
  serial: 0,
  registration: 1,
  name: 2,
  className: 3,
  section: 4,
  guardian: 5,
  address: 6,
  phone: 7,
  secondaryPhone: 8,
  routeCode: 9,
  slabKm: 10,
  onePmDrop: 11,
  fees: 12
} as const;

interface ParsedRow {
  rowNumber: number;
  serialNumber: string | null;
  registrationNumber: string;
  fullName: string;
  className: string;
  section: string | null;
  guardianName: string | null;
  area: string;
  address: string;
  phone: string;
  secondaryPhone: string | null;
  routeCode: string | null;
  distanceKm: number | null;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
  preview: string;
}

const cell = (row: string[], index: number) => String(row?.[index] ?? '').trim();

// Mirrors validators.ts. Imported numbers must match what the mobile OTP login
// looks up — a parent whose number is stored in any other shape cannot sign in.
function normalizePhone(value: string, label: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new Error(`${label} "${value}" is not 10-15 digits`);
  }
  return `+${digits}`;
}

// "0-5 KM" -> 5, "11-15 KM" -> 15. The sheet records a band, not a measured
// distance, so the upper bound is stored.
function parseSlabKm(value: string): number | null {
  const range = value.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return Number(range[2]);
  const single = value.match(/(\d+)/);
  return single ? Number(single[1]) : null;
}

// The sheet repeats its header row at the start of every route block, so those
// rows arrive interleaved with real data and must not become students.
function isHeaderRow(row: string[]): boolean {
  const name = cell(row, COL.name).toUpperCase();
  const serial = cell(row, COL.serial).toUpperCase();
  return (
    name.includes('STUDENT') && name.includes('NAME') ||
    (serial === 'S NO.' && cell(row, COL.className).toUpperCase() === 'CLASS')
  );
}

const isBlankRow = (row: string[]) => !row?.some(value => String(value ?? '').trim() !== '');

export class StudentImportService {
  /**
   * @param rowOffset index of the first row within the original sheet. The
   *   client uploads large sheets in chunks, so without this every chunk would
   *   report its rejects as "row 1..n" and the numbers would be meaningless.
   */
  static parse(rows: unknown, rowOffset = 0) {
    if (!Array.isArray(rows)) {
      throw new ApiError(400, 'rows must be an array of spreadsheet rows');
    }
    // Kept under the 1mb express.json limit (see app.ts): ~13 columns of this
    // data averages ~250 bytes of JSON per row. A clear error here beats an
    // opaque 413 from the body parser.
    if (rows.length > 3000) {
      throw new ApiError(400, 'sheet has more than 3000 rows — split it and import in parts');
    }

    const parsed: ParsedRow[] = [];
    const rejected: RejectedRow[] = [];
    const seen = new Map<string, number>();

    rows.forEach((raw, index) => {
      // 1-based and absolute within the original sheet, so a reject reported
      // from chunk 3 still points at the row the user can actually find.
      const rowNumber = rowOffset + index + 1;
      const row = (Array.isArray(raw) ? raw : []).map(value => String(value ?? ''));

      if (isBlankRow(row) || isHeaderRow(row)) return;

      const preview = [
        cell(row, COL.registration),
        cell(row, COL.name),
        cell(row, COL.className)
      ].filter(Boolean).join(' | ').slice(0, 120);

      try {
        const registrationNumber = cell(row, COL.registration);
        const fullName = cell(row, COL.name);
        if (!registrationNumber) throw new Error('registration number (column B) is empty');
        if (!fullName) throw new Error("student's name (column C) is empty");

        // A duplicate would make the later row silently overwrite the earlier
        // one, so reject rather than guess which is correct.
        const key = registrationNumber.toLowerCase();
        const previous = seen.get(key);
        if (previous) throw new Error(`duplicate registration number, also on row ${previous}`);
        seen.set(key, rowNumber);

        const className = cell(row, COL.className);
        if (!className) throw new Error('class (column D) is empty');

        const address = cell(row, COL.address);
        if (!address) throw new Error('address (column G) is empty and students.area is NOT NULL');

        const phoneRaw = cell(row, COL.phone);
        if (!phoneRaw) throw new Error('phone number (column H) is empty');
        const secondaryRaw = cell(row, COL.secondaryPhone);

        parsed.push({
          rowNumber,
          serialNumber: cell(row, COL.serial) || null,
          registrationNumber,
          fullName,
          className,
          section: cell(row, COL.section) || null,
          guardianName: cell(row, COL.guardian) || null,
          // area is NOT NULL and drives search/filters; address keeps the full
          // value. Same source column, different length limits.
          area: address.slice(0, 180),
          address: address.slice(0, 255),
          phone: normalizePhone(phoneRaw, 'phone number'),
          secondaryPhone: secondaryRaw ? normalizePhone(secondaryRaw, 'secondary phone') : null,
          routeCode: normalizeRouteCode(cell(row, COL.routeCode)) || null,
          distanceKm: parseSlabKm(cell(row, COL.slabKm))
        });
      } catch (error) {
        rejected.push({ rowNumber, reason: (error as Error).message, preview });
      }
    });

    return { parsed, rejected };
  }

  /**
   * Validates the grid and, when commit is true, writes it.
   *
   * Idempotent: students are matched on registration number, so re-running
   * updates rather than duplicating.
   */
  static async run(rows: unknown, commit: boolean, rowOffset = 0) {
    const { parsed, rejected } = StudentImportService.parse(rows, rowOffset);

    if (!commit) {
      return {
        dryRun: true,
        total: parsed.length + rejected.length,
        valid: parsed.length,
        created: 0,
        updated: 0,
        routesAssigned: 0,
        rejected,
        sample: parsed.slice(0, 10).map(row => ({
          registrationNumber: row.registrationNumber,
          fullName: row.fullName,
          className: [row.className, row.section].filter(Boolean).join(' '),
          guardianName: row.guardianName,
          phone: row.phone,
          secondaryPhone: row.secondaryPhone,
          routeCode: row.routeCode,
          distanceKm: row.distanceKm
        }))
      };
    }

    let created = 0;
    let updated = 0;
    let routesAssigned = 0;
    const failures: RejectedRow[] = [];

    for (const row of parsed) {
      try {
        // One transaction per student: a mid-way failure leaves that student
        // fully absent rather than half-imported.
        await prisma.$transaction(async tx => {
          const existing = await tx.student.findUnique({
            where: { registrationNumber: row.registrationNumber },
            select: { id: true }
          });

          const data = {
            serialNumber: row.serialNumber,
            fullName: row.fullName,
            className: row.className,
            section: row.section,
            guardianName: row.guardianName,
            area: row.area,
            address: row.address,
            phone: row.phone,
            secondaryPhone: row.secondaryPhone,
            distanceKm: row.distanceKm
          };

          let studentId: number;
          if (existing) {
            await tx.student.update({ where: { id: existing.id }, data });
            studentId = existing.id;
            updated++;
          } else {
            const student = await tx.student.create({
              data: { ...data, registrationNumber: row.registrationNumber },
              select: { id: true }
            });
            studentId = student.id;
            created++;
          }

          if (!row.routeCode) return;

          const route = await tx.transportRoute.upsert({
            where: { routeCode: row.routeCode },
            update: {},
            create: { routeCode: row.routeCode, name: row.routeCode }
          });

          const active = await tx.studentRouteAssignment.findFirst({
            where: { studentId, unassignedAt: null },
            select: { id: true, routeId: true }
          });
          if (active?.routeId === route.id) return;

          if (active) {
            await tx.studentRouteAssignment.update({
              where: { id: active.id },
              data: { unassignedAt: new Date() }
            });
          }

          // Legacy vehicle assignments must be closed too, or the generated
          // columns' one-active-row invariant is violated. See DATABASE_SCHEMA.md.
          await tx.studentVehicleAssignment.updateMany({
            where: { studentId, unassignedAt: null },
            data: { unassignedAt: new Date() }
          });

          await tx.studentRouteAssignment.create({ data: { studentId, routeId: route.id } });
          routesAssigned++;
        });
      } catch (error) {
        failures.push({
          rowNumber: row.rowNumber,
          reason: (error as Error).message,
          preview: `${row.registrationNumber} | ${row.fullName}`
        });
      }
    }

    return {
      dryRun: false,
      total: parsed.length + rejected.length,
      valid: parsed.length,
      created,
      updated,
      routesAssigned,
      rejected: [...rejected, ...failures],
      sample: []
    };
  }
}
