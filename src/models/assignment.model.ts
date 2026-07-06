import { prisma } from '../prisma.js';
import { toDriverStatus } from './driver.model.js';

export interface AssignDriverPayload {
  driverId: number;
  vehicleIdentifier: unknown;
  route: string | null;
}

export interface AssignStudentPayload {
  studentId: number;
  routeIdentifier: unknown;
  pickupOrder: number | null;
  notes: string | null;
}

export class AssignmentModel {
  static async findAll() {
    const [driverAssignments, studentAssignments] = await Promise.all([
      prisma.driverVehicleAssignment.findMany({
        where: { unassignedAt: null },
        include: { driver: true, vehicle: true },
        orderBy: { vehicle: { vehicleCode: 'asc' } }
      }),
      prisma.studentRouteAssignment.findMany({
        where: { unassignedAt: null },
        include: { student: true, route: { include: { vehicle: true } } },
        orderBy: [{ route: { routeCode: 'asc' } }, { pickupOrder: 'asc' }, { student: { fullName: 'asc' } }]
      })
    ]);

    return {
      driverAssignments: driverAssignments.map(assignment => ({
        id: assignment.id,
        driverId: assignment.driverId,
        driverName: assignment.driver.fullName,
        vehicleId: assignment.vehicleId,
        vehicleCode: assignment.vehicle.vehicleCode,
        route: assignment.route,
        assignedAt: assignment.assignedAt
      })),
      studentAssignments: studentAssignments.map(assignment => ({
        id: assignment.id,
        studentId: assignment.studentId,
        studentName: assignment.student.fullName,
        regNo: assignment.student.registrationNumber,
        routeId: assignment.routeId,
        routeCode: assignment.route.routeCode,
        routeName: assignment.route.name,
        routeFee: Number(assignment.route.fee ?? 0),
        vehicleId: assignment.route.vehicle?.id ?? null,
        vehicleCode: assignment.route.vehicle?.vehicleCode ?? null,
        pickupOrder: assignment.pickupOrder,
        notes: assignment.notes,
        assignedAt: assignment.assignedAt
      }))
    };
  }

  static async assignDriver(payload: AssignDriverPayload) {
    const assignment = await prisma.$transaction(async tx => {
      const vehicle = await resolveVehicle(payload.vehicleIdentifier, tx);
      await tx.driver.findUniqueOrThrow({ where: { id: payload.driverId }, select: { id: true } });

      await tx.driverVehicleAssignment.updateMany({
        where: {
          unassignedAt: null,
          OR: [{ driverId: payload.driverId }, { vehicleId: vehicle.id }]
        },
        data: { unassignedAt: new Date() }
      });

      const created = await tx.driverVehicleAssignment.create({
        data: {
          driverId: payload.driverId,
          vehicleId: vehicle.id,
          route: payload.route
        }
      });

      await tx.driver.update({
        where: { id: payload.driverId },
        data: {
          status: toDriverStatus('On duty'),
          ...(payload.route ? { route: payload.route } : {})
        }
      });

      if (payload.route) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { route: payload.route } });
      }

      return created;
    });

    return this.findDriverAssignmentById(assignment.id);
  }

  static async unassignDriver(assignmentId: number) {
    const result = await prisma.driverVehicleAssignment.updateMany({
      where: { id: assignmentId, unassignedAt: null },
      data: { unassignedAt: new Date() }
    });
    return { affectedRows: result.count };
  }

  static async unassignDriverByDriverId(driverId: number) {
    const result = await prisma.driverVehicleAssignment.updateMany({
      where: { driverId, unassignedAt: null },
      data: { unassignedAt: new Date() }
    });
    return { affectedRows: result.count };
  }

  static async assignStudent(payload: AssignStudentPayload) {
    const assignment = await prisma.$transaction(async tx => {
      const route = await resolveRoute(payload.routeIdentifier, tx);
      await tx.student.findUniqueOrThrow({ where: { id: payload.studentId }, select: { id: true } });

      await tx.studentRouteAssignment.updateMany({
        where: { studentId: payload.studentId, unassignedAt: null },
        data: { unassignedAt: new Date() }
      });
      // Direct vehicle assignments are legacy history. A route assignment is
      // the sole source of truth for the student's current vehicle.
      await tx.studentVehicleAssignment.updateMany({
        where: { studentId: payload.studentId, unassignedAt: null },
        data: { unassignedAt: new Date() }
      });

      return tx.studentRouteAssignment.create({
        data: {
          studentId: payload.studentId,
          routeId: route.id,
          pickupOrder: payload.pickupOrder,
          notes: payload.notes
        }
      });
    });

    return this.findStudentAssignmentById(assignment.id);
  }

  static async unassignStudent(assignmentId: number) {
    const result = await prisma.studentRouteAssignment.updateMany({
      where: { id: assignmentId, unassignedAt: null },
      data: { unassignedAt: new Date() }
    });
    return { affectedRows: result.count };
  }

  private static async findDriverAssignmentById(assignmentId: number) {
    const assignment = await prisma.driverVehicleAssignment.findUnique({
      where: { id: assignmentId },
      include: { driver: true, vehicle: true }
    });
    if (!assignment) return null;
    return {
      id: assignment.id,
      driverId: assignment.driverId,
      driverName: assignment.driver.fullName,
      vehicleId: assignment.vehicleId,
      vehicleCode: assignment.vehicle.vehicleCode,
      route: assignment.route,
      assignedAt: assignment.assignedAt
    };
  }

  private static async findStudentAssignmentById(assignmentId: number) {
    const assignment = await prisma.studentRouteAssignment.findUnique({
      where: { id: assignmentId },
      include: { student: true, route: { include: { vehicle: true } } }
    });
    if (!assignment) return null;
    return {
      id: assignment.id,
      studentId: assignment.studentId,
      studentName: assignment.student.fullName,
      regNo: assignment.student.registrationNumber,
      routeId: assignment.routeId,
      routeCode: assignment.route.routeCode,
      routeName: assignment.route.name,
      routeFee: Number(assignment.route.fee ?? 0),
      vehicleId: assignment.route.vehicle?.id ?? null,
      vehicleCode: assignment.route.vehicle?.vehicleCode ?? null,
      pickupOrder: assignment.pickupOrder,
      notes: assignment.notes,
      assignedAt: assignment.assignedAt
    };
  }
}

async function resolveVehicle(identifier: unknown, tx: any) {
  const value = String(identifier).trim();
  if (/^\d+$/.test(value)) {
    return tx.vehicle.findUniqueOrThrow({ where: { id: Number(value) }, select: { id: true } });
  }
  return tx.vehicle.findUniqueOrThrow({ where: { vehicleCode: value }, select: { id: true } });
}

async function resolveRoute(identifier: unknown, tx: any) {
  const value = String(identifier).trim();
  if (/^\d+$/.test(value)) {
    return tx.transportRoute.findUniqueOrThrow({ where: { id: Number(value) }, select: { id: true } });
  }
  return tx.transportRoute.findUniqueOrThrow({ where: { routeCode: value }, select: { id: true } });
}
