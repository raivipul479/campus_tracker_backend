import { ApiError } from '../errors.js';
import { Body } from '../validators.js';
import { DriverService } from './driver.service.js';
import { VehicleService } from './vehicle.service.js';
import { TransportLogService } from './transport-log.service.js';

async function driverFor(phone: string) {
  const drivers = await DriverService.list({ phone });
  const driver = drivers[0];
  if (!driver) throw new ApiError(404, 'Driver not found');
  return driver;
}

export class DriverPortalService {
  static async me(phone: string) {
    return driverFor(phone);
  }

  static async roster(phone: string) {
    const driver = await driverFor(phone);
    if (!driver.vehicleId) return { vehicle: null, students: [] };
    return VehicleService.roster(driver.vehicleId);
  }

  static async createTransportLog(phone: string, data: Body) {
    const { students } = await DriverPortalService.roster(phone);
    const studentId = Number(data.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId is invalid');
    const allowed = students.some((student: any) => Number(student.studentId ?? student.id) === studentId);
    if (!allowed) throw new ApiError(403, 'This student is not on your current roster');
    return TransportLogService.create(data);
  }
}
