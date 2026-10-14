/**
 * awrm — command-line interface. Every engine command goes through the same
 * loopback HTTP API and SDK that external callers use; no browser is needed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { AwrmClient, startApi, newApiToken, type ApiHandle } from '@awrm/api';
import { ELIGIBILITY, assess } from '@awrm/policy';
import { RulePort, WorkerPoolPort, brainA } from '@awrm/ports';
import { createKernel, type Kernel } from '@awrm/runtime';
import { benchmarkLanes } from '@awrm/scheduler';
import { openStore, sqliteAvailable } from '@awrm/store';
import { nodeFetch, recordingFetch, replayFetch, type WireRecord } from '@awrm/interop';
import { ALL_EXPERIMENTS, Recorder, acspScenario, deterministicPass, purlScenario, repoRoot, resultsDir, runExperiments, selfAudit } from '@awrm/research';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--') && !['--all', '--offline', '--latest', '--json'].includes(argv[i - 1]!)));
const out = (s: string): void => void process.stdout.write(s + '\n');
const home = (): string => resolve(process.env.AWRM_HOME ?? join(process.cwd(), '.awrm'));

async function engine(opts: { onnx?: boolean } = {}): Promise<{ kernel: Kernel; api: ApiHandle; client: AwrmClient; close(): Promise<void> }> {
  const dir = home();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const kernel = createKernel({ store: openStore({ kind: (process.env.AWRM_STORE as 'jsonl' | 'sqlite') ?? 'jsonl', dir: join(dir, 'store') }) });
  for (const p of [new RulePort({ id: 'owned-fixture' }), new RulePort({ id: 'local-a', kind: 'local-model' }), new RulePort({ id: 'local-b', brain: 'B', kind: 'local-model' })]) await kernel.registerPort(p);
  if (opts.onnx) {
    const { OnnxText2TextPort } = await import('@awrm/port-onnx');
    await kernel.registerPort(new OnnxText2TextPort({ id: 'onnx-local' }));
  }
  const recovered = kernel.recover();
  if (recovered.requeued.length || recovered.ambiguous.length) out(`recovered: ${JSON.stringify(recovered)}`);
  const api = await startApi({ kernel, token: newApiToken() });
  const client = new AwrmClient(api.url, api.token);
  return { kernel, api, client, close: async () => (await api.close(), await kernel.closePorts(), kernel.store.close()) };
}

function table(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '(none)';
  const cols = Object.keys(rows[0]!);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i]!)).join('  ');
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => String(r[c] ?? ''))))].join('\n');
}

const commands: Record<string, () => Promise<number>> = {
  async doctor() {
    const chromium = (process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers') + '/chromium-1194/chrome-linux/chrome';
    const rows = [
      { item: 'node', value: process.version, note: Number(process.versions.node.split('.')[0]) >= 20 ? 'ok (≥20)' : 'TOO OLD' },
      { item: 'cpu / memory', value: `${cpus().length} cores / ${Math.round(totalmem() / 1048576)} MB`, note: '' },
      { item: 'store backends', value: `jsonl${sqliteAvailable() ? ', sqlite' : ''}`, note: sqliteAvailable() ? 'node:sqlite available' : 'node:sqlite unavailable (Node < 22.5)' },
      { item: 'data dir', value: home(), note: existsSync(home()) ? 'exists' : 'created on first run' },
      { item: 'optional browser port', value: (await import('@awrm/browser-port')).browserAvailable().ok ? 'installed' : 'absent', note: existsSync(chromium) ? `chromium at ${chromium}` : 'no chromium found (browser port NOT_RUN)' },
      { item: 'optional local model port', value: (await import('@awrm/port-onnx')).onnxAvailable().ok ? 'installed' : 'absent', note: `cache ${process.env.AWRM_MODEL_CACHE ?? '~/.cache/awrm/models'}` },
      { item: 'PURL reference', value: process.env.AWRM_PURL_URL ?? 'unset', note: 'black-box server URL for live interop' },
      { item: 'ACSP reference', value: process.env.AWRM_ACSP_URL ?? 'unset', note: 'black-box server URL for live interop' },
      ...['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'].map((k) => ({ item: `credential ${k}`, value: process.env[k] ? 'present' : 'absent', note: 'value never read by doctor' })),
    ];
    out(table(rows));
    return 0;
  },

  async dmus() {
    const e = await engine();
    try {
      const { dmus } = await e.client.dmus();
      out(table(dmus.map((d) => ({ id: d.id, title: d.title, ports: d.allowedPortKinds.join(','), digest: d.digest.slice(0, 19) + '…' }))));
      return 0;
    } finally {
      await e.close();
    }
  },

  async providers() {
    const now = Date.parse('2026-10-14T12:00:00Z');
    out(table(ELIGIBILITY.map((r) => {
      let gate = r.mode === 'consumer-human' ? 'n/a (human use)' : 'permit (local)';
      if (r.record) {
        const input = { actor: { id: 'owner', kind: 'owner' as const }, seat: { seatId: 's', provider: r.provider, principal: 'owner-account' as const, quotaKey: 'q', allowedPortKinds: [r.record.portKind], permissionRecordIds: [r.record.id], scopes: [] }, port: { id: 'p', kind: r.record.portKind, label: '', liveness: 'external-live' as const, provider: r.provider, network: 'external' as const, sideEffects: 'unknown' as const, streaming: false }, operation: 'prompt' as const, permission: r.record, quota: { quotaKey: 'q', limit: 1, used: 0, windowMs: 1, blockedUntil: null }, budget: { maxCalls: 1, callsUsed: 0, maxWallMs: 1, wallMsUsed: 0 }, now, phase: 'enqueue' as const };
        const d = assess(input);
        const cf = assess({ ...input, permission: { ...r.record, ownerPermission: 'granted' } });
        gate = `${d.verdict}: ${d.code}`;
        return { provider: r.provider, mode: r.mode, status: r.status, gate, 'if owner consents': `${cf.verdict}${cf.verdict === 'deny' ? ': ' + cf.code : ' (still needs key + quota)'}`, port: r.awrmPort ?? '—' };
      }
      return { provider: r.provider, mode: r.mode, status: r.status, gate, 'if owner consents': '—', port: r.awrmPort ?? '—' };
    })));
    out('\nSources and quotes: docs/PROVIDER_ELIGIBILITY.md (accessed 2026-10-14). Unknown ⇒ denied.');
    return 0;
  },

  async run() {
    const dmuId = positional[1];
    if (!dmuId) throw new Error('usage: awrm run <dmuId> --port <portId> --input <json> [--seat <seatId>]');
    const portId = flag('port') ?? 'owned-fixture';
    const raw = flag('input') ?? '{}';
    const input: unknown = JSON.parse(raw);
    const e = await engine({ onnx: portId === 'onnx-local' });
    try {
      const seatId = flag('seat') ?? (portId === 'local-b' ? 'local-b' : portId === 'local-a' ? 'local-a' : 'local-owner');
      const { run } = await e.client.run({ dmuId, input, seatId, portId }, { wait: true, ...(flag('idempotency-key') ? { idempotencyKey: flag('idempotency-key')! } : {}) });
      const m = run.markDigest ? (await e.client.mark(run.markDigest)).mark : null;
      if (has('json')) out(JSON.stringify({ run, mark: m }, null, 2));
      else {
        out(`run      ${run.runId}`);
        out(`state    ${run.state}${run.error ? `  (${run.error.code}: ${run.error.message})` : ''}`);
        out(`output   ${JSON.stringify(run.output)}`);
        out(`port     ${m?.port.id} [${m?.port.kind}, ${m?.port.liveness}]  model=${m?.port.model ?? '—'}`);
        out(`gate     ${run.gate?.verdict}: ${run.gate?.code}`);
        out(`elapsed  ${m?.timing.elapsedMs ?? '—'} ms`);
        out(`mark     ${run.markDigest}`);
      }
      return run.state === 'completed' ? 0 : 2;
    } finally {
      await e.close();
    }
  },

  async marks() {
    const e = await engine();
    try {
      let digest = positional[2];
      if (!digest || has('latest')) {
        const list = await e.client.marks(1);
        digest = list.marks.at(-1)?.digest;
        if (!digest) {
          out('no marks yet — run `awrm run …` first');
          return 1;
        }
      }
      const { mark, verification } = await e.client.mark(digest);
      out(`mark     ${mark.digest}`);
      out(`dmu      ${mark.dmu.id}  verdict=${mark.verdict}  port=${mark.port.id}`);
      out(`digest   ${verification.structural.ok ? 'OK' : 'FAIL ' + verification.structural.problems.join('; ')}`);
      out(`content  ${verification.content.ok ? 'OK' : 'FAIL ' + verification.content.problems.join('; ')}`);
      return verification.ok ? 0 : 3;
    } finally {
      await e.close();
    }
  },

  async fleet() {
    const portName = flag('ports') ?? 'owned-fixture';
    const lanes = (flag('lanes') ?? '1,2,4,8').split(',').map(Number);
    const jobs = Number(flag('jobs') ?? 64);
    const kernel = createKernel();
    let close = async () => {};
    if (portName === 'cpu-pool') {
      const p = new WorkerPoolPort('cpu-pool', Math.max(...lanes), Number(flag('cpu-ms') ?? 20), brainA);
      close = () => p.close();
      await kernel.registerPort(p);
    } else await kernel.registerPort(new RulePort({ id: portName, latencyMs: Number(flag('latency-ms') ?? (portName === 'owned-fixture' ? 0 : 20)) }));
    try {
      const pts = await benchmarkLanes(kernel, { portId: portName, seatId: 'local-owner', laneCounts: lanes, jobsPerPoint: jobs });
      out(table(pts.map((p) => ({ lanes: p.lanes, jobs: p.jobs, 'DMU/s': p.throughputPerSec, goodput: p.goodputPerSec, p50ms: p.p50Ms, p95ms: p.p95Ms, p99ms: p.p99Ms, cpu: p.cpuUtilisation, rssMB: p.rssMb, jain: p.jain, maxInFlight: p.maxInFlightObserved }))));
      out('\nLocal capacity only. No provider quota is involved or implied.');
      return 0;
    } finally {
      await close();
    }
  },

  async passes() {
    const source = flag('source') ?? 'local-a';
    const target = flag('target') ?? 'local-b';
    const e = await engine();
    try {
      const text = 'The invoice is overdue and must be paid by Friday. The customer asked for a receipt.';
      const { run: cls } = await e.client.run({ dmuId: 'text.classify.v1', input: { text }, seatId: source, portId: source }, { wait: true });
      out(`1. ${source} classify → ${cls.state} ${JSON.stringify(cls.output)}  mark ${cls.markDigest}`);
      const { pass } = await e.client.createPass({ fromMark: cls.markDigest!, toSeatId: target, content: `label=${(cls.output as { label: string }).label}`, scope: 'cli-demo', consentRecord: 'owner:cli-demo' });
      out(`2. Pass ${pass.passId} ${source}→${target}  digest ${pass.digest}  (data only; no seat, credential or quota)`);
      const { run: sum } = await e.client.run({ dmuId: 'text.summarize.v1', input: { text }, seatId: target, portId: target, context: { passes: [pass.passId] } }, { wait: true });
      out(`3. ${target} summarize with Pass → ${sum.state} ${JSON.stringify(sum.output)}  mark ${sum.markDigest}`);
      let refused = '';
      await e.client.createPass({ fromMark: cls.markDigest!, toSeatId: target, content: 'x', scope: 'cli-demo', consentRecord: 'owner', credentialRef: 'vault:anything' }).catch((err: Error) => (refused = err.message));
      out(`4. Pass carrying credentialRef → refused: ${refused}`);
      return sum.state === 'completed' && refused ? 0 : 2;
    } finally {
      await e.close();
    }
  },

  async interop() {
    const protocol = flag('protocol');
    if (protocol !== 'purl' && protocol !== 'acsp') throw new Error('usage: awrm interop check --protocol purl|acsp (--offline | --live <url>)');
    const live = flag('live') ?? (has('offline') ? undefined : process.env[protocol === 'purl' ? 'AWRM_PURL_URL' : 'AWRM_ACSP_URL']);
    const r = new Recorder();
    const pass = await deterministicPass();
    let mode: string;
    if (live) {
      const log: WireRecord[] = [];
      const f = recordingFetch(nodeFetch, log, live);
      if (protocol === 'purl') await purlScenario(r, live, f, 'live', pass);
      else await acspScenario(r, live, f, 'live', pass, Date.now().toString(36));
      mode = `LIVE against ${live}`;
    } else {
      const golden = join(repoRoot(), 'fixtures', 'interop', `${protocol}.golden.json`);
      if (!existsSync(golden)) {
        out(`NOT_REFERENCE_VERIFIED: no recording at ${golden}; pass --live <url>`);
        return 4;
      }
      const g = JSON.parse(readFileSync(golden, 'utf8')) as { base: string; runKey: string; exchanges: WireRecord[]; recordedAt: string; reference: string };
      const f = replayFetch(g.exchanges, g.base);
      if (protocol === 'purl') await purlScenario(r, g.base, f as never, 'replay', pass);
      else await acspScenario(r, g.base, f as never, 'replay', pass, g.runKey);
      mode = `OFFLINE replay of a recording made against the reference server (${g.reference}, ${g.recordedAt}) — not a live verification`;
    }
    for (const c of r.checks) out(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    out(`\nmode: ${mode}`);
    return r.allPass ? 0 : 5;
  },

  async experiments() {
    const ids = has('all') ? ALL_EXPERIMENTS() : positional.slice(2);
    if (!ids.length) throw new Error(`usage: awrm experiments run --all | <ids…>  (known: ${ALL_EXPERIMENTS().join(' ')})`);
    const res = await runExperiments(ids, out);
    out(`\nresults written to ${resultsDir()}`);
    // A REFUTED X001 is the intended negative control; anything else REFUTED/INCONCLUSIVE is a failure.
    const bad = res.filter((r) => (r.verdict === 'REFUTED' && r.id !== 'X001') || r.verdict === 'INCONCLUSIVE' || (r.id === 'X001' && r.verdict !== 'REFUTED'));
    return bad.length ? 6 : 0;
  },

  async report() {
    const p = join(resultsDir(), 'summary.json');
    if (!existsSync(p)) {
      out('no summary yet — run `awrm experiments run --all`');
      return 1;
    }
    const s = JSON.parse(readFileSync(p, 'utf8')) as { generatedAt: string; environment: { commit: string | null; node: string; cpus: number }; results: Array<{ id: string; verdict: string; checks: number; failedChecks: string[]; marks: number; blocked: unknown[]; durationMs: number; title: string }> };
    out(`AWRM experiment report — generated ${s.generatedAt}, commit ${s.environment.commit ?? 'uncommitted'}, node ${s.environment.node}, ${s.environment.cpus} cores\n`);
    out(table(s.results.map((r) => ({ id: r.id, verdict: r.verdict, checks: `${r.checks - r.failedChecks.length}/${r.checks}`, marks: r.marks, 'blocked/not-run': r.blocked.length, ms: r.durationMs, title: r.title.slice(0, 60) }))));
    const a = selfAudit();
    out(`\nself-audit: ${a.ok ? 'OK' : 'FINDINGS'} (${a.findings.filter((f) => f.level === 'error').length} errors, ${a.findings.filter((f) => f.level === 'warn').length} warnings)`);
    out('Full narrative: MISSION_REPORT.md · research/PAPER.md · research/results/*.json');
    return 0;
  },

  async audit() {
    const a = selfAudit();
    for (const f of a.findings) out(`${f.level.toUpperCase().padEnd(5)} ${f.check}: ${f.detail}${f.where ? `  (${f.where})` : ''}`);
    return a.ok ? 0 : 7;
  },

  async serve() {
    const dir = home();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const kernel = createKernel({ store: openStore({ kind: 'jsonl', dir: join(dir, 'store') }) });
    for (const p of [new RulePort({ id: 'owned-fixture' }), new RulePort({ id: 'local-a', kind: 'local-model' }), new RulePort({ id: 'local-b', brain: 'B', kind: 'local-model' })]) await kernel.registerPort(p);
    kernel.recover();
    const token = newApiToken();
    const tokenFile = join(dir, 'api-token');
    writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    const api = await startApi({ kernel, token, port: Number(flag('port') ?? 7357) });
    out(`AWRM API listening on ${api.url} (loopback only)`);
    out(`token: ${tokenFile} (mode 0600) — send as Authorization: Bearer <token>`);
    await new Promise(() => {});
    return 0;
  },
};

const aliases: Record<string, string> = { 'dmus list': 'dmus', 'providers assess': 'providers', 'marks verify': 'marks', 'fleet benchmark': 'fleet', 'passes demo': 'passes', 'interop check': 'interop', 'experiments run': 'experiments' };
const key = aliases[`${argv[0]} ${argv[1]}`] ?? argv[0];
const cmd = key ? commands[key] : undefined;
if (!cmd) {
  out('usage: awrm <doctor | dmus list | providers assess | run <dmu> | marks verify [--latest|<digest>] | fleet benchmark | passes demo | interop check | experiments run | report | audit | serve>');
  process.exit(argv.length ? 1 : 0);
}
cmd()
  .then((code) => process.exit(code))
  .catch((e: Error) => {
    process.stderr.write(`awrm: ${e.message}\n`);
    process.exit(1);
  });
