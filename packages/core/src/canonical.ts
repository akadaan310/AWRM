/**
 * Canonical JSON (RFC 8785-compatible for AWRM's value space: objects, arrays,
 * strings, finite numbers, booleans, null) and SHA-256 digests.
 * `undefined` object members are omitted; non-finite numbers are rejected.
 */
import { createHash } from 'node:crypto';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(v: unknown, seen: Set<unknown>): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number');
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (seen.has(v)) throw new TypeError('canonicalJson: cycle');
      seen.add(v);
      let out: string;
      if (Array.isArray(v)) {
        out = '[' + v.map((x) => (x === undefined ? 'null' : serialize(x, seen))).join(',') + ']';
      } else {
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort(compareUtf16);
        out = '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(obj[k], seen)).join(',') + '}';
      }
      seen.delete(v);
      return out;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`);
  }
}

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256:<hex>` digest of the canonical JSON of a value. */
export function digest(value: unknown): string {
  return 'sha256:' + sha256Hex(canonicalJson(value));
}

export function isDigest(s: unknown): s is string {
  return typeof s === 'string' && /^sha256:[0-9a-f]{64}$/.test(s);
}

/** Deep-freeze a JSON-like value (used for immutable Forms and DMU definitions). */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
