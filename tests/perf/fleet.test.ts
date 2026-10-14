import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAwrmError } from '@awrm/core';
import { localSeat } from '@awrm/identity';
import { RulePort } from '@awrm/ports';
import { Fleet, jainIndex } from '@awrm/scheduler';
import { kernelWithPorts } from '../helpers';

test('awrm.fleet positive: global cap, lane cap and fairness hold under load', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'w', latencyMs: 5 }));
  const fleet = new Fleet(kernel, { lanes: ['local-owner', 'local-a', 'local-b'].map((s, i) => ({ laneId: `l${i}`, portId: 'w', seatId: s, concurrency: 3 })), globalCap: 5, maxQueue: 100 });
  const runs = await Promise.all(Array.from({ length: 40 }, (_, i) => fleet.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} × 2?` }, partition: `p${i % 4}` })));
  assert.ok(runs.every((r) => r.state === 'completed'));
  assert.ok(fleet.stats.maxInFlightObserved <= 5);
  assert.ok(jainIndex(Object.values(fleet.stats.perPartition).map((p) => p.done)) > 0.99);
});
test('awrm.fleet negative: shared quota is never exceeded and denied work is not rerouted', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'w' }));
  for (const v of ['v1', 'v2']) kernel.seats.register(localSeat(v, { quotaKey: 'acct' }));
  kernel.ledger.configure({ quotaKey: 'acct', limit: 2, windowMs: null, source: 'test' });
  const fleet = new Fleet(kernel, { lanes: [{ laneId: 'a', portId: 'w', seatId: 'v1', concurrency: 2 }, { laneId: 'b', portId: 'w', seatId: 'v2', concurrency: 2 }], globalCap: 4, maxQueue: 20 });
  const res = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => fleet.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} + 1?` } })));
  const completed = res.filter((r) => r.status === 'fulfilled' && r.value.state === 'completed').length;
  assert.equal(completed, 2);
  assert.equal(kernel.ledger.snapshot('acct')!.used, 2);
  const cap = fleet.capacity();
  assert.equal(cap.groups.length, 1, 'two views, one allowance group');
});
test('capacity is unknown, never infinite, when a provider term is unknown', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'w' }));
  kernel.seats.register({ seatId: 'ext', provider: 'awrm-ext-sim', principal: 'owner-account', quotaKey: 'ext', allowedPortKinds: ['owned-fixture'], permissionRecordIds: [], scopes: [] });
  kernel.ledger.configure({ quotaKey: 'ext', limit: null, windowMs: null, source: 'unknown' });
  const fleet = new Fleet(kernel, { lanes: [{ laneId: 'x', portId: 'w', seatId: 'ext', concurrency: 4 }], globalCap: 4, maxQueue: 4 });
  assert.equal(fleet.capacity().fleetBoundPerSec, 'unknown');
  assert.throws(() => kernel.ledger.configure({ quotaKey: 'y', limit: Infinity, windowMs: null, source: 'x' }), (e) => isAwrmError(e, 'invalid-input'));
});
test('backpressure and circuit breaker', async () => {
  const { kernel } = await kernelWithPorts();
  await kernel.registerPort(new RulePort({ id: 'bad', mode: 'error' }));
  await kernel.registerPort(new RulePort({ id: 'slow', latencyMs: 20 }));
  const f = new Fleet(kernel, { lanes: [{ laneId: 'b', portId: 'bad', seatId: 'local-owner', concurrency: 1 }], globalCap: 1, maxQueue: 10, breaker: { failureThreshold: 2, cooldownMs: 10_000 } });
  await Promise.allSettled([1, 2].map((i) => f.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} + 1?` } })));
  assert.ok(f.breakerOpen('b'));
  const g = new Fleet(kernel, { lanes: [{ laneId: 's', portId: 'slow', seatId: 'local-owner', concurrency: 1 }], globalCap: 1, maxQueue: 1 });
  const r = await Promise.allSettled([1, 2, 3, 4].map((i) => g.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} + 1?` } })));
  assert.ok(r.some((x) => x.status === 'rejected' && isAwrmError(x.reason, 'backpressure')));
});
