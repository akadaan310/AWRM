/**
 * X001 — INTENTIONALLY FAILING experiment (negative control).
 * Preregistered naive hypothesis: "Opening N virtual views of one account multiplies permitted calls by N."
 * AWRM predicts this is false. The counterexample is preserved.
 */
import { localSeat } from '@awrm/identity';
import { RulePort } from '@awrm/ports';
import { freshEngine, runExperiment } from '../harness';

export const X001 = () =>
  runExperiment({ id: 'X001', title: 'Negative control: "N views ⇒ N× allowance" (expected REFUTED)', hypotheses: ['naive-H5-complement'] }, async (r) => {
    const { kernel } = await freshEngine({ seats: [] });
    await kernel.registerPort(new RulePort({ id: 'p' }));
    const N = 4;
    const allowance = 3;
    for (let i = 0; i < N; i++) kernel.seats.register(localSeat(`view-${i}`, { quotaKey: 'acct:one' }));
    kernel.ledger.configure({ quotaKey: 'acct:one', limit: allowance, windowMs: null, source: 'simulated account allowance' });
    let admitted = 0;
    const trace: string[] = [];
    for (let i = 0; i < N * allowance; i++) {
      const run = await kernel.run({ dmuId: 'math.check.v1', input: { question: `What is ${i} + 1?` }, seatId: `view-${i % N}`, portId: 'p' });
      if (run.state === 'completed') admitted++;
      trace.push(`view-${i % N}:${run.state}${run.gate?.code && run.state !== 'completed' ? `(${run.gate.code})` : ''}`);
    }
    const predicted = N * allowance;
    r.check(`naive prediction: ${predicted} admitted calls`, admitted, predicted);
    if (admitted !== predicted) r.counterexamples.push({ views: N, allowancePerAccount: allowance, predictedAdmitted: predicted, observedAdmitted: admitted, trace });
    r.metrics = { admitted, predicted };
    return admitted === predicted
      ? { verdict: 'SUPPORTED', reason: 'UNEXPECTED: quota was amplified by views — this would be a Gate defect' }
      : { verdict: 'REFUTED', reason: `as intended: ${N} views of one account admitted ${admitted}, not ${predicted}; counterexample preserved` };
  });
