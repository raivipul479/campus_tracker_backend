import { Prisma, StudentBranch } from '@prisma/client';
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
 * Columns are mapped BY POSITION, not by header name, because the original
 * transport sheet has two columns called "S NO." (A and B) and two phone
 * columns that differ only by case ("Phone Number" / "PHONE NUMBER").
 * Case-insensitive header matching collides on both, silently losing the
 * registration number and the secondary phone.
 *
 * Two layouts are in use. They agree on columns A-J; the branch-wise sheet
 * inserts "Route Name" at K (the route code plus its band, "B-1 JPS 0-5 KM"),
 * which pushes slab, drop and fees one column right, and adds Branch at O. The
 * header row tells them apart — see detectLayout.
 */

const BASE_COLUMNS = {
  serial: 0,
  registration: 1,
  name: 2,
  className: 3,
  section: 4,
  guardian: 5,
  address: 6,
  phone: 7,
  secondaryPhone: 8,
  routeCode: 9
} as const;

interface SheetLayout {
  name: 'transport' | 'branch';
  slabKm: number;
  onePmDrop: number;
  fees: number;
  branch: number | null;
}

const LAYOUTS: Record<SheetLayout['name'], SheetLayout> = {
  // S NO. | S NO. | STUDENT'S NAME | CLASS | SEC. | FATHER'S/MOTHER'S NAME |
  // ADDRESS | Phone Number | PHONE NUMBER | ROUTE NO | Slab KMS | 1 PM DROP | FEES
  transport: { name: 'transport', slabKm: 10, onePmDrop: 11, fees: 12, branch: null },
  // Sr.No. | Unique ID | Student Name | Class | Section | Father Name | Address |
  // Phone Number | Secondry Contact no | Route No | Route Name | Slabe | PMDrop |
  // Fees | Branch
  branch: { name: 'branch', slabKm: 11, onePmDrop: 12, fees: 13, branch: 14 }
};

const COL = BASE_COLUMNS;

interface SlabBand {
  minKm: number;
  maxKm: number;
}

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
  /** Only set when the sheet has a Branch column, so older sheets never clear it. */
  branch: StudentBranch | null;
  routeCode: string | null;
  distanceKm: number | null;
  band: SlabBand | null;
  slabRaw: string;
  sheetFee: number | null;
  feeRaw: string;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
  preview: string;
}

/**
 * A route as the import will leave it. Routes and slabs the sheet needs but
 * the database lacks are planned here with `id: null` and written before any
 * student, so the dry run and the commit follow the same decisions.
 */
interface PlannedRoute {
  id: number | null;
  routeCode: string;
  fee: number;
  isNew: boolean;
  slabs: PlannedSlab[];
}

interface PlannedSlab {
  id: number | null;
  route: PlannedRoute;
  minKm: number;
  maxKm: number;
  fee: number;
  isNew: boolean;
}

interface ActiveAssignment {
  routeId: number;
  slabId: number | null;
}

interface RoutePlan {
  route: PlannedRoute;
  slab: PlannedSlab | null;
  change: 'none' | 'assign' | 'slab';
}

interface ResolvedRow {
  row: ParsedRow;
  studentExists: boolean;
  plan: RoutePlan | null;
}

const cell = (row: string[], index: number) => String(row?.[index] ?? '').trim();
const letter = (index: number) => String.fromCharCode(65 + index);

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

const money = (value: number) => `₹${Number.isInteger(value) ? value : value.toFixed(2)}`;
const bandLabel = (band: SlabBand) => `${band.minKm}-${band.maxKm} km`;
const slabList = (route: PlannedRoute) => route.slabs.map(bandLabel).join(', ');

// "0-5 KM" -> 5, "11-15 KM" -> 15. The sheet records a band, not a measured
// distance, so the upper bound is stored.
function parseSlabKm(value: string): number | null {
  const range = value.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return Number(range[2]);
  const single = value.match(/(\d+)/);
  return single ? Number(single[1]) : null;
}

// "0-5 KM" -> 0..5. Only a written range can become a new slab; a single
// figure says where the student is, not where the band starts and ends.
function parseSlabBand(value: string): SlabBand | null {
  const range = value.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (!range) return null;
  const band = { minKm: Number(range[1]), maxKm: Number(range[2]) };
  return band.maxKm >= band.minKm && band.maxKm <= 1000 ? band : null;
}

