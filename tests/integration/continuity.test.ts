import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAwrmError } from '@awrm/core';
import { kernelWithPorts, Q } from '../helpers';

async function setup() {
  const k = await kernelWithPorts();
  const run = await k.kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-a', portId: 'local-a' });
  return { ...k, mark: k.kernel.getMark(run.markDigest!)! };
}

test('awrm.keep positive: revisions form a verifiable lineage', async () => {
  const { kernel, mark } = await setup();
  const k1 = kernel.keeps.write({ keepId: 'last', content: { a: 391 }, mark, scope: 's', readers: ['local-a'], consentRecord: 'owner' });
  const k2 = kernel.keeps.write({ keepId: 'last', content: { a: 392 }, mark, scope: 's', readers: ['local-a'], consentRecord: 'owner' });
  assert.equal(k2.revision, 2);
  assert.deepEqual(k2.lineage, [k1.digest]);
  assert.ok(kernel.keeps.verifyAll((d) => kernel.getMark(d)).ok);
  assert.deepEqual(kernel.keeps.readFor('local-a', 'last').content, { a: 392 });
});
test('awrm.keep negative: non-reader, missing consent, tampered revision', async () => {
  const { kernel, mark } = await setup();
  kernel.keeps.write({ keepId: 'k', content: 'x', mark, scope: 's', readers: ['local-a'], consentRecord: 'owner' });
  assert.throws(() => kernel.keeps.readFor('local-b', 'k'), (e) => isAwrmError(e, 'forbidden'));
  assert.throws(() => kernel.keeps.write({ keepId: 'k2', content: 'x', mark, scope: 's', readers: [], consentRecord: '' }));
  const rec = kernel.store.get<Record<string, unknown>>('keeps', 'k@1')!;
  kernel.store.put('keeps', 'k@1', { ...rec, content: 'tampered' });
  assert.equal(kernel.keeps.verifyAll((d) => kernel.getMark(d)).ok, false);
});
test('awrm.pass positive: addressed, redacted, cites its Mark', async () => {
  const { kernel, mark } = await setup();
  const p = kernel.passes.create({ fromMark: mark, toSeatId: 'local-b', content: 'answer 391 (Bearer abcdefghijklmnop)', scope: 's', consentRecord: 'owner' });
  assert.deepEqual(p.payload.citations, [mark.digest]);
  assert.deepEqual(p.redactions, ['bearer-token']);
  assert.equal(kernel.passes.receive(p.passId, 'local-b').passId, p.passId);
});
test('awrm.pass negative: authority fields refused; wrong recipient refused; tamper detected', async () => {
  const { kernel, mark } = await setup();
  for (const field of ['credentialRef', 'token', 'quotaKey', 'permissionRecordIds', 'seat']) {
    assert.throws(() => kernel.passes.create({ fromMark: mark, toSeatId: 'local-b', content: 'x', scope: 's', consentRecord: 'owner', [field]: 'x' } as never), (e) => isAwrmError(e, 'authority-transfer'), field);
  }
  const p = kernel.passes.create({ fromMark: mark, toSeatId: 'local-b', content: 'x', scope: 's', consentRecord: 'owner' });
  assert.throws(() => kernel.passes.receive(p.passId, 'local-owner'), (e) => isAwrmError(e, 'forbidden'));
  kernel.store.put('passes', p.passId, { ...p, to: { seatId: 'local-owner' } });
  assert.throws(() => kernel.passes.receive(p.passId, 'local-owner'), (e) => isAwrmError(e, 'integrity'));
});
