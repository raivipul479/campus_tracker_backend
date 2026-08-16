import { ApiError } from '../errors.js';
import { Body } from '../validators.js';
import { DriverService } from './driver.service.js';
import { VehicleService } from './vehicle.service.js';
import { TransportLogService } from './transport-log.service.js';
import { NotificationService } from './notification.service.js';

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
    const { vehicle, students } = await VehicleService.roster(driver.vehicleId);

    // Held students are hidden from the driver only. The admin vehicle roster
    // deliberately still shows them, otherwise there would be no way to see a
    // held student in order to release the hold.
    //
    // createTransportLog below validates against this same list, so a held
    // student also cannot have a pickup or drop logged against them.
    return { vehicle, students: students.filter((student: any) => !student.onHold) };
  }

  static async createTransportLog(phone: string, data: Body) {
    const { students } = await DriverPortalService.roster(phone);
    const studentId = Number(data.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId is invalid');
    const allowed = students.some((student: any) => Number(student.studentId ?? student.id) === studentId);
    if (!allowed) throw new ApiError(403, 'This student is not on your current roster');
    const log = await TransportLogService.create(data);

    // Notify the parent — never let a push failure block the log response.
    NotificationService.notifyTransportEvent(studentId, log.action as 'Pickup' | 'Drop').catch(error => {
      console.error('[notifications] transport event failed:', (error as Error).message);
    });

    return log;
  }
}
