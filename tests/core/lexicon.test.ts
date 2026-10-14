import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTERNAL_VOCABULARY, LEXICON, validate } from '@awrm/core';
import { lexiconJson, lexiconMarkdown } from '../../scripts/lexicon';
import { kernelWithPorts, Q } from '../helpers';

const ROOT = join(import.meta.dirname, '..', '..');

test('exactly 12 namespaced terms, each with schema, example, artifact, falsifier and existing tests', () => {
  assert.equal(LEXICON.length, 12);
  for (const e of LEXICON) {
    assert.match(e.id, /^awrm\.[a-z]+$/);
    assert.ok(e.example.length > 20 && e.falsifier.length > 20 && e.definition.length > 40, e.id);
    assert.ok(existsSync(join(ROOT, e.artifact)), `${e.id} artifact ${e.artifact}`);
    for (const t of e.tests) assert.ok(existsSync(join(ROOT, t)), `${e.id} test ${t}`);
  }
});
test('no AWRM term collides with SEURL, PURL or ACSP vocabulary', () => {
  const ext = new Set(Object.values(EXTERNAL_VOCABULARY).flat().map((x) => String(x).toLowerCase()));
  for (const e of LEXICON) {
    assert.ok(!ext.has(e.id.slice(5)), e.id);
    assert.ok(!ext.has(e.name.toLowerCase()), e.name);
  }
});
test('research/lexicon.json and research/LEXICON.md are generated from the code and match it', () => {
  assert.equal(readFileSync(join(ROOT, 'research', 'lexicon.json'), 'utf8'), lexiconJson());
  assert.equal(readFileSync(join(ROOT, 'research', 'LEXICON.md'), 'utf8'), lexiconMarkdown());
});
test('term schemas accept real records (positive) and reject malformed ones (negative)', async () => {
  const { kernel } = await kernelWithPorts();
  const run = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-a', portId: 'local-a' });
  const mark = kernel.getMark(run.markDigest!)!;
  const keep = kernel.keeps.write({ keepId: 'k1', content: run.output, mark, scope: 's', readers: ['local-a'], consentRecord: 'owner' });
  const pass = kernel.passes.create({ fromMark: mark, toSeatId: 'local-b', content: 'x', scope: 's', consentRecord: 'owner' });
  const real: Record<string, unknown> = {
    'awrm.dmu': kernel.getDmu('math.check.v1'),
    'awrm.form': kernel.getDmu('math.check.v1').form,
    'awrm.seat': kernel.seats.require('local-a'),
    'awrm.port': kernel.portManifest('local-a'),
    'awrm.gate': run.gate,
    'awrm.turn': kernel.getTurn(run.turns[0]!),
    'awrm.mark': mark,
    'awrm.keep': keep,
    'awrm.pass': pass,
    'awrm.fleet': { lanes: [{ laneId: 'l', portId: 'local-a', seatId: 'local-a', concurrency: 2 }], globalCap: 4, maxQueue: 8 },
    'awrm.bond': { from: { node: 'a', field: 'facts' }, to: { node: 'b', field: 'facts' } },
    'awrm.seed': { schema: 'awrm.seed/1', seedId: 'seed_1', title: 't', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'backoff-tune', requestedCapabilities: ['local-compute'], status: 'proposed', preregistrationDigest: null, rejection: null, result: null },
  };
  const broken: Record<string, unknown> = {
    'awrm.dmu': { id: 'Bad Id' },
    'awrm.form': { formId: 'nope' },
    'awrm.seat': { ...kernel.seats.require('local-a'), password: 'hunter2' },
    'awrm.port': { ...kernel.portManifest('local-a'), liveness: 'probably-live' },
    'awrm.gate': { verdict: 'maybe', code: 'x', reasons: [], phase: 'enqueue' },
    'awrm.turn': { ...kernel.getTurn(run.turns[0]!), state: 'succeeded-later' },
    'awrm.mark': { ...mark, verdict: 'success' },
    'awrm.keep': { ...keep, identityAssurance: 'model-memory' },
    'awrm.pass': { ...pass, credentialRef: 'vault:x' },
    'awrm.fleet': { lanes: [], globalCap: 0, maxQueue: 1 },
    'awrm.bond': { from: { node: 'a', field: 'x' }, to: { node: 'b', field: 'y' }, seatId: 'attacker' },
    'awrm.seed': { schema: 'awrm.seed/1', seedId: 's', title: 't', hypothesis: 'h', metric: 'm', prediction: 'p', procedure: 'x', requestedCapabilities: ['root'], status: 'proposed' },
  };
  for (const e of LEXICON) {
    assert.ok(validate(e.schema, real[e.id]).ok, `${e.id} positive: ${JSON.stringify(validate(e.schema, real[e.id]).errors)}`);
    assert.ok(!validate(e.schema, broken[e.id]).ok, `${e.id} negative`);
  }
});
