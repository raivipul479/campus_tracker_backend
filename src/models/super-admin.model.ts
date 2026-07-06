import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { config } from '../config.js';
import { execute, row } from '../db.js';
import { hashPassword } from '../auth/password.js';

export interface SuperAdmin {
  id: number;
  email: string;
  fullName: string;
  passwordHash: string;
  passwordSalt: string;
  isActive: number;
}

interface SuperAdminRow extends RowDataPacket {
  id: number;
  email: string;
  full_name: string;
  password_hash: string;
  password_salt: string;
  is_active: number;
}

function mapSuperAdmin(record: SuperAdminRow): SuperAdmin {
  return {
    id: record.id,
    email: record.email,
    fullName: record.full_name,
    passwordHash: record.password_hash,
    passwordSalt: record.password_salt,
    isActive: record.is_active
  };
}

export class SuperAdminModel {
  static async findByEmail(email: string) {
    const admin = await row<SuperAdminRow>(
      'SELECT * FROM super_admins WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    return admin ? mapSuperAdmin(admin) : null;
  }

  static async findById(id: number) {
    const admin = await row<SuperAdminRow>(
      'SELECT * FROM super_admins WHERE id = ? LIMIT 1',
      [id]
    );
    return admin ? mapSuperAdmin(admin) : null;
  }

  static async recordLogin(id: number) {
    await execute(
      'UPDATE super_admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
  }

  static async ensureDefaultAdmin() {
    const existing = await SuperAdminModel.findByEmail(config.auth.defaultSuperAdminEmail);
    if (existing) return existing;

    const { hash, salt } = hashPassword(config.auth.defaultSuperAdminPassword);
    const result = await execute(
      `INSERT INTO super_admins (email, full_name, password_hash, password_salt)
       VALUES (?, ?, ?, ?)`,
      [
        config.auth.defaultSuperAdminEmail.trim().toLowerCase(),
        config.auth.defaultSuperAdminName,
        hash,
        salt
      ]
    ) as ResultSetHeader;

    return SuperAdminModel.findById(result.insertId);
  }
}
