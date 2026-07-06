import { ApiError } from './errors.js';

export type Body = Record<string, unknown>;

export function body(reqBody: unknown): Body {
  if (!reqBody || typeof reqBody !== 'object' || Array.isArray(reqBody)) {
    throw new ApiError(400, 'Request body must be an object');
  }
  return reqBody as Body;
}

export function requiredString(data: Body, keys: string[], label: string) {
  const value = optionalString(data, keys);
  if (!value) {
    throw new ApiError(400, `${label} is required`);
  }
  return value;
}

export function requiredOrExisting(
  data: Body,
  keys: string[],
  label: string,
  existing?: string | null
) {
  const value = optionalString(data, keys);
  if (value) return value;
  if (existing) return existing;
  return requiredString(data, keys, label);
}

export function optionalString(data: Body, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;
    return String(value).trim();
  }
  return null;
}

export function optionalNumber(data: Body, keys: string[]) {
  const value = optionalString(data, keys);
  if (value === null) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new ApiError(400, `${keys[0]} must be a number`);
  }
  return parsed;
}

export function optionalBoundedNumber(
  data: Body,
  keys: string[],
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
) {
  const value = optionalNumber(data, keys);
  if (value === null) return null;
  assertNumberRange(value, label, options);
  return value;
}

export function assertNumberRange(
  value: number,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
) {
  if (options.integer && !Number.isInteger(value)) {
    throw new ApiError(400, `${label} must be a whole number`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ApiError(400, `${label} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new ApiError(400, `${label} must be at most ${options.max}`);
  }
}

export function validateText(value: string, label: string, options: { min?: number; max?: number; pattern?: RegExp } = {}) {
  if (options.min !== undefined && value.length < options.min) {
    throw new ApiError(400, `${label} must be at least ${options.min} characters`);
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new ApiError(400, `${label} must be at most ${options.max} characters`);
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw new ApiError(400, `${label} has an invalid format`);
  }
  return value;
}

export function validatePhone(value: string, label = 'phone') {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // This deployment is India-based. Local 10-digit numbers are stored as E.164.
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new ApiError(400, `${label} must contain 10 to 15 digits`);
  }
  return `+${digits}`;
}

export function validateVehicleCode(value: string) {
  return validateText(value.toUpperCase(), 'vehicle code', {
    min: 3,
    max: 32,
    pattern: /^[A-Z0-9][A-Z0-9-]*$/
  });
}

export function validateRegistrationNumber(value: string) {
  return validateText(value, 'registration number', { min: 3, max: 64 });
}

export function enumValue<T extends string>(data: Body, keys: string[], allowed: readonly T[], fallback: T) {
  const value = optionalString(data, keys);
  if (!value) return fallback;
  if (!allowed.includes(value as T)) {
    throw new ApiError(400, `${keys[0]} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function positiveId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${label} must be a positive integer`);
  }
  return id;
}
