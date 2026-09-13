import { ApiError } from '../errors.js';
import { StudentService } from './student.service.js';
import { VehicleService } from './vehicle.service.js';
import { FeeDueService } from './fee-due.service.js';
import { PaymentService } from './payment.service.js';
import { TransportLogService } from './transport-log.service.js';
import { GpsService } from './gps.service.js';

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

  /**
   * Live position of the bus this parent's children ride, and no other.
   *
   * Deliberately not the fleet-wide GPS endpoint: a parent has no business
   * seeing where other people's children are being carried.
   */
  static async vehiclePositions(phone: string) {
    const vehicles = await ParentPortalService.vehicles(phone);
    const vehicleIds = vehicles
      .map(vehicle => vehicle.vehicleId as number)
      .filter((id): id is number => Boolean(id));
    return GpsService.forVehicleIds(vehicleIds);
  }

  /**
   * Where one child's bus has been, oldest first, for the route trail on the
   * parent's map. Only ever the bus of a child linked to this parent.
   */
  static async vehicleHistory(
    phone: string,
    studentIdValue: string | undefined,
    filters: { from?: string; to?: string; limit?: string }
  ) {
    const studentId = Number(studentIdValue);
    if (!Number.isInteger(studentId) || studentId <= 0) throw new ApiError(400, 'studentId is required');
    const child = (await childrenFor(phone)).find(item => Number(item.studentId) === studentId);
    if (!child) throw new ApiError(403, 'This student is not linked to your account');
    if (!child.vehicleId) return { vehicle: null, count: 0, limit: 0, positions: [] };
    return GpsService.historyForVehicleId(child.vehicleId as number, filters);
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
