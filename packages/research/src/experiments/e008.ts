/** E008 — Protocol boundaries: black-box PURL/0.1 and ACSP/0.1, partial SEURL (H-8, AX-7). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AwrmError, manualClock, sequentialIds, type PassRecord } from '@awrm/core';
import { AcspClient, InteropError, PurlClient, nodeFetch, recordingFetch, replayFetch, translateSeurl, type ExportAuthorization, type WireRecord } from '@awrm/interop';
import { HOSTILE_INPUTS } from '@awrm/fixtures';
import { freshEngine, repoRoot, runExperiment, type Recorder } from '../harness';

const GOLDEN_DIR = () => join(repoRoot(), 'fixtures', 'interop');

export async function deterministicPass(): Promise<PassRecord> {
  const { kernel } = await freshEngine({ deterministic: true, clock: manualClock(), ids: sequentialIds() });
  const run = await kernel.run({ dmuId: 'text.classify.v1', input: { text: 'The invoice is overdue.' }, seatId: 'local-a', portId: 'local-a' });
  return kernel.passes.create({ fromMark: kernel.getMark(run.markDigest!)!, toSeatId: 'local-b', content: `label=${(run.output as { label: string }).label} (classified by AWRM local adapter A)`, scope: 'e008-interop', consentRecord: 'owner:e008' });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof InteropError ? `${e.status}` : e instanceof AwrmError ? e.code : (e as Error).message;
  }
}

export async function purlScenario(r: Recorder, base: string, f: ReturnType<typeof recordingFetch>, mode: string, pass: PassRecord): Promise<void> {
  const c = new PurlClient(base, f);
  const man = await c.discover();
  r.check(`[purl/${mode}] discovery protocol`, man.protocol, 'PURL/0.1');
  await c.registerPrincipal('agent', 'awrm-interop-adapter');
  const res = await c.create('awrm-continuity', { note: 'AWRM export target' });
  const dest = `${base}/r/${res.id}`;
  const auth: ExportAuthorization = { approvedBy: 'owner', passDigest: pass.digest, destination: dest, protocol: 'PURL/0.1', approvedAt: '2026-10-14T00:00:00.000Z' };
  r.check(`[purl/${mode}] export without owner authorisation refused locally`, await code(c.exportPass(pass, res.id, null)), 'forbidden');
  r.check(`[purl/${mode}] authorisation for another protocol refused`, await code(c.exportPass(pass, res.id, { ...auth, protocol: 'ACSP/0.1' })), 'forbidden');
  const probe = await c.probeSafeGet(res.id, 'checkpoint');
  r.check(`[purl/${mode}] GET /ops/checkpoint → 405 Allow: POST, version unchanged`, [probe.status, probe.allow, probe.versionAfter === probe.versionBefore], [405, 'POST', true]);
  const ex = await c.exportPass(pass, res.id, auth);
  r.check(`[purl/${mode}] export → checkpoint at version 2`, ex.version, 2);
  const replay = await c.invoke(res.id, 'checkpoint', { label: `awrm pass ${pass.passId}`, package: (await import('@awrm/interop')).passToPurlPackage(pass) }, { expectedVersion: 1, idempotencyKey: `awrm-${pass.digest.slice(7, 39)}` });
  r.check(`[purl/${mode}] identical retry with same Idempotency-Key replays, no new event`, [replay.idempotent_replay, replay.resource.version], [true, 2]);
  r.check(`[purl/${mode}] stale expected_version → 409`, await code(c.invoke(res.id, 'annotate', { about: 'x', body: 'stale' }, { expectedVersion: 1 })), '409');
  r.check(`[purl/${mode}] AWRM refuses to invoke grant (outside export allow-list)`, await code(c.invoke(res.id, 'grant', {}, { expectedVersion: 2 })), 'forbidden');
  const verify = await c.projection(res.id, 'verify');
  r.check(`[purl/${mode}] server verifies hash chain`, verify.ok ?? verify.valid ?? verify.result?.ok, true);
  const cont = await c.projection(res.id, 'continuity');
  r.check(`[purl/${mode}] continuity returns AWRM package as claims`, JSON.stringify(cont).includes(pass.passId), true);
  const stranger = new PurlClient(base, f);
  await stranger.registerPrincipal('agent', 'stranger');
  r.check(`[purl/${mode}] another principal cannot see the resource (404, non-disclosure)`, await code(stranger.representation(res.id)), '404');
  r.check(`[purl/${mode}] token-in-URL base rejected`, await code(Promise.resolve().then(() => new PurlClient(`${base}?token=abc`))), 'invalid-input');
}

export async function acspScenario(r: Recorder, base: string, f: ReturnType<typeof recordingFetch>, mode: string, pass: PassRecord, runKey: string): Promise<void> {
  const c = new AcspClient(base, f);
  const d = await c.discover();
  r.check(`[acsp/${mode}] discovery protocol`, d.protocol.version, 'ACSP/0.1');
  const actor = { session_id: 'awrm-adapter-session', agent_id: 'awrm', kind: 'agent' as const };
  const res = await c.create(actor, { title: 'AWRM export target' }, `awrm-e008-create-${runKey}`);
  const dest = `${base}/r/${res.id}`;
  const auth: ExportAuthorization = { approvedBy: 'owner', passDigest: pass.digest, destination: dest, protocol: 'ACSP/0.1', approvedAt: '2026-10-14T00:00:00.000Z' };
  r.check(`[acsp/${mode}] export without owner authorisation refused locally`, await code(c.exportPass(pass, res.id, actor, res.ownerCapability, null)), 'forbidden');
  const noCap = await c.rawOperation(res.id, { protocol: 'ACSP/0.1', operation: 'append', actor, idempotency_key: `awrm-nocap-${runKey}`, payload: { type: 'finding', title: 'no capability' } });
  r.check(`[acsp/${mode}] mutation without capability → 401 authentication_required`, [noCap.status, noCap.json?.error?.code], [401, 'authentication_required']);
  const prep = await c.prepare(res.id, 'append', { session_id: 'awrm-adapter-session', type: 'finding', title: 'prepared only' });
  r.check(`[acsp/${mode}] prepare_append GET is an intent and changes nothing`, [prep.intent?.type, prep.versionAfter === prep.versionBefore], ['operation_intent', true]);
  const ex = await c.exportPass(pass, res.id, actor, res.ownerCapability, auth);
  r.check(`[acsp/${mode}] export → TOK-001 + checkpoint 1`, [ex.tokId, ex.checkpoint], ['TOK-001', 1]);
  const again = await c.operation(res.id, 'append', actor, (await import('@awrm/interop')).passToTok(pass), { capability: res.ownerCapability, idempotencyKey: `awrm-tok-${pass.digest.slice(7, 39)}` });
  r.check(`[acsp/${mode}] identical retry replays (no new event)`, [again.replayed, again.version], [true, ex.version - 1]);
  const stale = await c.rawOperation(res.id, { protocol: 'ACSP/0.1', operation: 'append', actor, expected_version: 1, idempotency_key: `awrm-stale-${runKey}`, payload: { type: 'finding', title: 'stale' } }, res.ownerCapability);
  r.check(`[acsp/${mode}] stale expected_version → 409 stale_version`, [stale.status, stale.json?.error?.code], [409, 'stale_version']);
  const imp = await c.rawOperation(res.id, { protocol: 'ACSP/0.1', operation: 'append', actor: { ...actor, session_id: 'impersonated-session' }, idempotency_key: `awrm-imp-${runKey}`, payload: { type: 'finding', title: 'impersonation' } }, res.ownerCapability);
  r.check(`[acsp/${mode}] actor ≠ capability session → 403 session_mismatch`, [imp.status, imp.json?.error?.code], [403, 'session_mismatch']);
  const doc = await c.inspect(res.id);
  const tok = doc.knowledge.items.find((t: { id: string }) => t.id === 'TOK-001');
  r.check(`[acsp/${mode}] TOK source is the ACSP session, assurance=capability (not the AWRM seat)`, [tok.source.session_id, tok.source.identity_assurance], ['awrm-adapter-session', 'capability']);
  r.check(`[acsp/${mode}] TOK carries AWRM mark citation`, JSON.stringify(tok.refs).includes(pass.from.markDigest), true);
  r.check(`[acsp/${mode}] AWRM refuses delegate (outside allow-list)`, await code(c.operation(res.id, 'delegate', actor, {}, { idempotencyKey: `awrm-del-${runKey}`, capability: res.ownerCapability })), 'forbidden');
}

export const E008 = () =>
  runExperiment({ id: 'E008', title: 'Protocol boundaries: PURL/0.1 and ACSP/0.1 black-box, SEURL partial', hypotheses: ['H-8', 'AX-7'] }, async (r) => {
    const pass = await deterministicPass();
    r.metrics.passDigest = pass.digest;
    r.mark(pass.from.markDigest);
    mkdirSync(GOLDEN_DIR(), { recursive: true });
    const modes: Record<string, string> = {};

    for (const proto of ['purl', 'acsp'] as const) {
      const liveUrl = process.env[proto === 'purl' ? 'AWRM_PURL_URL' : 'AWRM_ACSP_URL'];
      const golden = join(GOLDEN_DIR(), `${proto}.golden.json`);
      const runKey = Date.now().toString(36);
      if (liveUrl) {
        const log: WireRecord[] = [];
        const f = recordingFetch(nodeFetch, log, liveUrl);
        try {
          if (proto === 'purl') await purlScenario(r, liveUrl, f, 'live', pass);
          else await acspScenario(r, liveUrl, f, 'live', pass, runKey);
          writeFileSync(golden, JSON.stringify({ recordedAt: new Date().toISOString(), base: liveUrl, runKey, reference: proto === 'purl' ? 'akadaan310/purl@3df4452a (node src/transport/main.js, in-memory)' : 'akadaan310/NetGovComEduGovOrgEduGovComNet@9fcf2e1d (next dev, PGlite)', passDigest: pass.digest, exchanges: log }, null, 2) + '\n');
          modes[proto] = 'LIVE_REFERENCE_VERIFIED';
          r.metrics[`${proto}Exchanges`] = log.length;
          const posts = log.filter((x) => x.method === 'POST').map((x) => x.path.replace(/\/r\/[A-Za-z0-9_]+/, '/r/{id}'));
          r.check(`[${proto}] wire paths are protocol-correct`, proto === 'purl' ? posts.every((p) => !p.includes('/operations')) : posts.every((p) => !p.includes('/ops/')), true);
          const gets = log.filter((x) => x.method === 'GET');
          r.notes.push(`${proto}: ${log.length} live exchanges (${gets.length} GET), recorded to fixtures/interop/${proto}.golden.json`);
        } catch (e) {
          r.check(`[${proto}] live scenario completed`, (e as Error).message, 'ok');
          modes[proto] = 'LIVE_FAILED';
        }
      }
      if (existsSync(golden)) {
        const g = JSON.parse(readFileSync(golden, 'utf8')) as { base: string; runKey: string; exchanges: WireRecord[]; passDigest: string };
        if (g.passDigest !== pass.digest) {
          r.blocked.push({ path: `${proto} offline replay`, status: 'NOT_RUN', reason: 'recorded golden was made from a different deterministic Pass' });
        } else {
          const f = replayFetch(g.exchanges, g.base);
          try {
            if (proto === 'purl') await purlScenario(r, g.base, f as never, 'replay', pass);
            else await acspScenario(r, g.base, f as never, 'replay', pass, g.runKey);
            r.check(`[${proto}/replay] every recorded exchange consumed`, f.remaining(), 0);
          } catch (e) {
            r.check(`[${proto}/replay] replay matched recording`, (e as Error).message, 'ok');
          }
          modes[proto] ??= 'OFFLINE_REPLAY_OF_REFERENCE_RECORDING';
        }
      } else if (!liveUrl) {
        modes[proto] = 'NOT_REFERENCE_VERIFIED';
        r.blocked.push({ path: `${proto} reference server`, status: 'NOT_RUN', reason: `set AWRM_${proto.toUpperCase()}_URL to a separately running reference server` });
      }
    }

    // SEURL — partial translator
    const ok = translateSeurl('START\nTALK dmu=math.check.v1 input={"question":"What is 17 × 23?"}\nCOMMIT kind=pass ref=' + pass.from.markDigest, (id) => id === 'math.check.v1');
    r.check('[seurl] START/TALK/COMMIT → 3 proposals, nothing executed, no authority', [ok.proposals.map((p) => p.kind), ok.executed, ok.authorityGranted, ok.mintedUris.length], [['plan-boundary', 'run-dmu-proposal', 'checkpoint-proposal'], false, false, 0]);
    const attack = translateSeurl(HOSTILE_INPUTS.seurlAttack, (id) => id === 'math.check.v1');
    r.check('[seurl] WRITE/PERTURB/SWITCH reported as non-conformance, never mapped', attack.nonConformance.map((n) => `${n.verb}:${n.status}`), ['WRITE:underspecified', 'PERTURB:underspecified', 'SWITCH:unsupported']);
    const unknown = translateSeurl('FLY to=moon\nBUILD x=1', () => true);
    r.check('[seurl] unknown verb and BUILD flagged', unknown.nonConformance.map((n) => n.status), ['unknown-verb', 'underspecified']);
    modes.seurl = 'PARTIAL (3 of 7 verbs translated to proposals; 4 documented as unsupported/underspecified)';

    r.metrics.modes = modes;
    const failed = r.checks.filter((c) => !c.pass);
    if (failed.length) return { verdict: 'REFUTED', reason: `failed: ${failed.map((c) => c.name).join('; ')}` };
    const live = Object.values(modes).filter((m) => m === 'LIVE_REFERENCE_VERIFIED').length;
    return { verdict: live === 2 ? 'SUPPORTED' : 'INCONCLUSIVE', reason: live === 2 ? 'both adapters passed against separately running reference servers; GET stayed safe; export required owner authorisation and the destination protocol’s own authority' : `reference servers not both live (${JSON.stringify(modes)})` };
  });
