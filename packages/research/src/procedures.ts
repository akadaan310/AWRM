/**
 * The fixed registry of sandbox procedures a Seed may name. Seeds choose a
 * procedure and parameters; they cannot supply code. Every procedure is local,
 * deterministic in its inputs (seeded PRNG) and returns baseline vs candidate.
 */
import { canonicalJson, mathCheck, parseResponse, toSpec, type JsonSchema } from '@awrm/core';
import { REDACTION_RULES, redactText } from '@awrm/evidence';
import { RulePort, WorkerPoolPort, brainA, brainB } from '@awrm/ports';
import { benchmarkLanes } from '@awrm/scheduler';
import { freshEngine } from './harness';

export interface ProcedureOutcome {
  metric: string;
  higherIsBetter: boolean;
  baseline: number;
  candidate: number;
  /** Secondary constraint that must also hold for promotion. */
  guard: { name: string; ok: boolean; detail: string };
  details: Record<string, unknown>;
}

export type Procedure = (params: Record<string, unknown>) => Promise<ProcedureOutcome>;

export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Candidate redaction rules proposed by the redaction-coverage Seed (evaluated, not installed). */
export const CANDIDATE_REDACTION_RULES = [
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
];

export const PROCEDURES: Record<string, Procedure> = {
  async 'parser-strict-integer'() {
    // Ground-truth corpus: responses to "17 × 23" style questions from both brains + adversarial variants.
    const rnd = prng(12);
    const corpus: Array<{ text: string; truth: number }> = [];
    for (let i = 0; i < 200; i++) {
      const a = 2 + Math.floor(rnd() * 90);
      const b = 2 + Math.floor(rnd() * 90);
      const q = { system: mathCheck.prompt.system!, user: `Question: What is ${a} × ${b}?\nAnswer:` };
      corpus.push({ text: brainA(q), truth: a * b });
      corpus.push({ text: brainB(q), truth: a * b });
      corpus.push({ text: `${a * b + 1}`, truth: a * b }); // wrong answer
      corpus.push({ text: `I think ${a} times ${b} is ${a * b}`, truth: a * b }); // several integers
      corpus.push({ text: `about ${a * b - 3}, roughly`, truth: a * b }); // single wrong integer in prose
    }
    const evalParser = (strict: boolean) => {
      let accepted = 0;
      let falseAccept = 0;
      let goodAccept = 0;
      for (const c of corpus) {
        const out = strict
          ? /^-?\d+$/.test(c.text.trim())
            ? { answer: Number(c.text.trim()) }
            : { answer: c.text }
          : (parseResponse({ mode: 'integer', field: 'answer' }, c.text) as { answer: unknown });
        if (Number.isInteger(out.answer)) {
          accepted++;
          if (out.answer === c.truth) goodAccept++;
          else falseAccept++;
        }
      }
      return { accepted, falseAccept, goodAccept, falseAcceptRate: falseAccept / Math.max(1, accepted) };
    };
    const base = evalParser(false);
    const cand = evalParser(true);
    const goodputDrop = (base.goodAccept - cand.goodAccept) / Math.max(1, base.goodAccept);
    return {
      metric: 'false-accept rate among accepted answers',
      higherIsBetter: false,
      baseline: base.falseAcceptRate,
      candidate: cand.falseAcceptRate,
      guard: { name: 'correct-answer goodput drop ≤ 5%', ok: goodputDrop <= 0.05, detail: `goodput drop ${(goodputDrop * 100).toFixed(1)}%` },
      details: { base, cand, corpus: corpus.length },
    };
  },

  async 'redaction-coverage'() {
    const rnd = prng(7);
    const alnum = (n: number) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 62)]).join('');
    const upper = (n: number) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Math.floor(rnd() * 32)]).join('');
    const secrets: string[] = [];
    for (let i = 0; i < 20; i++) {
      secrets.push(`sk-ant-api03-${alnum(40)}`, `Bearer ${alnum(32)}`, `acsp_cap_${upper(10)}_${upper(32)}`, `purl_${alnum(32)}`, `ghp_${alnum(36)}`, `xoxb-${alnum(12)}-${alnum(24)}`, `AKIA${upper(16)}`);
    }
    const benign = ['The invoice is overdue.', 'sha256:' + 'a'.repeat(64), 'run_00000001', 'TOK-001', 'math.check.v1', 'AKIA is a word in this sentence', 'ghp_short', 'xoxb-1'];
    const detect = (extra: typeof CANDIDATE_REDACTION_RULES) => (s: string) => {
      if (redactText(s).text !== s) return true;
      return extra.some((r) => {
        r.re.lastIndex = 0;
        return r.re.test(s);
      });
    };
    const base = detect([]);
    const cand = detect(CANDIDATE_REDACTION_RULES);
    const rate = (f: (s: string) => boolean) => secrets.filter(f).length / secrets.length;
    const fp = (f: (s: string) => boolean) => benign.filter(f).length;
    return {
      metric: 'secret detection rate',
      higherIsBetter: true,
      baseline: rate(base),
      candidate: rate(cand),
      guard: { name: 'benign false positives do not increase', ok: fp(cand) <= fp(base), detail: `FP base ${fp(base)} → candidate ${fp(cand)}` },
      details: { baselineRules: REDACTION_RULES.map((r) => r.kind), candidateRules: CANDIDATE_REDACTION_RULES.map((r) => r.kind), missedByBaseline: [...new Set(secrets.filter((s) => !base(s)).map((s) => s.slice(0, 5)))] },
    };
  },

  async 'canonical-json-property'() {
    const rnd = prng(99);
    const gen = (depth: number): unknown => {
      const r = rnd();
      if (depth > 3 || r < 0.3) return [null, true, false, Math.floor(rnd() * 1e6) - 5e5, rnd() * 100, 'x' + Math.floor(rnd() * 1e3), 'ü "\\'][Math.floor(rnd() * 7)];
      if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(depth + 1));
      const o: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(rnd() * 5); i++) o[['b', 'a', 'é', 'A', '10', '2'][Math.floor(rnd() * 6)]! + i] = gen(depth + 1);
      return o;
    };
    let pass = 0;
    const failures: unknown[] = [];
    const N = 500;
    for (let i = 0; i < N; i++) {
      const v = gen(0);
      const c1 = canonicalJson(v);
      const c2 = canonicalJson(JSON.parse(c1));
      const shuffled = v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v;
      if (c1 === c2 && canonicalJson(shuffled) === c1) pass++;
      else failures.push(v);
    }
    return {
      metric: 'generated property cases passing (canonical JSON idempotence + key-order invariance)',
      higherIsBetter: true,
      baseline: 0,
      candidate: pass,
      guard: { name: 'no counterexample', ok: failures.length === 0, detail: `${failures.length} failures` },
      details: { cases: N, failures: failures.slice(0, 3) },
    };
  },

  async 'fleet-lane-optimum'(params) {
    const { kernel } = await freshEngine();
    const port = new WorkerPoolPort('cpu-pool', 8, Number(params.cpuWorkMs ?? 10), brainA);
    await kernel.registerPort(port);
    try {
      const pts = await benchmarkLanes(kernel, { portId: 'cpu-pool', seatId: 'local-owner', laneCounts: [1, 2, 4, 8], jobsPerPoint: 48 });
      const best = pts.reduce((a, b) => (b.throughputPerSec > a.throughputPerSec ? b : a));
      const at1 = pts[0]!.throughputPerSec;
      const at4 = pts.find((p) => p.lanes === 4)!.throughputPerSec;
      const at8 = pts.find((p) => p.lanes === 8)!.throughputPerSec;
      return {
        metric: 'throughput (DMU/s) at the recommended lane count vs 1 lane',
        higherIsBetter: true,
        baseline: at1,
        candidate: best.throughputPerSec,
        guard: { name: '8 lanes give < 15% over 4 lanes on this machine (saturation)', ok: at8 < at4 * 1.15, detail: `4→8 lanes: ${at4} → ${at8}/s` },
        details: { points: pts.map((p) => ({ lanes: p.lanes, tput: p.throughputPerSec, p95: p.p95Ms, cpu: p.cpuUtilisation })), recommendedLanes: best.lanes },
      };
    } finally {
      await port.close();
    }
  },

  async 'context-budget'() {
    const outs: Record<number, string[]> = {};
    for (const budget of [4000, 400, 120]) {
      const { kernel } = await freshEngine({ deterministic: true });
      outs[budget] = [];
      const texts = ['The invoice is overdue and must be paid by Friday.', 'My parcel has not arrived. Tracking is stuck.', 'The app crashes on login after the update.', 'Can I change my username?'];
      for (const t of texts) {
        const c = await kernel.run({ dmuId: 'text.classify.v1', input: { text: t }, seatId: 'local-a', portId: 'local-a' });
        const pass = kernel.passes.create({ fromMark: kernel.getMark(c.markDigest!)!, toSeatId: 'local-b', content: `label=${(c.output as { label: string }).label}`, scope: 'demo', consentRecord: 'owner:procedure' });
        const base = toSpec(kernel.getDmu('text.summarize.v1'));
        const def = kernel.registerDmu({ ...base, id: `text.summarize-ctx${budget}.v1`, form: { ...base.form, formId: `form.text.summarize-ctx${budget}`, context: { maxContextChars: budget, acceptsKeeps: true, acceptsPasses: true } } });
        const s = await kernel.run({ dmuId: def.id, input: { text: t }, seatId: 'local-b', portId: 'local-b', context: { passes: [pass.passId] } });
        outs[budget]!.push(JSON.stringify(s.output));
      }
    }
    const same = (b: number) => outs[b]!.filter((o, i) => o === outs[4000]![i]).length / outs[4000]!.length;
    return {
      metric: 'fraction of summaries unchanged when context budget shrinks 4000→400 chars',
      higherIsBetter: true,
      baseline: 1,
      candidate: same(400),
      guard: { name: 'outputs at 120 chars recorded (expected to change)', ok: true, detail: `unchanged at 120: ${same(120)}` },
      details: { outs },
    };
  },

  async 'backoff-tune'() {
    const measure = async (base: number) => {
      const { kernel } = await freshEngine();
      const lat: number[] = [];
      let ok = 0;
      for (let i = 0; i < 20; i++) {
        const port = new RulePort({ id: `flaky-${base}-${i}`, mode: 'flaky', flakyFailures: 1 });
        await kernel.registerPort(port);
        (kernel as unknown as { backoffBaseMs: number }).backoffBaseMs = base;
        const t0 = performance.now();
        const r = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 6 × 7?' }, seatId: 'local-owner', portId: port.id });
        lat.push(performance.now() - t0);
        if (r.state === 'completed') ok++;
      }
      lat.sort((a, b) => a - b);
      return { ok, p50: lat[10]! };
    };
    const a = await measure(50);
    const b = await measure(5);
    return {
      metric: 'p50 latency (ms) of a run that needs one retry',
      higherIsBetter: false,
      baseline: a.p50,
      candidate: b.p50,
      guard: { name: 'success count unchanged', ok: a.ok === b.ok, detail: `${a.ok} vs ${b.ok} of 20` },
      details: { base50: a, base5: b, note: 'applies only to side-effect-free local ports; external ports never retry blindly' },
    };
  },

  async 'remote-benchmark'() {
    // Declares only local-compute, but tries to reach the network: the sandbox must stop it.
    await fetch('https://example.com/benchmark');
    return { metric: 'n/a', higherIsBetter: true, baseline: 0, candidate: 0, guard: { name: 'n/a', ok: false, detail: '' }, details: {} };
  },
};

export type JsonSchemaRef = JsonSchema;
