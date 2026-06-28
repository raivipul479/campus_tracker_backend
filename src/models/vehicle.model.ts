import { VehicleStatus } from '@prisma/client';
import { ApiError } from '../errors.js';
import { StudentRow, VehicleRow } from '../mappers.js';
import { prisma } from '../prisma.js';

export interface VehiclePayload {
  code: string;
  plate: string;
  route: string | null;
  status: string;
  speed: number;
  mapX: number;
  mapY: number;
}

export class VehicleModel {
  static async resolveId(identifier: unknown) {
    if (identifier === undefined || identifier === null || identifier === '') {
      throw new ApiError(400, 'vehicleId is required');
    }

    const value = String(identifier).trim();
    const vehicle = /^\d+$/.test(value)
      ? await prisma.vehicle.findUnique({ where: { id: Number(value) }, select: { id: true } })
      : await prisma.vehicle.findUnique({ where: { vehicleCode: value }, select: { id: true } });

    if (!vehicle) {
      throw new ApiError(404, 'Vehicle not found');
    }
    return vehicle.id;
  }

  static async findAll(filters: { q?: string; status?: string; driverId?: string; routeId?: string; assigned?: string }) {
    const vehicles = await prisma.vehicle.findMany({
      where: {
        ...(filters.q
          ? {
            OR: [
              { vehicleCode: { contains: filters.q } },
              { registrationNumber: { contains: filters.q } },
              { route: { contains: filters.q } },
              { routes: { some: { name: { contains: filters.q } } } },
              { driverAssignments: { some: { unassignedAt: null, driver: { fullName: { contains: filters.q } } } } }
            ]
          }
          : {}),
        ...(filters.status ? { status: toVehicleStatus(filters.status) } : {}),
        ...(filters.driverId
          ? { driverAssignments: { some: { unassignedAt: null, driverId: Number(filters.driverId) } } }
          : {}),
        ...(filters.routeId
          ? { routes: { some: /^\d+$/.test(filters.routeId) ? { id: Number(filters.routeId) } : { routeCode: filters.routeId } } }
          : {}),
        ...(filters.assigned === 'assigned' ? { routes: { some: {} } } : {}),
        ...(filters.assigned === 'unassigned' ? { routes: { none: {} } } : {})
      },
      include: vehicleInclude(),
      orderBy: { vehicleCode: 'asc' }
    });

    return vehicles.map(mapVehicleRecord);
  }

  static async findById(id: number) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: vehicleInclude()
    });
    return vehicle ? mapVehicleRecord(vehicle) : null;
  }

  static async findRawById(id: number) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    return vehicle ? mapVehicleRecord(vehicle) : null;
  }

  static async findRoster(vehicleId: number) {
    const assignments = await prisma.studentRouteAssignment.findMany({
      where: { route: { vehicleId }, unassignedAt: null },
      include: { student: true, route: { include: { vehicle: true } } },
      orderBy: [{ pickupOrder: 'asc' }, { student: { fullName: 'asc' } }]
    });

    return assignments.map(assignment => mapStudentRecord(assignment.student, assignment.route));
  }

  static async create(payload: VehiclePayload) {
    const vehicle = await prisma.vehicle.create({
      data: {
        vehicleCode: payload.code,
        registrationNumber: payload.plate,
        route: payload.route,
        status: toVehicleStatus(payload.status),
        speedKmh: payload.speed,
        mapX: payload.mapX,
        mapY: payload.mapY
      },
      include: vehicleInclude()
    });

    return mapVehicleRecord(vehicle);
  }

  static async update(id: number, payload: VehiclePayload) {
    const vehicle = await prisma.vehicle.update({
      where: { id },
      data: {
        vehicleCode: payload.code,
        registrationNumber: payload.plate,
        route: payload.route,
        status: toVehicleStatus(payload.status),
        speedKmh: payload.speed,
        mapX: payload.mapX,
        mapY: payload.mapY
      },
      include: vehicleInclude()
    });

    return mapVehicleRecord(vehicle);
  }

  static async delete(id: number) {
    try {
      await prisma.vehicle.delete({ where: { id } });
      return { affectedRows: 1 };
    } catch {
      return { affectedRows: 0 };
    }
  }
}

export function toVehicleStatus(status: string): VehicleStatus {
  const map: Record<string, VehicleStatus> = {
    'On route': VehicleStatus.On_route,
    'At school': VehicleStatus.At_school,
    Offline: VehicleStatus.Offline
  };
  return map[status] ?? VehicleStatus.Offline;
}

export function fromVehicleStatus(status: VehicleStatus | string) {
  const map: Record<string, string> = {
    On_route: 'On route',
    At_school: 'At school',
    Offline: 'Offline'
  };
  return map[String(status)] ?? String(status);
}

function vehicleInclude() {
  return {
    driverAssignments: {
      where: { unassignedAt: null },
      include: { driver: true },
      take: 1
    },
    routes: {
      include: {
        studentAssignments: {
          where: { unassignedAt: null },
          select: { id: true }
        }
      }
    },
    studentAssignments: {
      where: { unassignedAt: null },
      select: { id: true }
    }
  } as const;
}

function mapVehicleRecord(vehicle: any): VehicleRow {
  const driverAssignment = vehicle.driverAssignments?.[0];
  return {
    id: vehicle.id,
    vehicle_code: vehicle.vehicleCode,
    registration_number: vehicle.registrationNumber,
    route: vehicle.route,
    status: fromVehicleStatus(vehicle.status),
    speed_kmh: Number(vehicle.speedKmh),
    map_x: Number(vehicle.mapX),
    map_y: Number(vehicle.mapY),
    driver_id: driverAssignment?.driver.id ?? null,
    driver_name: driverAssignment?.driver.fullName ?? null,
    student_count: vehicle.routes?.reduce((sum: number, route: any) => sum + (route.studentAssignments?.length ?? 0), 0) ?? vehicle.studentAssignments?.length ?? 0
  };
}

function mapStudentRecord(student: any, route: any): StudentRow {
  const vehicle = route.vehicle;
  return {
    id: student.id,
    serial_number: student.serialNumber,
    registration_number: student.registrationNumber,
    full_name: student.fullName,
    class_name: student.className,
    distance_km: student.distanceKm === null ? null : Number(student.distanceKm),
    tag_no: student.tagNo,
    area: student.area,
    phone: student.phone,
    secondary_phone: student.secondaryPhone,
    vehicle_id: vehicle?.id ?? null,
    vehicle_code: vehicle?.vehicleCode ?? null,
    route_id: route.id,
    route_code: route.routeCode,
    route_name: route.name
  };
}
