import { ApiError } from '../errors.js';
import { mapStudent, mapVehicle, VehicleRow } from '../mappers.js';
import { VehicleModel } from '../models/vehicle.model.js';
import {
  Body,
  enumValue,
  optionalBoundedNumber,
  optionalString,
  requiredOrExisting,
  validateRegistrationNumber,
  validateText,
  validateVehicleCode
} from '../validators.js';

const vehicleStatuses = ['On route', 'At school', 'Offline'] as const;
const vehicleTypes = ['Bus', 'Van', 'Mini Bus'] as const;
const fuelTypes = ['Diesel', 'Petrol', 'CNG', 'Electric'] as const;

export class VehicleService {
  static async list(filters: { q?: string; status?: string; driverId?: string; routeId?: string; assigned?: string }) {
    const vehicles = await VehicleModel.findAll(filters);
    return vehicles.map(mapVehicle);
  }

  static async getById(identifier: unknown) {
    const id = await VehicleModel.resolveId(identifier);
    const vehicle = await VehicleModel.findById(id);
    if (!vehicle) throw new ApiError(404, 'Vehicle not found');
    return mapVehicle(vehicle);
  }

  static async roster(identifier: unknown) {
    const id = await VehicleModel.resolveId(identifier);
    const vehicle = await VehicleModel.findById(id);
    if (!vehicle) throw new ApiError(404, 'Vehicle not found');

    const students = await VehicleModel.findRoster(id);
    return {
      vehicle: mapVehicle(vehicle),
      students: students.map(mapStudent)
    };
  }

  static async create(data: Body) {
    const payload = vehiclePayload(data);
    const created = await VehicleModel.create(payload);
    return mapVehicle(created!);
  }

  static async update(identifier: unknown, data: Body) {
    const id = await VehicleModel.resolveId(identifier);
    const existing = await VehicleModel.findRawById(id);
    if (!existing) throw new ApiError(404, 'Vehicle not found');

    const payload = vehiclePayload(data, existing);
    const updated = await VehicleModel.update(id, payload);
    return mapVehicle(updated!);
  }

  static async delete(identifier: unknown) {
    const id = await VehicleModel.resolveId(identifier);
    const result = await VehicleModel.delete(id);
    if (!result.affectedRows) throw new ApiError(404, 'Vehicle not found');
  }
}

function vehiclePayload(data: Body, existing?: VehicleRow) {
  const code = validateVehicleCode(requiredOrExisting(data, ['id', 'code', 'vehicleCode'], 'vehicle code', existing?.vehicle_code));
  const plate = validateRegistrationNumber(requiredOrExisting(data, ['plate', 'registrationNumber'], 'registration number', existing?.registration_number));
  const route = optionalString(data, ['route']) ?? existing?.route ?? null;
  if (route) validateText(route, 'route', { max: 120 });
  const chassisNumber = optionalString(data, ['chassisNumber']) ?? existing?.chassis_number ?? null;
  if (chassisNumber) validateText(chassisNumber, 'chassis number', { max: 64 });

  return {
    code,
    plate,
    route,
    status: enumValue(data, ['status'], vehicleStatuses, (existing?.status as (typeof vehicleStatuses)[number]) ?? 'Offline'),
    speed: optionalBoundedNumber(data, ['speed', 'speedKmh'], 'speed', { min: 0, max: 160 }) ?? Number(existing?.speed_kmh ?? 0),
    mapX: optionalBoundedNumber(data, ['x', 'mapX'], 'map x', { min: 0, max: 100 }) ?? Number(existing?.map_x ?? 50),
    mapY: optionalBoundedNumber(data, ['y', 'mapY'], 'map y', { min: 0, max: 100 }) ?? Number(existing?.map_y ?? 50),
    vehicleType: enumValue(data, ['vehicleType'], vehicleTypes, (existing?.vehicle_type as (typeof vehicleTypes)[number]) ?? 'Bus'),
    fuelType: enumValue(data, ['fuelType'], fuelTypes, (existing?.fuel_type as (typeof fuelTypes)[number]) ?? 'Diesel'),
    seatingCapacity: optionalBoundedNumber(data, ['seatingCapacity'], 'seating capacity', { min: 1, max: 100, integer: true }) ?? existing?.seating_capacity ?? null,
    chassisNumber,
    insuranceExpiry: optionalDate(data, ['insuranceExpiry'], 'insurance expiry') ?? existingDate(existing?.insurance_expiry),
    fitnessExpiry: optionalDate(data, ['fitnessExpiry'], 'fitness expiry') ?? existingDate(existing?.fitness_expiry),
    pucExpiry: optionalDate(data, ['pucExpiry'], 'PUC expiry') ?? existingDate(existing?.puc_expiry),
    permitExpiry: optionalDate(data, ['permitExpiry'], 'permit expiry') ?? existingDate(existing?.permit_expiry)
  };
}

function optionalDate(data: Body, keys: string[], label: string) {
  const value = optionalString(data, keys);
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${label} is invalid`);
  return date;
}

function existingDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
