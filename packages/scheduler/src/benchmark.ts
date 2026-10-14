/** Measured Fleet scaling: 1→2→4→8 lanes, latency percentiles, CPU, RSS, fairness. */
import { cpus, loadavg } from 'node:os';
import type { RunRecord } from '@awrm/core';
import type { Kernel } from '@awrm/runtime';
import { Fleet, jainIndex, type FleetConfig } from './fleet';

export interface BenchPoint {
  lanes: number;
  jobs: number;
  wallMs: number;
  throughputPerSec: number;
  goodputPerSec: number; // schema-valid completions
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  failures: number;
  denied: number;
  maxInFlightObserved: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuUtilisation: number; // (user+system)/(wall × cores)
  rssMb: number;
  jain: number;
  loadavg1: number;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export async function benchmarkLanes(
  kernel: Kernel,
  opts: { portId: string; seatId: string; laneCounts: number[]; jobsPerPoint: number; partitions?: number; dmuId?: string },
): Promise<BenchPoint[]> {
  const out: BenchPoint[] = [];
  const partitions = opts.partitions ?? 4;
  for (const n of opts.laneCounts) {
    const cfg: FleetConfig = {
      lanes: Array.from({ length: n }, (_, i) => ({ laneId: `lane-${i + 1}`, portId: opts.portId, seatId: opts.seatId, concurrency: 1 })),
      globalCap: n,
      maxQueue: opts.jobsPerPoint + 1,
      partitions: Object.fromEntries(Array.from({ length: partitions }, (_, i) => [`p${i}`, 1])),
    };
    const fleet = new Fleet(kernel, cfg);
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    const jobs: Promise<RunRecord>[] = [];
    for (let j = 0; j < opts.jobsPerPoint; j++) {
      const a = 10 + (j % 50);
      const b = 3 + (j % 17);
      jobs.push(fleet.submit({ dmuId: opts.dmuId ?? 'math.check.v1', input: { question: `What is ${a} × ${b}?` }, partition: `p${j % partitions}` }));
    }
    const runs = await Promise.all(jobs);
    const wallMs = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    const lat = runs
      .map((r) => kernel.getMark(r.markDigest!)?.timing.elapsedMs ?? 0)
      .sort((a, b) => a - b);
    const good = runs.filter((r) => r.state === 'completed').length;
    const perPart = Object.values(fleet.stats.perPartition).map((p) => p.done);
    out.push({
      lanes: n,
      jobs: runs.length,
      wallMs: r3(wallMs),
      throughputPerSec: r3((runs.length / wallMs) * 1000),
      goodputPerSec: r3((good / wallMs) * 1000),
      p50Ms: r3(percentile(lat, 50)),
      p95Ms: r3(percentile(lat, 95)),
      p99Ms: r3(percentile(lat, 99)),
      failures: fleet.stats.failed,
      denied: fleet.stats.denied,
      maxInFlightObserved: fleet.stats.maxInFlightObserved,
      cpuUserMs: r3(cpu.user / 1000),
      cpuSystemMs: r3(cpu.system / 1000),
      cpuUtilisation: r3((cpu.user + cpu.system) / 1000 / (wallMs * cpus().length)),
      rssMb: r3(process.memoryUsage().rss / 1048576),
      jain: r3(jainIndex(perPart)),
      loadavg1: r3(loadavg()[0] ?? 0),
    });
  }
  return out;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
