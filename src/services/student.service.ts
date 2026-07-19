import { ApiError } from '../errors.js';
import { mapStudent, StudentRow } from '../mappers.js';
import { StudentModel } from '../models/student.model.js';
import {
  Body,
  optionalBoundedNumber,
  optionalString,
  positiveId,
  requiredOrExisting,
  validatePhone,
  validateRegistrationNumber,
  validateText
} from '../validators.js';

export class StudentService {
  static async list(filters: { q?: string; vehicleId?: string; routeId?: string; assigned?: string; className?: string; tagNo?: string; phone?: string }) {
    const students = await StudentModel.findAll(filters);
    return students.map(mapStudent);
  }

  static async getById(idValue: unknown) {
    const id = positiveId(idValue, 'student id');
    const student = await StudentModel.findById(id);
    if (!student) throw new ApiError(404, 'Student not found');
    return mapStudent(student);
  }

  static async create(data: Body) {
    const payload = studentPayload(data);
    const created = await StudentModel.create(payload);
    return mapStudent(created!);
  }

  static async update(idValue: unknown, data: Body) {
    const id = positiveId(idValue, 'student id');
    const existing = await StudentModel.findRawById(id);
    if (!existing) throw new ApiError(404, 'Student not found');

    const payload = studentPayload(data, existing);
    const updated = await StudentModel.update(id, payload);
    return mapStudent(updated!);
  }

  static async delete(idValue: unknown) {
    const id = positiveId(idValue, 'student id');
    const result = await StudentModel.delete(id);
    if ('conflict' in result && result.conflict) {
      throw new ApiError(409, 'Student has retained billing or transport history and cannot be hard-deleted');
    }
    if (!result.affectedRows) throw new ApiError(404, 'Student not found');
  }
}

function studentPayload(data: Body, existing?: StudentRow) {
  const serialNumber = optionalString(data, ['f', 'serialNumber']) ?? existing?.serial_number ?? null;
  const registrationNumber = validateRegistrationNumber(requiredOrExisting(data, ['regNo', 'registrationNumber'], 'registration number', existing?.registration_number));
  const name = validateText(requiredOrExisting(data, ['name', 'fullName'], 'student name', existing?.full_name), 'student name', { min: 2, max: 160 });
  const className = validateText(requiredOrExisting(data, ['class', 'className'], 'class', existing?.class_name), 'class', { min: 1, max: 80 });
  const tagNo = optionalString(data, ['tagNo', 'tag']) ?? existing?.tag_no ?? null;
  const area = validateText(requiredOrExisting(data, ['area'], 'area', existing?.area), 'area', { min: 2, max: 180 });
  const phone = validateStudentPhone(requiredOrExisting(data, ['phone'], 'phone', existing?.phone), 'phone');
  const secondaryPhoneInput = optionalString(data, ['secondaryPhone', 'secondary_phone']) ?? existing?.secondary_phone ?? null;
  const secondaryPhone = secondaryPhoneInput ? validateStudentPhone(secondaryPhoneInput, 'secondary phone') : null;
  if (serialNumber) validateText(serialNumber, 'serial number', { max: 32 });
  if (tagNo) validateText(tagNo, 'tag number', { max: 32 });
  return {
    serialNumber,
    registrationNumber,
    name,
    className,
    distanceKm: optionalBoundedNumber(data, ['kms', 'distanceKm'], 'kilometers', { min: 0, max: 500 }) ?? existing?.distance_km ?? null,
    tagNo,
    area,
    phone,
    secondaryPhone
  };
}

function validateStudentPhone(value: string, label: string) {
  return validatePhone(value, label);
}
