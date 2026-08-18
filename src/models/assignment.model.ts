import { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
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
  // Which distance slab of that route the student is billed on. Undefined means
  // "pick the only one" for a single-slab route; null means explicitly none.
  slabId?: number | null;
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
    return prisma.$transaction(async tx => {
      const assignment = await tx.driverVehicleAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment || assignment.unassignedAt !== null) {
        return { affectedRows: 0 };
      }
      await tx.driverVehicleAssignment.update({
        where: { id: assignmentId },
        data: { unassignedAt: new Date() }
      });
      await tx.driver.update({
        where: { id: assignment.driverId },
        data: { status: toDriverStatus('Available'), route: null }
      });
      return { affectedRows: 1 };
    });
  }

  static async unassignDriverByDriverId(driverId: number) {
    return prisma.$transaction(async tx => {
      const result = await tx.driverVehicleAssignment.updateMany({
        where: { driverId, unassignedAt: null },
        data: { unassignedAt: new Date() }
      });
      if (result.count > 0) {
        await tx.driver.update({
          where: { id: driverId },
          data: { status: toDriverStatus('Available'), route: null }
        });
      }
      return { affectedRows: result.count };
    });
  }

  static async assignStudent(payload: AssignStudentPayload) {
    const assignmentId = await AssignmentModel.assignStudentOnce(payload);
    return this.findStudentAssignmentById(assignmentId);
  }

  static async assignStudentsBulk(payloads: AssignStudentPayload[]) {
    const assigned: NonNullable<Awaited<ReturnType<typeof AssignmentModel.findStudentAssignmentById>>>[] = [];
    const failed: { studentId: number; error: string }[] = [];
    const concurrency = 8;

    for (let i = 0; i < payloads.length; i += concurrency) {
      const chunk = payloads.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(async payload => {
        try {
          const assignmentId = await AssignmentModel.assignStudentOnce(payload);
          const assignment = await this.findStudentAssignmentById(assignmentId);
          return { ok: true as const, assignment };
        } catch (error) {
          return { ok: false as const, studentId: payload.studentId, error: describeAssignmentError(error) };
        }
      }));
      for (const result of results) {
        if (result.ok) {
          if (result.assignment) assigned.push(result.assignment);
        } else {
          failed.push({ studentId: result.studentId, error: result.error });
        }
      }
    }

    return { assigned, failed };
  }

  private static async assignStudentOnce(payload: AssignStudentPayload) {
    const assignment = await prisma.$transaction(async tx => {
      const route = await resolveRoute(payload.routeIdentifier, tx);
      await tx.student.findUniqueOrThrow({ where: { id: payload.studentId }, select: { id: true } });
      const slabId = await resolveSlabId(tx, route.id, payload.slabId);

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
          slabId,
          pickupOrder: payload.pickupOrder,
          notes: payload.notes
        }
      });
    });

    return assignment.id;
  }

  static async unassignStudent(assignmentId: number) {
    const result = await prisma.studentRouteAssignment.updateMany({
      where: { id: assignmentId, unassignedAt: null },
      data: { unassignedAt: new Date() }
    });
    return { affectedRows: result.count };
  }

  static async unassignStudentByStudentId(studentId: number) {
    const result = await prisma.studentRouteAssignment.updateMany({
      where: { studentId, unassignedAt: null },
      data: { unassignedAt: new Date() }
    });
    return { affectedRows: result.count };
  }

  static async driverHistory(driverId: number) {
    const rows = await prisma.driverVehicleAssignment.findMany({
      where: { driverId },
      include: { vehicle: true },
      orderBy: { assignedAt: 'desc' }
    });
    return rows.map(assignment => ({
      id: assignment.id,
      vehicleId: assignment.vehicleId,
      vehicleCode: assignment.vehicle.vehicleCode,
      route: assignment.route,
      assignedAt: assignment.assignedAt,
      unassignedAt: assignment.unassignedAt
    }));
  }

  static async vehicleHistory(vehicleId: number) {
    const rows = await prisma.driverVehicleAssignment.findMany({
      where: { vehicleId },
      include: { driver: true },
      orderBy: { assignedAt: 'desc' }
    });
    return rows.map(assignment => ({
      id: assignment.id,
      driverId: assignment.driverId,
      driverName: assignment.driver.fullName,
      route: assignment.route,
      assignedAt: assignment.assignedAt,
      unassignedAt: assignment.unassignedAt
    }));
  }

  static async studentHistory(studentId: number) {
    const [routeRows, legacyVehicleRows] = await Promise.all([
      prisma.studentRouteAssignment.findMany({
        where: { studentId },
        include: { route: { include: { vehicle: true } } },
        orderBy: { assignedAt: 'desc' }
      }),
      prisma.studentVehicleAssignment.findMany({
        where: { studentId },
        include: { vehicle: true },
        orderBy: { assignedAt: 'desc' }
      })
    ]);

    const routeHistory = routeRows.map(assignment => ({
      id: `route-${assignment.id}`,
      kind: 'route' as const,
      routeId: assignment.routeId,
      routeCode: assignment.route.routeCode,
      routeName: assignment.route.name,
      vehicleCode: assignment.route.vehicle?.vehicleCode ?? null,
      pickupOrder: assignment.pickupOrder,
      assignedAt: assignment.assignedAt,
      unassignedAt: assignment.unassignedAt
    }));

    const legacyHistory = legacyVehicleRows.map(assignment => ({
      id: `vehicle-${assignment.id}`,
      kind: 'vehicle' as const,
      vehicleId: assignment.vehicleId,
      vehicleCode: assignment.vehicle.vehicleCode,
      pickupOrder: assignment.pickupOrder,
      assignedAt: assignment.assignedAt,
      unassignedAt: assignment.unassignedAt
    }));

    return [...routeHistory, ...legacyHistory].sort(
      (a, b) => b.assignedAt.getTime() - a.assignedAt.getTime()
    );
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

/**
 * Which distance slab of a route a student is billed on.
 *
 * A slab must belong to the route being assigned — accepting one from another
 * route would bill the student a fee unrelated to the bus they ride.
 *
 * When the caller does not name a slab: an unbanded route gets none (the student
 * falls back to `routes.fee`), a single-slab route gets that one, and a route
 * with several is rejected rather than guessed at, since picking the wrong band
 * silently charges a real family the wrong amount.
 */
async function resolveSlabId(tx: any, routeId: number, slabId: number | null | undefined) {
  if (slabId === null) return null;

  if (slabId !== undefined) {
    const slab = await tx.routeFeeSlab.findUnique({ where: { id: slabId }, select: { id: true, routeId: true } });
    if (!slab) throw new ApiError(404, 'Distance slab not found');
    if (slab.routeId !== routeId) throw new ApiError(400, 'That distance slab belongs to a different route');
    return slab.id;
  }

  const slabs = await tx.routeFeeSlab.findMany({ where: { routeId }, select: { id: true, minKm: true, maxKm: true } });
  if (slabs.length === 0) return null;
  if (slabs.length === 1) return slabs[0].id;
  const ranges = slabs.map((slab: any) => `${Number(slab.minKm)}-${Number(slab.maxKm)} km`).join(', ');
  throw new ApiError(400, `This route has several distance slabs (${ranges}). Pick one with slabId.`);
}

function describeAssignmentError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    return 'Student or route not found';
  }
  return error instanceof Error ? error.message : 'Assignment failed';
}
