import mysql, { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60_000,
  enableKeepAlive: true
});

export type DbConnection = typeof pool | PoolConnection;
export type SqlParam = string | number | boolean | Date | Buffer | null;

export async function rows<T extends RowDataPacket>(sql: string, params: SqlParam[] = [], db: DbConnection = pool) {
  const [result] = await db.query<T[]>(sql, params);
  return result;
}

export async function row<T extends RowDataPacket>(sql: string, params: SqlParam[] = [], db: DbConnection = pool) {
  const result = await rows<T>(sql, params, db);
  return result[0] ?? null;
}

export async function execute(sql: string, params: SqlParam[] = [], db: DbConnection = pool) {
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result;
}

export async function transaction<T>(callback: (connection: PoolConnection) => Promise<T>) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
