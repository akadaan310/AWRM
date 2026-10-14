/** E001 — DMU atom: one complete Mark and distinct negative Marks (H-2). */
import { verifyMark } from '@awrm/evidence';
import { RulePort } from '@awrm/ports';
import { freshEngine, runExperiment, verdictFrom } from '../harness';

export const E001 = () =>
  runExperiment({ id: 'E001', title: 'DMU atom: one prompt, one validated response or a typed failure', hypotheses: ['H-2'] }, async (r) => {
    const { kernel } = await freshEngine();
    for (const mode of ['wrong', 'timeout', 'refuse', 'partial'] as const) await kernel.registerPort(new RulePort({ id: `fixture-${mode}`, mode }));
    const q = { question: 'What is 17 × 23?', response_format: 'integer' };

    const ok = await kernel.run({ dmuId: 'math.check.v1', input: q, seatId: 'local-owner', portId: 'owned-fixture' });
    r.check('correct: state', ok.state, 'completed');
    r.check('correct: answer', (ok.output as { answer: number }).answer, 391);
    const m = kernel.getMark(ok.markDigest!)!;
    r.check('correct: mark verifies', verifyMark(m).ok, true);
    r.check('correct: mark names port + liveness', [m.port.id, m.port.liveness], ['owned-fixture', 'deterministic-test-double']);
    r.check('correct: elapsed time measured', typeof m.timing.elapsedMs === 'number' && m.timing.elapsedMs >= 0, true);
    r.mark(m.digest);

    const cases: Array<[string, string, Record<string, number>?]> = [
      ['fixture-wrong', 'invalid-output'],
      ['fixture-timeout', 'timeout', { maxWallMs: 150 }],
      ['fixture-refuse', 'refused'],
      ['fixture-partial', 'partial-response'],
    ];
    const codes = new Set<string>();
    for (const [portId, code, budget] of cases) {
      const t0 = performance.now();
      const run = await kernel.run({ dmuId: 'math.check.v1', input: q, seatId: 'local-owner', portId, ...(budget ? { budget } : {}) });
      const mk = kernel.getMark(run.markDigest!)!;
      r.check(`${portId}: failed with ${code}`, [run.state, run.error?.code], ['failed', code]);
      r.check(`${portId}: no validated output`, [run.output, mk.outputDigest], [null, null]);
      r.check(`${portId}: mark verifies`, verifyMark(mk).ok, true);
      if (code === 'timeout') r.check('timeout enforced near deadline (<1 s)', performance.now() - t0 < 1000, true, { deterministic: false });
      codes.add(code);
      r.mark(mk.digest);
    }
    const bad = await kernel.run({ dmuId: 'math.check.v1', input: { question: 17 * 23 }, seatId: 'local-owner', portId: 'owned-fixture' });
    r.check('invalid input rejected before any Turn', [bad.state, bad.error?.code, bad.turns.length], ['failed', 'invalid-input', 0]);
    r.mark(bad.markDigest);
    r.check('distinct negative mark kinds ≥ 3', codes.size >= 3, true);
    r.metrics = { negativeKinds: [...codes], marksWritten: kernel.listMarks().length };
    return verdictFrom(r, 'valid answer completed; invalid output, timeout, refusal, partial stream and bad input all ended as typed failures with verifying Marks');
  });
