import { ApiError } from '../errors.js';
import { AssignmentModel } from '../models/assignment.model.js';
import { Body, optionalBoundedNumber, optionalString, positiveId, validateText } from '../validators.js';

export class AssignmentService {
  static async list() {
    return AssignmentModel.findAll();
  }

  static async assignDriver(data: Body) {
    const route = optionalString(data, ['route']);
    const vehicleIdentifier = data.vehicleId ?? data.vehicleCode ?? data.vehicle;
    if (vehicleIdentifier === undefined || vehicleIdentifier === null || vehicleIdentifier === '') {
      throw new ApiError(400, 'vehicleId is required');
    }
    if (route) validateText(route, 'route', { max: 120 });
    return AssignmentModel.assignDriver({
      driverId: positiveId(data.driverId, 'driverId'),
      vehicleIdentifier,
      route
    });
  }

  static async unassignDriver(assignmentIdValue: unknown) {
    const assignmentId = positiveId(assignmentIdValue, 'assignment id');
    const result = await AssignmentModel.unassignDriver(assignmentId);
    if (!result.affectedRows) throw new ApiError(404, 'Active driver assignment not found');
  }

  static async unassignDriverByDriverId(driverIdValue: unknown) {
    const driverId = positiveId(driverIdValue, 'driver id');
    await AssignmentModel.unassignDriverByDriverId(driverId);
  }

  static async assignStudent(data: Body) {
    const notes = optionalString(data, ['notes']);
    const routeIdentifier = data.routeId ?? data.routeCode ?? data.route;
    if (routeIdentifier === undefined || routeIdentifier === null || routeIdentifier === '') {
      throw new ApiError(400, 'routeId is required');
    }
    if (notes) validateText(notes, 'notes', { max: 255 });
    return AssignmentModel.assignStudent({
      studentId: positiveId(data.studentId, 'studentId'),
      routeIdentifier,
      pickupOrder: optionalBoundedNumber(data, ['pickupOrder', 'pickup_order'], 'pickup order', { min: 1, max: 500, integer: true }),
      notes
    });
  }

  static async unassignStudent(assignmentIdValue: unknown) {
    const assignmentId = positiveId(assignmentIdValue, 'assignment id');
    const result = await AssignmentModel.unassignStudent(assignmentId);
    if (!result.affectedRows) throw new ApiError(404, 'Active student assignment not found');
  }
}
