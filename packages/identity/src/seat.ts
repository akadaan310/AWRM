/**
 * awrm.seat — owner-bound execution identity or local principal reference.
 * A Seat record is a set of *handles*. Registration rejects anything that
 * looks like credential material anywhere in the record.
 */
import { AwrmError, LEXICON, validate, type PermissionRecord, type SeatRef } from '@awrm/core';
import { containsSecret } from '@awrm/evidence';

const SEAT_SCHEMA = LEXICON.find((e) => e.id === 'awrm.seat')!.schema;

export function checkSeat(seat: SeatRef): void {
  const v = validate(SEAT_SCHEMA, seat);
  if (!v.ok) throw new AwrmError('invalid-input', 'invalid seat', { errors: v.errors });
  const flat = JSON.stringify(seat);
  if (containsSecret(flat)) throw new AwrmError('secret-material', 'seat record contains credential-shaped material');
}

export class SeatRegistry {
  private seats = new Map<string, SeatRef>();
  register(seat: SeatRef): SeatRef {
    checkSeat(seat);
    if (this.seats.has(seat.seatId)) throw new AwrmError('invalid-input', `seat ${seat.seatId} exists`);
    const frozen = Object.freeze(structuredClone(seat));
    this.seats.set(seat.seatId, frozen);
    return frozen;
  }
  get(seatId: string): SeatRef | undefined {
    return this.seats.get(seatId);
  }
  require(seatId: string): SeatRef {
    const s = this.seats.get(seatId);
    if (!s) throw new AwrmError('unknown-seat', `no seat ${seatId}`);
    return s;
  }
  list(): SeatRef[] {
    return [...this.seats.values()];
  }
}

export const LOCAL_PERMISSIONS = (): PermissionRecord[] => (['owned-fixture', 'local-model', 'approved-browser'] as const).map((k) => localPermission(k));

export class PermissionRegistry {
  private records = new Map<string, PermissionRecord>();
  put(rec: PermissionRecord): void {
    if (containsSecret(JSON.stringify(rec))) throw new AwrmError('secret-material', 'permission record contains secret-shaped material');
    this.records.set(rec.id, Object.freeze(structuredClone(rec)));
  }
  get(id: string | null): PermissionRecord | null {
    return id ? (this.records.get(id) ?? null) : null;
  }
  /** The record a seat may use for a given provider and port kind, if any. */
  forSeat(seat: SeatRef, provider: string, portKind: SeatRef['allowedPortKinds'][number]): PermissionRecord | null {
    for (const id of seat.permissionRecordIds) {
      const r = this.records.get(id);
      if (r && r.provider === provider && r.portKind === portKind) return r;
    }
    return null;
  }
  list(): PermissionRecord[] {
    return [...this.records.values()];
  }
}

/** Default local principal seats used by fixtures, experiments and the CLI. */
export function localSeat(seatId: string, opts: Partial<SeatRef> = {}): SeatRef {
  return {
    seatId,
    provider: 'awrm-local',
    principal: 'local-principal',
    quotaKey: `awrm-local:${seatId}`,
    allowedPortKinds: ['owned-fixture', 'local-model', 'approved-browser'],
    permissionRecordIds: ['perm.awrm-local.owned-fixture', 'perm.awrm-local.local-model', 'perm.awrm-local.approved-browser'],
    scopes: ['prompt', 'observe'],
    ...opts,
  };
}

export const localPermission = (portKind: SeatRef['allowedPortKinds'][number]): PermissionRecord => ({
  id: `perm.awrm-local.${portKind}`,
  provider: 'awrm-local',
  portKind,
  method: 'local-execution',
  operations: ['prompt', 'observe'],
  ownerPermission: 'granted',
  providerPermission: 'not-applicable',
  evidence: [{ source: 'AWRM owns this code and the fixture/model execution', accessed: '2026-10-14' }],
  decidedAt: '2026-10-14T00:00:00.000Z',
});
