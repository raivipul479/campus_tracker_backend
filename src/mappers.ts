export function initialsFor(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function toneForVehicle(status: string) {
  if (status === 'On route') return 'green';
  if (status === 'At school') return 'blue';
  return 'gray';
}

export interface StudentRow {
  id: number;
  serial_number: string | null;
  registration_number: string;
  full_name: string;
  class_name: string;
  distance_km: string | number | null;
  tag_no: string | null;
  area: string;
  phone: string;
  secondary_phone: string | null;
  vehicle_code?: string | null;
  vehicle_id?: number | null;
  route_id?: number | null;
  route_code?: string | null;
  route_name?: string | null;
}

export interface DriverRow {
  id: number;
  full_name: string;
  phone: string;
  license_number: string | null;
  status: string;
  docs_status: string;
  route: string | null;
  vehicle_code?: string | null;
  vehicle_id?: number | null;
}

export interface VehicleRow {
  id: number;
  vehicle_code: string;
  registration_number: string;
  route: string | null;
  status: string;
  speed_kmh: string | number;
  map_x: string | number;
  map_y: string | number;
  driver_name?: string | null;
  driver_id?: number | null;
  student_count?: number | string;
}

export function mapStudent(row: StudentRow) {
  return {
    studentId: row.id,
    id: row.id,
    f: row.serial_number ?? '',
    regNo: row.registration_number,
    name: row.full_name,
    class: row.class_name,
    kms: row.distance_km === null ? '' : String(row.distance_km),
    tagNo: row.tag_no ?? '',
    area: row.area,
    phone: row.phone,
    secondaryPhone: row.secondary_phone ?? '',
    vehicleId: row.vehicle_id ?? null,
    vehicle: row.vehicle_code ?? 'Unassigned',
    routeId: row.route_id ?? null,
    routeCode: row.route_code ?? null,
    route: row.route_code ?? '',
    routeName: row.route_name ?? '',
    initials: initialsFor(row.full_name)
  };
}

export interface RouteRow {
  id: number;
  route_code: string;
  name: string;
  description: string | null;
  vehicle_id?: number | null;
  vehicle_code?: string | null;
  student_count?: number | string;
}

export function mapRoute(row: RouteRow) {
  return {
    routeId: row.id,
    id: row.route_code,
    code: row.route_code,
    name: row.name,
    description: row.description ?? '',
    vehicleId: row.vehicle_id ?? null,
    vehicle: row.vehicle_code ?? 'Not assigned',
    students: Number(row.student_count ?? 0)
  };
}

export function mapDriver(row: DriverRow) {
  return {
    driverId: row.id,
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    licenseNumber: row.license_number,
    vehicleId: row.vehicle_id ?? null,
    vehicle: row.vehicle_code ?? 'Unassigned',
    route: row.route ?? '-',
    status: row.status,
    docs: row.docs_status,
    initials: initialsFor(row.full_name)
  };
}

export function mapVehicle(row: VehicleRow) {
  return {
    vehicleId: row.id,
    id: row.vehicle_code,
    code: row.vehicle_code,
    plate: row.registration_number,
    driverId: row.driver_id ?? null,
    driver: row.driver_name ?? 'Unassigned',
    route: row.route ?? '-',
    speed: Number(row.speed_kmh),
    status: row.status,
    students: Number(row.student_count ?? 0),
    tone: toneForVehicle(row.status),
    x: Number(row.map_x),
    y: Number(row.map_y)
  };
}
