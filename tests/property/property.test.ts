import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, type GateInput } from '@awrm/core';
import { verifyMark, redactText } from '@awrm/evidence';
import { assess } from '@awrm/policy';
import { localPermission, localSeat } from '@awrm/identity';
import { prng } from '@awrm/research';
import { kernelWithPorts, Q } from '../helpers';

test('property: random single-character tamper of any Mark field is always detected (300 trials)', async () => {
  const { kernel } = await kernelWithPorts();
  const r = await kernel.run({ dmuId: 'math.check.v1', input: Q, seatId: 'local-owner', portId: 'owned-fixture' });
  const m = kernel.getMark(r.markDigest!)!;
  const rnd = prng(2026);
  const paths: string[][] = [];
  const walk = (v: unknown, p: string[]) => {
    if (typeof v === 'string' && p[0] !== 'digest') paths.push(p);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
  };
  walk(m, []);
  for (let i = 0; i < 300; i++) {
    const t = structuredClone(m) as unknown as Record<string, unknown>;
    const p = paths[Math.floor(rnd() * paths.length)]!;
    let o = t;
    for (const k of p.slice(0, -1)) o = o[k] as Record<string, unknown>;
    const s = String(o[p.at(-1)!]);
    const j = Math.floor(rnd() * s.length);
    o[p.at(-1)!] = s.slice(0, j) + (s[j] === 'a' ? 'b' : 'a') + s.slice(j + 1);
    if (canonicalJson(t) === canonicalJson(m)) continue;
    assert.equal(verifyMark(t as never).ok, false, p.join('.'));
  }
});
test('property: the Gate never permits an external port when any permission term is not positively established', () => {
  const rnd = prng(7);
  const tri = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  for (let i = 0; i < 2000; i++) {
    const owner = tri(['granted', 'denied', 'unknown'] as const);
    const provider = tri(['permitted', 'prohibited', 'unknown', 'not-applicable'] as const);
    const limit = tri([null, 0, 5]);
    const used = tri([0, 5]);
    const evidence = tri([[], [{ source: 's', accessed: 'd' }]]);
    const input: GateInput = {
      actor: { id: 'x', kind: tri(['owner', 'seed', 'plan'] as const) },
      seat: { seatId: 'e', provider: 'p', principal: 'owner-account', quotaKey: 'q', allowedPortKinds: ['official-api'], permissionRecordIds: ['perm'], scopes: [] },
      port: { id: 'p', kind: 'official-api', label: '', liveness: 'external-live', provider: 'p', network: 'external', sideEffects: 'unknown', streaming: false },
      operation: 'prompt',
      permission: { id: 'perm', provider: 'p', portKind: 'official-api', method: 'm', operations: ['prompt'], ownerPermission: owner, providerPermission: provider, evidence, decidedAt: 'd' },
      quota: { quotaKey: 'q', limit, used, windowMs: null, blockedUntil: null },
      budget: { maxCalls: 1, callsUsed: 0, maxWallMs: 1, wallMsUsed: 0 },
      now: 0,
      phase: 'pre-invoke',
    };
    const d = assess(input);
    const shouldPermit = input.actor.kind !== 'seed' && owner === 'granted' && provider === 'permitted' && evidence.length > 0 && limit !== null && used < limit;
    assert.equal(d.verdict === 'permit', shouldPermit, JSON.stringify({ owner, provider, limit, used, ev: evidence.length, actor: input.actor.kind }));
  }
  // local sanity
  assert.equal(assess({ actor: { id: 'o', kind: 'owner' }, seat: localSeat('s'), port: { id: 'p', kind: 'owned-fixture', label: '', liveness: 'deterministic-test-double', provider: 'awrm-local', network: 'none', sideEffects: 'none', streaming: false }, operation: 'prompt', permission: localPermission('owned-fixture'), quota: { quotaKey: 'q', limit: null, used: 0, windowMs: null, blockedUntil: null }, budget: { maxCalls: 1, callsUsed: 0, maxWallMs: 1, wallMsUsed: 0 }, now: 0, phase: 'enqueue' }).verdict, 'permit');
});
test('property: redaction is idempotent on random strings with embedded secrets', () => {
  const rnd = prng(3);
  const pick = ['Bearer abcdefghijklmnop', 'sk-ant-api03-ZZZZZZZZZZZZZZZZ', 'password: x', 'plain text', '12345'];
  for (let i = 0; i < 500; i++) {
    const s = Array.from({ length: 4 }, () => pick[Math.floor(rnd() * pick.length)]).join(' ~ ');
    const once = redactText(s).text;
    assert.equal(redactText(once).text, once);
  }
});
