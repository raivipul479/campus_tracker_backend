import { ApiError } from '../errors.js';
import { StudentService } from './student.service.js';
import { VehicleService } from './vehicle.service.js';
import { FeeDueService } from './fee-due.service.js';
import { PaymentService } from './payment.service.js';
import { TransportLogService } from './transport-log.service.js';

async function childrenFor(phone: string) {
  return StudentService.list({ phone });
}

async function childIds(phone: string) {
  const children = await childrenFor(phone);
  return children.map(child => child.studentId as number);
}

export class ParentPortalService {
  static async children(phone: string) {
    return childrenFor(phone);
  }

  static async vehicles(phone: string) {
    const children = await childrenFor(phone);
    const vehicleIds = new Set(children.map(child => child.vehicleId).filter((id): id is number => Boolean(id)));
    if (!vehicleIds.size) return [];
    const allVehicles = await VehicleService.list({});
    return allVehicles.filter(vehicle => vehicleIds.has(vehicle.vehicleId as number));
  }

  static async feeDues(phone: string, month?: string) {
    const studentIds = await childIds(phone);
    if (!studentIds.length) return [];
    return FeeDueService.list({ studentIds, month });
  }

  static async payments(phone: string) {
    const studentIds = await childIds(phone);
    if (!studentIds.length) return [];
    return PaymentService.list({ studentIds });
  }

  static async transportLogs(phone: string, studentIdValue?: string) {
    const studentIds = await childIds(phone);
    if (!studentIds.length) return [];
    if (studentIdValue) {
      const studentId = Number(studentIdValue);
      if (!studentIds.includes(studentId)) {
        throw new ApiError(403, 'This student is not linked to your account');
      }
      return TransportLogService.list({ studentId: studentIdValue });
    }
    return TransportLogService.list({ studentIds });
  }
}
