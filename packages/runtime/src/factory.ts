/** Convenience constructor wiring a Kernel with default local seats and permissions. */
import { manualClock, type Clock, type IdSource } from '@awrm/core';
import { EnvSecretSource, LOCAL_PERMISSIONS, MemorySecretSource, PermissionRegistry, SeatRegistry, Vault, localSeat, type SecretSource } from '@awrm/identity';
import { QuotaLedger, providerPermissionRecords } from '@awrm/policy';
import { openStore, type Store } from '@awrm/store';
import { Kernel } from './kernel';

export interface EngineOptions {
  store?: Store;
  storeSpec?: Parameters<typeof openStore>[0];
  clock?: Clock;
  ids?: IdSource;
  secrets?: SecretSource;
  /** Local seats to create (each gets its own unknown-limit local quota). */
  localSeats?: string[];
  backoffBaseMs?: number;
}

export function createKernel(o: EngineOptions = {}): Kernel {
  const store = o.store ?? openStore(o.storeSpec ?? { kind: 'memory' });
  const clock = o.clock;
  const seats = new SeatRegistry();
  const permissions = new PermissionRegistry();
  for (const p of LOCAL_PERMISSIONS()) permissions.put(p);
  for (const p of providerPermissionRecords()) permissions.put(p);
  const ledger = new QuotaLedger(clock ? () => clock.now() : Date.now);
  for (const id of o.localSeats ?? ['local-owner', 'local-a', 'local-b']) {
    const seat = seats.register(localSeat(id));
    ledger.configure({ quotaKey: seat.quotaKey, limit: null, windowMs: null, source: 'local execution: bounded by machine resources, not a provider allowance' });
  }
  return new Kernel({
    store,
    seats,
    permissions,
    ledger,
    vault: new Vault(o.secrets ?? new EnvSecretSource()),
    ...(clock ? { clock } : {}),
    ...(o.ids ? { ids: o.ids } : {}),
    ...(o.backoffBaseMs !== undefined ? { backoffBaseMs: o.backoffBaseMs } : {}),
  });
}

export { manualClock, MemorySecretSource };
