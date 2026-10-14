import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_DMUS, defineDmu, mathCheck, renderPrompt, toSpec, isAwrmError } from '@awrm/core';

test('awrm.dmu positive: builtins are valid, frozen and digest-stable through toSpec', () => {
  assert.equal(BUILTIN_DMUS.length, 5);
  for (const d of BUILTIN_DMUS) assert.equal(defineDmu(toSpec(d)).digest, d.digest);
});
test('awrm.dmu negative: bad id, unknown template variable, budget above ceiling', () => {
  const base = toSpec(mathCheck);
  for (const bad of [
    { ...base, id: 'Math Check' },
    { ...base, prompt: { template: '{{input.nope}}' } },
    { ...base, budget: { ...base.budget, maxCalls: 1000 } },
    { ...base, budget: { ...base.budget, maxRetries: 5, maxCalls: 2 } },
    { ...base, allowedPortKinds: ['teleport' as never] },
  ]) {
    assert.throws(() => defineDmu(bad), (e) => isAwrmError(e, 'invalid-definition'));
  }
});
test('renderPrompt places context and input explicitly', () => {
  const p = renderPrompt(mathCheck, { question: 'What is 2 × 2?' }, '[CTX]\n');
  assert.equal(p.user, '[CTX]\nQuestion: What is 2 × 2?\nAnswer:');
  assert.equal(p.system, 'Answer with a single integer and nothing else.');
});
