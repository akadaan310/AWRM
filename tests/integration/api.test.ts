import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AwrmClient, AwrmApiError, startApi } from '@awrm/api';
import { toSpec, mathCheck } from '@awrm/core';
import { kernelWithPorts, Q } from '../helpers';

test('SDK ↔ API round trip: status, dmus, run, events, mark verify, pass, capacity, interop', async () => {
  const { kernel } = await kernelWithPorts();
  const api = await startApi({ kernel });
  const c = new AwrmClient(api.url, api.token);
  try {
    assert.equal((await c.status()).engine, 'awrm');
    assert.ok((await c.dmus()).dmus.some((d) => d.id === 'math.check.v1'));
    const { run } = await c.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' }, { wait: true, idempotencyKey: 'api-test-0001' });
    assert.equal(run.state, 'completed');
    const again = await c.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' }, { wait: true, idempotencyKey: 'api-test-0001' });
    assert.equal(again.run.runId, run.runId);
    const ev = await c.events(run.runId);
    assert.equal(ev.at(-1)!.event, 'end');
    assert.ok(ev.some((e) => e.event === 'mark'));
    const mv = await c.mark(run.markDigest!);
    assert.ok(mv.verification.ok);
    const { pass } = await c.createPass({ fromMark: run.markDigest!, toSeatId: 'local-b', content: 'answer=391', scope: 's', consentRecord: 'owner' });
    assert.equal((await c.getPass(pass.passId)).pass.digest, pass.digest);
    await assert.rejects(c.createPass({ fromMark: run.markDigest!, toSeatId: 'local-b', content: 'x', scope: 's', consentRecord: 'owner', token: 'x' }), (e) => e instanceof AwrmApiError && e.status === 403);
    const cap = await c.capacity();
    assert.ok(cap.quotas.every((q: { limit: unknown }) => q.limit === 'unknown' || typeof q.limit === 'number'));
    assert.equal((await c.interop()).matrix.seurl.support, 'partial');
    assert.ok((await c.providers()).rows.length >= 10);
  } finally {
    await api.close();
  }
});
test('POST /v1/dmus needs owner approval and never executes', async () => {
  const { kernel, fixture } = await kernelWithPorts();
  const api = await startApi({ kernel });
  const c = new AwrmClient(api.url, api.token);
  try {
    const spec = { ...toSpec(mathCheck), id: 'math.check-copy.v1' };
    const before = fixture.invocations;
    const res = await c.registerDmu(spec);
    assert.equal(res.executed, false);
    assert.equal(fixture.invocations, before);
    const r = await fetch(`${api.url}/v1/dmus`, { method: 'POST', headers: { authorization: `Bearer ${api.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ definition: { ...spec, id: 'math.check-x.v1' } }) });
    assert.equal(r.status, 403);
  } finally {
    await api.close();
  }
});
