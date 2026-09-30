import { Prisma } from '@prisma/client';
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
  slabRaw: string;
  sheetFee: number | null;
  feeRaw: string;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
  preview: string;
}

type RouteWithSlabs = Prisma.TransportRouteGetPayload<{ include: { feeSlabs: true } }>;
type RouteSlab = RouteWithSlabs['feeSlabs'][number];

interface ActiveAssignment {
  routeId: number;
  slabId: number | null;
}

/**
 * What a row will do to the student's route assignment, worked out against the
 * database before anything is written so the dry run reports exactly what the
 * commit will do.
 */
interface RoutePlan {
  route: RouteWithSlabs;
  slab: RouteSlab | null;
  change: 'none' | 'assign' | 'slab';
}

interface ResolvedRow {
  row: ParsedRow;
  studentExists: boolean;
  plan: RoutePlan | null;
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

// "4,200", "4200/-", "Rs. 4200" -> 4200. Null when the cell holds no number.
function parseSheetFee(value: string): number | null {
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

const km = (value: Prisma.Decimal | number) => Number(value);
const slabLabel = (slab: RouteSlab) => `${km(slab.minKm)}-${km(slab.maxKm)} km`;
const slabList = (route: RouteWithSlabs) => route.feeSlabs.map(slabLabel).join(', ');
const money = (value: number) => `₹${Number.isInteger(value) ? value : value.toFixed(2)}`;

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
          distanceKm: parseSlabKm(cell(row, COL.slabKm)),
          slabRaw: cell(row, COL.slabKm),
          sheetFee: parseSheetFee(cell(row, COL.fees)),
          feeRaw: cell(row, COL.fees)
        });
      } catch (error) {
        rejected.push({ rowNumber, reason: (error as Error).message, preview });
      }
    });

    return { parsed, rejected };
  }

  /**
   * Checks every parsed row against the routes and existing assignments in the
   * database, so the dry run reports exactly what the commit will do. Rows whose
   * route or slab cannot be settled are rejected rather than imported onto a
   * wrong fee.
   *
   * - The route must already exist. Import used to create a missing route on the
   *   fly, which turned every typo in column J into a ₹0 route with no bus.
   * - On a route with distance slabs the student is placed on the slab covering
   *   their Slab KMS, because the slab is what they are billed. A distance no
   *   slab covers is rejected. An empty Slab KMS keeps the slab the student
   *   already has on that route, falls back to the only slab if there is one,
   *   and is otherwise rejected — the same refusal to guess as resolveSlabId.
   * - FEES (column M) is compared with what the student will actually be billed.
   *   A mismatch is a warning, not a rejection: the configured slab or flat fee
   *   is what billing uses either way, and the office decides which is right.
   */
  static async resolve(parsed: ParsedRow[]) {
    const codes = [...new Set(parsed.map(row => row.routeCode).filter((code): code is string => Boolean(code)))];
    const routes = codes.length
      ? await prisma.transportRoute.findMany({
          where: { routeCode: { in: codes } },
          include: { feeSlabs: { orderBy: { minKm: 'asc' } } }
        })
      : [];
    const routesByCode = new Map(routes.map(route => [route.routeCode.toUpperCase(), route]));

    const students = parsed.length
      ? await prisma.student.findMany({
          where: { registrationNumber: { in: parsed.map(row => row.registrationNumber) } },
          select: {
            registrationNumber: true,
            routeAssignments: { where: { unassignedAt: null }, select: { routeId: true, slabId: true }, take: 1 }
          }
        })
      : [];
    const activeByReg = new Map<string, ActiveAssignment | null>(students.map(student => [
      student.registrationNumber.toLowerCase(),
      student.routeAssignments[0] ?? null
    ]));

    const resolved: ResolvedRow[] = [];
    const rejected: RejectedRow[] = [];
    const warnings: RejectedRow[] = [];
    const unknownRoutes = new Map<string, number>();

    for (const row of parsed) {
      const regKey = row.registrationNumber.toLowerCase();
      const studentExists = activeByReg.has(regKey);
      const active = activeByReg.get(regKey) ?? null;
      const preview = `${row.registrationNumber} | ${row.fullName}`;
      const reject = (reason: string) => rejected.push({ rowNumber: row.rowNumber, reason, preview });

      if (!row.routeCode) {
        resolved.push({ row, studentExists, plan: null });
        continue;
      }

      const route = routesByCode.get(row.routeCode);
      if (!route) {
        unknownRoutes.set(row.routeCode, (unknownRoutes.get(row.routeCode) ?? 0) + 1);
        reject(`route "${row.routeCode}" (column J) does not exist — create it on the Routes page, or fix the code in the sheet`);
        continue;
      }

      let slab: RouteSlab | null = null;
      if (route.feeSlabs.length) {
        const distance = row.distanceKm;
        if (distance !== null) {
          // Slabs never overlap (RouteService.parseSlabs), so at most one matches.
          slab = route.feeSlabs.find(candidate => km(candidate.minKm) <= distance && distance <= km(candidate.maxKm)) ?? null;
          if (!slab) {
            reject(`no distance slab on route ${route.routeCode} covers ${distance} km (Slab KMS "${row.slabRaw}"); its slabs are ${slabList(route)}`);
            continue;
          }
        } else if (active?.routeId === route.id && active.slabId !== null) {
          slab = route.feeSlabs.find(candidate => candidate.id === active.slabId) ?? null;
        } else if (route.feeSlabs.length === 1) {
          slab = route.feeSlabs[0];
        } else {
          reject(`${row.slabRaw ? `Slab KMS "${row.slabRaw}" has no distance` : 'Slab KMS (column K) is empty'} and route ${route.routeCode} has several distance slabs (${slabList(route)})`);
          continue;
        }
      }

      const change: RoutePlan['change'] = active?.routeId !== route.id ? 'assign'
        : active.slabId !== (slab?.id ?? null) ? 'slab'
        : 'none';

      if (row.feeRaw) {
        const expected = Number(slab ? slab.fee : route.fee);
        const source = slab ? `slab ${slabLabel(slab)} on route ${route.routeCode}` : `route ${route.routeCode}'s flat fee`;
        if (row.sheetFee === null) {
          warnings.push({ rowNumber: row.rowNumber, reason: `FEES (column M) "${row.feeRaw}" is not a number, so it was not checked`, preview });
        } else if (Math.abs(row.sheetFee - expected) > 0.005) {
          warnings.push({
            rowNumber: row.rowNumber,
            reason: `FEES (column M) says ${money(row.sheetFee)} but ${source} is ${money(expected)} — billing will use ${money(expected)}`,
            preview
          });
        }
      }

      resolved.push({ row, studentExists, plan: { route, slab, change } });
    }

    return {
      resolved,
      rejected,
      warnings,
      unknownRoutes: [...unknownRoutes].map(([routeCode, rows]) => ({ routeCode, rows }))
    };
  }

  /**
   * Validates the grid and, when commit is true, writes it.
   *
   * Idempotent: students are matched on registration number, so re-running
   * updates rather than duplicating.
   */
  static async run(rows: unknown, commit: boolean, rowOffset = 0) {
    const parsed = StudentImportService.parse(rows, rowOffset);
    const { resolved, rejected: unresolved, warnings, unknownRoutes } = await StudentImportService.resolve(parsed.parsed);
    const rejected = [...parsed.rejected, ...unresolved].sort((a, b) => a.rowNumber - b.rowNumber);
    const total = parsed.parsed.length + parsed.rejected.length;

    if (!commit) {
      return {
        dryRun: true,
        total,
        valid: resolved.length,
        // Projections: what the commit would do if run now.
        created: resolved.filter(item => !item.studentExists).length,
        updated: resolved.filter(item => item.studentExists).length,
        routesAssigned: resolved.filter(item => item.plan?.change === 'assign').length,
        slabsChanged: resolved.filter(item => item.plan?.change === 'slab').length,
        rejected,
        warnings,
        unknownRoutes,
        sample: resolved.slice(0, 10).map(({ row, plan }) => ({
          registrationNumber: row.registrationNumber,
          fullName: row.fullName,
          className: [row.className, row.section].filter(Boolean).join(' '),
          guardianName: row.guardianName,
          phone: row.phone,
          secondaryPhone: row.secondaryPhone,
          routeCode: row.routeCode,
          distanceKm: row.distanceKm,
          slab: plan?.slab ? slabLabel(plan.slab) : null,
          fee: plan ? Number(plan.slab ? plan.slab.fee : plan.route.fee) : null
        }))
      };
    }

    let created = 0;
    let updated = 0;
    let routesAssigned = 0;
    let slabsChanged = 0;
    const failures: RejectedRow[] = [];

    for (const { row, plan } of resolved) {
      try {
        // One transaction per student: a mid-way failure leaves that student
        // fully absent rather than half-imported. Counts are taken from the
        // transaction's result so a rolled-back row is never counted.
        const outcome = await prisma.$transaction(async tx => {
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
          } else {
            const student = await tx.student.create({
              data: { ...data, registrationNumber: row.registrationNumber },
              select: { id: true }
            });
            studentId = student.id;
          }

          const result: { created: boolean; change: RoutePlan['change'] } = { created: !existing, change: 'none' };
          if (!plan) return result;

          // Re-read inside the transaction; the plan came from a read taken
          // before the loop started.
          const slabId = plan.slab?.id ?? null;
          const active = await tx.studentRouteAssignment.findFirst({
            where: { studentId, unassignedAt: null },
            select: { id: true, routeId: true, slabId: true, pickupOrder: true, notes: true }
          });
          if (active?.routeId === plan.route.id && active.slabId === slabId) return result;

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

          // A slab change on the same route is a new history row, as with bulk
          // assign, but the student's place on the run carries over.
          const sameRoute = active?.routeId === plan.route.id;
          await tx.studentRouteAssignment.create({
            data: {
              studentId,
              routeId: plan.route.id,
              slabId,
              pickupOrder: sameRoute ? active.pickupOrder : null,
              notes: sameRoute ? active.notes : null
            }
          });
          result.change = sameRoute ? 'slab' : 'assign';
          return result;
        });

        if (outcome.created) created++; else updated++;
        if (outcome.change === 'assign') routesAssigned++;
        if (outcome.change === 'slab') slabsChanged++;
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
      total,
      valid: resolved.length,
      created,
      updated,
      routesAssigned,
      slabsChanged,
      rejected: [...rejected, ...failures],
      warnings,
      unknownRoutes,
      sample: []
    };
  }
}
