/**
 * A deliberately small JSON Schema (2020-12 subset) validator. AWRM owns it so
 * the kernel has zero runtime dependencies. Supported keywords are listed in
 * SUPPORTED; an unknown keyword is a schema error, never silently ignored.
 */
export interface JsonSchema {
  $id?: string;
  $schema?: string;
  title?: string;
  description?: string;
  type?: JsonType | JsonType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  examples?: unknown[];
  default?: unknown;
}
export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

const SUPPORTED = new Set([
  '$id', '$schema', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems',
  'maxItems', 'anyOf', 'examples', 'default',
]);

export interface SchemaError {
  path: string;
  message: string;
}
export interface ValidationResult {
  ok: boolean;
  errors: SchemaError[];
}

export function checkSchema(schema: JsonSchema, path = '#'): SchemaError[] {
  const errs: SchemaError[] = [];
  if (typeof schema !== 'object' || schema === null) return [{ path, message: 'schema must be an object' }];
  for (const k of Object.keys(schema)) if (!SUPPORTED.has(k)) errs.push({ path, message: `unsupported keyword "${k}"` });
  if (schema.pattern !== undefined) {
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      errs.push({ path, message: 'invalid pattern' });
    }
  }
  for (const [k, s] of Object.entries(schema.properties ?? {})) errs.push(...checkSchema(s, `${path}/properties/${k}`));
  if (schema.items) errs.push(...checkSchema(schema.items, `${path}/items`));
  if (typeof schema.additionalProperties === 'object') errs.push(...checkSchema(schema.additionalProperties, `${path}/additionalProperties`));
  (schema.anyOf ?? []).forEach((s, i) => errs.push(...checkSchema(s, `${path}/anyOf/${i}`)));
  return errs;
}

function typeOf(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v as JsonType;
}

function typeMatches(t: JsonType, v: unknown): boolean {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return t === actual;
}

export function validate(schema: JsonSchema, value: unknown): ValidationResult {
  const errors: SchemaError[] = [];
  walk(schema, value, '$', errors);
  return { ok: errors.length === 0, errors };
}

function walk(s: JsonSchema, v: unknown, path: string, errors: SchemaError[]): void {
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(t, v))) {
      errors.push({ path, message: `expected ${types.join('|')}, got ${typeOf(v)}` });
      return;
    }
  }
  if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(v)) errors.push({ path, message: 'const mismatch' });
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) errors.push({ path, message: `not in enum` });
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errors.push({ path, message: `< minimum ${s.minimum}` });
    if (s.maximum !== undefined && v > s.maximum) errors.push({ path, message: `> maximum ${s.maximum}` });
  }
  if (typeof v === 'string') {
    const len = [...v].length;
    if (s.minLength !== undefined && len < s.minLength) errors.push({ path, message: `shorter than ${s.minLength}` });
    if (s.maxLength !== undefined && len > s.maxLength) errors.push({ path, message: `longer than ${s.maxLength}` });
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) errors.push({ path, message: `does not match pattern` });
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) errors.push({ path, message: `fewer than ${s.minItems} items` });
    if (s.maxItems !== undefined && v.length > s.maxItems) errors.push({ path, message: `more than ${s.maxItems} items` });
    if (s.items) v.forEach((x, i) => walk(s.items!, x, `${path}[${i}]`, errors));
  }
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in obj) || obj[r] === undefined) errors.push({ path, message: `missing required "${r}"` });
    for (const [k, x] of Object.entries(obj)) {
      if (x === undefined) continue;
      const ps = s.properties?.[k];
      if (ps) walk(ps, x, `${path}.${k}`, errors);
      else if (s.additionalProperties === false) errors.push({ path, message: `unexpected property "${k}"` });
      else if (typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${path}.${k}`, errors);
    }
  }
  if (s.anyOf) {
    const ok = s.anyOf.some((alt) => {
      const e: SchemaError[] = [];
      walk(alt, v, path, e);
      return e.length === 0;
    });
    if (!ok) errors.push({ path, message: 'matches no anyOf alternative' });
  }
}
