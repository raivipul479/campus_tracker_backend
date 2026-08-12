/**
 * Bulk-imports students (and their route assignments) from a CSV on stdin.
 *
 *   # dry run — validates everything, writes nothing
 *   docker compose exec -T backend node dist/scripts/import-students.js < students.csv
 *
 *   # apply
 *   docker compose exec -T backend node dist/scripts/import-students.js --commit < students.csv
 *
 * Reads stdin rather than a file path because the runtime image has no bind
 * mount for data files.
 *
 * Expected header row (case/space insensitive, extra columns ignored):
 *   serial_number, registration_number, full_name, class, section,
 *   guardian_name, address, phone, secondary_phone, route_code, slab_km
 *
 * `address` populates both columns: `students.address` keeps the full postal
 * address, and `students.area` (NOT NULL, used by search/filters) gets the
 * same value truncated to its 180-char limit.
 *
 * Idempotent: students are matched on registration_number, so re-running
 * updates rather than duplicating. A student already on the same route keeps
 * the existing assignment; a student on a *different* route has the old
 * assignment closed before the new one opens, preserving the one-active-row
 * invariant that the generated columns enforce.
 */

import { prisma } from '../prisma.js';

const COMMIT = process.argv.includes('--commit');

// ---- CSV ---------------------------------------------------------------
// Hand-rolled RFC4180 parser: addresses in this data contain commas, embedded
// quotes ("D 803, Bhavyaa Green Luxuria...") and newlines, so splitting on ','
// silently corrupts rows.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s.]+/g, '_');

// ---- field normalisation ----------------------------------------------
// Mirrors validators.ts so imported numbers match what the OTP login looks up.
// A parent whose number is stored in any other shape simply cannot log in.
function normalizePhone(value: string, label: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new Error(`${label} "${value}" is not 10-15 digits`);
  }
  return `+${digits}`;
}

// "0-5 KM" -> 5, "11-15 KM" -> 15. Stores the slab's upper bound: the source
// data records a band, not a measured distance.
function parseSlabKm(value: string): number | null {
  const match = value.match(/(\d+)\s*-\s*(\d+)/);
  if (match) return Number(match[2]);
  const single = value.match(/(\d+)/);
  return single ? Number(single[1]) : null;
}

interface Row {
  line: number;
  serialNumber: string | null;
  registrationNumber: string;
  fullName: string;
  className: string;
  section: string | null;
  guardianName: string | null;
  area: string;
  address: string | null;
  phone: string;
  secondaryPhone: string | null;
  routeCode: string | null;
  distanceKm: number | null;
}

async function main() {
  const raw = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { buffer += chunk; });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });

  if (!raw.trim()) {
    console.error('No CSV on stdin. Pipe the file in:  ... import-students.js < students.csv');
    process.exit(1);
  }

  const table = parseCsv(raw);
  const headers = table[0].map(normalizeHeader);
  const col = (name: string) => headers.indexOf(name);

  const required = ['registration_number', 'full_name', 'phone'];
  const missing = required.filter(name => col(name) === -1);
  if (missing.length) {
    console.error(`CSV is missing required column(s): ${missing.join(', ')}`);
    console.error(`Found: ${headers.join(', ')}`);
    process.exit(1);
  }

  const cell = (row: string[], name: string) => {
    const index = col(name);
    return index === -1 ? '' : (row[index] ?? '').trim();
  };

  const rows: Row[] = [];
  const rejects: { line: number; reason: string; raw: string }[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const source = table[i];
    try {
      const registrationNumber = cell(source, 'registration_number');
      const fullName = cell(source, 'full_name');
      if (!registrationNumber) throw new Error('registration_number is empty');
      if (!fullName) throw new Error('full_name is empty');

      // A duplicate registration number would make the later row silently
      // overwrite the earlier one, so reject rather than guess.
      const previous = seen.get(registrationNumber.toLowerCase());
      if (previous) throw new Error(`duplicate registration_number, also on line ${previous}`);
      seen.set(registrationNumber.toLowerCase(), line);

      const secondaryRaw = cell(source, 'secondary_phone');
      // class and section are stored in separate columns now, so the class is
      // no longer merged into class_name.
      const className = cell(source, 'class');
      if (!className) throw new Error('class is empty');

      const address = cell(source, 'address');
      if (!address) throw new Error('address is empty (students.area is NOT NULL)');

      rows.push({
        line,
        serialNumber: cell(source, 'serial_number') || null,
        registrationNumber,
        fullName,
        className,
        section: cell(source, 'section') || null,
        guardianName: cell(source, 'guardian_name') || null,
        area: address.slice(0, 180),
        address: address.slice(0, 255),
        phone: normalizePhone(cell(source, 'phone'), 'phone'),
        secondaryPhone: secondaryRaw ? normalizePhone(secondaryRaw, 'secondary_phone') : null,
        routeCode: (cell(source, 'route_code') || '').toUpperCase() || null,
        distanceKm: parseSlabKm(cell(source, 'slab_km'))
      });
    } catch (error) {
      rejects.push({ line, reason: (error as Error).message, raw: source.join(' | ').slice(0, 120) });
    }
  }

  console.log(`\nParsed ${rows.length} valid row(s), ${rejects.length} rejected.`);
  if (rejects.length) {
    console.log('\nRejected rows (not imported):');
    for (const reject of rejects.slice(0, 40)) {
      console.log(`  line ${reject.line}: ${reject.reason}\n    ${reject.raw}`);
    }
    if (rejects.length > 40) console.log(`  ... and ${rejects.length - 40} more`);
  }

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
    const preview = rows.slice(0, 5);
    console.log('\nFirst rows as they would be stored:');
    for (const row of preview) {
      console.log(`  ${row.registrationNumber} | ${row.fullName} | ${row.className} ${row.section ?? ''} | ` +
        `guardian=${row.guardianName ?? '-'} | ` +
        `${row.phone}${row.secondaryPhone ? ' / ' + row.secondaryPhone : ''} | ` +
        `route=${row.routeCode ?? '-'} | km=${row.distanceKm ?? '-'}`);
    }
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  let updated = 0;
  let assigned = 0;
  let reassigned = 0;
  const failures: { line: number; reason: string }[] = [];

  for (const row of rows) {
    try {
      // One transaction per student: a failure part-way leaves that student
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
          reassigned++;
        } else {
          assigned++;
        }

        // Legacy vehicle assignments must be closed too — see DATABASE_SCHEMA.md.
        await tx.studentVehicleAssignment.updateMany({
          where: { studentId, unassignedAt: null },
          data: { unassignedAt: new Date() }
        });

        await tx.studentRouteAssignment.create({
          data: { studentId, routeId: route.id }
        });
      });
    } catch (error) {
      failures.push({ line: row.line, reason: (error as Error).message });
    }
  }

  console.log(`\nDone.`);
  console.log(`  students created   : ${created}`);
  console.log(`  students updated   : ${updated}`);
  console.log(`  routes assigned    : ${assigned}`);
  console.log(`  routes reassigned  : ${reassigned}`);
  console.log(`  failed             : ${failures.length}`);
  for (const failure of failures.slice(0, 30)) {
    console.log(`    line ${failure.line}: ${failure.reason}`);
  }

  await prisma.$disconnect();
  if (failures.length || rejects.length) process.exitCode = 1;
}

main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
