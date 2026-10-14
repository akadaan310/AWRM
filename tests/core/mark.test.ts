import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyMark, verifyMarkGraph, sealMark } from '@awrm/evidence';
import { kernelWithPorts, Q } from '../helpers';

test('awrm.mark positive: kernel marks verify, graph verifies', async () => {
  const { kernel } = await kernelWithPorts();
  const a = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' });
  const b = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture', parentMarks: [a.markDigest!] });
  assert.ok(verifyMark(kernel.getMark(b.markDigest!)!).ok);
  assert.ok(verifyMarkGraph(kernel.listMarks()).ok);
});
test('awrm.mark negative: any field change or unsealed forgery fails', async () => {
  const { kernel } = await kernelWithPorts();
  const a = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' });
  const m = kernel.getMark(a.markDigest!)!;
  for (const t of [{ ...m, outputPreview: '392' }, { ...m, seatId: 'local-b' }, { ...m, usage: { ...m.usage, calls: 2 } }, { ...m, gate: null }]) assert.equal(verifyMark(t).ok, false);
  const { digest: _d, ...body } = m;
  const resealedDenied = sealMark({ ...body, verdict: 'denied' });
  assert.equal(verifyMark(resealedDenied).ok, false, 'denied mark with permit gate is internally inconsistent');
  assert.equal(verifyMarkGraph([{ ...m, parents: ['sha256:' + 'f'.repeat(64)] }]).ok, false);
});
