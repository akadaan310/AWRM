import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export type IdSource = (prefix: string) => string;

export function randomId(prefix: string, length = 16): string {
  const bytes = randomBytes(length);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return `${prefix}_${s}`;
}

/** Deterministic id source for reproducible experiments and tests. */
export function sequentialIds(seed = 0): IdSource {
  let n = seed;
  return (prefix) => `${prefix}_${String(++n).padStart(8, '0')}`;
}
