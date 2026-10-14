import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAwrmError } from '@awrm/core';
import { localSeat } from '@awrm/identity';
import { DisabledConsumerPort, RulePort } from '@awrm/ports';
import { manualClock } from '@awrm/runtime';
import { verifyMark } from '@awrm/evidence';
import { kernelWithPorts, Q } from '../helpers';

test('completed run: typed output, one Turn, one verifying Mark', async () => {
  const { kernel } = await kernelWithPorts();
  const r = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' });
  assert.equal(r.state, 'completed');
  assert.deepEqual(r.output, { answer: 391 });
  assert.equal(r.turns.length, 1);
  assert.ok(verifyMark(kernel.getMark(r.markDigest!)!).ok);
});

test('awrm.dmu negative: an invalid response is never a completed invocation', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'wrong', mode: 'wrong' }));
  const r = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'wrong' });
  assert.equal(r.state, 'failed');
  assert.equal(r.output, null);
  assert.equal(kernel.getMark(r.markDigest!)!.outputDigest, null);
});

test('awrm.gate: a denied run never reaches the port and opens no connection', async () => {
  const { kernel } = await kernelWithPorts();
  const consumer = new DisabledConsumerPort('consumer.x', 'openai', 'ChatGPT');
  await kernel.registerPort(consumer);
  kernel.seats.register({ seatId: 'openai-1', provider: 'openai', principal: 'owner-account', quotaKey: 'openai:me', allowedPortKinds: ['approved-browser'], permissionRecordIds: ['perm.openai.consumer-web'], scopes: [] });
  kernel.ledger.configure({ quotaKey: 'openai:me', limit: null, windowMs: null, source: 'unknown' });
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error('no network');
  }) as typeof fetch;
  try {
    const r = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'openai-1', portId: 'consumer.x' });
    assert.equal(r.state, 'denied');
    assert.equal(r.turns.length, 0);
    assert.equal(calls, 0);
    assert.equal(kernel.getMark(r.markDigest!)!.gate?.verdict, 'deny');
  } finally {
    globalThis.fetch = orig;
  }
});

test('Gate is re-evaluated immediately before invocation (permission expiring after enqueue)', async () => {
  const clock = manualClock();
  const { kernel } = await kernelWithPorts({ clock });
  const seat = kernel.seats.register(localSeat('short', { expiry: new Date(clock.now() + 1000).toISOString() }));
  kernel.ledger.configure({ quotaKey: seat.quotaKey, limit: null, windowMs: null, source: 'local' });
  const r = kernel.submit({ dmuId: 'math.check.v1', input: Q, seatId: 'short', portId: 'owned-fixture' });
  assert.equal(r.state, 'queued');
  clock.advance(2000);
  const done = await kernel.execute(r.runId);
  assert.equal(done.state, 'denied');
  assert.equal(done.gate?.code, 'seat-expired');
  assert.equal(done.gate?.phase, 'pre-invoke');
});

test('idempotency: same key + same request returns the same run; different request conflicts', async () => {
  const { kernel, fixture } = await kernelWithPorts();
  const a = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture', idempotencyKey: 'idem-key-0001' });
  const b = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture', idempotencyKey: 'idem-key-0001' });
  assert.equal(a.runId, b.runId);
  assert.equal(fixture.invocations, 1);
  assert.throws(() => kernel.submit({ dmuId: 'math.check.v1', input: { question: 'What is 1 + 1?' }, seatId: 'local-owner', portId: 'owned-fixture', idempotencyKey: 'idem-key-0001' }), (e) => isAwrmError(e, 'idempotency-conflict'));
});

test('awrm.turn: retry creates a child Turn with its own Mark citing the failed attempt', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'flaky', mode: 'flaky', flakyFailures: 1 }));
  const r = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'flaky' });
  assert.equal(r.state, 'completed');
  assert.equal(r.turns.length, 2);
  const [t1, t2] = r.turns.map((t) => kernel.getTurn(t)!);
  assert.equal(t1!.state, 'failure');
  assert.equal(t2!.parentTurnId, t1!.turnId);
  assert.ok(kernel.getMark(t2!.markDigest!)!.parents.includes(t1!.markDigest!));
});

test('awrm.turn negative: timeout ends the Turn; the late answer is never reported', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'slow', latencyMs: 300 }));
  const r = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'slow', budget: { maxWallMs: 50 } });
  assert.equal(r.error?.code, 'timeout');
  await new Promise((res) => setTimeout(res, 350));
  const later = kernel.getRun(r.runId);
  assert.equal(later.state, 'failed');
  assert.equal(later.output, null);
  assert.equal(later.turns.length, 1, 'no silent re-bill');
});

test('a request cannot raise the DMU budget; unknown-side-effect ports never retry', async () => {
  const { kernel } = await kernelWithPorts();
  const s = kernel.submit({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture', budget: { maxCalls: 99, maxRetries: 99 } });
  assert.equal(s.budget.maxCalls, 2);
  assert.equal(s.budget.maxRetries, 1);
});

test('cancellation: queued run cancels with a Mark; running run cancels its Turn', async () => {
  const { kernel } = await kernelWithPorts();
  const q = kernel.submit({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' });
  assert.equal(kernel.cancel(q.runId).state, 'cancelled');
  await kernel.registerPort(new RulePort({ id: 'hang', mode: 'timeout' }));
  const h = kernel.submit({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'hang' });
  const p = kernel.execute(h.runId);
  await new Promise((res) => setTimeout(res, 20));
  kernel.cancel(h.runId);
  const done = await p;
  assert.equal(done.state, 'cancelled');
  assert.equal(kernel.getTurn(done.turns[0]!)!.state, 'cancelled');
  assert.equal(kernel.getMark(done.markDigest!)!.verdict, 'cancelled');
});

test('rate-limit signal is a hard stop for the quota key', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'rl', mode: 'rate-limit', retryAfterMs: 60_000 }));
  const a = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'rl' });
  assert.equal(a.error?.code, 'rate-limited');
  const b = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' });
  assert.equal(b.state, 'denied');
  assert.equal(b.gate?.code, 'rate-limited');
});

test('secret-shaped input is refused and not stored', async () => {
  const { kernel } = await kernelWithPorts();
  const r = await kernel.run({ dmuId: 'text.classify.v1', input: { text: 'my key is sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV' }, seatId: 'local-a', portId: 'local-a' });
  assert.equal(r.error?.code, 'secret-material');
  assert.ok(!JSON.stringify(kernel.listRuns()).includes('sk-ant-api03'));
});

test('DMU definitions are immutable per id', async () => {
  const { kernel } = await kernelWithPorts();
  const { toSpec, mathCheck } = await import('@awrm/core');
  assert.throws(() => kernel.registerDmu({ ...toSpec(mathCheck), title: 'changed' }), (e) => isAwrmError(e, 'invalid-definition'));
});
