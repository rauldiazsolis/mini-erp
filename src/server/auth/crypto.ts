import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, key] = parts;
  if (salt === undefined || key === undefined) {
    return false;
  }
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = scryptSync(password, salt, keyBuffer.length);
  return timingSafeEqual(keyBuffer, derivedKey);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function generatePosApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const random = randomBytes(24).toString('base64url');
  const rawKey = `mpos_${random}`;
  const keyPrefix = rawKey.slice(0, 10);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyPrefix, keyHash };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}
