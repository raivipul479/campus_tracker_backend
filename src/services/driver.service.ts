import { ApiError } from '../errors.js';
import { DriverRow, mapDriver } from '../mappers.js';
import { DriverModel } from '../models/driver.model.js';
import { Body, enumValue, optionalString, positiveId, requiredOrExisting, validatePhone, validateText } from '../validators.js';

const driverStatuses = ['On duty', 'Available', 'Off duty', 'At school'] as const;
const docsStatuses = ['Verified', 'ExpiringSoon', 'Pending', 'Expired'] as const;

export class DriverService {
  static async list(filters: { q?: string; status?: string; docs?: string; vehicleId?: string; phone?: string }) {
    const drivers = await DriverModel.findAll(filters);
    return drivers.map(mapDriver);
  }

  static async getById(idValue: unknown) {
    const id = positiveId(idValue, 'driver id');
    const driver = await DriverModel.findById(id);
    if (!driver) throw new ApiError(404, 'Driver not found');
    return mapDriver(driver);
  }

  static async create(data: Body) {
    const payload = driverPayload(data);
    const created = await DriverModel.create(payload);
    return mapDriver(created!);
  }

  static async update(idValue: unknown, data: Body) {
    const id = positiveId(idValue, 'driver id');
    const existing = await DriverModel.findRawById(id);
    if (!existing) throw new ApiError(404, 'Driver not found');

    const payload = driverPayload(data, existing);
    const updated = await DriverModel.update(id, payload);
    return mapDriver(updated!);
  }

  static async delete(idValue: unknown) {
    const id = positiveId(idValue, 'driver id');
    const result = await DriverModel.delete(id);
    if ('conflict' in result && result.conflict) {
      throw new ApiError(409, 'Driver has vehicle assignment history and cannot be hard-deleted');
    }
    if (!result.affectedRows) throw new ApiError(404, 'Driver not found');
  }
}

function driverPayload(data: Body, existing?: DriverRow) {
  const name = validateText(requiredOrExisting(data, ['name', 'fullName'], 'driver name', existing?.full_name), 'driver name', { min: 2, max: 160 });
  const phone = validatePhone(requiredOrExisting(data, ['phone'], 'phone', existing?.phone), 'phone');
  const licenseNumber = optionalString(data, ['licenseNumber', 'license']) ?? existing?.license_number ?? null;
  const route = optionalString(data, ['route']) ?? existing?.route ?? null;
  if (licenseNumber) validateText(licenseNumber, 'license number', { max: 80 });
  if (route) validateText(route, 'route', { max: 120 });

  return {
    name,
    phone,
    licenseNumber,
    status: enumValue(data, ['status'], driverStatuses, (existing?.status as (typeof driverStatuses)[number]) ?? 'Available'),
    docs: enumValue(data, ['docs', 'docsStatus'], docsStatuses, (existing?.docs_status as (typeof docsStatuses)[number]) ?? 'Pending'),
    route
  };
}
