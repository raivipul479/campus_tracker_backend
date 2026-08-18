import { ApiError } from '../errors.js';
import { mapRoute, RouteRow } from '../mappers.js';
import { RouteFeeSlabInput, RouteModel } from '../models/route.model.js';
import { Body, normalizeRouteCode, optionalBoundedNumber, optionalString, positiveId, requiredOrExisting, validateText } from '../validators.js';

export class RouteService {
  static async list(filters: { q?: string; vehicleId?: string; assigned?: string }) {
    const routes = await RouteModel.findAll(filters);
    return routes.map(mapRoute);
  }

  static async getById(idValue: unknown) {
    const id = positiveId(idValue, 'route id');
    const route = await RouteModel.findById(id);
    if (!route) throw new ApiError(404, 'Route not found');
    return mapRoute(route);
  }

  static async create(data: Body) {
    const created = await RouteModel.create(routePayload(data));
    return mapRoute(created);
  }

  static async update(idValue: unknown, data: Body) {
    const id = positiveId(idValue, 'route id');
    const existing = await RouteModel.findById(id);
    if (!existing) throw new ApiError(404, 'Route not found');
    const updated = await RouteModel.update(id, routePayload(data, existing));
    return mapRoute(updated);
  }

  static async delete(idValue: unknown) {
    const id = positiveId(idValue, 'route id');
    const result = await RouteModel.delete(id);
    if ('conflict' in result && result.conflict) {
      throw new ApiError(409, 'Route has student assignment or fee due history and cannot be hard-deleted');
    }
    if (!result.affectedRows) throw new ApiError(404, 'Route not found');
  }
}

function routePayload(data: Body, existing?: RouteRow) {
  const code = validateText(normalizeRouteCode(requiredOrExisting(data, ['id', 'code', 'routeCode'], 'route code', existing?.route_code)), 'route code', {
    min: 2,
    max: 32,
    pattern: /^[A-Z0-9][A-Z0-9 -]*$/
  });
  const name = validateText(requiredOrExisting(data, ['name'], 'route name', existing?.name), 'route name', { min: 2, max: 120 });
  const description = optionalString(data, ['description']) ?? existing?.description ?? null;
  if (description) validateText(description, 'description', { max: 255 });
  const fee = optionalBoundedNumber(data, ['fee', 'routeFee'], 'route fee', { min: 0, max: 99999999.99 }) ?? Number(existing?.fee ?? 0);
  const vehicleIdentifier = data.vehicleId ?? data.vehicleCode ?? data.vehicle ?? existing?.vehicle_id ?? null;
  const slabs = parseSlabs(data.slabs ?? data.feeSlabs);

  return { code, name, description, fee, vehicleIdentifier, slabs };
}

// One slab per kilometre step from 0 to 30 leaves plenty of headroom; the cap
// exists so a malformed payload cannot write thousands of rows.
const MAX_SLABS = 24;

/**
 * A route's distance slabs, validated as a set rather than row by row.
 *
 * Returns null when the caller did not mention slabs at all, so a PATCH that
 * only renames a route keeps its pricing. An explicit empty array clears them
 * and puts the route back on its flat `fee`.
 */
function parseSlabs(value: unknown): RouteFeeSlabInput[] | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Array.isArray(value)) throw new ApiError(400, 'slabs must be an array');
  if (value.length > MAX_SLABS) throw new ApiError(400, `at most ${MAX_SLABS} distance slabs are allowed`);

  const slabs = value.map((entry, index) => {
    const label = `slab ${index + 1}`;
    if (!entry || typeof entry !== 'object') throw new ApiError(400, `${label} is invalid`);
    const row = entry as Record<string, unknown>;
    const minKm = slabNumber(row.minKm ?? row.min_km ?? row.fromKm, `${label} from km`, 0, 1000);
    const maxKm = slabNumber(row.maxKm ?? row.max_km ?? row.toKm, `${label} to km`, 0, 1000);
    const slabFee = slabNumber(row.fee ?? row.amount, `${label} fee`, 0, 99999999.99);
    if (maxKm < minKm) throw new ApiError(400, `${label}: "to km" must be at least "from km"`);
    return { minKm, maxKm, fee: slabFee };
  });

  // Overlapping slabs make "which fee applies" ambiguous, and whichever sorted
  // first would silently win.
  const sorted = [...slabs].sort((a, b) => a.minKm - b.minKm);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].minKm <= sorted[index - 1].maxKm) {
      throw new ApiError(400, `distance slabs overlap: ${sorted[index - 1].minKm}-${sorted[index - 1].maxKm} km and ${sorted[index].minKm}-${sorted[index].maxKm} km`);
    }
  }

  return sorted;
}

function slabNumber(value: unknown, label: string, min: number, max: number) {
  if (value === undefined || value === null || value === '') throw new ApiError(400, `${label} is required`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, `${label} must be a number between ${min} and ${max}`);
  }
  return number;
}
