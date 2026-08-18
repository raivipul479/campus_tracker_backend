import { Prisma } from '@prisma/client';
import { StudentRow } from '../mappers.js';
import { prisma } from '../prisma.js';

export interface StudentPayload {
  serialNumber: string | null;
  registrationNumber: string;
  name: string;
  className: string;
  section: string | null;
  guardianName: string | null;
  distanceKm: number | string | null;
  tagNo: string | null;
  area: string;
  address: string | null;
  onHold: boolean;
  branch: string | null;
  phone: string;
  secondaryPhone: string | null;
}

export class StudentModel {
  static async findAll(filters: { q?: string; vehicleId?: string; routeId?: string; assigned?: string; className?: string; tagNo?: string; phone?: string }) {
    const vehicleFilter = filters.vehicleId
      ? {
          routeAssignments: {
            some: {
              unassignedAt: null,
              route: {
                vehicle: /^\d+$/.test(filters.vehicleId)
                  ? { id: Number(filters.vehicleId) }
                  : { vehicleCode: filters.vehicleId }
              }
            }
          }
        }
      : {};

    const routeFilter = filters.routeId
      ? {
          routeAssignments: {
            some: {
              unassignedAt: null,
              route: /^\d+$/.test(filters.routeId)
                ? { id: Number(filters.routeId) }
                : { routeCode: filters.routeId }
            }
          }
        }
      : {};

    const assignmentFilter =
      filters.assigned === 'assigned'
        ? { routeAssignments: { some: { unassignedAt: null } } }
        : filters.assigned === 'unassigned'
          ? { routeAssignments: { none: { unassignedAt: null } } }
          : {};

    const students = await prisma.student.findMany({
      where: {
        ...vehicleFilter,
        ...routeFilter,
        ...assignmentFilter,
        ...(filters.className ? { className: filters.className } : {}),
        ...(filters.tagNo ? { tagNo: filters.tagNo } : {}),
        ...(filters.phone ? { AND: [{ OR: [{ phone: filters.phone }, { secondaryPhone: filters.phone }] }] } : {}),
        ...(filters.q
          ? {
              OR: [
                { fullName: { contains: filters.q } },
                { registrationNumber: { contains: filters.q } },
                { area: { contains: filters.q } },
                { address: { contains: filters.q } },
                { guardianName: { contains: filters.q } },
                { tagNo: { contains: filters.q } },
                { phone: { contains: filters.q } }
              ]
            }
          : {})
      },
      include: activeVehicleInclude(),
      orderBy: { fullName: 'asc' }
    });

    return students.map(mapStudentRecord);
  }

  static async findById(id: number) {
    const student = await prisma.student.findUnique({
      where: { id },
      include: activeVehicleInclude()
    });
    return student ? mapStudentRecord(student) : null;
  }

  static async findRawById(id: number) {
    const student = await prisma.student.findUnique({ where: { id } });
    return student ? mapStudentRecord(student) : null;
  }

  static async create(payload: StudentPayload) {
    const student = await prisma.student.create({
      data: {
        serialNumber: payload.serialNumber,
        registrationNumber: payload.registrationNumber,
        fullName: payload.name,
        className: payload.className,
        section: payload.section,
        guardianName: payload.guardianName,
        distanceKm: payload.distanceKm === null ? null : payload.distanceKm,
        tagNo: payload.tagNo,
        area: payload.area,
        address: payload.address,
        onHold: payload.onHold,
        branch: (payload.branch as any) ?? null,
        phone: payload.phone,
        secondaryPhone: payload.secondaryPhone
      },
      include: activeVehicleInclude()
    });

    return mapStudentRecord(student);
  }

  static async update(id: number, payload: StudentPayload) {
    const student = await prisma.student.update({
      where: { id },
      data: {
        serialNumber: payload.serialNumber,
        registrationNumber: payload.registrationNumber,
        fullName: payload.name,
        className: payload.className,
        section: payload.section,
        guardianName: payload.guardianName,
        distanceKm: payload.distanceKm === null ? null : payload.distanceKm,
        tagNo: payload.tagNo,
        area: payload.area,
        address: payload.address,
        onHold: payload.onHold,
        branch: (payload.branch as any) ?? null,
        phone: payload.phone,
        secondaryPhone: payload.secondaryPhone
      },
      include: activeVehicleInclude()
    });

    return mapStudentRecord(student);
  }

  static async delete(id: number) {
    try {
      await prisma.student.delete({ where: { id } });
      return { affectedRows: 1 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return { affectedRows: 0, conflict: true };
      }
      return { affectedRows: 0 };
    }
  }
}

function activeVehicleInclude() {
  return {
    routeAssignments: {
      where: { unassignedAt: null },
      include: { route: { include: { vehicle: true } }, slab: true },
      take: 1
    }
  } as const;
}

function mapStudentRecord(student: any): StudentRow {
  const assignment = student.routeAssignments?.[0];
  const route = assignment?.route;
  const vehicle = route?.vehicle;
  return {
    id: student.id,
    serial_number: student.serialNumber,
    registration_number: student.registrationNumber,
    full_name: student.fullName,
    class_name: student.className,
    section: student.section ?? null,
    guardian_name: student.guardianName ?? null,
    distance_km: student.distanceKm === null ? null : Number(student.distanceKm),
    tag_no: student.tagNo,
    area: student.area,
    address: student.address ?? null,
    on_hold: Boolean(student.onHold),
    branch: student.branch ?? null,
    phone: student.phone,
    secondary_phone: student.secondaryPhone,
    vehicle_id: vehicle?.id ?? null,
    vehicle_code: vehicle?.vehicleCode ?? null,
    route_id: route?.id ?? null,
    route_code: route?.routeCode ?? null,
    route_name: route?.name ?? null,
    // The slab the student is billed on. Its fee, not the route's, is what they
    // owe; the route fee applies only to routes with no slabs.
    slab_id: assignment?.slab?.id ?? null,
    slab_min_km: assignment?.slab ? Number(assignment.slab.minKm) : null,
    slab_max_km: assignment?.slab ? Number(assignment.slab.maxKm) : null,
    route_fee: assignment?.slab?.fee ?? route?.fee ?? 0
  };
}
