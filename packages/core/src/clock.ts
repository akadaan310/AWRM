export interface Clock {
  now(): number; // epoch milliseconds
  iso(): string;
  monotonic(): number; // high-resolution ms for durations
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
  monotonic: () => performance.now(),
};

/** A manually advanced clock for deterministic tests. */
export function manualClock(start = Date.UTC(2026, 9, 14)): Clock & { advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    iso: () => new Date(t).toISOString(),
    monotonic: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}
