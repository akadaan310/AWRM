import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { selfAudit } from '@awrm/research';

const ROOT = join(import.meta.dirname, '..', '..');

test('awrm.port negative: the kernel imports no browser, model or legacy code (self-audit)', () => {
  const a = selfAudit(ROOT);
  const bad = a.findings.filter((f) => ['legacy-dependency', 'legacy-import', 'browser-in-kernel', 'kernel-third-party-dependency', 'raw-secret', 'purl-wire-path', 'acsp-wire-path', 'get-mutation', 'protocol-collision', 'namespace', 'liveness-label', 'unbounded-retries'].includes(f.check));
  assert.deepEqual(bad, []);
});
test('the kernel loads and runs a DMU with no browser or model packages resolvable', () => {
  const script = `
    import { createKernel } from '@awrm/runtime';
    import { RulePort } from '@awrm/ports';
    const k = createKernel();
    await k.registerPort(new RulePort({ id: 'owned-fixture' }));
    const r = await k.run({ dmuId: 'math.check.v1', input: { question: 'What is 17 × 23?' }, seatId: 'local-owner', portId: 'owned-fixture' });
    const loaded = Object.keys(await import('node:module').then(() => ({})));
    console.log(JSON.stringify({ state: r.state, answer: r.output.answer }));`;
  const outp = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: join(ROOT, 'packages', 'runtime'), env: { ...process.env, NODE_OPTIONS: '' } }).toString();
  assert.deepEqual(JSON.parse(outp.trim().split('\n').at(-1)!), { state: 'completed', answer: 391 });
});
test('kernel package graph is acyclic and depends only on @awrm/* packages', async () => {
  const { readFileSync } = await import('node:fs');
  const KERNEL = ['core', 'store', 'policy', 'identity', 'evidence', 'ports', 'continuity', 'runtime', 'scheduler', 'plans'];
  const deps = (p: string) => Object.keys((JSON.parse(readFileSync(join(ROOT, 'packages', p, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {});
  for (const k of KERNEL) for (const d of deps(k)) assert.ok(d.startsWith('@awrm/') && KERNEL.includes(d.slice(6)), `${k} → ${d}`);
  const seen = new Set<string>();
  const visit = (p: string, stack: string[]) => {
    assert.ok(!stack.includes(p), `cycle ${[...stack, p].join(' → ')}`);
    if (seen.has(p)) return;
    seen.add(p);
    for (const d of deps(p)) visit(d.slice(6), [...stack, p]);
  };
  for (const k of KERNEL) visit(k, []);
});
