import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, digest, isDigest, deepFreeze } from '@awrm/core';

test('canonical JSON sorts keys and omits undefined', () => {
  assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
});
test('canonical JSON normalises -0 and escapes strings', () => {
  assert.equal(canonicalJson({ x: -0, s: 'é\n"' }), '{"s":"é\\n\\"","x":0}');
});
test('canonical JSON rejects non-finite numbers and cycles', () => {
  assert.throws(() => canonicalJson({ n: NaN }));
  assert.throws(() => canonicalJson({ n: Infinity }));
  const a: Record<string, unknown> = {};
  a.self = a;
  assert.throws(() => canonicalJson(a));
});
test('digest is key-order invariant and well-formed', () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.ok(isDigest(digest(null)));
  assert.notEqual(digest({ a: 1 }), digest({ a: '1' }));
});
test('deepFreeze freezes nested values', () => {
  const v = deepFreeze({ a: { b: [1] } });
  assert.throws(() => {
    (v.a.b as number[]).push(2);
  });
});
