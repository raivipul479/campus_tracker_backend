import { createHash } from 'node:crypto';
import { config } from '../config.js';

/**
 * Snaps a bus's raw GPS fixes to the road network, so a route is drawn along
 * the streets it drove instead of as straight lines between fixes (which cut
 * across blocks whenever the 90 s poll missed a turn).
 *
 * Uses an OSRM-compatible `match` endpoint. Done here rather than in each
 * client so the web dashboard and both phone apps get the same line, and no
 * routing credential or CORS concern reaches them.
 *
 * Best effort: any failure returns the original points, so the trail always
 * draws.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

// The public OSRM server rejects a match request with more coordinates.
const MAX_COORDS_PER_REQUEST = 100;
// Bounds the number of provider calls one history request can cause.
const MAX_SNAP_POINTS = 1400;
// Typical GPS error for a vehicle tracker; how far a fix may sit from its road.
const SEARCH_RADIUS_METERS = 35;
const CACHE_SIZE = 60;

const cache = new Map<string, LatLng[]>();

function distanceMeters(from: LatLng, to: LatLng) {
  const rad = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * rad;
  const dLng = (to.longitude - from.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * Drops fixes closer than `spacing` to the last kept one. A parked bus reports
 * the same spot with jitter, which only confuses matching and wastes the
 * request budget. The final fix is always kept so the line reaches the bus.
 */
function thin(points: LatLng[], spacing: number) {
  const kept: LatLng[] = [];
  points.forEach((point, index) => {
    const last = kept[kept.length - 1];
    if (!last || distanceMeters(last, point) >= spacing || index === points.length - 1) kept.push(point);
  });
  return kept;
}

// Google Roads API. Preferred when a key is configured, since its road data is
// generally the better of the two. Takes up to 100 points per request.
async function snapChunkGoogle(points: LatLng[]): Promise<LatLng[] | null> {
  const path = points.map(point => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join('|');
  const url = 'https://roads.googleapis.com/v1/snapToRoads'
    + `?interpolate=true&path=${encodeURIComponent(path)}&key=${encodeURIComponent(config.routing.googleRoadsApiKey)}`;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), config.routing.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    // A 403 here is a key problem (API not enabled, or restricted away from
    // this server). Thrown, never logged with the URL, which holds the key.
    if (!response.ok) throw new Error(`Google Roads API returned HTTP ${response.status}`);
    const payload = await response.json() as {
      snappedPoints?: { location?: { latitude?: number; longitude?: number } }[];
    };
    const snapped = (payload.snappedPoints ?? [])
      .filter(item => Number.isFinite(item.location?.latitude) && Number.isFinite(item.location?.longitude))
      .map(item => ({ latitude: item.location!.latitude!, longitude: item.location!.longitude! }));
    // No snappedPoints means the fixes were nowhere near a road: fall back for
    // this chunk only.
    return snapped.length > 1 ? snapped : null;
  } finally {
    clearTimeout(deadline);
  }
}

// After Google errors, skip it for a while instead of failing a call on every
// request, and use OSRM meanwhile.
const GOOGLE_RETRY_AFTER_MS = 5 * 60 * 1000;
let googleFailedAt = 0;

async function matchChunk(points: LatLng[]): Promise<LatLng[] | null> {
  if (config.routing.googleRoadsApiKey && Date.now() - googleFailedAt > GOOGLE_RETRY_AFTER_MS) {
    try {
      return await snapChunkGoogle(points);
    } catch (error) {
      googleFailedAt = Date.now();
      console.warn(`[road-snap] ${(error as Error).message}; using OSRM for the next few minutes`);
    }
  }
  return config.routing.baseUrl ? matchChunkOsrm(points) : null;
}

async function matchChunkOsrm(points: LatLng[]): Promise<LatLng[] | null> {
  const coordinates = points.map(point => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(';');
  const radiuses = points.map(() => SEARCH_RADIUS_METERS).join(';');
  const url = `${config.routing.baseUrl.replace(/\/$/, '')}/match/v1/driving/${coordinates}`
    + `?geometries=geojson&overview=full&gaps=split&tidy=true&radiuses=${radiuses}`;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), config.routing.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as {
      code?: string;
      matchings?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    // NoMatch is a real answer (the fixes were nowhere near a road), not an
    // outage, so it falls back for this chunk only.
    if (payload.code !== 'Ok' || !payload.matchings?.length) return null;
    const snapped = payload.matchings.flatMap(matching =>
      (matching.geometry?.coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude })));
    return snapped.length > 1 ? snapped : null;
  } finally {
    clearTimeout(deadline);
  }
}

export class RoadSnapService {
  static get enabled() {
    return config.routing.enabled && Boolean(config.routing.googleRoadsApiKey || config.routing.baseUrl);
  }

  /** The points as a road-following line, or the points themselves if it cannot. */
  static async snap(points: LatLng[]): Promise<LatLng[]> {
    if (!RoadSnapService.enabled || points.length < 2) return points;

    let spacing = config.routing.minSpacingMeters;
    let thinned = thin(points, spacing);
    while (thinned.length > MAX_SNAP_POINTS) {
      spacing *= 2;
      thinned = thin(points, spacing);
    }
    if (thinned.length < 2) return points;

    const key = createHash('sha1')
      .update(thinned.map(point => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join('|'))
      .digest('hex');
    const hit = cache.get(key);
    if (hit) return hit;

    // Consecutive chunks share one fix, so the snapped line has no gap where
    // they meet.
    const chunks: LatLng[][] = [];
    for (let start = 0; start < thinned.length - 1; start += MAX_COORDS_PER_REQUEST - 1) {
      chunks.push(thinned.slice(start, start + MAX_COORDS_PER_REQUEST));
    }

    const path: LatLng[] = [];
    let serviceDown = false;
    for (const chunk of chunks) {
      let snapped: LatLng[] | null = null;
      // After one failed call the rest would only wait out their own timeouts.
      if (!serviceDown) {
        try {
          snapped = await matchChunk(chunk);
        } catch (error) {
          serviceDown = true;
          console.warn(`[road-snap] routing service unavailable: ${(error as Error).message}`);
        }
      }
      path.push(...(snapped ?? chunk));
    }

    // A result that fell back wholesale is not worth remembering: the service
    // may be back on the next request.
    if (!serviceDown) {
      cache.set(key, path);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    }
    return path;
  }
}
