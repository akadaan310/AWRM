import { RulePort } from '@awrm/ports';
import { createKernel, manualClock, MemorySecretSource } from '@awrm/runtime';
import { sequentialIds } from '@awrm/core';

export async function kernelWithPorts(o: { deterministic?: boolean; clock?: ReturnType<typeof manualClock> } = {}) {
  const secrets = new MemorySecretSource();
  const clock = o.clock ?? (o.deterministic ? manualClock() : undefined);
  const kernel = createKernel({ secrets, backoffBaseMs: 1, ...(clock ? { clock, ids: sequentialIds() } : {}) });
  const fixture = new RulePort({ id: 'owned-fixture' });
  const localA = new RulePort({ id: 'local-a', kind: 'local-model' });
  const localB = new RulePort({ id: 'local-b', brain: 'B', kind: 'local-model' });
  for (const p of [fixture, localA, localB]) await kernel.registerPort(p);
  return { kernel, secrets, fixture, localA, localB, clock };
}

export const Q = { question: 'What is 17 × 23?', response_format: 'integer' } as const;
