import { ApiError } from '../errors.js';
import { prisma } from '../prisma.js';
import { plateKey } from './gps-provider.js';
import { GpsPoller } from './gps-poller.service.js';

/**
 * Vehicle positions, read from what the poller stored.
 *
 * Nothing here contacts the provider. That is the point: the provider allows
 * one call a minute, so serving reads from the database lets any number of
 * dashboards and phones poll as often as they like.
 */

interface VehicleRef {
  id: number;
  vehicleCode: string;
  registrationNumber: string;
  route: string | null;
  driverAssignments: { driver: { fullName: string } }[];
}

const vehicleSelect = {
  id: true,
  vehicleCode: true,
  registrationNumber: true,
  route: true,
  driverAssignments: {
    where: { unassignedAt: null },
    select: { driver: { select: { fullName: true } } },
    take: 1
  }
} as const;

function shape(position: any, vehicle: VehicleRef | null) {
  const reportedAt: Date = position.reportedAt;
  return {
    id: vehicle?.vehicleCode ?? position.vehicleNo,
    vehicleId: vehicle?.id ?? null,
    vehicleNo: position.vehicleNo,
    // Empty when the provider reports a bus this school has no record of.
    vehicleCode: vehicle?.vehicleCode ?? '',
    registrationNumber: vehicle?.registrationNumber ?? position.vehicleNo,
    driver: vehicle?.driverAssignments[0]?.driver?.fullName ?? 'Unassigned',
    route: vehicle?.route ?? '',
    imei: position.imei ?? '',
    latitude: Number(position.latitude),
    longitude: Number(position.longitude),
    speed: Number(position.speed),
    ignition: Boolean(position.ignition),
    direction: position.direction ?? 0,
    status: position.status ?? '',
    odometer: position.odometer === null ? 0 : Number(position.odometer),
    reportedAt: reportedAt.toISOString(),
    // How old the provider's own reading is. A client showing a bus on a map
    // needs this to tell a live position from a parked or stale one.
    ageMs: Date.now() - reportedAt.getTime()
  };
}

/** Resolves "BUS-01", "RJ14HC7365" or "RJ 14 HC 7365" to one vehicle. */
async function resolveVehicle(value: string) {
  const text = value.trim();
  if (!text) throw new ApiError(400, 'vehicle is required');
  const vehicle = await prisma.vehicle.findFirst({
    where: { OR: [{ vehicleCode: text }, { registrationNumber: text }] },
    select: vehicleSelect
  });
  // Fall back to a punctuation-insensitive match, since the office may store a
  // plate with spaces the caller did not type.
  if (vehicle) return { vehicle, plate: plateKey(vehicle.registrationNumber) };
  const all = await prisma.vehicle.findMany({ select: vehicleSelect });
  const key = plateKey(text);
  const loose = all.find(item => plateKey(item.registrationNumber) === key || plateKey(item.vehicleCode) === key);
  return { vehicle: loose ?? null, plate: loose ? plateKey(loose.registrationNumber) : key };
}

export class GpsService {
  /** Latest stored position for every vehicle the provider reports. */
  static async vehicles() {
    // One row per vehicle_no, the newest. distinct on an ordered query is
    // served by the (vehicle_no, reported_at) index.
    const positions = await prisma.vehiclePosition.findMany({
      distinct: ['vehicleNo'],
      orderBy: [{ vehicleNo: 'asc' }, { reportedAt: 'desc' }],
      include: { vehicle: { select: vehicleSelect } }
    });

    const rows = positions.map(position => shape(position, position.vehicle as VehicleRef | null));
    return {
      fetchedAt: new Date().toISOString(),
      total: rows.length,
      matched: rows.filter(row => row.vehicleCode).length,
      poller: GpsPoller.status,
      vehicles: rows
    };
  }

  /**
   * Latest position for specific vehicles only.
   *
   * The parent portal uses this so a parent receives the bus their own child
   * rides and nothing else -- the whole-fleet endpoint is for staff.
   */
  static async forVehicleIds(vehicleIds: number[]) {
    if (!vehicleIds.length) return [];
    const positions = await prisma.vehiclePosition.findMany({
      where: { vehicleId: { in: vehicleIds } },
      distinct: ['vehicleNo'],
      orderBy: [{ vehicleNo: 'asc' }, { reportedAt: 'desc' }],
      include: { vehicle: { select: vehicleSelect } }
    });
    return positions.map(position => shape(position, position.vehicle as VehicleRef | null));
  }

  /** Latest stored position for one vehicle, by code or registration number. */
  static async vehicle(value: string) {
    const { vehicle, plate } = await resolveVehicle(value);
    const position = await prisma.vehiclePosition.findFirst({
      where: { vehicleNo: plate },
      orderBy: { reportedAt: 'desc' }
    });

    if (!position) {
      // Distinguish "we do not know this bus" from "we know it but the
      // provider has never reported it", which are different problems.
      throw new ApiError(404, vehicle
        ? `No GPS position stored for ${vehicle.vehicleCode}. The provider has not reported this vehicle yet.`
        : `No vehicle or GPS position found for "${value}"`);
    }
    return shape(position, vehicle);
  }

  /** Position history for one vehicle, oldest first, for replaying a route. */
  static async history(value: string, filters: { from?: string; to?: string; limit?: string }) {
    const { vehicle, plate } = await resolveVehicle(value);

    const where: any = { vehicleNo: plate };
    if (filters.from || filters.to) {
      where.reportedAt = {};
      if (filters.from) {
        const from = new Date(filters.from);
        if (Number.isNaN(from.getTime())) throw new ApiError(400, 'from is not a valid date');
        where.reportedAt.gte = from;
      }
      if (filters.to) {
        const to = new Date(filters.to);
        if (Number.isNaN(to.getTime())) throw new ApiError(400, 'to is not a valid date');
        where.reportedAt.lte = to;
      }
    }

    const limit = Math.min(Math.max(Number(filters.limit ?? 500), 1), 5000);
    // Newest first from the index, then reversed: taking the most recent N is
    // what a caller wants when the window holds more than the limit.
    const positions = await prisma.vehiclePosition.findMany({
      where,
      orderBy: { reportedAt: 'desc' },
      take: limit
    });

    return {
      vehicle: vehicle
        ? { id: vehicle.id, code: vehicle.vehicleCode, registrationNumber: vehicle.registrationNumber }
        : { id: null, code: '', registrationNumber: plate },
      count: positions.length,
      limit,
      positions: positions.reverse().map(position => shape(position, vehicle))
    };
  }
}
