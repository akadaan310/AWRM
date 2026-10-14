/**
 * A CPU-bound owned-fixture port backed by worker_threads, used to measure
 * real machine-limited Fleet scaling. Each invocation runs brain A and then
 * `cpuWorkMs` of genuine SHA-256 work on a worker thread.
 */
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

let calibrated: number | null = null;
/** SHA-256 rounds per millisecond on one core of this machine (measured once). */
export function hashRoundsPerMs(): number {
  if (calibrated) return calibrated;
  let h = Buffer.from('calibrate');
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < 50) {
    for (let i = 0; i < 200; i++) h = createHash('sha256').update(h).digest();
    n += 200;
  }
  calibrated = n / (performance.now() - t0);
  return calibrated;
}
import type { PortManifest, SeatRef } from '@awrm/core';
import type { AwrmPort, PortEvent, PortInvocation, PortPermission } from './interface';

const WORKER_SRC = `
const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
parentPort.on('message', ({ id, text, rounds }) => {
  // A fixed amount of work (not a wall-clock spin): oversubscribed threads take longer, as real compute does.
  let h = Buffer.from(text);
  for (let i = 0; i < rounds; i++) h = createHash('sha256').update(h).digest();
  parentPort.postMessage({ id, rounds });
});
`;

export class WorkerPoolPort implements AwrmPort {
  readonly kind = 'owned-fixture' as const;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private waiting: Array<(w: Worker) => void> = [];
  private seq = 0;
  readonly roundsPerJob: number;

  constructor(readonly id: string, private size: number, private cpuWorkMs: number, private brain: (p: { system?: string; user: string }) => string) {
    this.roundsPerJob = Math.max(1, Math.round(hashRoundsPerMs() * cpuWorkMs));
    for (let i = 0; i < size; i++) {
      const w = new Worker(WORKER_SRC, { eval: true });
      w.unref();
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  async describe(): Promise<PortManifest> {
    return {
      id: this.id,
      kind: 'owned-fixture',
      label: `worker-thread pool (${this.size}) running rule program A + ${this.roundsPerJob} SHA-256 rounds (≈${this.cpuWorkMs} ms on one idle core)`,
      liveness: 'deterministic-test-double',
      provider: 'awrm-local',
      network: 'none',
      sideEffects: 'none',
      streaming: false,
      maxConcurrency: this.size,
      model: 'awrm-rules-a@1',
    };
  }

  async assess(seat: SeatRef): Promise<PortPermission> {
    return { available: seat.provider === 'awrm-local', reason: 'local' };
  }

  private acquire(): Promise<Worker> {
    const w = this.idle.pop();
    return w ? Promise.resolve(w) : new Promise((r) => this.waiting.push(r));
  }
  private releaseWorker(w: Worker): void {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  async *invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent> {
    const w = await this.acquire();
    try {
      const id = ++this.seq;
      const text = this.brain(req.prompt);
      await new Promise<void>((resolve, reject) => {
        const onMsg = (m: { id: number }): void => {
          if (m.id !== id) return;
          w.off('message', onMsg);
          resolve();
        };
        w.on('message', onMsg);
        signal.addEventListener('abort', () => { w.off('message', onMsg); reject(signal.reason); }, { once: true });
        w.postMessage({ id, text, rounds: this.roundsPerJob });
      });
      yield { type: 'final', text, model: 'awrm-rules-a@1' };
    } finally {
      this.releaseWorker(w);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
