import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Jeton aléatoire en base64url (sessions, secrets imprimés, références publiques). */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/** Comparaison en temps constant de deux chaînes (évite les attaques par mesure de temps). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Sérialisation JSON stable (clés triées) pour calculer des clés de cache. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
