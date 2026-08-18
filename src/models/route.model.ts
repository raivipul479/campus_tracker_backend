import { Prisma } from '@prisma/client';
import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { RouteRow } from '../mappers.js';

export interface RouteFeeSlabInput {
  minKm: number;
  maxKm: number;
  fee: number;
}

export interface RoutePayload {
  code: string;
  name: string;
  description: string | null;
  fee: number;
  vehicleIdentifier: unknown;
  // null means "leave the existing slabs alone" — an update that never mentions
  // slabs must not silently wipe a route's pricing. [] clears them explicitly.
  slabs: RouteFeeSlabInput[] | null;
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
    const where = {
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
    };

    const routes = await prisma.transportRoute.findMany({
      where,
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
        fee: payload.fee,
        vehicleId,
        ...(payload.slabs?.length ? { feeSlabs: { create: payload.slabs.map(slabData) } } : {})
      },
      include: routeInclude()
    });

    return mapRouteRecord(route);
  }

  static async update(id: number, payload: RoutePayload) {
    const vehicleId = payload.vehicleIdentifier ? await resolveVehicleId(payload.vehicleIdentifier) : null;

    const route = await prisma.$transaction(async tx => {
      if (payload.slabs) await replaceSlabs(tx, id, payload.slabs);

      return tx.transportRoute.update({
        where: { id },
        data: {
          routeCode: payload.code,
          name: payload.name,
          description: payload.description,
          fee: payload.fee,
          vehicleId
        },
        include: routeInclude()
      });
    });

    return mapRouteRecord(route);
  }

  static async delete(id: number) {
    try {
      await prisma.transportRoute.delete({ where: { id } });
      return { affectedRows: 1 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return { affectedRows: 0, conflict: true };
      }
      return { affectedRows: 0 };
    }
  }
}

const slabData = (slab: RouteFeeSlabInput) => ({
  minKm: slab.minKm,
  maxKm: slab.maxKm,
  fee: slab.fee
});

/**
 * Replaces a route's distance slabs, keeping the rows students are billed on.
 *
 * A slab is identified by its starting kilometre — the same key as
 * `uq_route_fee_slabs_route_min` — so editing a price updates that row in place.
 * Deleting and recreating would change the slab id under every assignment
 * pointing at it, which is the whole link between a student and their fee.
 *
 * Removing a slab that any assignment references is refused rather than
 * cascaded: those students would be left with no rate at all. The database says
 * the same thing via ON DELETE RESTRICT — this just fails with an explanation
 * instead of a foreign key error.
 */
async function replaceSlabs(tx: Prisma.TransactionClient, routeId: number, slabs: RouteFeeSlabInput[]) {
  const existing = await tx.routeFeeSlab.findMany({
    where: { routeId },
    select: { id: true, minKm: true, maxKm: true, _count: { select: { assignments: true } } }
  });

  const kept = new Set<number>();
  for (const slab of slabs) {
    const match = existing.find(row => Number(row.minKm) === slab.minKm);
    if (match) {
      kept.add(match.id);
      await tx.routeFeeSlab.update({ where: { id: match.id }, data: { maxKm: slab.maxKm, fee: slab.fee } });
    } else {
      await tx.routeFeeSlab.create({ data: { routeId, ...slabData(slab) } });
    }
  }

  const removed = existing.filter(row => !kept.has(row.id));
  const inUse = removed.filter(row => row._count.assignments > 0);
  if (inUse.length) {
    const ranges = inUse.map(row => `${Number(row.minKm)}-${Number(row.maxKm)} km`).join(', ');
    throw new ApiError(409, `Cannot remove the ${ranges} band: students are assigned to it. Move them to another band first.`);
  }
  if (removed.length) {
    await tx.routeFeeSlab.deleteMany({ where: { id: { in: removed.map(row => row.id) } } });
  }
}

function routeInclude() {
  return {
    vehicle: true,
    studentAssignments: {
      where: { unassignedAt: null },
      select: { id: true }
    },
    feeSlabs: {
      orderBy: { minKm: 'asc' as const },
      select: { id: true, minKm: true, maxKm: true, fee: true }
    }
  };
}

function mapRouteRecord(route: any): RouteRow {
  return {
    id: route.id,
    route_code: route.routeCode,
    name: route.name,
    description: route.description,
    fee: route.fee,
    vehicle_id: route.vehicle?.id ?? null,
    vehicle_code: route.vehicle?.vehicleCode ?? null,
    student_count: route.studentAssignments?.length ?? 0,
    fee_slabs: (route.feeSlabs ?? []).map((slab: any) => ({
      id: slab.id,
      min_km: slab.minKm,
      max_km: slab.maxKm,
      fee: slab.fee
    }))
  };
}

async function resolveVehicleId(identifier: unknown) {
  const value = String(identifier).trim();
  if (!value || value === 'Not assigned' || value === 'Unassigned') return null;
  const vehicle = /^\d+$/.test(value)
    ? await prisma.vehicle.findUnique({ where: { id: Number(value) }, select: { id: true } })
    : await prisma.vehicle.findUnique({ where: { vehicleCode: value }, select: { id: true } });
  if (!vehicle) throw new ApiError(404, `Vehicle "${value}" not found`);
  return vehicle.id;
}
