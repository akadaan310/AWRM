import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineForm, mathCheck, validateInput, validateOutput, isAwrmError } from '@awrm/core';

test('awrm.form positive: 391 passes the math Form', () => {
  assert.ok(validateOutput(mathCheck.form, { answer: 391 }).ok);
  assert.ok(validateInput(mathCheck.form, { question: 'What is 17 × 23?', response_format: 'integer' }).ok);
});
test('awrm.form negative: "maybe", a float or an extra field fail', () => {
  assert.ok(!validateOutput(mathCheck.form, { answer: 'maybe' }).ok);
  assert.ok(!validateOutput(mathCheck.form, { answer: 390.5 }).ok);
  assert.ok(!validateOutput(mathCheck.form, { answer: 391, secret: 'x' }).ok);
});
test('Forms are immutable and content-addressed', () => {
  assert.ok(Object.isFrozen(mathCheck.form));
  assert.throws(() => {
    (mathCheck.form.output as { type: string }).type = 'string';
  });
  const spec = { formId: 'form.t', version: 1, input: { type: 'object' as const }, output: { type: 'object' as const }, context: { maxContextChars: 0, acceptsKeeps: false, acceptsPasses: false }, errors: [] };
  assert.equal(defineForm(spec).digest, defineForm(JSON.parse(JSON.stringify(spec))).digest);
});
test('invalid Form definitions are rejected', () => {
  try {
    defineForm({ formId: 'bad id', version: 0, input: { type: 'string' }, output: { type: 'array' }, context: { maxContextChars: 0, acceptsKeeps: false, acceptsPasses: false }, errors: [] });
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(isAwrmError(e, 'invalid-definition'));
    assert.ok(((e as unknown as { details: { problems: string[] } }).details.problems.length) >= 3);
  }
});
