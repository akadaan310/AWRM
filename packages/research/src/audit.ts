/**
 * Self-audit: static checks over this repository for the failure modes the
 * mission names. Each finding is evidence-backed (file:line). Run with
 * `awrm audit`; CI fails on any error-level finding.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BUDGET_CEILING, EXTERNAL_VOCABULARY, LEXICON } from '@awrm/core';
import { REDACTION_RULES } from '@awrm/evidence';
import { repoRoot } from './harness';

export interface Finding {
  check: string;
  level: 'error' | 'warn' | 'ok';
  detail: string;
  where?: string;
}

const KERNEL = ['core', 'store', 'policy', 'identity', 'evidence', 'ports', 'continuity', 'runtime', 'scheduler', 'plans'];
const LEGACY = /golden-surface|luna-foundry|netgovcomedu|NetGovComEduGovOrgEduGovComNet|gis-substrate|gis-browser-sidecar|pearl-substrate|pearl-foundry|aanebed|netscape-surface|my-sneaky-ai|\bMUSA\b/i;
const LEGACY_PKG = /^(seurl|purl|acsp|golden-surface|luna-foundry|pearl[-\w]*|aanebed[-\w]*|gis-[-\w]*|netscape-surface)$/;
const BROWSER = /playwright|puppeteer|@awrm\/browser-port|@awrm\/port-onnx|@huggingface|selenium|webview|android/i;
/** Files that deliberately contain fake secret-shaped strings as test data. */
const SECRET_FIXTURE_ALLOW = [/packages\/fixtures\/src\/hostile\.ts$/, /packages\/research\/src\/procedures\.ts$/, /packages\/research\/src\/experiments\/e00[78]\.ts$/, /packages\/research\/src\/experiments\/e010\.ts$/, /packages\/ports\/src\/rule-port\.ts$/, /packages\/evidence\/src\/redact\.ts$/, /^tests\//];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git', 'results', '.awrm'].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|json|md)$/.test(e)) out.push(p);
  }
  return out;
}

