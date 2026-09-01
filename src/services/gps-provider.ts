import { ApiError } from '../errors.js';
import { config } from '../config.js';

/**
 * The GPS provider's HTTP contract, in one place.
 *
 * Called only by the poller. It is never reached from the browser: the provider
 * sends no CORS headers (the `username` header forces a preflight it does not
 * answer), and the credential must not ship in the public JS bundle.
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

export interface Position {
  vehicleNo: string;
  alias: string;
  imei: string;
  latitude: number;
  longitude: number;
  speed: number;
  ignition: boolean;
  direction: number;
  status: string;
  odometer: number;
  gpsDuration: number;
  reportedAt: Date;
}

/**
 * Registration numbers are compared without punctuation, case-insensitively:
 * the provider reports RJ45CE4015 where the office may have typed
 * "RJ 45 CE 4015".
 */
export const plateKey = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export class GpsProvider {
  static get configured() {
    return Boolean(config.gps.baseUrl && config.gps.username);
  }

  static async fetchPositions(): Promise<Position[]> {
    if (!GpsProvider.configured) {
      throw new ApiError(503, 'GPS provider is not configured. Set GPS_API_BASE_URL and GPS_API_USERNAME.');
    }

    const url = `${config.gps.baseUrl.replace(/\/$/, '')}/gps/public/api/v1/vehicles/location/data`;

    // Without a deadline a hung provider would hold the poll open past its own
    // next tick.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), config.gps.timeoutMs);
    let payload: { code?: number; status?: string; data?: ProviderRow[] };
    try {
      const response = await fetch(url, {
        headers: { username: config.gps.username },
        signal: controller.signal
      });
      if (!response.ok) throw new ApiError(502, `GPS provider returned HTTP ${response.status}`);
      payload = await response.json() as typeof payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const reason = (error as Error).name === 'AbortError'
        ? `did not respond within ${config.gps.timeoutMs}ms`
        : (error as Error).message;
      throw new ApiError(502, `Could not reach the GPS provider: ${reason}`);
    } finally {
      clearTimeout(deadline);
    }

    // Rejection arrives as HTTP 200 with code -1 ("Too many api hit",
    // "Unauthorized request"), so the status code alone cannot tell success
    // from failure.
    if (payload?.code !== 0 || !Array.isArray(payload.data)) {
      throw new ApiError(502, `GPS provider rejected the request: ${payload?.status ?? 'unrecognised response'}`);
    }

    return payload.data
      .map(item => ({
        vehicleNo: String(item.vehicleNo ?? '').trim(),
        alias: item.alias ?? '',
        imei: item.imei ?? '',
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        speed: Number(item.speed ?? 0),
        ignition: Boolean(item.ignition),
        direction: Number(item.direction ?? 0),
        status: item.vehicleStatus ?? (item.ignition ? 'Running' : 'Stopped'),
        odometer: Number(item.totalGpsOdometer ?? 0),
        gpsDuration: Number(item.totalGpsDuration ?? 0),
        // Provider sends epoch milliseconds.
        reportedAt: new Date(Number(item.timestamp ?? Date.now()))
      }))
      .filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
  }
}
