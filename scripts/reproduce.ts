/**
 * Runs every experiment twice into two fresh result directories and compares
 * each experiment's deterministicDigest (digest over checks marked
 * deterministic: names, observed values, pass/fail). Writes
 * research/results/REPRODUCIBILITY.json.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_EXPERIMENTS, environment, runExperiments } from '@awrm/research';

const root = join(import.meta.dirname, '..');
const finalDir = process.env.AWRM_RESULTS_DIR ?? join(root, 'research', 'results');
const runs: Record<string, { verdict: string; deterministicDigest: string }>[] = [];
for (const i of [1, 2]) {
  process.env.AWRM_RESULTS_DIR = mkdtempSync(join(tmpdir(), `awrm-repro-${i}-`));
  const res = await runExperiments(ALL_EXPERIMENTS(), () => {});
  runs.push(Object.fromEntries(res.map((r) => [r.id, { verdict: r.verdict, deterministicDigest: r.deterministicDigest }])));
  console.log(`run ${i}: ${res.map((r) => `${r.id}=${r.verdict}`).join(' ')}`);
}
const rows = ALL_EXPERIMENTS().map((id) => ({ id, run1: runs[0]![id], run2: runs[1]![id], identical: runs[0]![id]!.deterministicDigest === runs[1]![id]!.deterministicDigest && runs[0]![id]!.verdict === runs[1]![id]!.verdict }));
const out = { schema: 'awrm.reproducibility/1', generatedAt: new Date().toISOString(), environment: environment(), liveReferences: { purl: Boolean(process.env.AWRM_PURL_URL), acsp: Boolean(process.env.AWRM_ACSP_URL) }, rows, identical: rows.filter((r) => r.identical).length, total: rows.length };
writeFileSync(join(finalDir, 'REPRODUCIBILITY.json'), JSON.stringify(out, null, 2) + '\n');
for (const r of rows) console.log(`${r.identical ? 'SAME' : 'DIFF'}  ${r.id.padEnd(6)} ${r.run1!.verdict.padEnd(10)} ${r.run1!.deterministicDigest.slice(0, 23)} ${r.run2!.deterministicDigest.slice(0, 23)}`);
console.log(`${out.identical}/${out.total} experiments reproduced their deterministic digest and verdict`);
