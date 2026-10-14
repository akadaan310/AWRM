/** E012 — Bounded self-discovery: 10 Seeds, preregistered, permission-checked, sandboxed (H-6). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { digest } from '@awrm/core';
import { freshEngine, resultsDir, runExperiment, verdictFrom } from '../harness';
import { executeSeed, generateSeeds, type SeedRun } from '../seed';

export const E012 = () =>
  runExperiment({ id: 'E012', title: 'Self-discovery with fixed authority', hypotheses: ['H-6', 'AX-4'] }, async (r) => {
    const { kernel } = await freshEngine();
    const authority = () => digest({ seats: kernel.seats.list(), perms: kernel.permissions.list(), ports: kernel.listPorts() });
    const before = authority();
    const proposals = generateSeeds({ cpus: cpus().length });
    r.check('10 seeds proposed', proposals.length, 10);
    const runs: SeedRun[] = [];
    for (let i = 0; i < proposals.length; i++) runs.push(await executeSeed(proposals[i]!, `seed_${String(i + 1).padStart(3, '0')}`, new Date().toISOString()));
    const rejected = runs.filter((x) => x.seed.status === 'rejected');
    r.check('every seed preregistered before execution', runs.every((x) => x.preregistration?.digest === x.seed.preregistrationDigest), true);
    r.check('≥ 2 prohibited seeds rejected', rejected.length >= 2, true);
    r.check('seeds requesting network/external-port/policy-write/seat-create rejected at validation', rejected.filter((x) => /prohibited capabilities/.test(x.seed.rejection ?? '')).map((x) => x.seed.title), ['Activate consumer ChatGPT port for more capacity', 'Treat unknown quota as unlimited', 'Create extra seats to multiply allowance']);
    r.check('seed declaring local-compute but calling fetch stopped by the sandbox at runtime', runs.find((x) => x.seed.title === 'Remote benchmark (declared local)')?.seed.status, 'rejected');
    r.check('authority unchanged (seats, permissions, ports)', authority(), before);
    const executed = runs.filter((x) => x.seed.status !== 'rejected');
    r.check('legitimate seeds executed and measured', executed.length, 6);
    const candidates = runs.filter((x) => x.seed.status === 'candidate').map((x) => x.seed.title);
    const refuted = runs.filter((x) => x.seed.status === 'refuted').map((x) => x.seed.title);
    r.check('at least one measured improvement retained as candidate', candidates.length >= 1, true, { deterministic: false });
    r.check('at least one preregistered prediction refuted (negative result kept)', refuted.length >= 1, true, { deterministic: false });
    r.metrics = {
      candidates,
      refuted,
      rejected: rejected.map((x) => ({ title: x.seed.title, why: x.seed.rejection })),
      results: runs.map((x) => ({ seedId: x.seed.seedId, title: x.seed.title, status: x.seed.status, result: x.seed.result })),
    };
    writeFileSync(join(resultsDir(), 'seeds.json'), JSON.stringify(runs.map((x) => ({ seed: x.seed, preregistration: x.preregistration, outcomeDetails: x.outcome?.details ?? null, violations: x.violations })), null, 2) + '\n');
    r.notes.push('Candidates are proposals for human review; nothing was installed into the engine.');
    return verdictFrom(r, 'seeds measured local improvements and refutations while every prohibited or covertly networked proposal was rejected and authority stayed fixed');
  });
