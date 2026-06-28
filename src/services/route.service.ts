import { ApiError } from '../errors.js';
import { mapRoute, RouteRow } from '../mappers.js';
import { RouteModel } from '../models/route.model.js';
import { Body, optionalString, positiveId, requiredOrExisting, validateText } from '../validators.js';

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
    if (!result.affectedRows) throw new ApiError(404, 'Route not found');
  }
}

function routePayload(data: Body, existing?: RouteRow) {
  const code = validateText(requiredOrExisting(data, ['id', 'code', 'routeCode'], 'route code', existing?.route_code).toUpperCase(), 'route code', {
    min: 2,
    max: 32,
    pattern: /^[A-Z0-9][A-Z0-9-]*$/
  });
  const name = validateText(requiredOrExisting(data, ['name'], 'route name', existing?.name), 'route name', { min: 2, max: 120 });
  const description = optionalString(data, ['description']) ?? existing?.description ?? null;
  if (description) validateText(description, 'description', { max: 255 });
  const vehicleIdentifier = data.vehicleId ?? data.vehicleCode ?? data.vehicle ?? existing?.vehicle_id ?? null;

  return { code, name, description, vehicleIdentifier };
}
