/** E004 — Provider eligibility: deterministic Gate decisions from sourced permission records. */
import { assess, ELIGIBILITY } from '@awrm/policy';
import { DisabledConsumerPort, AnthropicMessagesPort, GeminiApiPort } from '@awrm/ports';
import type { PortManifest, SeatRef } from '@awrm/core';
import { freshEngine, runExperiment, verdictFrom } from '../harness';

export const E004 = () =>
  runExperiment({ id: 'E004', title: 'Provider eligibility: consumer UI vs API vs local, decided by the Gate', hypotheses: ['H-6', 'AX-4'] }, async (r) => {
    const decisions: Record<string, unknown>[] = [];
    for (const row of ELIGIBILITY) {
      if (!row.record) {
        decisions.push({ provider: row.provider, product: row.product, mode: row.mode, status: row.status, gate: row.mode === 'consumer-human' ? 'n/a (human use; not an AWRM port)' : 'local permit path' });
        continue;
      }
      const rec = row.record;
      const seat: SeatRef = { seatId: `${rec.provider}-owner-1`, provider: rec.provider, principal: 'owner-account', quotaKey: `${rec.provider}:owner`, allowedPortKinds: [rec.portKind], permissionRecordIds: [rec.id], scopes: ['prompt'], credentialRef: 'vault:hypothetical' };
      const port: PortManifest = { id: 'p', kind: rec.portKind, label: '', liveness: 'external-live', provider: rec.provider, network: 'external', sideEffects: 'unknown', streaming: false };
      const input = { actor: { id: 'owner', kind: 'owner' as const }, seat, port, operation: 'prompt' as const, permission: rec, quota: { quotaKey: seat.quotaKey, limit: 10, used: 0, windowMs: 60000, blockedUntil: null }, budget: { maxCalls: 1, callsUsed: 0, maxWallMs: 1000, wallMsUsed: 0 }, now: Date.parse('2026-10-14T12:00:00Z'), phase: 'enqueue' as const };
      const d1 = assess(input);
      const d2 = assess(input);
      r.check(`${rec.id}: deterministic`, JSON.stringify(d1) === JSON.stringify(d2), true);
      r.check(`${rec.id}: denied`, d1.verdict, 'deny');
      decisions.push({ provider: row.provider, product: row.product, mode: row.mode, status: row.status, gate: `${d1.verdict}:${d1.code}`, reasons: d1.reasons });
      // Counterfactual: what would it take? owner grants + provider permitted (API rows only)
      if (rec.providerPermission === 'permitted') {
        const cf = assess({ ...input, permission: { ...rec, ownerPermission: 'granted' } });
        r.check(`${rec.id}: permitted only once owner grants and a key handle exists`, cf.verdict, 'permit');
      }
      if (row.mode === 'consumer-automation') {
        const cf = assess({ ...input, permission: { ...rec, ownerPermission: 'granted' } });
        r.check(`${rec.id}: still denied even with owner consent (provider permission not established)`, [cf.verdict, cf.code], ['deny', 'provider-permission-not-established']);
      }
    }
    // End-to-end: runs aimed at disabled consumer ports never reach invoke().
    const { kernel } = await freshEngine();
    const consumer = [new DisabledConsumerPort('consumer.openai.chatgpt', 'openai', 'ChatGPT'), new DisabledConsumerPort('consumer.anthropic.claude-ai', 'anthropic', 'claude.ai'), new DisabledConsumerPort('consumer.google.gemini', 'google', 'Gemini')];
    for (const p of consumer) await kernel.registerPort(p);
    await kernel.registerPort(new AnthropicMessagesPort({ id: 'api.anthropic.messages', model: 'claude-haiku-5-5' }));
    await kernel.registerPort(new GeminiApiPort({ id: 'api.google.gemini', model: 'gemini-2.5-flash' }));
    for (const [prov, perm] of [['openai', 'perm.openai.consumer-web'], ['anthropic', 'perm.anthropic.consumer-web'], ['google', 'perm.google.consumer-web']] as const) {
      kernel.seats.register({ seatId: `${prov}-personal-1`, provider: prov, principal: 'owner-account', accountAlias: 'personal', quotaKey: `${prov}:personal`, allowedPortKinds: ['approved-browser', 'official-api'], permissionRecordIds: [perm, prov === 'anthropic' ? 'perm.anthropic.api' : prov === 'google' ? 'perm.google.gemini-api' : 'perm.openai.api'], scopes: ['prompt'], credentialRef: `vault:${prov}-api-key` });
      kernel.ledger.configure({ quotaKey: `${prov}:personal`, limit: null, windowMs: null, source: 'unknown: no published consumer allowance' });
    }
    const origFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      fetches++;
      return origFetch(...a);
    }) as typeof fetch;
    try {
      for (const [seatId, portId] of [['openai-personal-1', 'consumer.openai.chatgpt'], ['anthropic-personal-1', 'consumer.anthropic.claude-ai'], ['google-personal-1', 'consumer.google.gemini'], ['anthropic-personal-1', 'api.anthropic.messages'], ['google-personal-1', 'api.google.gemini']] as const) {
        const run = await kernel.run({ dmuId: 'math.check.v1', input: { question: 'What is 17 × 23?' }, seatId, portId });
        r.check(`${portId}: run denied before any Turn`, [run.state, run.turns.length], ['denied', 0]);
        r.mark(run.markDigest);
        decisions.push({ endToEnd: portId, state: run.state, gate: run.gate?.code });
      }
    } finally {
      globalThis.fetch = origFetch;
    }
    r.check('no network request was made for any external path', fetches, 0);
    r.blocked.push(
      { path: 'ChatGPT / claude.ai / Gemini consumer UI automation', status: 'BLOCKED', reason: 'provider permission prohibited or not established (see docs/PROVIDER_ELIGIBILITY.md)' },
      { path: 'Anthropic Messages API, Gemini API', status: 'NOT_RUN', reason: 'no owner-supplied key or acceptance of API terms in this environment' },
      { path: 'OpenAI API', status: 'NOT_RUN', reason: 'terms pages unreachable (403) on 2026-10-14; status unknown; no port implemented' },
    );
    r.metrics.decisions = decisions;
    const v = verdictFrom(r, 'every external path is denied by deterministic, evidence-backed Gate decisions; API paths become permissible only with owner consent + credential');
    return v.verdict === 'SUPPORTED' ? { verdict: 'OBSERVED', reason: v.reason + ' (policy reading recorded, not a legal ruling)' } : v;
  });
