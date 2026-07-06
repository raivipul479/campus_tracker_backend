import crypto from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const { hash } = hashPassword(password, salt);
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
