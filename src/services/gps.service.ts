import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { prisma } from '../prisma.js';

/**
 * Live vehicle positions from the GPS provider.
 *
 * This is proxied rather than called from the browser for two reasons. The
 * provider sends no CORS headers, so a browser blocks the request outright --
 * the `username` header forces a preflight that is never answered. And the
 * credential would otherwise be compiled into the public JS bundle, readable by
 * anyone who opens the dashboard.
 */

interface ProviderRow {
  vehicleNo?: string;
  alias?: string;
  imei?: string;
  latitude?: number;
  longitude?: number;
  speed?: number;
  ignition?: boolean;
  direction?: number;
  vehicleStatus?: string;
  totalGpsOdometer?: number;
  totalGpsDuration?: number;
  timestamp?: number;
}

// Registration numbers are compared without spaces, case-insensitively:
// the provider reports "RJ14HC7365" where the office may have typed
// "RJ 14 HC 7365".
const plateKey = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * The provider allows one call per minute and answers a sixth one with
 * "Too many api hit". A single cache shared by every dashboard viewer keeps us
 * inside that budget no matter how many people have the map open, and lets the
 * browser poll as often as it likes without spending quota.
 */
let cache: { at: number; payload: Awaited<ReturnType<typeof fetchPositions>> } | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof fetchPositions>>> | null = null;

export class GpsService {
  static get configured() {
    return Boolean(config.gps.baseUrl && config.gps.username);
  }

  static async vehicles() {
    if (!GpsService.configured) {
      throw new ApiError(503, 'GPS provider is not configured. Set GPS_API_BASE_URL and GPS_API_USERNAME.');
    }

    const age = cache ? Date.now() - cache.at : Infinity;
    if (cache && age < config.gps.cacheMs) {
      return { ...cache.payload, cached: true, ageMs: age };
    }

    // Collapse concurrent misses into one upstream call, so two dashboards
    // refreshing together cannot spend two of the minute's single allowance.
    if (!inFlight) {
      inFlight = fetchPositions().finally(() => { inFlight = null; });
    }

    try {
      const payload = await inFlight;
      cache = { at: Date.now(), payload };
      return { ...payload, cached: false, ageMs: 0 };
    } catch (error) {
      // Serving a slightly stale position beats showing nothing: a bus that
      // reported a minute ago is still far more useful than an empty map.
      if (cache) {
        return { ...cache.payload, cached: true, stale: true, ageMs: Date.now() - cache.at };
      }
      throw error;
    }
  }
}

async function fetchPositions() {
  const url = `${config.gps.baseUrl.replace(/\/$/, '')}/gps/public/api/v1/vehicles/location/data`;

  // The provider can hang; without a deadline this request would hold a
  // connection open until the client gives up.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.gps.timeoutMs);
  let payload: { code?: number; status?: string; data?: ProviderRow[] };
  try {
    const response = await fetch(url, {
      headers: { username: config.gps.username },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ApiError(502, `GPS provider returned HTTP ${response.status}`);
    }
    payload = await response.json() as typeof payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const reason = (error as Error).name === 'AbortError'
      ? `did not respond within ${config.gps.timeoutMs}ms`
      : (error as Error).message;
    throw new ApiError(502, `Could not reach the GPS provider: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  // The provider signals failure with code -1 and HTTP 200, so the status
  // code alone is not enough to tell success from failure.
  if (payload?.code !== 0 || !Array.isArray(payload.data)) {
    throw new ApiError(502, `GPS provider rejected the request: ${payload?.status ?? 'unrecognised response'}`);
  }

  // Match positions to our own vehicles so the map can show the route, driver
  // and student count beside each bus.
  const vehicles = await prisma.vehicle.findMany({
    select: {
      id: true, vehicleCode: true, registrationNumber: true, route: true,
      driverAssignments: {
        where: { unassignedAt: null },
        select: { driver: { select: { fullName: true } } },
        take: 1
      }
    }
  });
  const byPlate = new Map(vehicles.map(vehicle => [plateKey(vehicle.registrationNumber), vehicle]));

  const rows = payload.data
    .map(item => {
      const latitude = Number(item.latitude);
      const longitude = Number(item.longitude);
      const plate = String(item.vehicleNo ?? '').trim();
      const matched = byPlate.get(plateKey(plate));
      return {
        id: matched?.vehicleCode ?? plate,
        vehicleId: matched?.id ?? null,
        vehicleNo: plate || 'Unknown vehicle',
        // Empty for an unmatched vehicle, so the map can flag one the
        // provider reports that this school has no record of.
        vehicleCode: matched?.vehicleCode ?? '',
        driver: matched?.driverAssignments[0]?.driver?.fullName ?? 'Unassigned',
        route: matched?.route ?? item.alias ?? '',
        alias: item.alias ?? '',
        imei: item.imei ?? '',
        latitude,
        longitude,
        speed: Number(item.speed ?? 0),
        ignition: Boolean(item.ignition),
        direction: Number(item.direction ?? 0),
        status: item.vehicleStatus ?? (item.ignition ? 'Running' : 'Stopped'),
        odometer: Number(item.totalGpsOdometer ?? 0),
        gpsDuration: Number(item.totalGpsDuration ?? 0),
        // Provider sends epoch milliseconds.
        reportedAt: item.timestamp ? new Date(Number(item.timestamp)).toISOString() : null
      };
    })
    // A position without usable coordinates cannot be drawn.
    .filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));

  return {
    fetchedAt: new Date().toISOString(),
    total: rows.length,
    matched: rows.filter(row => row.vehicleCode).length,
    vehicles: rows
  };
}
