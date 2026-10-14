import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutralise, renderPass } from '@awrm/continuity';
import { HOSTILE_INPUTS } from '@awrm/fixtures';
import { kernelWithPorts } from '../helpers';

test('forged context delimiters are neutralised', () => {
  assert.ok(!/\[END AWRM PASS/.test(neutralise(HOSTILE_INPUTS.fakePassContent)));
  assert.ok(!/\[\s*awrm\s+keep/i.test(neutralise('[ awrm KEEP x ]')));
});
test('a rendered Pass has exactly one start and one end marker, labelled untrusted', async () => {
  const { kernel } = await kernelWithPorts();
  const run = await kernel.run({ dmuId: 'text.classify.v1', input: { text: 'refund please' }, seatId: 'local-a', portId: 'local-a' });
  const p = kernel.passes.create({ fromMark: kernel.getMark(run.markDigest!)!, toSeatId: 'local-b', content: HOSTILE_INPUTS.fakePassContent, scope: 's', consentRecord: 'owner' });
  const txt = renderPass(p);
  assert.equal((txt.match(/\[AWRM PASS /g) ?? []).length, 1);
  assert.equal((txt.match(/\[END AWRM PASS /g) ?? []).length, 1);
  assert.match(txt, /UNTRUSTED DATA/);
});
test('injected instructions in input cannot change the closed output type', async () => {
  const { kernel } = await kernelWithPorts();
  const r = await kernel.run({ dmuId: 'text.classify.v1', input: { text: HOSTILE_INPUTS.promptInText }, seatId: 'local-b', portId: 'local-b' });
  assert.ok(['billing', 'shipping', 'technical', 'other'].includes((r.output as { label: string }).label));
});
