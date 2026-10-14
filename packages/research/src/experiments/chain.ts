/**
 * CHAIN — end-to-end:  classify → Mark → Keep → Pass → (Bond plan: extract → cite → summarize) → Mark
 *                      → checkpoint → restart → replay → report
 * with two independent model adapters (local-a, local-b), run twice in empty
 * temporary directories, plus a deterministic-mode pair whose Mark digests
 * must be byte-identical.
 */
import { join } from 'node:path';
import { manualClock, sequentialIds, digest, type Mark } from '@awrm/core';
import { verifyMarkGraph } from '@awrm/evidence';
import { executePlan } from '@awrm/plans';
import { createKernel, type Kernel } from '@awrm/runtime';
import { openStore } from '@awrm/store';
import { RulePort } from '@awrm/ports';
import { freshEngine, runExperiment, tempDir, verdictFrom } from '../harness';

const TICKET = 'The invoice INV-7 is overdue. Payment of 120 EUR is due on Friday. The customer asked for a receipt.';

async function chainOnce(dir: string, deterministic: boolean) {
  const clock = deterministic ? manualClock() : undefined;
  const ids = deterministic ? sequentialIds() : undefined;
  const { kernel } = await freshEngine({ dir, ...(deterministic ? { deterministic: true, clock: clock!, ids: ids! } : {}) });
  const cls = await kernel.run({ dmuId: 'text.classify.v1', input: { text: TICKET }, seatId: 'local-a', portId: 'local-a' });
  const mCls = kernel.getMark(cls.markDigest!)!;
  const keep = kernel.keeps.write({ keepId: 'ticket-topic', content: cls.output, mark: mCls, scope: 'chain', readers: ['local-a', 'local-b'], consentRecord: 'owner:chain' });
  const pass = kernel.passes.create({ fromMark: mCls, toSeatId: 'local-b', content: `label=${(cls.output as { label: string }).label}`, scope: 'chain', consentRecord: 'owner:chain' });
  const plan = await executePlan(kernel, {
    planId: 'chain-plan',
    nodes: [
      { id: 'extract', dmuId: 'facts.extract.v1', seatId: 'local-a', portId: 'local-a', input: { text: TICKET } },
      { id: 'cite', dmuId: 'facts.cite.v1', seatId: 'local-b', portId: 'local-b', input: { source: 'ticket-INV-7' } },
      { id: 'summarize', dmuId: 'text.summarize.v1', seatId: 'local-b', portId: 'local-b', input: {}, context: { passes: [pass.passId], keeps: ['ticket-topic'] } },
    ],
    bonds: [
      { from: { node: 'extract', field: 'facts' }, to: { node: 'cite', field: 'facts' } },
      { from: { node: 'cite', field: 'text' }, to: { node: 'summarize', field: 'text' } },
    ],
    stop: { onFailure: 'halt', maxNodes: 8 },
  });
  // checkpoint = verified evidence closure at this point
  const checkpoint = { marks: kernel.listMarks().map((m) => m.digest).sort(), keep: keep.digest, pass: pass.digest, graphOk: verifyMarkGraph(kernel.listMarks()).ok };
  kernel.store.close();
  // restart: a new kernel on the same directory
  const k2: Kernel = createKernel({ store: openStore({ kind: 'jsonl', dir }), localSeats: ['local-owner', 'local-a', 'local-b'] });
  for (const p of [new RulePort({ id: 'owned-fixture' }), new RulePort({ id: 'local-a', kind: 'local-model' }), new RulePort({ id: 'local-b', brain: 'B', kind: 'local-model' })]) await k2.registerPort(p);
  const marks = k2.listMarks();
  const replay = {
    graph: verifyMarkGraph(marks),
    keeps: k2.keeps.verifyAll((d) => k2.getMark(d)),
    keepContent: k2.keeps.latest('ticket-topic')?.content,
    passIntact: k2.passes.get(pass.passId)?.digest === pass.digest,
    markSet: marks.map((m) => m.digest).sort(),
  };
  const recov = k2.recover();
  k2.store.close();
  const summaryRun = plan.runs.summarize!;
  const sumMark = marks.find((m) => m.digest === summaryRun.markDigest) as Mark;
  // Structural, run-independent fingerprint (excludes ids, timestamps, latencies).
  const fingerprint = marks
    .map((m) => ({ dmu: m.dmu.id, port: m.port.id, verdict: m.verdict, input: m.inputDigest, output: m.outputDigest, parents: m.parents.length }))
    .sort((a, b) => (a.dmu + a.input < b.dmu + b.input ? -1 : 1));
  return { cls, plan, checkpoint, replay, recov, sumMark, fingerprint, markDigests: replay.markSet };
}

