import dotenv from 'dotenv';

const nodeEnv = process.env.NODE_ENV ?? 'development';
dotenv.config({ path: `.env.${nodeEnv}` });
dotenv.config();

const numberFromEnv = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
};

const DEFAULT_TOKEN_SECRET = 'change-this-secret-before-production';
const DEFAULT_SUPER_ADMIN_PASSWORD = 'Admin@12345';
const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

const tokenSecret = process.env.AUTH_TOKEN_SECRET ?? DEFAULT_TOKEN_SECRET;
const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD ?? DEFAULT_SUPER_ADMIN_PASSWORD;

if (isProduction && tokenSecret === DEFAULT_TOKEN_SECRET) {
  throw new Error(
    'AUTH_TOKEN_SECRET must be set to a strong, unique value in production. Refusing to start with the default secret.'
  );
}
if (isProduction && superAdminPassword === DEFAULT_SUPER_ADMIN_PASSWORD) {
  throw new Error(
    'SUPER_ADMIN_PASSWORD must be set to a strong, unique value in production. Refusing to start with the default password.'
  );
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction,
  port: numberFromEnv('PORT', 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173',
  auth: {
    tokenSecret,
    tokenTtlSeconds: numberFromEnv('AUTH_TOKEN_TTL_SECONDS', 60 * 60 * 8),
    defaultSuperAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? 'admin@campus.local',
    defaultSuperAdminPassword: superAdminPassword,
    defaultSuperAdminName: process.env.SUPER_ADMIN_NAME ?? 'Super Admin'
  },
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: numberFromEnv('DB_PORT', 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'campus_tracker'
  }
};