function parseBranch(value: string, column: number): StudentBranch {
  const branch = value.toUpperCase();
  if (branch === StudentBranch.JPS || branch === StudentBranch.JPIS) return branch;
  throw new Error(`branch (column ${letter(column)}) "${value}" is not JPS or JPIS`);
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

// The branch-wise sheet is the one with "Route Name" at K.
function detectLayout(header: string[] | null): SheetLayout {
  const k = header ? cell(header, 10).toUpperCase() : '';
  return k.includes('ROUTE') && k.includes('NAME') ? LAYOUTS.branch : LAYOUTS.transport;
}

const isBlankRow = (row: string[]) => !row?.some(value => String(value ?? '').trim() !== '');
const toRow = (raw: unknown) => (Array.isArray(raw) ? raw : []).map(value => String(value ?? ''));

// Same rule RouteService applies, so a route the import creates can still be
// edited from the Routes page afterwards.
const ROUTE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9 -]*$/;

export class StudentImportService {
  /**
   * @param rowOffset index of the first row within the original sheet. The
   *   client uploads large sheets in chunks, so without this every chunk would
   *   report its rejects as "row 1..n" and the numbers would be meaningless.
   * @param header the sheet's header row. Only the first chunk contains it, and
   *   the layout is read from it, so the client sends it with every chunk.
   */
  static parse(rows: unknown, rowOffset = 0, header: unknown = null) {
    if (!Array.isArray(rows)) {
      throw new ApiError(400, 'rows must be an array of spreadsheet rows');
    }
    // Kept under the 1mb express.json limit (see app.ts): ~13 columns of this
    // data averages ~250 bytes of JSON per row. A clear error here beats an
    // opaque 413 from the body parser.
    if (rows.length > 3000) {
      throw new ApiError(400, 'sheet has more than 3000 rows — split it and import in parts');
    }

    const headerRow = rows.map(toRow).find(isHeaderRow) ?? (Array.isArray(header) ? toRow(header) : null);
    const layout = detectLayout(headerRow);

    const parsed: ParsedRow[] = [];
    const rejected: RejectedRow[] = [];
    const seen = new Map<string, number>();

    rows.forEach((raw, index) => {
      // 1-based and absolute within the original sheet, so a reject reported
      // from chunk 3 still points at the row the user can actually find.
      const rowNumber = rowOffset + index + 1;
      const row = toRow(raw);

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

        const routeCode = normalizeRouteCode(cell(row, COL.routeCode)) || null;
        if (routeCode && (routeCode.length > 32 || !ROUTE_CODE_PATTERN.test(routeCode))) {
          throw new Error(`route "${routeCode}" (column J) must be at most 32 letters, numbers, spaces or hyphens`);
        }

        const branchRaw = layout.branch === null ? '' : cell(row, layout.branch);
        const slabRaw = cell(row, layout.slabKm);
        const feeRaw = cell(row, layout.fees);

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
          branch: branchRaw ? parseBranch(branchRaw, layout.branch!) : null,
          routeCode,
          distanceKm: parseSlabKm(slabRaw),
          band: parseSlabBand(slabRaw),
          slabRaw,
          sheetFee: parseSheetFee(feeRaw),
          feeRaw
        });
      } catch (error) {
        rejected.push({ rowNumber, reason: (error as Error).message, preview });
      }
    });

    return { parsed, rejected, layout: layout.name };
  }

  /**
   * Checks every parsed row against the routes and existing assignments in the
   * database, so the dry run reports exactly what the commit will do.
   *
   * - A route the database does not have is created. It is priced from the
   *   sheet: with a Slab KMS range it gets that slab, otherwise its flat fee is
   *   the row's FEES.
   * - On a route with distance slabs the student is placed on the slab covering
   *   their Slab KMS, because the slab is what they are billed. When none covers
   *   it, the band is added as a new slab — on a route the import created, one
   *   already priced in slabs, or one with no pricing at all (no slabs and a ₹0
   *   flat fee, as routes auto-created by older imports were). A route priced by
   *   a flat fee is left alone. A band that overlaps an existing slab, or has no
   *   fee to charge, is rejected.
   * - A new slab's fee is the most common FEES among this import's rows for that
   *   route and band. The rows that disagree are reported as fee warnings.
   * - An empty Slab KMS keeps the slab the student already has on that route,
   *   falls back to the only slab if there is one, and is otherwise rejected —
   *   the same refusal to guess as resolveSlabId.
   * - FEES is compared with what the student will actually be billed. A
   *   mismatch is a warning, not a rejection: billing uses the configured fee.
   */
  static async resolve(parsed: ParsedRow[]) {
    const codes = [...new Set(parsed.map(row => row.routeCode).filter((code): code is string => Boolean(code)))];
    const existingRoutes = codes.length
      ? await prisma.transportRoute.findMany({
          where: { routeCode: { in: codes } },
          include: { feeSlabs: { orderBy: { minKm: 'asc' } } }
        })
      : [];

    const routes = new Map<string, PlannedRoute>();
    for (const existing of existingRoutes) {
      const route: PlannedRoute = { id: existing.id, routeCode: existing.routeCode, fee: Number(existing.fee), isNew: false, slabs: [] };
      route.slabs = existing.feeSlabs.map(slab => ({
        id: slab.id, route, minKm: Number(slab.minKm), maxKm: Number(slab.maxKm), fee: Number(slab.fee), isNew: false
      }));
      routes.set(existing.routeCode.toUpperCase(), route);
    }

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

    // The fee a new slab is created with: the most frequent FEES among the rows
    // for that route and band, first seen on a tie.
    const feeVotes = new Map<string, Map<number, number>>();
    const voteKey = (code: string, band: SlabBand) => `${code}|${band.minKm}|${band.maxKm}`;
    for (const row of parsed) {
      if (!row.routeCode || !row.band || row.sheetFee === null) continue;
      const key = voteKey(row.routeCode, row.band);
      const votes = feeVotes.get(key) ?? new Map<number, number>();
      votes.set(row.sheetFee, (votes.get(row.sheetFee) ?? 0) + 1);
      feeVotes.set(key, votes);
    }
    const commonFee = (code: string, band: SlabBand) => {
      let best: number | null = null;
      let bestCount = 0;
      for (const [fee, count] of feeVotes.get(voteKey(code, band)) ?? []) {
        if (count > bestCount) { best = fee; bestCount = count; }
      }
      return best;
    };

    const resolved: ResolvedRow[] = [];
    const rejected: RejectedRow[] = [];
    const warnings: RejectedRow[] = [];
    const newSlabs: PlannedSlab[] = [];

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

      let route = routes.get(row.routeCode);
      if (!route) {
        // Priced in slabs when the sheet gives a band; the slab is added below.
        route = { id: null, routeCode: row.routeCode, fee: row.band ? 0 : row.sheetFee ?? 0, isNew: true, slabs: [] };
        routes.set(row.routeCode, route);
      }

      // Slabs never overlap (RouteService.parseSlabs), so at most one matches.
      const distance = row.distanceKm;
      let slab = distance === null ? null
        : route.slabs.find(candidate => candidate.minKm <= distance && distance <= candidate.maxKm) ?? null;

      const unpriced = route.slabs.length === 0 && route.fee === 0;
      if (!slab && row.band && (route.isNew || route.slabs.length > 0 || unpriced)) {
        const band = row.band;
        const overlap = route.slabs.find(existing => band.minKm <= existing.maxKm && existing.minKm <= band.maxKm);
        const fee = commonFee(route.routeCode, band);
        if (overlap) {
          reject(`Slab KMS "${row.slabRaw}" overlaps slab ${bandLabel(overlap)} on route ${route.routeCode}, so it cannot be added; its slabs are ${slabList(route)}`);
          continue;
        }
        if (fee === null) {
          reject(`cannot add slab ${bandLabel(band)} to route ${route.routeCode}: no row for it has a FEES amount`);
          continue;
        }
        slab = { id: null, route, minKm: band.minKm, maxKm: band.maxKm, fee, isNew: true };
        route.slabs.push(slab);
        route.slabs.sort((a, b) => a.minKm - b.minKm);
        newSlabs.push(slab);
      }

      if (!slab && route.slabs.length) {
        if (distance !== null) {
          reject(`no distance slab on route ${route.routeCode} covers ${distance} km (Slab KMS "${row.slabRaw}"); its slabs are ${slabList(route)}`);
          continue;
        }
        if (active && active.routeId === route.id && active.slabId !== null) {
          slab = route.slabs.find(candidate => candidate.id === active.slabId) ?? null;
        } else if (route.slabs.length === 1) {
          slab = route.slabs[0];
        } else {
          reject(`${row.slabRaw ? `Slab KMS "${row.slabRaw}" has no distance` : 'Slab KMS is empty'} and route ${route.routeCode} has several distance slabs (${slabList(route)})`);
          continue;
        }
      }

      const sameRoute = route.id !== null && active?.routeId === route.id;
      const change: RoutePlan['change'] = !sameRoute ? 'assign'
        : slab?.isNew || active!.slabId !== (slab?.id ?? null) ? 'slab'
        : 'none';

      if (row.feeRaw) {
        const expected = slab ? slab.fee : route.fee;
        const source = slab ? `slab ${bandLabel(slab)} on route ${route.routeCode}` : `route ${route.routeCode}'s flat fee`;
        if (row.sheetFee === null) {
          warnings.push({ rowNumber: row.rowNumber, reason: `FEES "${row.feeRaw}" is not a number, so it was not checked`, preview });
        } else if (Math.abs(row.sheetFee - expected) > 0.005) {
          warnings.push({
            rowNumber: row.rowNumber,
            reason: `FEES says ${money(row.sheetFee)} but ${source} is ${money(expected)} — billing will use ${money(expected)}`,
            preview
          });
        }
      }

      resolved.push({ row, studentExists, plan: { route, slab, change } });
    }

    const newRoutes = [...routes.values()].filter(route => route.isNew && resolved.some(item => item.plan?.route === route));
    return { resolved, rejected, warnings, newRoutes, newSlabs: newSlabs.filter(slab => newRoutes.includes(slab.route) || !slab.route.isNew) };
  }

  /** Writes the routes and slabs the plan needs, filling in their ids. */
  private static async createRoutesAndSlabs(newRoutes: PlannedRoute[], newSlabs: PlannedSlab[]) {
    if (!newRoutes.length && !newSlabs.length) return;
    try {
      await prisma.$transaction(async tx => {
        for (const route of newRoutes) {
          const created = await tx.transportRoute.create({
            data: { routeCode: route.routeCode, name: route.routeCode, fee: route.fee },
            select: { id: true }
          });
          route.id = created.id;
        }
        for (const slab of newSlabs) {
          const created = await tx.routeFeeSlab.create({
            data: { routeId: slab.route.id!, minKm: slab.minKm, maxKm: slab.maxKm, fee: slab.fee },
            select: { id: true }
          });
          slab.id = created.id;
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'a route or slab this import needs was created by someone else meanwhile — run the import again');
      }
      throw error;
    }
  }

  /**
   * Validates the grid and, when commit is true, writes it.
   *
   * Idempotent: students are matched on registration number, so re-running
   * updates rather than duplicating, and routes and slabs made by an earlier
   * run are found rather than made twice.
   */
  static async run(rows: unknown, commit: boolean, rowOffset = 0, header: unknown = null) {
    const parsed = StudentImportService.parse(rows, rowOffset, header);
    const { resolved, rejected: unresolved, warnings, newRoutes, newSlabs } = await StudentImportService.resolve(parsed.parsed);
    const rejected = [...parsed.rejected, ...unresolved].sort((a, b) => a.rowNumber - b.rowNumber);
    const total = parsed.parsed.length + parsed.rejected.length;
    const report = {
      layout: parsed.layout,
      createdRoutes: newRoutes.map(route => ({
        routeCode: route.routeCode,
        fee: route.slabs.length ? null : route.fee,
        slabs: route.slabs.map(slab => ({ label: bandLabel(slab), fee: slab.fee }))
      })),
      // Slabs added to routes that already existed.
      createdSlabs: newSlabs.filter(slab => !slab.route.isNew).map(slab => ({
        routeCode: slab.route.routeCode, label: bandLabel(slab), fee: slab.fee
      }))
    };

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
        ...report,
        rejected,
        warnings,
        sample: resolved.slice(0, 10).map(({ row, plan }) => ({
          registrationNumber: row.registrationNumber,
          fullName: row.fullName,
          className: [row.className, row.section].filter(Boolean).join(' '),
          guardianName: row.guardianName,
          phone: row.phone,
          secondaryPhone: row.secondaryPhone,
          branch: row.branch,
          routeCode: row.routeCode,
          distanceKm: row.distanceKm,
          slab: plan?.slab ? bandLabel(plan.slab) : null,
          fee: plan ? (plan.slab ? plan.slab.fee : plan.route.fee) : null
        }))
      };
    }

    await StudentImportService.createRoutesAndSlabs(newRoutes, newSlabs);

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
            distanceKm: row.distanceKm,
            ...(row.branch ? { branch: row.branch } : {})
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
          const routeId = plan.route.id!;
          const slabId = plan.slab?.id ?? null;
          const active = await tx.studentRouteAssignment.findFirst({
            where: { studentId, unassignedAt: null },
            select: { id: true, routeId: true, slabId: true, pickupOrder: true, notes: true }
          });
          if (active?.routeId === routeId && active.slabId === slabId) return result;

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
          const sameRoute = active?.routeId === routeId;
          await tx.studentRouteAssignment.create({
            data: {
              studentId,
              routeId,
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
      ...report,
      rejected: [...rejected, ...failures],
      warnings,
      sample: []
    };
  }
}