export function selfAudit(root = repoRoot()): { ok: boolean; findings: Finding[] } {
  const f: Finding[] = [];
  const files = walk(root).filter((p) => !p.includes('pnpm-lock'));
  const rel = (p: string) => relative(root, p);
  const src = files.filter((p) => /packages\/[^/]+\/src\/.*\.ts$/.test(rel(p)));
  const importsOf = (p: string) => [...readFileSync(p, 'utf8').matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!);

  // 1. legacy dependencies
  for (const pj of files.filter((p) => p.endsWith('package.json'))) {
    const j = JSON.parse(readFileSync(pj, 'utf8')) as Record<string, Record<string, string>>;
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const d of Object.keys(j[k] ?? {})) if (LEGACY_PKG.test(d) || LEGACY.test(d)) f.push({ check: 'legacy-dependency', level: 'error', detail: `${d} in ${k}`, where: rel(pj) });
  }
  for (const p of src) for (const i of importsOf(p)) if (LEGACY.test(i) || LEGACY_PKG.test(i)) f.push({ check: 'legacy-import', level: 'error', detail: i, where: rel(p) });
  // 2. browser / model imports inside kernel packages
  for (const p of src.filter((x) => KERNEL.some((k) => rel(x).startsWith(`packages/${k}/`)))) for (const i of importsOf(p)) if (BROWSER.test(i)) f.push({ check: 'browser-in-kernel', level: 'error', detail: i, where: rel(p) });
  for (const k of KERNEL) {
    const pj = join(root, 'packages', k, 'package.json');
    const j = JSON.parse(readFileSync(pj, 'utf8')) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    for (const d of [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.optionalDependencies ?? {})]) if (!d.startsWith('@awrm/') || BROWSER.test(d)) f.push({ check: 'kernel-third-party-dependency', level: 'error', detail: d, where: rel(pj) });
  }
  // 3. raw secrets
  for (const p of files) {
    const r = rel(p);
    if (SECRET_FIXTURE_ALLOW.some((a) => a.test(r))) continue;
    const text = readFileSync(p, 'utf8');
    // Source scanning uses only high-signal credential shapes; 'password:'/'cookie:' also match type annotations.
    for (const rule of REDACTION_RULES.filter((x) => !['password-field', 'cookie'].includes(x.kind))) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(text);
      rule.re.lastIndex = 0;
      if (m && !/REDACTED|\[A-Za-z|\\b|\{8,\}|placeholder|example/i.test(m[0])) f.push({ check: 'raw-secret', level: 'error', detail: `${rule.kind}: ${m[0].slice(0, 12)}…`, where: r });
    }
  }
  // 4. interop wire paths and GET safety
  const purl = readFileSync(join(root, 'packages/interop/src/purl/client.ts'), 'utf8');
  const acsp = readFileSync(join(root, 'packages/interop/src/acsp/client.ts'), 'utf8');
  if (!/this\.call\('POST', `\/r\/\$\{encodeURIComponent\(id\)\}\/ops\/\$\{operation\}`/.test(purl)) f.push({ check: 'purl-wire-path', level: 'error', detail: 'PURL invoke must POST /r/{id}/ops/{operation}' });
  if (/\/operations/.test(purl.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) f.push({ check: 'purl-wire-path', level: 'error', detail: 'PURL client references ACSP /operations path' });
  if (!/this\.call\('POST', `\/r\/\$\{encodeURIComponent\(id\)\}\/operations`/.test(acsp)) f.push({ check: 'acsp-wire-path', level: 'error', detail: 'ACSP operations must POST /r/{id}/operations' });
  if (/\/ops\//.test(acsp.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) f.push({ check: 'acsp-wire-path', level: 'error', detail: 'ACSP client references PURL /ops/ path' });
  const getOps = [...purl.matchAll(/this\.call\('GET', `([^`]*)`/g)].map((m) => m[1]!).filter((p) => p.includes('/ops/'));
  if (getOps.length !== 1) f.push({ check: 'get-mutation', level: 'error', detail: `expected exactly one GET on /ops/ (the 405 safety probe), found ${getOps.length}` });
  // 5. protocol-name collisions
  const external = new Set(Object.values(EXTERNAL_VOCABULARY).flat().map((x) => String(x).toLowerCase()));
  for (const e of LEXICON) {
    if (!e.id.startsWith('awrm.')) f.push({ check: 'namespace', level: 'error', detail: `${e.id} not in awrm. namespace` });
    if (external.has(e.id.slice(5)) || external.has(e.name.toLowerCase())) f.push({ check: 'protocol-collision', level: 'error', detail: `${e.id} collides with an external term` });
  }
  // 6. live-vs-mock labelling
  for (const p of src) {
    const t = readFileSync(p, 'utf8');
    if (/class RulePort|class WorkerPoolPort/.test(t) && !/deterministic-test-double/.test(t)) f.push({ check: 'liveness-label', level: 'error', detail: 'rule/worker port not labelled as test double', where: rel(p) });
  }
  // 7. unbounded retries / infinite capacity
  if (!Number.isFinite(BUDGET_CEILING.maxRetries) || BUDGET_CEILING.maxRetries > 5) f.push({ check: 'unbounded-retries', level: 'error', detail: `maxRetries ceiling ${BUDGET_CEILING.maxRetries}` });
  for (const p of files.filter((x) => /\.(md|ts)$/.test(x))) {
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/\b(unlimited|infinite|infinity)\b/i.test(line) && !/\b(not|never|no|nor|without|false|refus|reject|cannot|isn't|instead|rather than|fiction|claim|deny|denied|unknown|bound|finite|NaN|Number\.|isFinite|non-finite|throws|unbounded)\b/i.test(line))
        f.push({ check: 'infinity-claim', level: 'warn', detail: line.trim().slice(0, 100), where: `${rel(p)}:${i + 1}` });
    });
  }
  // 8. negative results present
  const resDir = join(root, 'research', 'results');
  if (existsSync(join(resDir, 'summary.json'))) {
    const s = JSON.parse(readFileSync(join(resDir, 'summary.json'), 'utf8')) as { results: Array<{ id: string; verdict: string }> };
    if (!s.results.some((r) => r.verdict === 'REFUTED')) f.push({ check: 'negative-results', level: 'error', detail: 'no REFUTED result recorded' });
    const dup = readFileSync(join(resDir, 'E011.json'), 'utf8');
    if (!/ambiguous run never re-invoked after restart","expected":0,"observed":0,"pass":true|"name": "ambiguous run never re-invoked after restart",\s*"expected": 0,\s*"observed": 0,\s*"pass": true/.test(dup)) f.push({ check: 'duplicate-side-effect', level: 'error', detail: 'E011 does not show zero re-invocations of the ambiguous run' });
  } else f.push({ check: 'negative-results', level: 'warn', detail: 'no experiment summary yet (run awrm experiments run --all)' });

  const errors = f.filter((x) => x.level === 'error');
  if (!errors.length) f.push({ check: 'summary', level: 'ok', detail: `${files.length} files scanned; no error-level findings` });
  return { ok: errors.length === 0, findings: f };
}
