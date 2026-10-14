import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AcspClient, PurlClient, passToPurlPackage, passToTok, replayFetch, checkExportAuthorization, type WireRecord } from '@awrm/interop';
import { Recorder, acspScenario, deterministicPass, purlScenario } from '@awrm/research';
import { isAwrmError } from '@awrm/core';

const ROOT = join(import.meta.dirname, '..', '..');
const golden = (p: string) => join(ROOT, 'fixtures', 'interop', `${p}.golden.json`);

for (const proto of ['purl', 'acsp'] as const) {
  test(`${proto}: offline replay of the reference-server recording passes every check`, { skip: existsSync(golden(proto)) ? false : 'no recording; run E008 with a live reference server' }, async () => {
    const g = JSON.parse(readFileSync(golden(proto), 'utf8')) as { base: string; runKey: string; exchanges: WireRecord[] };
    const r = new Recorder();
    const pass = await deterministicPass();
    const f = replayFetch(g.exchanges, g.base);
    if (proto === 'purl') await purlScenario(r, g.base, f as never, 'replay', pass);
    else await acspScenario(r, g.base, f as never, 'replay', pass, g.runKey);
    assert.deepEqual(r.checks.filter((c) => !c.pass).map((c) => c.name), []);
    assert.equal(f.remaining(), 0);
    assert.ok(!JSON.stringify(g).match(/acsp_cap_[A-Z0-9]+_[A-Z0-9]{8}|purl_[A-Za-z0-9_-]{20}/), 'recordings contain no live tokens');
  });
}
test('replay refuses divergent requests instead of inventing answers', async () => {
  const f = replayFetch([{ method: 'GET', path: '/.well-known/purl', status: 200, requestHeaders: {}, requestBody: null, responseBody: { protocol: 'PURL/0.1', kind: 'instance-manifest' } }], 'http://x');
  await assert.rejects(new PurlClient('http://x', f).create('t'), /divergence/);
});
test('mapping: PURL package and ACSP TOK fit the destination schemas and carry provenance', async () => {
  const pass = await deterministicPass();
  const pkg = passToPurlPackage(pass) as { task: string; objective: string; findings: string[]; constraints: string[] };
  assert.ok(pkg.task.length <= 2000 && pkg.findings.every((x) => x.length <= 2000));
  assert.ok(pkg.constraints.some((c) => /No AWRM seat/.test(c)));
  const tok = passToTok(pass) as { type: string; title: string; refs: Array<{ citation: string }>; content: string };
  assert.equal(tok.type, 'finding');
  assert.ok(tok.title.length <= 200);
  assert.ok(tok.refs.every((r) => r.citation.startsWith('awrm:mark:sha256:')));
  assert.ok(tok.content.includes(pass.from.markDigest));
});
test('export authorisation is bound to one Pass, one destination and one protocol', async () => {
  const pass = await deterministicPass();
  const ok = { approvedBy: 'owner' as const, passDigest: pass.digest, destination: 'http://x/r/1', protocol: 'PURL/0.1' as const, approvedAt: 'now' };
  checkExportAuthorization(ok, pass, 'http://x/r/1', 'PURL/0.1');
  assert.throws(() => checkExportAuthorization(ok, pass, 'http://x/r/2', 'PURL/0.1'), (e) => isAwrmError(e, 'forbidden'));
  assert.throws(() => checkExportAuthorization({ ...ok, passDigest: 'sha256:' + '0'.repeat(64) }, pass, 'http://x/r/1', 'PURL/0.1'));
  assert.throws(() => checkExportAuthorization(null, pass, 'http://x/r/1', 'PURL/0.1'));
});
test('clients refuse operations outside their export allow-lists without sending anything', async () => {
  let sent = 0;
  const f = (async () => {
    sent++;
    throw new Error('should not send');
  }) as never;
  await assert.rejects(new PurlClient('http://x', f).invoke('r', 'transfer', {}, { expectedVersion: 1 }), (e) => isAwrmError(e, 'forbidden'));
  await assert.rejects(new AcspClient('http://x', f).operation('r', 'close', { session_id: 's', kind: 'agent' }, {}, { idempotencyKey: 'abcdefgh' }), (e) => isAwrmError(e, 'forbidden'));
  assert.equal(sent, 0);
});