export const CHAIN = () =>
  runExperiment({ id: 'CHAIN', title: 'End-to-end chain across two independent adapters with restart and replay', hypotheses: ['H-1', 'H-3', 'H-4', 'H-7', 'AX-6'] }, async (r) => {
    const outs = [];
    for (const deterministic of [false, false, true, true]) {
      const t = tempDir('chain');
      try {
        outs.push(await chainOnce(join(t.dir, 'store'), deterministic));
      } finally {
        t.cleanup();
      }
    }
    const [a, b, d1, d2] = outs as [Awaited<ReturnType<typeof chainOnce>>, Awaited<ReturnType<typeof chainOnce>>, Awaited<ReturnType<typeof chainOnce>>, Awaited<ReturnType<typeof chainOnce>>];
    r.check('classify completed (local-a)', [a.cls.state, a.cls.output], ['completed', { label: 'billing' }]);
    r.check('plan completed in bonded order', [a.plan.ok, a.plan.order], [true, ['extract', 'cite', 'summarize']]);
    const summary = String((a.plan.runs.summarize!.output as { summary: string }).summary);
    r.check('summary used the passed topic (local-b format)', summary.startsWith('Topic billing:'), true);
    r.check('summary Mark cites cite-node Mark (Bond) and classify Mark (Pass/Keep)', [a.sumMark.parents.includes(a.plan.runs.cite!.markDigest!), a.sumMark.parents.includes(a.cls.markDigest!)], [true, true]);
    r.check('checkpoint: evidence graph verified before restart', a.checkpoint.graphOk, true);
    r.check('replay after restart: Mark graph verifies', a.replay.graph.ok, true);
    r.check('replay after restart: Keeps verify', a.replay.keeps.ok, true);
    r.check('replay after restart: Keep content intact', a.replay.keepContent, { label: 'billing' });
    r.check('replay after restart: Pass intact', a.replay.passIntact, true);
    r.check('replay: same Mark set as at checkpoint', a.replay.markSet, a.checkpoint.marks);
    r.check('nothing pending after restart', a.recov, { requeued: [], ambiguous: [], pendingQueued: [] });
    r.check('two real-clock runs: identical structural fingerprint (verdicts + content digests)', digest(a.fingerprint), digest(b.fingerprint));
    r.check('two real-clock runs: Mark digests differ (timestamps/ids are genuinely variable)', digest(a.markDigests) === digest(b.markDigests), false, { deterministic: false });
    r.check('two deterministic-mode runs: Mark digests byte-identical', d1.markDigests, d2.markDigests);
    r.mark(...a.markDigests);
    r.metrics = { summary, fingerprint: a.fingerprint, deterministicMarkSetDigest: digest(d1.markDigests), marksPerRun: a.markDigests.length };
    r.notes.push('Real-clock Marks embed wall-clock timestamps, run ids and measured latency, so their digests legitimately differ between runs; content digests and verdicts do not.');
    return verdictFrom(r, 'the full chain completed, survived restart and replay, and reproduced structurally (and byte-for-byte in deterministic mode)');
  });
