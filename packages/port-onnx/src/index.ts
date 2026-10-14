/**
 * OPTIONAL real open-weight local model port.
 *
 * Runs a text-to-text model (default Xenova/flan-t5-small, ONNX, 8-bit
 * quantised, Apache-2.0) on the local CPU through transformers.js / ONNX
 * Runtime. Weights are fetched once from the public Hugging Face hub into a
 * local cache; inference itself makes no network calls.
 *
 * Output quality is whatever the model produces — e.g. flan-t5-small answers
 * "17 × 23" incorrectly — and the DMU's Form decides validity.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PortManifest, SeatRef } from '@awrm/core';
import type { AwrmPort, PortEvent, PortInvocation, PortPermission } from '@awrm/ports';

export interface OnnxPortOptions {
  id: string;
  model?: string;
  dtype?: 'q8' | 'fp32';
  cacheDir?: string;
  maxNewTokens?: number;
}

type Generator = (input: string, opts: Record<string, unknown>) => Promise<Array<{ generated_text: string }>>;

export function onnxAvailable(): { ok: boolean; reason: string } {
  try {
    import.meta.resolve('@huggingface/transformers');
    return { ok: true, reason: '@huggingface/transformers resolvable' };
  } catch (e) {
    return { ok: false, reason: `@huggingface/transformers not installed: ${(e as Error).message}` };
  }
}

export function defaultModelCache(): string {
  return process.env.AWRM_MODEL_CACHE ?? join(homedir(), '.cache', 'awrm', 'models');
}

export class OnnxText2TextPort implements AwrmPort {
  readonly kind = 'local-model' as const;
  readonly id: string;
  readonly model: string;
  private gen: Promise<Generator> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  loadMs: number | null = null;

  constructor(private o: OnnxPortOptions) {
    this.id = o.id;
    this.model = o.model ?? 'Xenova/flan-t5-small';
  }

  async describe(): Promise<PortManifest> {
    return {
      id: this.id,
      kind: 'local-model',
      label: `${this.model} (${this.o.dtype ?? 'q8'}) via ONNX Runtime on local CPU`,
      liveness: 'local-open-weight-model',
      provider: 'awrm-local',
      network: 'none',
      sideEffects: 'none',
      streaming: false,
      maxConcurrency: 1,
      model: this.model,
      license: this.model.includes('flan-t5') ? 'Apache-2.0 (google/flan-t5; ONNX conversion by Xenova)' : 'see model card',
      notes: 'Weights downloaded once from the public Hugging Face hub; inference is offline.',
    };
  }

  async assess(seat: SeatRef): Promise<PortPermission> {
    return seat.provider === 'awrm-local' ? { available: true, reason: 'local inference' } : { available: false, reason: 'local model serves awrm-local seats only' };
  }

  async warm(): Promise<number> {
    const t0 = performance.now();
    await this.generator();
    return performance.now() - t0;
  }

  private generator(): Promise<Generator> {
    this.gen ??= (async () => {
      const t0 = performance.now();
      const tf = (await import('@huggingface/transformers')) as unknown as {
        pipeline(task: string, model: string, o: Record<string, unknown>): Promise<Generator>;
        env: { cacheDir: string; allowRemoteModels: boolean };
      };
      tf.env.cacheDir = this.o.cacheDir ?? defaultModelCache();
      const g = await tf.pipeline('text2text-generation', this.model, { dtype: this.o.dtype ?? 'q8' });
      this.loadMs = performance.now() - t0;
      return g;
    })();
    return this.gen;
  }

  async *invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent> {
    const gen = await this.generator();
    if (signal.aborted) return;
    const input = (req.prompt.system ? req.prompt.system + '\n' : '') + req.prompt.user;
    // ONNX sessions are not re-entrant here; serialise calls on this port.
    const run = this.queue.then(() => gen(input, { max_new_tokens: this.o.maxNewTokens ?? 48, do_sample: false }));
    this.queue = run.catch(() => undefined);
    const out = await run;
    yield { type: 'final', text: out[0]?.generated_text ?? '', model: this.model };
  }

  async close(): Promise<void> {}
}
