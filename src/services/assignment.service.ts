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
    return AssignmentModel.assignStudent(parseStudentAssignment(data));
  }

  static async assignStudentsBulk(data: Body) {
    const items = data.assignments;
    if (!Array.isArray(items) || !items.length) {
      throw new ApiError(400, 'assignments must be a non-empty array');
    }
    const payloads = items.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new ApiError(400, `assignments[${index}] must be an object`);
      }
      return parseStudentAssignment(item as Body, `assignments[${index}].`);
    });
    return AssignmentModel.assignStudentsBulk(payloads);
  }

  static async unassignStudent(assignmentIdValue: unknown) {
    const assignmentId = positiveId(assignmentIdValue, 'assignment id');
    const result = await AssignmentModel.unassignStudent(assignmentId);
    if (!result.affectedRows) throw new ApiError(404, 'Active student assignment not found');
  }

  static async unassignStudentByStudentId(studentIdValue: unknown) {
    const studentId = positiveId(studentIdValue, 'student id');
    await AssignmentModel.unassignStudentByStudentId(studentId);
  }

  static async driverHistory(driverIdValue: unknown) {
    return AssignmentModel.driverHistory(positiveId(driverIdValue, 'driver id'));
  }

  static async vehicleHistory(vehicleIdValue: unknown) {
    return AssignmentModel.vehicleHistory(positiveId(vehicleIdValue, 'vehicle id'));
  }

  static async studentHistory(studentIdValue: unknown) {
    return AssignmentModel.studentHistory(positiveId(studentIdValue, 'student id'));
  }
}

function parseStudentAssignment(data: Body, labelPrefix = '') {
  const notes = optionalString(data, ['notes']);
  const routeIdentifier = data.routeId ?? data.routeCode ?? data.route;
  if (routeIdentifier === undefined || routeIdentifier === null || routeIdentifier === '') {
    throw new ApiError(400, `${labelPrefix}routeId is required`);
  }
  if (notes) validateText(notes, 'notes', { max: 255 });
  return {
    studentId: positiveId(data.studentId, `${labelPrefix}studentId`),
    routeIdentifier,
    pickupOrder: optionalBoundedNumber(data, ['pickupOrder', 'pickup_order'], 'pickup order', { min: 1, max: 500, integer: true }),
    notes
  };
}
