/** Shared experiment infrastructure: fresh engines, checks, environment capture, result files. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalJson, digest, manualClock, sequentialIds, type Clock, type IdSource } from '@awrm/core';
import { MemorySecretSource } from '@awrm/identity';
import { RulePort } from '@awrm/ports';
import { createKernel, type Kernel } from '@awrm/runtime';
import { openStore } from '@awrm/store';

export type Verdict = 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE' | 'NOT_RUN' | 'OBSERVED' | 'BLOCKED';

export interface Check {
  name: string;
  expected: unknown;
  observed: unknown;
  pass: boolean;
  deterministic: boolean; // included in the reproducibility digest
}

export interface ExperimentResult {
  schema: 'awrm.experiment-result/1';
  id: string;
  title: string;
  hypotheses: string[];
  verdict: Verdict;
  verdictReason: string;
  command: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  environment: ReturnType<typeof environment>;
  checks: Check[];
  metrics: Record<string, unknown>;
  marks: string[];
  blocked: Array<{ path: string; status: 'BLOCKED' | 'NOT_RUN' | 'UNSUPPORTED'; reason: string }>;
  counterexamples: unknown[];
  notes: string[];
  deterministicDigest: string;
}

export class Recorder {
  checks: Check[] = [];
  metrics: Record<string, unknown> = {};
  marks: string[] = [];
  blocked: ExperimentResult['blocked'] = [];
  counterexamples: unknown[] = [];
  notes: string[] = [];

  check(name: string, observed: unknown, expected: unknown, opts: { deterministic?: boolean; pass?: boolean } = {}): boolean {
    const pass = opts.pass ?? canonicalJson(observed ?? null) === canonicalJson(expected ?? null);
    this.checks.push({ name, expected, observed, pass, deterministic: opts.deterministic ?? true });
    return pass;
  }
  mark(...d: Array<string | null | undefined>): void {
    for (const x of d) if (x) this.marks.push(x);
  }
  get allPass(): boolean {
    return this.checks.every((c) => c.pass);
  }
}

export function environment() {
  let commit: string | null = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    commit = null;
  }
  return { node: process.version, platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model ?? 'unknown', memMb: Math.round(totalmem() / 1048576), commit };
}

export function repoRoot(): string {
  return resolve(new URL('.', import.meta.url).pathname, '../../..');
}

export function resultsDir(): string {
  const d = process.env.AWRM_RESULTS_DIR ?? join(repoRoot(), 'research', 'results');
  mkdirSync(d, { recursive: true });
  return d;
}

export function tempDir(prefix: string): { dir: string; cleanup(): void } {
  const base = process.env.AWRM_TMP ?? tmpdir();
  const dir = mkdtempSync(join(base, `awrm-${prefix}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface EngineSetup {
  kernel: Kernel;
  secrets: MemorySecretSource;
  ports: { fixture: RulePort; localA: RulePort; localB: RulePort };
}

/** A fresh engine with the three standard local ports. Deterministic mode fixes ids and time. */
export async function freshEngine(o: { dir?: string; deterministic?: boolean; seats?: string[]; clock?: Clock; ids?: IdSource } = {}): Promise<EngineSetup> {
  const secrets = new MemorySecretSource();
  const kernel = createKernel({
    store: o.dir ? openStore({ kind: 'jsonl', dir: o.dir }) : openStore({ kind: 'memory' }),
    secrets,
    localSeats: o.seats ?? ['local-owner', 'local-a', 'local-b'],
    backoffBaseMs: 5,
    ...(o.deterministic ? { clock: o.clock ?? manualClock(), ids: o.ids ?? sequentialIds() } : {}),
    ...(o.clock && !o.deterministic ? { clock: o.clock } : {}),
    ...(o.ids && !o.deterministic ? { ids: o.ids } : {}),
  });
  const fixture = new RulePort({ id: 'owned-fixture', brain: 'A', label: 'owned in-process fixture (rule program A)' });
  const localA = new RulePort({ id: 'local-a', brain: 'A', kind: 'local-model', label: 'local adapter A: keyword/regex rule program (test double)' });
  const localB = new RulePort({ id: 'local-b', brain: 'B', kind: 'local-model', label: 'local adapter B: centroid/shunting-yard rule program (test double)' });
  for (const p of [fixture, localA, localB]) await kernel.registerPort(p);
  return { kernel, secrets, ports: { fixture, localA, localB } };
}

export async function runExperiment(
  meta: { id: string; title: string; hypotheses: string[] },
  body: (r: Recorder) => Promise<{ verdict: Verdict; reason: string }>,
): Promise<ExperimentResult> {
  const r = new Recorder();
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let verdict: Verdict;
  let reason: string;
  try {
    ({ verdict, reason } = await body(r));
  } catch (e) {
    verdict = 'INCONCLUSIVE';
    reason = `experiment crashed: ${(e as Error).stack ?? e}`;
  }
  const result: ExperimentResult = {
    schema: 'awrm.experiment-result/1',
    id: meta.id,
    title: meta.title,
    hypotheses: meta.hypotheses,
    verdict,
    verdictReason: reason,
    command: `awrm experiments run ${meta.id}`,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - t0),
    environment: environment(),
    checks: r.checks,
    metrics: r.metrics,
    marks: [...new Set(r.marks)],
    blocked: r.blocked,
    counterexamples: r.counterexamples,
    notes: r.notes,
    deterministicDigest: digest(r.checks.filter((c) => c.deterministic).map((c) => ({ name: c.name, observed: c.observed, pass: c.pass }))),
  };
  writeFileSync(join(resultsDir(), `${meta.id}.json`), JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function verdictFrom(r: Recorder, supported = 'all checks passed'): { verdict: Verdict; reason: string } {
  const failed = r.checks.filter((c) => !c.pass);
  return failed.length ? { verdict: 'REFUTED', reason: `failed checks: ${failed.map((c) => c.name).join('; ')}` } : { verdict: 'SUPPORTED', reason: supported };
}
