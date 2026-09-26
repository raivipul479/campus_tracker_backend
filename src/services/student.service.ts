import { ApiError } from '../errors.js';
import { mapStudent, StudentRow } from '../mappers.js';
import { StudentFilters, StudentModel, StudentSortKey } from '../models/student.model.js';
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

// The admin table's column keys (see mapStudent) to sortable database fields.
const sortFields: Record<string, StudentSortKey> = {
  name: 'fullName',
  regNo: 'registrationNumber',
  f: 'serialNumber',
  class: 'className',
  section: 'section',
  branch: 'branch',
  onHold: 'onHold',
  guardianName: 'guardianName',
  kms: 'distanceKm',
  tagNo: 'tagNo',
  area: 'area',
  address: 'address',
  phone: 'phone',
  secondaryPhone: 'secondaryPhone'
};

const MAX_PAGE_SIZE = 200;

export class StudentService {
  static async list(filters: StudentFilters) {
    const students = await StudentModel.findAll(filters);
    return students.map(mapStudent);
  }

  /**
   * One page of students for scroll-to-load: `{ rows, total, offset, limit,
   * nextOffset }`, where nextOffset is null once the last page is reached.
   * `sort` is an admin column key (name, regNo, class, ...), `dir` asc or desc.
   */
  static async page(filters: StudentFilters, query: { limit?: string; offset?: string; sort?: string; dir?: string }) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ApiError(400, `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, 'offset must be a non-negative integer');

    const sortKey = query.sort ?? 'name';
    const sort = sortFields[sortKey];
    if (!sort) throw new ApiError(400, `Cannot sort students by ${sortKey}`);
    const dir = query.dir === 'desc' ? 'desc' : 'asc';

    const { total, rows } = await StudentModel.findPage(filters, { limit, offset, sort, dir });
    const nextOffset = offset + rows.length < total ? offset + rows.length : null;
    return { rows: rows.map(mapStudent), total, offset, limit, nextOffset };
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
  const section = optionalString(data, ['section']) ?? existing?.section ?? null;
  const guardianName = optionalString(data, ['guardianName', 'guardian_name', 'parentName']) ?? existing?.guardian_name ?? null;
  const tagNo = optionalString(data, ['tagNo', 'tag']) ?? existing?.tag_no ?? null;
  const area = validateText(requiredOrExisting(data, ['area'], 'area', existing?.area), 'area', { min: 2, max: 180 });
  // Full postal address. Optional, and separate from `area` (the short
  // locality), so existing callers that only send `area` keep working.
  const address = optionalString(data, ['address']) ?? existing?.address ?? null;

  // A held student disappears from the driver's roster and the driver can no
  // longer log a pickup or drop for them. Admin and parent views are unchanged.
  const onHoldInput = data.onHold ?? data.on_hold;
  const onHold = onHoldInput === undefined || onHoldInput === null || onHoldInput === ''
    ? (existing?.on_hold ?? false)
    : onHoldInput === true || onHoldInput === 'true' || onHoldInput === 1 || onHoldInput === '1' || onHoldInput === 'Yes';

  // JPIS / JPS — required, because the parent app switches its payment button
  // on this and a student with no branch gets no button at all.
  //
  // The column stays nullable at the database level: students created by the
  // bulk sheet import have no branch (the sheet has no such column), and making
  // it NOT NULL would reject them outright. Required is enforced here and in
  // the admin form instead.
  const branch = validateBranch(
    requiredOrExisting(data, ['branch'], 'branch', existing?.branch ?? undefined)
  );
  const phone = validateStudentPhone(requiredOrExisting(data, ['phone'], 'phone', existing?.phone), 'phone');
  const secondaryPhoneInput = optionalString(data, ['secondaryPhone', 'secondary_phone']) ?? existing?.secondary_phone ?? null;
  const secondaryPhone = secondaryPhoneInput ? validateStudentPhone(secondaryPhoneInput, 'secondary phone') : null;
  if (serialNumber) validateText(serialNumber, 'serial number', { max: 32 });
  if (tagNo) validateText(tagNo, 'tag number', { max: 32 });
  if (section) validateText(section, 'section', { max: 16 });
  if (guardianName) validateText(guardianName, "father's / mother's name", { max: 160 });
  if (address) validateText(address, 'address', { max: 255 });
  // The fee sheet's E-Mail Address. Not validated beyond shape and length —
  // siblings share a parent's address, and rejecting an odd-looking one would
  // block importing a sheet the office already treats as correct.
  const emailInput = optionalString(data, ['email']) ?? existing?.email ?? null;
  const email = emailInput ? emailInput.trim() : null;
  if (email) {
    validateText(email, 'email', { max: 190 });
    if (!email.includes('@')) throw new ApiError(400, 'email must contain @');
  }
  return {
    serialNumber,
    registrationNumber,
    name,
    className,
    section,
    guardianName,
    distanceKm: optionalBoundedNumber(data, ['kms', 'distanceKm'], 'kilometers', { min: 0, max: 500 }) ?? existing?.distance_km ?? null,
    tagNo,
    area,
    address,
    onHold,
    branch,
    phone,
    secondaryPhone,
    email
  };
}

function validateStudentPhone(value: string, label: string) {
  return validatePhone(value, label);
}

const BRANCHES = ['JPIS', 'JPS'] as const;

function validateBranch(value: string) {
  const branch = value.trim().toUpperCase();
  if (!BRANCHES.includes(branch as (typeof BRANCHES)[number])) {
    throw new ApiError(400, `branch must be one of ${BRANCHES.join(', ')}`);
  }
  return branch;
}
