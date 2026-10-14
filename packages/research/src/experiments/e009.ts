/** E009 — Evidence corruption: every single-field tamper is detected; the original still verifies (H-3). */
import { digest, type Mark } from '@awrm/core';
import { verifyMark, verifyMarkContent, verifyMarkGraph } from '@awrm/evidence';
import { RulePort } from '@awrm/ports';
import { freshEngine, runExperiment, verdictFrom } from '../harness';

const flip = (d: string): string => d.slice(0, -1) + (d.endsWith('0') ? '1' : '0');

export const E009 = () =>
  runExperiment({ id: 'E009', title: 'Evidence corruption detection', hypotheses: ['H-3', 'AX-6'] }, async (r) => {
    const { kernel } = await freshEngine();
    const a = await kernel.run({ dmuId: 'text.classify.v1', input: { text: 'The invoice is overdue.' }, seatId: 'local-a', portId: 'local-a' });
    const b = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 17 × 23?' }, seatId: 'local-owner', portId: 'owned-fixture', parentMarks: [a.markDigest!] });
    const ma = kernel.getMark(a.markDigest!)!;
    const mb = kernel.getMark(b.markDigest!)!;
    await kernel.registerPort(new RulePort({ id: 'wrong', mode: 'wrong' }));
    const f = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 17 × 23?' }, seatId: 'local-owner', portId: 'wrong' });
    const mf = kernel.getMark(f.markDigest!)!;
    const content = kernel.store.get<{ input: unknown; output: unknown }>('mark-content', mb.digest)!;
    r.check('original mark verifies', verifyMark(mb).ok, true);
    r.check('original content verifies', verifyMarkContent(mb, content.input, content.output).ok, true);
    r.check('original graph verifies', verifyMarkGraph([ma, mb]).ok, true);
    const tampers: Array<[string, Mark]> = [
      ['input digest flipped', { ...mb, inputDigest: flip(mb.inputDigest) }],
      ['output digest flipped', { ...mb, outputDigest: flip(mb.outputDigest!) }],
      ['parent link replaced', { ...mb, parents: [flip(ma.digest)] }],
      ['parent link removed', { ...mb, parents: [] }],
      ['timing endedAt moved', { ...mb, timing: { ...mb.timing, endedAt: '2020-01-01T00:00:00.000Z' } }],
      ['elapsed time altered', { ...mb, timing: { ...mb.timing, elapsedMs: (mb.timing.elapsedMs ?? 0) + 1 } }],
      ['failed verdict upgraded to completed', { ...mf, verdict: 'completed', error: null }],
      ['port relabelled as external-live', { ...mb, port: { ...mb.port, liveness: 'external-live' } }],
      ['preview rewritten', { ...mb, outputPreview: '392' }],
    ];
    const detections: Record<string, string[]> = {};
    for (const [name, t] of tampers) {
      const v = verifyMark(t);
      detections[name] = v.problems;
      r.check(`tamper detected: ${name}`, v.ok, false);
    }
    // Re-sealing a tampered body yields a different digest: the original reference no longer resolves to it.
    const { digest: _d, ...body } = mb;
    const resealed = digest({ ...body, outputPreview: '392' });
    r.check('re-sealed forgery has a different digest than the cited one', resealed === mb.digest, false);
    const forged = { ...body, outputPreview: '392', digest: resealed } as Mark;
    r.check('graph check flags a child citing a missing parent', verifyMarkGraph([forged, { ...mb, parents: ['sha256:' + '0'.repeat(64)] }]).ok, false);
    r.check('content tamper: altered stored output detected', verifyMarkContent(mb, content.input, { answer: 392 }).ok, false);
    r.check('content tamper: altered stored input detected', verifyMarkContent(mb, { question: 'What is 17 × 24?' }, content.output).ok, false);
    r.check('original still verifies after the trials', verifyMark(kernel.getMark(mb.digest)!).ok, true);
    r.mark(ma.digest, mb.digest);
    r.metrics = { tampers: tampers.length, detections };
    return verdictFrom(r, 'all 9 single-field tampers, 2 content tampers and a dangling parent were detected; originals verified');
  });
