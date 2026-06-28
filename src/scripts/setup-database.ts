import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

async function runSqlFile(connection: mysql.Connection, filePath: string) {
  const sql = await fs.readFile(filePath, 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function main() {
  const databaseDir = path.resolve('database');
  const adminConnection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password
  });

  await adminConnection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await adminConnection.end();

  const appConnection = await mysql.createConnection(config.db);
  await runSqlFile(appConnection, path.join(databaseDir, 'schema.sql'));
  await runSqlFile(appConnection, path.join(databaseDir, 'seed.sql'));
  await appConnection.end();

  console.log(`Database ${config.db.database} is ready.`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
