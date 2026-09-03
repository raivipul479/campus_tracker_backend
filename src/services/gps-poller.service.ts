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

/** To the stored column's precision, so comparisons are like for like. */
const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

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
      // Rounded to the column's own precision before anything compares them.
      // The provider sends 26.961257833333334; DECIMAL(10,7) stores 26.9612578.
      // Comparing the raw reading against the stored one therefore never
      // matched, and a parked bus looked like it had moved on every poll.
      latitude: round(row.latitude, 7),
      longitude: round(row.longitude, 7),
      speed: round(row.speed, 2),
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

  // Store only what actually changed.
  //
  // The device keeps reporting while a bus is parked, with a fresh timestamp
  // every time and identical coordinates. Keying on (vehicle_no, reported_at)
  // therefore suppressed nothing -- every poll produced a new row, ~1,300 a day
  // per vehicle, all saying the bus had not moved. Comparing against the last
  // stored position instead keeps the table proportional to movement.
  const latest = await prisma.vehiclePosition.findMany({
    where: { vehicleNo: { in: [...new Set(data.map(row => row.vehicleNo))] } },
    distinct: ['vehicleNo'],
    orderBy: [{ vehicleNo: 'asc' }, { reportedAt: 'desc' }],
    select: { vehicleNo: true, latitude: true, longitude: true, speed: true, ignition: true, reportedAt: true }
  });
  const previous = new Map(latest.map(row => [row.vehicleNo, row]));

  const changed = data.filter(row => {
    const last = previous.get(row.vehicleNo);
    if (!last) return true;
    // Never store a reading older than the one we already hold: the provider
    // can repeat a stale sample when a device drops off the network.
    if (row.reportedAt <= last.reportedAt) return false;
    const moved = Number(last.latitude) !== row.latitude || Number(last.longitude) !== row.longitude;
    const stateChanged = Boolean(last.ignition) !== row.ignition || Number(last.speed) !== row.speed;
    if (moved || stateChanged) return true;
    // A stationary bus still gets a heartbeat, so the map can distinguish
    // "parked here since 8am" from "we stopped hearing from it at 8am".
    return row.reportedAt.getTime() - last.reportedAt.getTime() >= config.gps.heartbeatMs;
  });

  if (!changed.length) return { stored: 0, seen: rows.length };

  // skipDuplicates still guards the unique key against two pollers racing.
  const result = await prisma.vehiclePosition.createMany({ data: changed, skipDuplicates: true });
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
