import { RowDataPacket } from 'mysql2';
import { DbConnection, row } from './db.js';
import { ApiError } from './errors.js';

interface IdRow extends RowDataPacket {
  id: number;
}

export async function resolveVehicleId(identifier: unknown, db?: DbConnection) {
  if (identifier === undefined || identifier === null || identifier === '') {
    throw new ApiError(400, 'vehicleId is required');
  }

  const value = String(identifier).trim();
  const record = /^\d+$/.test(value)
    ? await row<IdRow>('SELECT id FROM vehicles WHERE id = ?', [Number(value)], db)
    : await row<IdRow>('SELECT id FROM vehicles WHERE vehicle_code = ?', [value], db);

  if (!record) {
    throw new ApiError(404, 'Vehicle not found');
  }

  return record.id;
}

export async function ensureRecord(table: 'students' | 'drivers', id: number, db?: DbConnection) {
  const record = await row<IdRow>(`SELECT id FROM ${table} WHERE id = ?`, [id], db);
  if (!record) {
    throw new ApiError(404, `${table.slice(0, -1)} not found`);
  }
  return record.id;
}
