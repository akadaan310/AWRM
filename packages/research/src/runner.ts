import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPERIMENTS } from './experiments/index';
import { environment, resultsDir, type ExperimentResult } from './harness';

export async function runExperiments(ids: string[], log: (s: string) => void = console.log): Promise<ExperimentResult[]> {
  const out: ExperimentResult[] = [];
  for (const id of ids) {
    const fn = EXPERIMENTS[id];
    if (!fn) throw new Error(`unknown experiment ${id}; known: ${Object.keys(EXPERIMENTS).join(', ')}`);
    log(`▶ ${id} …`);
    const r = await fn();
    const failed = r.checks.filter((c) => !c.pass).length;
    log(`  ${r.verdict.padEnd(12)} ${r.checks.length - failed}/${r.checks.length} checks, ${r.marks.length} marks, ${r.durationMs} ms${r.blocked.length ? `, ${r.blocked.length} blocked/not-run path(s)` : ''}`);
    out.push(r);
  }
  if (ids.length === Object.keys(EXPERIMENTS).length) {
    writeFileSync(
      join(resultsDir(), 'summary.json'),
      JSON.stringify(
        {
          schema: 'awrm.experiment-summary/1',
          generatedAt: new Date().toISOString(),
          environment: environment(),
          results: out.map((r) => ({ id: r.id, title: r.title, hypotheses: r.hypotheses, verdict: r.verdict, checks: r.checks.length, failedChecks: r.checks.filter((c) => !c.pass).map((c) => c.name), marks: r.marks.length, blocked: r.blocked, durationMs: r.durationMs, deterministicDigest: r.deterministicDigest, command: r.command })),
        },
        null,
        2,
      ) + '\n',
    );
  }
  return out;
}

export const ALL_EXPERIMENTS = (): string[] => Object.keys(EXPERIMENTS);
