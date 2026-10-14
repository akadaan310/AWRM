import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchema, validate } from '@awrm/core';

test('validator enforces types, required, enum, bounds, pattern, items, additionalProperties, anyOf', () => {
  const s = {
    type: 'object' as const,
    required: ['n', 'e'],
    additionalProperties: false,
    properties: {
      n: { type: 'integer' as const, minimum: 0, maximum: 10 },
      e: { enum: ['a', 'b'] },
      s: { type: 'string' as const, pattern: '^x', maxLength: 3 },
      arr: { type: 'array' as const, items: { type: 'number' as const }, maxItems: 2 },
      u: { anyOf: [{ type: 'null' as const }, { type: 'string' as const }] },
    },
  };
  assert.ok(validate(s, { n: 3, e: 'a', s: 'xy', arr: [1, 2.5], u: null }).ok);
  assert.ok(!validate(s, { n: 3.5, e: 'a' }).ok);
  assert.ok(!validate(s, { n: 11, e: 'a' }).ok);
  assert.ok(!validate(s, { n: 1, e: 'c' }).ok);
  assert.ok(!validate(s, { n: 1, e: 'a', s: 'yy' }).ok);
  assert.ok(!validate(s, { n: 1, e: 'a', arr: [1, 2, 3] }).ok);
  assert.ok(!validate(s, { n: 1, e: 'a', extra: 1 }).ok);
  assert.ok(!validate(s, { n: 1, e: 'a', u: 3 }).ok);
  assert.ok(!validate(s, { e: 'a' }).ok);
});
test('unsupported schema keywords are errors, not silently ignored', () => {
  assert.equal(checkSchema({ type: 'object', oneOf: [] } as never).length, 1);
  assert.equal(checkSchema({ type: 'string', pattern: '(' }).length, 1);
});
