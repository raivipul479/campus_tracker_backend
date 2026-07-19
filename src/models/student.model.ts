import { Prisma } from '@prisma/client';
import { StudentRow } from '../mappers.js';
import { prisma } from '../prisma.js';

export interface StudentPayload {
  serialNumber: string | null;
  registrationNumber: string;
  name: string;
  className: string;
  distanceKm: number | string | null;
  tagNo: string | null;
  area: string;
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
        distanceKm: payload.distanceKm === null ? null : payload.distanceKm,
        tagNo: payload.tagNo,
        area: payload.area,
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
        distanceKm: payload.distanceKm === null ? null : payload.distanceKm,
        tagNo: payload.tagNo,
        area: payload.area,
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
      include: { route: { include: { vehicle: true } } },
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
    distance_km: student.distanceKm === null ? null : Number(student.distanceKm),
    tag_no: student.tagNo,
    area: student.area,
    phone: student.phone,
    secondary_phone: student.secondaryPhone,
    vehicle_id: vehicle?.id ?? null,
    vehicle_code: vehicle?.vehicleCode ?? null,
    route_id: route?.id ?? null,
    route_code: route?.routeCode ?? null,
    route_name: route?.name ?? null,
    route_fee: route?.fee ?? 0
  };
}
