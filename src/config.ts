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
  gps: {
    // Proxied server-side: the provider sends no CORS headers, and this
    // credential must not reach the browser bundle.
    baseUrl: process.env.GPS_API_BASE_URL ?? '',
    username: process.env.GPS_API_USERNAME ?? '',
    timeoutMs: numberFromEnv('GPS_API_TIMEOUT_MS', 10000),
    // The provider rejects a second call inside a minute, so never go below it.
    // Above the provider's one-call-per-minute limit, with margin.
    pollMs: numberFromEnv('GPS_POLL_MS', 66000),
    pollEnabled: (process.env.GPS_POLL_ENABLED ?? 'true') !== 'false',
    retentionDays: numberFromEnv('GPS_RETENTION_DAYS', 30)
  },
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: numberFromEnv('DB_PORT', 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'campus_tracker'
  },
  firebase: {
    // Path to the service-account JSON file, OR the full JSON as a string
    // (or base64-encoded JSON). If neither is set, push sending is disabled
    // and the app still runs — notifications are just stored, not delivered.
    serviceAccount:
      process.env.FIREBASE_SERVICE_ACCOUNT ??
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
      ''
  }
};
