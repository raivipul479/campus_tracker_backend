import { prisma } from '../prisma.js';
import { RouteRow } from '../mappers.js';

export interface RoutePayload {
  code: string;
  name: string;
  description: string | null;
  vehicleIdentifier: unknown;
}

export class RouteModel {
  static async resolveId(identifier: unknown, tx: any = prisma) {
    const value = String(identifier).trim();
    if (/^\d+$/.test(value)) {
      return tx.transportRoute.findUniqueOrThrow({ where: { id: Number(value) }, select: { id: true } });
    }
    return tx.transportRoute.findUniqueOrThrow({ where: { routeCode: value }, select: { id: true } });
  }

  static async findAll(filters: { q?: string; vehicleId?: string; assigned?: string }) {
    const routes = await prisma.transportRoute.findMany({
      where: {
        ...(filters.q
          ? {
            OR: [
              { routeCode: { contains: filters.q } },
              { name: { contains: filters.q } },
              { vehicle: { vehicleCode: { contains: filters.q } } }
            ]
          }
          : {}),
        ...(filters.vehicleId
          ? {
              vehicle: /^\d+$/.test(filters.vehicleId)
                ? { id: Number(filters.vehicleId) }
                : { vehicleCode: filters.vehicleId }
            }
          : {}),
        ...(filters.assigned === 'assigned' ? { vehicleId: { not: null } } : {}),
        ...(filters.assigned === 'unassigned' ? { vehicleId: null } : {})
      },
      include: routeInclude(),
      orderBy: { routeCode: 'asc' }
    });

    return routes.map(mapRouteRecord);
  }

  static async findById(id: number) {
    const route = await prisma.transportRoute.findUnique({
      where: { id },
      include: routeInclude()
    });
    return route ? mapRouteRecord(route) : null;
  }

  static async create(payload: RoutePayload) {
    const vehicleId = payload.vehicleIdentifier ? await resolveVehicleId(payload.vehicleIdentifier) : null;
    const route = await prisma.transportRoute.create({
      data: {
        routeCode: payload.code,
        name: payload.name,
        description: payload.description,
        vehicleId
      },
      include: routeInclude()
    });

    return mapRouteRecord(route);
  }

  static async update(id: number, payload: RoutePayload) {
    const vehicleId = payload.vehicleIdentifier ? await resolveVehicleId(payload.vehicleIdentifier) : null;
    const route = await prisma.transportRoute.update({
      where: { id },
      data: {
        routeCode: payload.code,
        name: payload.name,
        description: payload.description,
        vehicleId
      },
      include: routeInclude()
    });

    return mapRouteRecord(route);
  }

  static async delete(id: number) {
    try {
      await prisma.transportRoute.delete({ where: { id } });
      return { affectedRows: 1 };
    } catch {
      return { affectedRows: 0 };
    }
  }
}

function routeInclude() {
  return {
    vehicle: true,
    studentAssignments: {
      where: { unassignedAt: null },
      select: { id: true }
    }
  } as const;
}

function mapRouteRecord(route: any): RouteRow {
  return {
    id: route.id,
    route_code: route.routeCode,
    name: route.name,
    description: route.description,
    vehicle_id: route.vehicle?.id ?? null,
    vehicle_code: route.vehicle?.vehicleCode ?? null,
    student_count: route.studentAssignments?.length ?? 0
  };
}

async function resolveVehicleId(identifier: unknown) {
  const value = String(identifier).trim();
  if (!value || value === 'Not assigned' || value === 'Unassigned') return null;
  const vehicle = /^\d+$/.test(value)
    ? await prisma.vehicle.findUnique({ where: { id: Number(value) }, select: { id: true } })
    : await prisma.vehicle.findUnique({ where: { vehicleCode: value }, select: { id: true } });
  return vehicle?.id ?? null;
}
