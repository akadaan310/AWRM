/**
 * awrm.gate — pure, deterministic permission decision.
 *
 * Rules are evaluated in a fixed order; the first failing rule decides.
 * "unknown" never permits. Generated Seeds never reach external ports.
 * This module has no I/O and no mutable state; it cannot be reconfigured at
 * runtime (AX-4).
 */
import type { GateDecision, GateInput } from '@awrm/core';

export function assess(input: GateInput): GateDecision {
  const deny = (code: GateDecision['code'], ...reasons: string[]): GateDecision => ({ verdict: 'deny', code, reasons, phase: input.phase });
  const { seat, port, permission, quota, budget, now, actor, operation } = input;

  if (actor.kind === 'seed' && (port.network === 'external' || port.kind === 'official-api' || port.kind === 'approved-browser'))
    return deny('seed-external-forbidden', 'Seeds may only use local ports');

  if (!seat) return deny('no-seat', 'every invocation needs a seat (owner account or local principal)');
  if (seat.expiry && Date.parse(seat.expiry) <= now) return deny('seat-expired', `seat ${seat.seatId} expired ${seat.expiry}`);
  if (!seat.allowedPortKinds.includes(port.kind)) return deny('port-kind-not-allowed-for-seat', `seat ${seat.seatId} does not allow ${port.kind}`);
  if (seat.provider !== port.provider) return deny('seat-provider-mismatch', `seat provider ${seat.provider} ≠ port provider ${port.provider}`);

  // Local, AWRM-owned execution needs no third-party permission, but still needs a record.
  const local = port.network !== 'external' && port.provider === 'awrm-local';
  if (!permission) return deny('permission-missing', 'no permission record for this seat');
  if (!seat.permissionRecordIds.includes(permission.id)) return deny('permission-mismatch', 'permission record does not belong to this seat');
  if (permission.expiresAt && Date.parse(permission.expiresAt) <= now) return deny('permission-expired', `permission ${permission.id} expired`);
  if (permission.provider !== port.provider || permission.portKind !== port.kind)
    return deny('permission-mismatch', `permission covers ${permission.provider}/${permission.portKind}, not ${port.provider}/${port.kind}`);
  if (!permission.operations.includes(operation)) return deny('operation-not-permitted', `operation ${operation} not covered`);
  if (permission.ownerPermission !== 'granted') return deny('owner-permission-not-granted', `owner permission is ${permission.ownerPermission}`);
  if (!local && permission.providerPermission !== 'permitted')
    return deny('provider-permission-not-established', `provider permission for ${permission.method} is ${permission.providerPermission}`);
  if (!local && permission.evidence.length === 0) return deny('provider-permission-not-established', 'no documentary evidence attached');

  if (budget.callsUsed >= budget.maxCalls) return deny('budget-exhausted', `calls ${budget.callsUsed}/${budget.maxCalls}`);
  if (budget.wallMsUsed >= budget.maxWallMs) return deny('budget-exhausted', `wall ${budget.wallMsUsed}/${budget.maxWallMs} ms`);

  if (!quota) return deny('quota-unknown', 'no quota snapshot');
  if (quota.blockedUntil !== null && quota.blockedUntil > now) return deny('rate-limited', `quota ${quota.quotaKey} blocked until ${new Date(quota.blockedUntil).toISOString()}`);
  if (quota.limit === null && !local) return deny('quota-unknown', `authorised allowance for ${quota.quotaKey} is unknown`);
  if (quota.limit !== null && quota.used >= quota.limit) return deny('quota-exhausted', `quota ${quota.quotaKey} ${quota.used}/${quota.limit}`);

  return { verdict: 'permit', code: 'permit', reasons: [local ? 'local AWRM-owned execution' : `documented permission ${permission.id}`], phase: input.phase };
}
