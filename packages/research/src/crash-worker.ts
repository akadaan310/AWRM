/**
 * Child process for E011. Opens a JSONL-backed kernel, completes one run and a
 * Keep, starts two long runs (one side-effect-free, one with unknown side
 * effects), reports READY and waits to be SIGKILLed mid-Turn.
 */
import { createKernel } from '@awrm/runtime';
import { openStore } from '@awrm/store';
import { RulePort } from '@awrm/ports';
import { UnknownEffectsPort } from './experiments/e011-ports';

const dir = process.argv[2]!;
const kernel = createKernel({ store: openStore({ kind: 'jsonl', dir }), localSeats: ['local-owner'] });
await kernel.registerPort(new RulePort({ id: 'fast' }));
await kernel.registerPort(new RulePort({ id: 'slow-local', latencyMs: 60_000 }));
await kernel.registerPort(new UnknownEffectsPort('slow-external-like', 60_000));
const done = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 12 × 12?' }, seatId: 'local-owner', portId: 'fast' });
kernel.keeps.write({ keepId: 'last-square', content: { q: '12×12', a: (done.output as { answer: number }).answer }, mark: kernel.getMark(done.markDigest!)!, scope: 'e011', readers: ['local-owner'], consentRecord: 'owner:e011' });
const a = kernel.submit({ dmuId: 'math.check.v1', input: { question: 'What is 21 × 2?' }, seatId: 'local-owner', portId: 'slow-local' });
const b = kernel.submit({ dmuId: 'math.check.v1', input: { question: 'What is 9 × 9?' }, seatId: 'local-owner', portId: 'slow-external-like' });
void kernel.execute(a.runId);
void kernel.execute(b.runId);
setTimeout(() => process.stdout.write(JSON.stringify({ ready: true, completed: done.runId, a: a.runId, b: b.runId }) + '\n'), 200);
setInterval(() => {}, 1000);
