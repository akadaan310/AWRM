/**
 * Owned-fixture HTTP port: speaks to the AWRM-owned chat fixture server
 * (packages/fixtures) over loopback HTTP + SSE, authenticating with a
 * test-only credential obtained through the seat's vault handle.
 *
 * The fixture session cookie lives only in this object's memory. It is never
 * returned in events, Marks, logs or the store.
 */
import type { PortManifest, SeatRef } from '@awrm/core';
import type { AwrmPort, PortEvent, PortInvocation, PortPermission } from './interface';
import { readSse } from './sse';

export class OwnedChatHttpPort implements AwrmPort {
  readonly kind = 'owned-fixture' as const;
  #cookie: string | null = null;
  constructor(readonly id: string, private baseUrl: string) {
    const u = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('owned-chat port is restricted to loopback fixtures');
  }

  async describe(): Promise<PortManifest> {
    return {
      id: this.id,
      kind: 'owned-fixture',
      label: 'AWRM owned chat fixture over loopback HTTP + SSE',
      liveness: 'owned-fixture',
      provider: 'awrm-local',
      network: 'loopback',
      sideEffects: 'none',
      streaming: true,
      model: 'owned-chat-fixture@1 (rule program A)',
    };
  }

  async assess(seat: SeatRef): Promise<PortPermission> {
    return { available: seat.provider === 'awrm-local' && Boolean(seat.credentialRef), reason: 'needs a local seat bound to a fixture test credential' };
  }

  private async login(req: PortInvocation, signal: AbortSignal): Promise<boolean> {
    if (!req.credentials) return false;
    return req.credentials.withCredential(async (secret) => {
      const [username, password] = secret.reveal().split(':');
      const res = await fetch(new URL('/login', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        redirect: 'manual',
        signal,
      });
      const set = res.headers.get('set-cookie');
      await res.body?.cancel();
      if (res.status !== 200 || !set) return false;
      this.#cookie = set.split(';')[0]!;
      return true;
    });
  }

  async *invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.#cookie && !(await this.login(req, signal))) {
        yield { type: 'error', code: 'human-login-required', message: 'fixture session absent and no usable test credential', retryable: false };
        return;
      }
      const res = await fetch(new URL('/api/chat', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: this.#cookie!, accept: 'text/event-stream' },
        body: JSON.stringify(req.prompt),
        signal,
      });
      if (res.status === 401) {
        await res.body?.cancel();
        this.#cookie = null; // expired / logged out: one re-login with the seat's own credential
        continue;
      }
      if (res.status === 429) {
        await res.body?.cancel();
        const ra = res.headers.get('retry-after');
        yield { type: 'rate-limited', retryAfterMs: ra ? Number(ra) * 1000 : null };
        return;
      }
      if (!res.ok || !res.body) {
        yield { type: 'error', code: `http-${res.status}`, message: 'fixture returned an error', retryable: res.status >= 500 };
        return;
      }
      let full = '';
      for await (const ev of readSse(res.body, signal)) {
        const d = JSON.parse(ev.data) as { text?: string; reason?: string };
        if (ev.event === 'chunk') {
          full += d.text ?? '';
          yield { type: 'chunk', text: d.text ?? '' };
        } else if (ev.event === 'done') {
          yield { type: 'final', text: d.text ?? full, model: 'owned-chat-fixture@1' };
          return;
        } else if (ev.event === 'refusal') {
          yield { type: 'refusal', reason: d.reason ?? 'refused' };
          return;
        }
      }
      yield { type: 'error', code: 'stream-interrupted', message: 'SSE ended without done', retryable: false };
      return;
    }
    yield { type: 'error', code: 'human-login-required', message: 'fixture rejected the session twice', retryable: false };
  }

  async close(): Promise<void> {
    this.#cookie = null;
  }
}
