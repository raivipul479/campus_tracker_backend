import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { GpsProvider, plateKey } from './gps-provider.js';

/**
 * Polls the GPS provider on a fixed cadence and stores what it reports.
 *
 * The provider allows one call per minute. Polling here, rather than on demand,
 * means client reads never touch it: any number of dashboards and phones can
 * read positions from the database as often as they like while exactly one
 * caller spends the provider's budget.
 *
 * Self-scheduling rather than setInterval, so a slow provider can never cause
 * two polls to overlap and spend two of the minute's single allowance.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRun: { at: string; stored: number; seen: number; error: string | null } | null = null;
let lastPrune = 0;

const HOUR_MS = 60 * 60 * 1000;

async function pollOnce() {
  const rows = await GpsProvider.fetchPositions();

  // Resolve each plate to one of our vehicles. A position for a vehicle we do
  // not own is still stored -- dropping it would hide a real bus.
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, registrationNumber: true }
  });
  const byPlate = new Map(vehicles.map(v => [plateKey(v.registrationNumber), v.id]));

  const data = rows
    .filter(row => row.vehicleNo && Number.isFinite(row.latitude) && Number.isFinite(row.longitude))
    .map(row => ({
      vehicleNo: plateKey(row.vehicleNo),
      vehicleId: byPlate.get(plateKey(row.vehicleNo)) ?? null,
      latitude: row.latitude,
      longitude: row.longitude,
      speed: row.speed,
      ignition: row.ignition,
      direction: row.direction,
      status: row.status,
      odometer: row.odometer,
      gpsDuration: BigInt(Math.max(0, Math.trunc(row.gpsDuration))),
      imei: row.imei || null,
      reportedAt: row.reportedAt,
      fetchedAt: new Date()
    }));

  if (!data.length) return { stored: 0, seen: rows.length };

  // skipDuplicates leans on the unique (vehicle_no, reported_at) key: a parked
  // bus repeats the same provider timestamp every poll, so only genuinely new
  // positions are written.
  const result = await prisma.vehiclePosition.createMany({ data, skipDuplicates: true });
  return { stored: result.count, seen: rows.length };
}

/** Drop positions past the retention window. Hourly, not every tick. */
async function pruneOldPositions() {
  if (Date.now() - lastPrune < HOUR_MS) return;
  lastPrune = Date.now();
  const cutoff = new Date(Date.now() - config.gps.retentionDays * 24 * HOUR_MS);
  const removed = await prisma.vehiclePosition.deleteMany({ where: { reportedAt: { lt: cutoff } } });
  if (removed.count) {
    console.log(`[gps] pruned ${removed.count} position(s) older than ${config.gps.retentionDays} days`);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const { stored, seen } = await pollOnce();
    lastRun = { at: new Date().toISOString(), stored, seen, error: null };
    await pruneOldPositions();
  } catch (error) {
    // A failed poll must never kill the process or stop the schedule -- the
    // provider being briefly unreachable is expected, not fatal.
    lastRun = { at: new Date().toISOString(), stored: 0, seen: 0, error: (error as Error).message };
    console.error('[gps] poll failed:', (error as Error).message);
  } finally {
    running = false;
    if (timer) timer = setTimeout(tick, config.gps.pollMs);
  }
}

export class GpsPoller {
  static get status() {
    return {
      enabled: Boolean(timer),
      pollMs: config.gps.pollMs,
      retentionDays: config.gps.retentionDays,
      lastRun
    };
  }

  static start() {
    if (timer) return;
    if (!config.gps.pollEnabled) {
      console.log('[gps] polling disabled (GPS_POLL_ENABLED=false)');
      return;
    }
    if (!GpsProvider.configured) {
      console.log('[gps] polling not started: GPS_API_BASE_URL / GPS_API_USERNAME are not set');
      return;
    }
    console.log(`[gps] polling every ${config.gps.pollMs}ms, keeping ${config.gps.retentionDays} days`);
    // Placeholder so start() is idempotent before the first tick schedules.
    timer = setTimeout(() => {}, 0);
    void tick();
  }

  static stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
}
