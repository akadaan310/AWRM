/**
 * awrm.fleet — bounded multiplicity.
 *
 * A Fleet dispatches DMU jobs onto lanes (port × seat × concurrency) under a
 * hard global cap, a bounded queue (backpressure), deficit-round-robin
 * fairness across partitions with aging, and per-lane circuit breakers.
 *
 * It never manufactures capacity: it does not resubmit a denied or
 * rate-limited run to another lane, and lanes that share a quotaKey share one
 * allowance. Capacity it cannot measure or source is reported as unknown.
 */
import { AwrmError, type RunRecord } from '@awrm/core';
import type { Kernel } from '@awrm/runtime';

export interface LaneSpec {
  laneId: string;
  portId: string;
  seatId: string;
  concurrency: number;
  /** Approved request rate for this lane (calls/s); null = none published/unknown. */
  rate?: number | null;
}

export interface FleetConfig {
  lanes: LaneSpec[];
  globalCap: number;
  maxQueue: number;
  partitions?: Record<string, number>; // partition → weight
  agingMs?: number;
  breaker?: { failureThreshold: number; cooldownMs: number };
}

export interface FleetJob {
  dmuId: string;
  input: unknown;
  partition?: string;
  laneId?: string; // pin to a lane (no fallback to other lanes)
  tags?: string[];
}

interface Pending {
  job: FleetJob;
  enqueuedAt: number;
  resolve: (r: RunRecord) => void;
  reject: (e: unknown) => void;
}

interface LaneState {
  spec: LaneSpec;
  inFlight: number;
  completed: number;
  failures: number;
  consecutiveFailures: number;
  openUntil: number;
  busyMs: number;
  quotaStopped: boolean;
}

export interface FleetStats {
  submitted: number;
  completed: number;
  failed: number;
  denied: number;
  rejectedBackpressure: number;
  maxInFlightObserved: number;
  perLane: Record<string, { completed: number; failures: number; maxInFlight: number }>;
  perPartition: Record<string, { done: number; waitMsTotal: number }>;
  completionOrder: string[]; // partitions in completion order (for fairness)
}

const TRANSIENT = new Set(['port-error', 'timeout', 'partial-response']);

export class Fleet {
  private lanes: LaneState[];
  private queues = new Map<string, Pending[]>();
  private deficit = new Map<string, number>();
  private inFlight = 0;
  private laneMax = new Map<string, number>();
  private idleWaiters: Array<() => void> = [];
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  readonly stats: FleetStats;

  constructor(private kernel: Kernel, private cfg: FleetConfig) {
    if (!Number.isInteger(cfg.globalCap) || cfg.globalCap < 1) throw new AwrmError('invalid-input', 'globalCap must be a positive integer');
    if (!cfg.lanes.length) throw new AwrmError('invalid-input', 'a fleet needs at least one lane');
    for (const l of cfg.lanes) {
      kernel.portManifest(l.portId);
      kernel.seats.require(l.seatId);
      if (!Number.isInteger(l.concurrency) || l.concurrency < 1) throw new AwrmError('invalid-input', 'lane concurrency must be a positive integer');
    }
    this.lanes = cfg.lanes.map((spec) => ({ spec, inFlight: 0, completed: 0, failures: 0, consecutiveFailures: 0, openUntil: 0, busyMs: 0, quotaStopped: false }));
    this.stats = { submitted: 0, completed: 0, failed: 0, denied: 0, rejectedBackpressure: 0, maxInFlightObserved: 0, perLane: {}, perPartition: {}, completionOrder: [] };
  }

  get queued(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }

  submit(job: FleetJob): Promise<RunRecord> {
    if (job.laneId && !this.lanes.some((l) => l.spec.laneId === job.laneId)) return Promise.reject(new AwrmError('invalid-input', `no lane ${job.laneId}`));
    if (this.queued >= this.cfg.maxQueue) {
      this.stats.rejectedBackpressure++;
      return Promise.reject(new AwrmError('backpressure', `queue full (${this.cfg.maxQueue})`));
    }
    this.stats.submitted++;
    const part = job.partition ?? 'default';
    return new Promise<RunRecord>((resolve, reject) => {
      const q = this.queues.get(part) ?? [];
      q.push({ job, enqueuedAt: Date.now(), resolve, reject });
      this.queues.set(part, q);
      this.pump();
    });
  }

