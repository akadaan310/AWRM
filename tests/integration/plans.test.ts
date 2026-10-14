import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan, executePlan, schemaAssignable, type PlanSpec } from '@awrm/plans';
import { kernelWithPorts } from '../helpers';

const plan = (over: Partial<PlanSpec> = {}): PlanSpec => ({
  planId: 'p',
  nodes: [
    { id: 'extract', dmuId: 'facts.extract.v1', seatId: 'local-a', portId: 'local-a', input: { text: 'The invoice is overdue. Pay by Friday.' } },
    { id: 'cite', dmuId: 'facts.cite.v1', seatId: 'local-b', portId: 'local-b', input: { source: 't1' } },
  ],
  bonds: [{ from: { node: 'extract', field: 'facts' }, to: { node: 'cite', field: 'facts' } }],
  stop: { onFailure: 'halt', maxNodes: 4 },
  ...over,
});

test('awrm.bond positive: typed DAG executes in order and records provenance', async () => {
  const { kernel } = await kernelWithPorts();
  const r = await executePlan(kernel, plan());
  assert.ok(r.ok);
  assert.deepEqual(r.order, ['extract', 'cite']);
  assert.ok(kernel.getMark(r.runs.cite!.markDigest!)!.parents.includes(r.runs.extract!.markDigest!));
  assert.equal(r.runs.cite!.seatId, 'local-b', 'downstream keeps its own seat');
});
test('awrm.bond negative: type mismatch, cycle, authority field, unknown field', async () => {
  const { kernel } = await kernelWithPorts();
  const dm = (id: string) => kernel.getDmu(id);
  assert.ok(!checkPlan(plan({ bonds: [{ from: { node: 'extract', field: 'facts' }, to: { node: 'cite', field: 'source' } }] }), dm).ok, 'array → string');
  assert.ok(!checkPlan(plan({ bonds: [{ from: { node: 'extract', field: 'facts' }, to: { node: 'cite', field: 'facts' } }, { from: { node: 'cite', field: 'text' }, to: { node: 'extract', field: 'text' } }] }), dm).ok, 'cycle');
  assert.ok(!checkPlan(plan({ bonds: [{ from: { node: 'extract', field: 'facts' }, to: { node: 'cite', field: 'seatId' } }] }), dm).ok, 'authority via bond');
  assert.ok(!checkPlan(plan({ nodes: [{ ...plan().nodes[0]!, input: { text: 'x', seatId: 'local-owner' } }, plan().nodes[1]!] }), dm).ok, 'authority via input');
  assert.ok(!schemaAssignable({ type: 'string' }, { enum: ['a'] }).ok);
  assert.ok(!schemaAssignable({ type: 'string', maxLength: 500 }, { type: 'string', maxLength: 100 }).ok);
  assert.ok(schemaAssignable({ type: 'integer' }, { type: 'number' }).ok);
});
