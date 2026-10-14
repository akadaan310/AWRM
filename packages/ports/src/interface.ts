/**
 * awrm.port — the one interface every execution method implements.
 * The kernel depends on this file only; it never imports a concrete port.
 */
import type { PortManifest, SeatRef } from '@awrm/core';

export type { PortManifest };

export interface PortPermission {
  available: boolean;
  reason: string;
}

export interface CredentialAccess {
  /** Opens the seat's own credential for the duration of fn. Throws if absent or not bound. */
  withCredential<T>(fn: (secret: { reveal(): string }) => Promise<T>): Promise<T>;
}

export interface PortInvocation {
  runId: string;
  turnId: string;
  attempt: number;
  dmuId: string;
  prompt: { system?: string; user: string };
  maxOutputChars: number;
  deadlineMs: number;
  seat: SeatRef;
  credentials: CredentialAccess | null;
}

export type PortEvent =
  | { type: 'chunk'; text: string }
  | { type: 'final'; text: string; model?: string; costUsd?: number }
  | { type: 'refusal'; reason: string }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'rate-limited'; retryAfterMs: number | null };

export interface AwrmPort {
  id: string;
  kind: PortManifest['kind'];
  describe(): Promise<PortManifest>;
  assess(seat: SeatRef, operation: 'prompt' | 'observe'): Promise<PortPermission>;
  invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent>;
  close(): Promise<void>;
}

/** Resolves after ms, or rejects early when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
