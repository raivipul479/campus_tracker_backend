import { DocsStatus, DriverStatus } from '@prisma/client';
import { DriverRow } from '../mappers.js';
import { prisma } from '../prisma.js';

export interface DriverPayload {
  name: string;
  phone: string;
  licenseNumber: string | null;
  status: string;
  docs: string;
  route: string | null;
}

export class DriverModel {
  static async findAll(filters: { q?: string; status?: string; docs?: string; vehicleId?: string }) {
    const drivers = await prisma.driver.findMany({
      where: {
        ...(filters.q
          ? {
            OR: [
              { fullName: { contains: filters.q } },
              { phone: { contains: filters.q } },
              { route: { contains: filters.q } },
              { vehicleAssignments: { some: { unassignedAt: null, vehicle: { vehicleCode: { contains: filters.q } } } } }
            ]
          }
          : {}),
        ...(filters.status ? { status: toDriverStatus(filters.status) } : {}),
        ...(filters.docs ? { docsStatus: toDocsStatus(filters.docs) } : {}),
        ...(filters.vehicleId
          ? {
              vehicleAssignments: {
                some: {
                  unassignedAt: null,
                  vehicle: /^\d+$/.test(filters.vehicleId)
                    ? { id: Number(filters.vehicleId) }
                    : { vehicleCode: filters.vehicleId }
                }
              }
            }
          : {})
      },
      include: activeVehicleInclude(),
      orderBy: { fullName: 'asc' }
    });

    return drivers.map(mapDriverRecord);
  }

  static async findById(id: number) {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: activeVehicleInclude()
    });
    return driver ? mapDriverRecord(driver) : null;
  }

  static async findRawById(id: number) {
    const driver = await prisma.driver.findUnique({ where: { id } });
    return driver ? mapDriverRecord(driver) : null;
  }

  static async create(payload: DriverPayload) {
    const driver = await prisma.driver.create({
      data: {
        fullName: payload.name,
        phone: payload.phone,
        licenseNumber: payload.licenseNumber,
        status: toDriverStatus(payload.status),
        docsStatus: toDocsStatus(payload.docs),
        route: payload.route
      },
      include: activeVehicleInclude()
    });

    return mapDriverRecord(driver);
  }

  static async update(id: number, payload: DriverPayload) {
    const driver = await prisma.driver.update({
      where: { id },
      data: {
        fullName: payload.name,
        phone: payload.phone,
        licenseNumber: payload.licenseNumber,
        status: toDriverStatus(payload.status),
        docsStatus: toDocsStatus(payload.docs),
        route: payload.route
      },
      include: activeVehicleInclude()
    });

    return mapDriverRecord(driver);
  }

  static async delete(id: number) {
    try {
      await prisma.driver.delete({ where: { id } });
      return { affectedRows: 1 };
    } catch {
      return { affectedRows: 0 };
    }
  }
}

export function toDriverStatus(status: string): DriverStatus {
  const map: Record<string, DriverStatus> = {
    'On duty': DriverStatus.On_duty,
    Available: DriverStatus.Available,
    'Off duty': DriverStatus.Off_duty,
    'At school': DriverStatus.At_school
  };
  return map[status] ?? DriverStatus.Available;
}

export function fromDriverStatus(status: DriverStatus | string) {
  const map: Record<string, string> = {
    On_duty: 'On duty',
    Available: 'Available',
    Off_duty: 'Off duty',
    At_school: 'At school'
  };
  return map[String(status)] ?? String(status);
}

export function toDocsStatus(status: string): DocsStatus {
  const map: Record<string, DocsStatus> = {
    Verified: DocsStatus.Verified,
    ExpiringSoon: DocsStatus.ExpiringSoon,
    Pending: DocsStatus.Pending,
    Expired: DocsStatus.Expired
  };
  return map[status] ?? DocsStatus.Pending;
}

function fromDocsStatus(status: DocsStatus | string) {
  const map: Record<string, string> = {
    Verified: 'Verified',
    ExpiringSoon: 'ExpiringSoon',
    Pending: 'Pending',
    Expired: 'Expired'
  };
  return map[String(status)] ?? String(status);
}

function activeVehicleInclude() {
  return {
    vehicleAssignments: {
      where: { unassignedAt: null },
      include: { vehicle: true },
      take: 1
    }
  } as const;
}

function mapDriverRecord(driver: any): DriverRow {
  const assignment = driver.vehicleAssignments?.[0];
  return {
    id: driver.id,
    full_name: driver.fullName,
    phone: driver.phone,
    license_number: driver.licenseNumber,
    status: fromDriverStatus(driver.status),
    docs_status: fromDocsStatus(driver.docsStatus),
    route: driver.route,
    vehicle_id: assignment?.vehicle.id ?? null,
    vehicle_code: assignment?.vehicle.vehicleCode ?? null
  };
}
