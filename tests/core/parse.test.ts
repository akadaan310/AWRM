import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse } from '@awrm/core';

test('integer mode: exact, single integer in prose, ambiguous, none', () => {
  const s = { mode: 'integer' as const, field: 'answer' };
  assert.deepEqual(parseResponse(s, ' 391 '), { answer: 391 });
  assert.deepEqual(parseResponse(s, 'The answer is 391.'), { answer: 391, explanation: 'The answer is 391.' });
  assert.deepEqual(parseResponse(s, '17 times 23 is a number.'), { answer: '17 times 23 is a number.' });
  assert.deepEqual(parseResponse(s, 'maybe'), { answer: 'maybe' });
});
test('label mode: exact, embedded, ambiguous', () => {
  const s = { mode: 'label' as const, field: 'label', labels: ['billing', 'shipping'] };
  assert.deepEqual(parseResponse(s, 'Billing'), { label: 'billing' });
  assert.deepEqual(parseResponse(s, 'Label: shipping'), { label: 'shipping' });
  assert.deepEqual(parseResponse(s, 'billing or shipping'), { label: 'billing or shipping' });
});
test('lines and json modes', () => {
  assert.deepEqual(parseResponse({ mode: 'lines', field: 'f', maxLines: 2 }, '- a\n2. b\n* c\n d'), { f: ['a', 'b', 'c'] });
  assert.deepEqual(parseResponse({ mode: 'json' }, 'noise {"x":1} noise'), { x: 1 });
  assert.deepEqual(parseResponse({ mode: 'json' }, 'no json'), { __unparsed: 'no json' });
});