  /** Resolves when no job is queued or in flight. */
  drain(): Promise<void> {
    if (this.inFlight === 0 && this.queued === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private eligibleLane(job: FleetJob): LaneState | null {
    const now = Date.now();
    const candidates = this.lanes.filter(
      (l) => (!job.laneId || l.spec.laneId === job.laneId) && l.inFlight < l.spec.concurrency && l.openUntil <= now && !l.quotaStopped,
    );
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.inFlight / a.spec.concurrency - b.inFlight / b.spec.concurrency);
    return candidates[0]!;
  }

  /** Deficit round robin over partitions; a job older than agingMs jumps the line. */
  private nextJob(): { part: string; p: Pending; lane: LaneState } | null {
    const parts = [...this.queues.entries()].filter(([, q]) => q.length);
    if (!parts.length) return null;
    const aging = this.cfg.agingMs ?? 5_000;
    const now = Date.now();
    const old = parts
      .map(([part, q]) => ({ part, p: q[0]! }))
      .filter((x) => now - x.p.enqueuedAt > aging)
      .sort((a, b) => a.p.enqueuedAt - b.p.enqueuedAt);
    for (const o of old) {
      const lane = this.eligibleLane(o.p.job);
      if (lane) return { part: o.part, p: this.queues.get(o.part)!.shift()!, lane };
    }
    for (let round = 0; round < 64; round++) {
      for (const [part, q] of parts) {
        if (!q.length) continue;
        const w = this.cfg.partitions?.[part] ?? 1;
        const d = (this.deficit.get(part) ?? 0) + (round === 0 ? 0 : w);
        if (d >= 1) {
          const lane = this.eligibleLane(q[0]!.job);
          if (!lane) {
            this.deficit.set(part, Math.min(d, w * 4));
            continue;
          }
          this.deficit.set(part, d - 1);
          return { part, p: q.shift()!, lane };
        }
        this.deficit.set(part, d);
      }
    }
    return null;
  }

  private pump(): void {
    while (this.inFlight < this.cfg.globalCap) {
      const next = this.nextJob();
      if (!next) break;
      this.dispatch(next.part, next.p, next.lane);
    }
    // Jobs pinned to a lane that is stopped by quota can never run: fail them now, do not reroute.
    for (const [part, q] of this.queues) {
      for (let i = q.length - 1; i >= 0; i--) {
        const p = q[i]!;
        const lane = p.job.laneId ? this.lanes.find((l) => l.spec.laneId === p.job.laneId) : null;
        const allStopped = this.lanes.every((l) => l.quotaStopped);
        if ((lane && lane.quotaStopped) || allStopped) {
          q.splice(i, 1);
          p.reject(new AwrmError('budget-exhausted', `lane quota exhausted; job from partition ${part} not rerouted`));
        }
      }
    }
    if (this.inFlight === 0 && this.queued === 0) this.idleWaiters.splice(0).forEach((r) => r());
    // Nothing running but work waiting behind open breakers: wake up when the earliest cools down.
    if (this.inFlight === 0 && this.queued > 0 && !this.wakeTimer) {
      const reopen = Math.min(...this.lanes.filter((l) => !l.quotaStopped && l.openUntil > Date.now()).map((l) => l.openUntil));
      if (Number.isFinite(reopen)) {
        this.wakeTimer = setTimeout(() => {
          this.wakeTimer = null;
          this.pump();
        }, Math.max(1, reopen - Date.now()));
        this.wakeTimer.unref?.();
      }
    }
  }

  private dispatch(part: string, p: Pending, lane: LaneState): void {
    this.inFlight++;
    lane.inFlight++;
    this.stats.maxInFlightObserved = Math.max(this.stats.maxInFlightObserved, this.inFlight);
    this.laneMax.set(lane.spec.laneId, Math.max(this.laneMax.get(lane.spec.laneId) ?? 0, lane.inFlight));
    const waitMs = Date.now() - p.enqueuedAt;
    const t0 = performance.now();
    this.kernel
      .run({ dmuId: p.job.dmuId, input: p.job.input, seatId: lane.spec.seatId, portId: lane.spec.portId, tags: [...(p.job.tags ?? []), `lane:${lane.spec.laneId}`, `partition:${part}`] })
      .then(
        (run) => {
          lane.busyMs += performance.now() - t0;
          this.account(lane, run);
          const ps = (this.stats.perPartition[part] ??= { done: 0, waitMsTotal: 0 });
          ps.done++;
          ps.waitMsTotal += waitMs;
          this.stats.completionOrder.push(part);
          p.resolve(run);
        },
        (e) => {
          lane.failures++;
          p.reject(e);
        },
      )
      .finally(() => {
        this.inFlight--;
        lane.inFlight--;
        this.pump();
      });
  }

  private account(lane: LaneState, run: RunRecord): void {
    const id = lane.spec.laneId;
    const pl = (this.stats.perLane[id] ??= { completed: 0, failures: 0, maxInFlight: 0 });
    pl.maxInFlight = this.laneMax.get(id) ?? 0;
    if (run.state === 'completed') {
      this.stats.completed++;
      pl.completed++;
      lane.completed++;
      lane.consecutiveFailures = 0;
      return;
    }
    if (run.state === 'denied') {
      this.stats.denied++;
      // A quota/rate denial stops this lane; jobs are not shifted to other identities.
      if (run.gate && ['quota-exhausted', 'rate-limited', 'quota-unknown', 'budget-exhausted'].includes(run.gate.code)) lane.quotaStopped = this.laneBlocked(lane);
      return;
    }
    this.stats.failed++;
    pl.failures++;
    lane.failures++;
    if (run.error?.code === 'rate-limited') lane.quotaStopped = this.laneBlocked(lane);
    if (run.error && TRANSIENT.has(run.error.code)) {
      lane.consecutiveFailures++;
      const b = this.cfg.breaker;
      if (b && lane.consecutiveFailures >= b.failureThreshold) {
        lane.openUntil = Date.now() + b.cooldownMs;
        lane.consecutiveFailures = 0;
      }
    }
  }

  private laneBlocked(lane: LaneState): boolean {
    const seat = this.kernel.seats.require(lane.spec.seatId);
    const q = this.kernel.ledger.snapshot(seat.quotaKey);
    if (!q) return true;
    if (q.blockedUntil !== null && q.blockedUntil > Date.now()) return true;
    return q.limit !== null && q.used >= q.limit;
  }

  breakerOpen(laneId: string): boolean {
    return (this.lanes.find((l) => l.spec.laneId === laneId)?.openUntil ?? 0) > Date.now();
  }

  /**
   * Conservative upper bound  R ≤ Σ_groups min(Q_g/T_g, Σ_lanes min(r_i, c_i/L_i)).
   * Lanes sharing a quotaKey form one group with one allowance (AX-5).
   * Any unknown provider term makes the bound unknown — never infinite.
   */
  capacity(): CapacityReport {
    const groups = new Map<string, LaneState[]>();
    for (const l of this.lanes) {
      const key = this.kernel.seats.require(l.spec.seatId).quotaKey;
      groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    const lanes: LaneCapacity[] = [];
    const groupRows: GroupCapacity[] = [];
    let total: number | 'unknown' = 0;
    for (const [quotaKey, ls] of groups) {
      const snap = this.kernel.ledger.snapshot(quotaKey);
      const seat = this.kernel.seats.require(ls[0]!.spec.seatId);
      const local = seat.provider === 'awrm-local';
      let laneSum: number | 'unknown' = 0;
      for (const l of ls) {
        const L = l.completed ? l.busyMs / l.completed : null;
        const cOverL = L ? (l.spec.concurrency / L) * 1000 : null;
        const r = l.spec.rate ?? null;
        let bound: number | 'unknown';
        if (cOverL === null) bound = 'unknown';
        else if (r === null) bound = local ? cOverL : 'unknown';
        else bound = Math.min(r, cOverL);
        lanes.push({ laneId: l.spec.laneId, quotaKey, concurrency: l.spec.concurrency, rate: r, meanOccupiedMs: L, boundPerSec: bound });
        laneSum = laneSum === 'unknown' || bound === 'unknown' ? 'unknown' : laneSum + bound;
      }
      let allowance: number | 'unknown' | 'not-applicable';
      if (local) allowance = 'not-applicable';
      else if (!snap || snap.limit === null || snap.windowMs === null) allowance = 'unknown';
      else allowance = (snap.limit / snap.windowMs) * 1000;
      let groupBound: number | 'unknown';
      if (allowance === 'unknown') groupBound = 'unknown';
      else if (allowance === 'not-applicable') groupBound = laneSum;
      else groupBound = laneSum === 'unknown' ? allowance : Math.min(allowance, laneSum);
      groupRows.push({ quotaKey, lanes: ls.map((l) => l.spec.laneId), allowancePerSec: allowance, boundPerSec: groupBound });
      total = total === 'unknown' || groupBound === 'unknown' ? 'unknown' : total + groupBound;
    }
    return { formula: 'R ≤ Σ_g min(Q_g/T_g, Σ_i∈g min(r_i, c_i/L_i))', lanes, groups: groupRows, fleetBoundPerSec: total, globalCap: this.cfg.globalCap, note: 'Engineering upper bound under simplified assumptions; unknown terms are reported, never assumed infinite.' };
  }
}

export interface LaneCapacity {
  laneId: string;
  quotaKey: string;
  concurrency: number;
  rate: number | null;
  meanOccupiedMs: number | null;
  boundPerSec: number | 'unknown';
}
export interface GroupCapacity {
  quotaKey: string;
  lanes: string[];
  allowancePerSec: number | 'unknown' | 'not-applicable';
  boundPerSec: number | 'unknown';
}
export interface CapacityReport {
  formula: string;
  lanes: LaneCapacity[];
  groups: GroupCapacity[];
  fleetBoundPerSec: number | 'unknown';
  globalCap: number;
  note: string;
}

/** Jain's fairness index over per-partition allocations (1 = perfectly fair). */
export function jainIndex(xs: number[]): number {
  if (!xs.length) return 1;
  const s = xs.reduce((a, b) => a + b, 0);
  const s2 = xs.reduce((a, b) => a + b * b, 0);
  return s2 === 0 ? 1 : (s * s) / (xs.length * s2);
}
