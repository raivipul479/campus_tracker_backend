import { prisma } from '../prisma.js';

export class DashboardModel {
  static async healthCheck() {
    await prisma.$queryRaw`SELECT 1 AS ok`;
  }

  static async stats() {
    const [students, drivers, vehicles, routes, activeDriverAssignments, activeStudentAssignments] = await Promise.all([
      prisma.student.count(),
      prisma.driver.count(),
      prisma.vehicle.count(),
      prisma.transportRoute.count(),
      prisma.driverVehicleAssignment.count({ where: { unassignedAt: null } }),
      prisma.studentRouteAssignment.count({ where: { unassignedAt: null } })
    ]);

    return {
      students,
      drivers,
      vehicles,
      routes,
      activeDriverAssignments,
      activeStudentAssignments
    };
  }
}
