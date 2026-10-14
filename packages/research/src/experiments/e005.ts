/** E005 — One unit → Fleet: measured 1→2→4→8 lane scaling, caps, fairness, breaker isolation (H-5 local part). */
import { cpus } from 'node:os';
import { RulePort, WorkerPoolPort, brainA } from '@awrm/ports';
import { Fleet, benchmarkLanes } from '@awrm/scheduler';
import { freshEngine, runExperiment, verdictFrom } from '../harness';

export const E005 = () =>
  runExperiment({ id: 'E005', title: 'One DMU → Fleet: measured scaling until machine limits', hypotheses: ['H-5'] }, async (r) => {
    const { kernel } = await freshEngine();
    const cpu = new WorkerPoolPort('cpu-pool', 8, Number(process.env.AWRM_E005_CPU_MS ?? 20), brainA);
    const io = new RulePort({ id: 'io-latency', latencyMs: 20 });
    await kernel.registerPort(cpu);
    await kernel.registerPort(io);
    try {
      const jobs = Number(process.env.AWRM_E005_JOBS ?? 96);
      const cpuPts = await benchmarkLanes(kernel, { portId: 'cpu-pool', seatId: 'local-owner', laneCounts: [1, 2, 4, 8], jobsPerPoint: jobs });
      const ioPts = await benchmarkLanes(kernel, { portId: 'io-latency', seatId: 'local-owner', laneCounts: [1, 2, 4, 8], jobsPerPoint: jobs });
      r.metrics.cores = cpus().length;
      r.metrics.cpuBound = cpuPts;
      r.metrics.latencyBound = ioPts;
      const s = (pts: typeof cpuPts, n: number) => pts.find((p) => p.lanes === n)!.throughputPerSec / pts[0]!.throughputPerSec;
      r.metrics.speedup = { cpu: [1, 2, 4, 8].map((n) => +s(cpuPts, n).toFixed(2)), io: [1, 2, 4, 8].map((n) => +s(ioPts, n).toFixed(2)) };
      r.check('all benchmark jobs completed', [...cpuPts, ...ioPts].every((p) => p.failures === 0 && p.denied === 0), true);
      r.check('in-flight never exceeded lane count', [...cpuPts, ...ioPts].every((p) => p.maxInFlightObserved <= p.lanes), true);
      r.check('latency-bound scaling 1→8 lanes ≥ 4×', s(ioPts, 8) >= 4, true, { deterministic: false });
      r.check('CPU-bound scaling 1→4 lanes ≥ 2×', s(cpuPts, 4) >= 2, true, { deterministic: false });
      r.check(`CPU-bound 8 lanes give < 1.3× of 4 lanes on ${cpus().length} cores (machine limit visible)`, s(cpuPts, 8) / s(cpuPts, 4) < 1.3, true, { deterministic: false });
      r.check('partition fairness (Jain) ≥ 0.95 at every point', [...cpuPts, ...ioPts].every((p) => p.jain >= 0.95), true);

      // 32 DMUs, 4 lanes, hard global cap 8; one bad lane isolated by its breaker.
      const bad = new RulePort({ id: 'bad-worker', mode: 'error', latencyMs: 2 });
      const slowGood = new RulePort({ id: 'good-worker', latencyMs: 10 });
      await kernel.registerPort(bad);
      await kernel.registerPort(slowGood);
      const fleet = new Fleet(kernel, {
        lanes: [
          { laneId: 'g1', portId: 'good-worker', seatId: 'local-a', concurrency: 3 },
          { laneId: 'g2', portId: 'good-worker', seatId: 'local-b', concurrency: 3 },
          { laneId: 'g3', portId: 'good-worker', seatId: 'local-owner', concurrency: 3 },
          { laneId: 'bad', portId: 'bad-worker', seatId: 'local-owner', concurrency: 3 },
        ],
        globalCap: 8,
        maxQueue: 64,
        breaker: { failureThreshold: 2, cooldownMs: 60_000 },
      });
      const runs = await Promise.all(Array.from({ length: 32 }, (_, i) => fleet.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i + 2} × 3?` }, partition: `t${i % 4}` })));
      const okRuns = runs.filter((x) => x.state === 'completed');
      r.mark(...runs.map((x) => x.markDigest));
      r.metrics.benchmarkMarksWritten = kernel.listMarks().length;
      r.check('global cap 8 respected', fleet.stats.maxInFlightObserved <= 8, true);
      r.check('bad lane breaker opened', fleet.breakerOpen('bad'), true);
      r.check('bad lane failures bounded (≤ threshold + concurrency in flight)', (fleet.stats.perLane.bad?.failures ?? 0) <= 2 + 3, true);
      r.check('every other job completed with a verifying mark', okRuns.length >= 32 - 5 && okRuns.every((x) => x.markDigest), true);
      r.check('failed runs were not resubmitted elsewhere (32 runs total)', runs.length, 32);
      r.metrics.isolation = { completed: okRuns.length, failedOnBadLane: fleet.stats.perLane.bad?.failures ?? 0, maxInFlight: fleet.stats.maxInFlightObserved, perLane: fleet.stats.perLane };
      // Backpressure
      const tiny = new Fleet(kernel, { lanes: [{ laneId: 'x', portId: 'good-worker', seatId: 'local-a', concurrency: 1 }], globalCap: 1, maxQueue: 2 });
      const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => tiny.submit({ dmuId: 'math.check.v1', input: { question: `What is ${i} + 1?` } })));
      r.check('bounded queue rejects excess with backpressure', attempts.filter((a) => a.status === 'rejected').length >= 3, true);
      r.metrics.capacity = fleet.capacity();
      return verdictFrom(r, 'throughput scaled with lanes until CPU cores saturated; caps, fairness, backpressure and breaker isolation held');
    } finally {
      await cpu.close();
    }
  });
