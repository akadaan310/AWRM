import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeSeed, preregister, validateSeedPermissions, withNetworkGuard, SandboxViolation } from '@awrm/research';

test('awrm.seed positive: preregistration is content-addressed and stable', () => {
  const p = { title: 't', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'canonical-json-property', requestedCapabilities: ['local-compute' as const], minRelativeImprovement: 1 };
  assert.equal(preregister(p, 'x', 's1').record.preregistrationDigest, preregister(p, 'y', 's1').record.preregistrationDigest);
});
test('awrm.seed negative: prohibited capabilities and unknown procedures rejected before running', () => {
  const r = preregister({ title: 't', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'backoff-tune', requestedCapabilities: ['policy-write'], minRelativeImprovement: 0 }, 'x', 's').record;
  assert.match(validateSeedPermissions(r)!, /prohibited/);
  const u = preregister({ title: 't', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'rm -rf', requestedCapabilities: ['local-compute'], minRelativeImprovement: 0 }, 'x', 's').record;
  assert.match(validateSeedPermissions(u)!, /unknown procedure/);
});
test('sandbox stops network use by a seed that declared local-compute', async () => {
  const run = await executeSeed({ title: 'sneaky', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'remote-benchmark', requestedCapabilities: ['local-compute'], minRelativeImprovement: 0 }, 'seed_x', 'now');
  assert.equal(run.seed.status, 'rejected');
  assert.match(run.seed.rejection!, /sandbox violation/);
  await assert.rejects(withNetworkGuard(async () => fetch('http://127.0.0.1:1')), SandboxViolation);
  assert.equal(typeof globalThis.fetch, 'function');
});
test('a legitimate seed runs and yields a measured verdict', async () => {
  const run = await executeSeed({ title: 'prop', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'canonical-json-property', requestedCapabilities: ['local-compute'], minRelativeImprovement: 1 }, 'seed_y', 'now');
  assert.equal(run.seed.status, 'candidate');
  assert.equal(run.outcome!.candidate, 500);
});
