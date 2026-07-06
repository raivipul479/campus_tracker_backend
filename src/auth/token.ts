import crypto from 'node:crypto';
import { config } from '../config.js';

interface TokenPayload {
  sub: number;
  email: string;
  role: 'super_admin';
  exp: number;
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string) {
  return crypto
    .createHmac('sha256', config.auth.tokenSecret)
    .update(data)
    .digest('base64url');
}

export function createAuthToken(admin: { id: number; email: string }) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    sub: admin.id,
    email: admin.email,
    role: 'super_admin',
    exp: Math.floor(Date.now() / 1000) + config.auth.tokenTtlSeconds
  } satisfies TokenPayload));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyAuthToken(token: string): TokenPayload {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    throw new Error('Invalid token');
  }

  const unsigned = `${header}.${payload}`;
  const expected = sign(unsigned);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid token');
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
  if (parsed.role !== 'super_admin' || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Invalid token');
  }

  return parsed;
}
