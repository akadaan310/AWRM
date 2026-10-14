import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GateInput, PermissionRecord } from '@awrm/core';
import { assess } from '@awrm/policy';
import { localPermission, localSeat } from '@awrm/identity';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const base = (): GateInput => ({
  actor: { id: 'owner', kind: 'owner' },
  seat: localSeat('s1'),
  port: { id: 'p', kind: 'owned-fixture', label: '', liveness: 'deterministic-test-double', provider: 'awrm-local', network: 'none', sideEffects: 'none', streaming: true },
  operation: 'prompt',
  permission: localPermission('owned-fixture'),
  quota: { quotaKey: 'awrm-local:s1', limit: null, used: 0, windowMs: null, blockedUntil: null },
  budget: { maxCalls: 2, callsUsed: 0, maxWallMs: 1000, wallMsUsed: 0 },
  now: NOW,
  phase: 'enqueue',
});
const ext = (perm: Partial<PermissionRecord> = {}): GateInput => {
  const b = base();
  const permission: PermissionRecord = { id: 'perm.x', provider: 'anthropic', portKind: 'official-api', method: 'messages-api', operations: ['prompt'], ownerPermission: 'granted', providerPermission: 'permitted', evidence: [{ source: 'terms', accessed: '2026-10-14' }], decidedAt: '2026-10-14', ...perm };
  return { ...b, seat: { seatId: 'a1', provider: 'anthropic', principal: 'owner-account', quotaKey: 'anthropic:me', allowedPortKinds: ['official-api'], permissionRecordIds: ['perm.x'], scopes: [], credentialRef: 'vault:k' }, port: { ...b.port, kind: 'official-api', provider: 'anthropic', network: 'external', sideEffects: 'unknown', liveness: 'external-live' }, permission, quota: { quotaKey: 'anthropic:me', limit: 10, used: 0, windowMs: 60000, blockedUntil: null } };
};

test('awrm.gate positive: local permit, documented external permit', () => {
  assert.equal(assess(base()).verdict, 'permit');
  assert.equal(assess(ext()).verdict, 'permit');
});
test('awrm.gate negative: every rule denies with its own code', () => {
  const cases: Array<[string, GateInput]> = [
    ['no-seat', { ...base(), seat: null }],
    ['seat-expired', { ...base(), seat: { ...localSeat('s1'), expiry: '2026-10-13T00:00:00Z' } }],
    ['port-kind-not-allowed-for-seat', { ...base(), seat: { ...localSeat('s1'), allowedPortKinds: ['local-model'] } }],
    ['seat-provider-mismatch', { ...base(), port: { ...base().port, provider: 'openai' } }],
    ['permission-missing', { ...base(), permission: null }],
    ['permission-mismatch', { ...base(), seat: { ...localSeat('s1'), permissionRecordIds: [] } }],
    ['permission-expired', { ...base(), permission: { ...localPermission('owned-fixture'), expiresAt: '2026-10-01T00:00:00Z' } }],
    ['operation-not-permitted', { ...base(), operation: 'observe', permission: { ...localPermission('owned-fixture'), operations: ['prompt'] } }],
    ['owner-permission-not-granted', ext({ ownerPermission: 'unknown' })],
    ['provider-permission-not-established', ext({ providerPermission: 'unknown' })],
    ['provider-permission-not-established', ext({ providerPermission: 'prohibited' })],
    ['provider-permission-not-established', ext({ evidence: [] })],
    ['budget-exhausted', { ...base(), budget: { maxCalls: 1, callsUsed: 1, maxWallMs: 1, wallMsUsed: 0 } }],
    ['quota-unknown', { ...ext(), quota: { quotaKey: 'anthropic:me', limit: null, used: 0, windowMs: null, blockedUntil: null } }],
    ['quota-exhausted', { ...ext(), quota: { quotaKey: 'anthropic:me', limit: 3, used: 3, windowMs: null, blockedUntil: null } }],
    ['rate-limited', { ...ext(), quota: { quotaKey: 'anthropic:me', limit: 3, used: 0, windowMs: null, blockedUntil: NOW + 1000 } }],
    ['seed-external-forbidden', { ...ext(), actor: { id: 'seed', kind: 'seed' } }],
  ];
  for (const [code, input] of cases) {
    const d = assess(input);
    assert.equal(d.verdict, 'deny', code);
    assert.equal(d.code, code);
  }
});
test('awrm.gate is pure: same input, same decision; input not mutated', () => {
  const i = ext({ providerPermission: 'unknown' });
  const snap = JSON.stringify(i);
  assert.deepEqual(assess(i), assess(i));
  assert.equal(JSON.stringify(i), snap);
});
