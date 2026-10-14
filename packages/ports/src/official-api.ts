/**
 * Official provider API ports. They exist so a permitted, owner-configured API
 * can be used without changing any DMU. They are inert unless the Gate permits
 * (documented provider permission + owner permission + credential present).
 * No consumer-website endpoints are implemented anywhere in AWRM.
 */
import type { PortManifest, SeatRef } from '@awrm/core';
import type { AwrmPort, PortEvent, PortInvocation, PortPermission } from './interface';

export interface OfficialApiOptions {
  id: string;
  model: string;
  baseUrl?: string; // override only for wire tests against an owned fake
  maxTokens?: number;
}

export class AnthropicMessagesPort implements AwrmPort {
  readonly kind = 'official-api' as const;
  readonly id: string;
  constructor(private o: OfficialApiOptions) {
    this.id = o.id;
  }
  async describe(): Promise<PortManifest> {
    return {
      id: this.id,
      kind: 'official-api',
      label: 'Anthropic Messages API (official, API-key authenticated)',
      liveness: 'external-live',
      provider: 'anthropic',
      network: 'external',
      sideEffects: 'unknown', // billed per call; never blindly retried
      streaming: false,
      model: this.o.model,
      notes: 'Paid usage under Anthropic Commercial Terms. Disabled unless owner permission + key exist.',
    };
  }
  async assess(seat: SeatRef): Promise<PortPermission> {
    return seat.provider === 'anthropic' && seat.credentialRef ? { available: true, reason: 'seat has a credential handle' } : { available: false, reason: 'no anthropic seat with credential handle' };
  }
  async *invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent> {
    if (!req.credentials) {
      yield { type: 'error', code: 'no-credential', message: 'no credential access', retryable: false };
      return;
    }
    const res = await req.credentials.withCredential((key) =>
      fetch(`${this.o.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key.reveal(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.o.model,
          max_tokens: this.o.maxTokens ?? 512,
          ...(req.prompt.system ? { system: req.prompt.system } : {}),
          messages: [{ role: 'user', content: req.prompt.user }],
        }),
        signal,
      }),
    );
    if (res.status === 429) {
      const ra = res.headers.get('retry-after');
      yield { type: 'rate-limited', retryAfterMs: ra ? Number(ra) * 1000 : null };
      return;
    }
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string; error?: { message?: string } };
    if (!res.ok) {
      yield { type: 'error', code: `http-${res.status}`, message: body.error?.message ?? 'api error', retryable: false };
      return;
    }
    if (body.stop_reason === 'refusal') {
      yield { type: 'refusal', reason: 'provider refusal' };
      return;
    }
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    yield { type: 'final', text, model: this.o.model };
  }
  async close(): Promise<void> {}
}

export class GeminiApiPort implements AwrmPort {
  readonly kind = 'official-api' as const;
  readonly id: string;
  constructor(private o: OfficialApiOptions) {
    this.id = o.id;
  }
  async describe(): Promise<PortManifest> {
    return {
      id: this.id,
      kind: 'official-api',
      label: 'Google Gemini API generateContent (official, API-key authenticated)',
      liveness: 'external-live',
      provider: 'google',
      network: 'external',
      sideEffects: 'unknown',
      streaming: false,
      model: this.o.model,
      notes: 'Unpaid tier content may be used to improve Google products (Gemini API Additional Terms). Disabled unless owner permission + key exist.',
    };
  }
  async assess(seat: SeatRef): Promise<PortPermission> {
    return seat.provider === 'google' && seat.credentialRef ? { available: true, reason: 'seat has a credential handle' } : { available: false, reason: 'no google seat with credential handle' };
  }
  async *invoke(req: PortInvocation, signal: AbortSignal): AsyncIterable<PortEvent> {
    if (!req.credentials) {
      yield { type: 'error', code: 'no-credential', message: 'no credential access', retryable: false };
      return;
    }
    const res = await req.credentials.withCredential((key) =>
      fetch(`${this.o.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(this.o.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key.reveal() }, // key in header, never in the URL
        body: JSON.stringify({
          ...(req.prompt.system ? { systemInstruction: { parts: [{ text: req.prompt.system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: req.prompt.user }] }],
        }),
        signal,
      }),
    );
    if (res.status === 429) {
      yield { type: 'rate-limited', retryAfterMs: null };
      return;
    }
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; error?: { message?: string } };
    if (!res.ok) {
      yield { type: 'error', code: `http-${res.status}`, message: body.error?.message ?? 'api error', retryable: false };
      return;
    }
    const c = body.candidates?.[0];
    if (!c || c.finishReason === 'SAFETY') {
      yield { type: 'refusal', reason: c?.finishReason ?? 'no candidate' };
      return;
    }
    yield { type: 'final', text: (c.content?.parts ?? []).map((p) => p.text ?? '').join(''), model: this.o.model };
  }
  async close(): Promise<void> {}
}

/**
 * Declared-but-disabled consumer UI ports. They exist only so the provider
 * matrix and the Gate have something concrete to deny. invoke() is
 * unreachable by construction and throws if somehow called.
 */
export class DisabledConsumerPort implements AwrmPort {
  readonly kind = 'approved-browser' as const;
  constructor(readonly id: string, private provider: string, private product: string) {}
  async describe(): Promise<PortManifest> {
    return {
      id: this.id,
      kind: 'approved-browser',
      label: `${this.product} consumer UI — DISABLED (automation not permitted / not established)`,
      liveness: 'external-live',
      provider: this.provider,
      network: 'external',
      sideEffects: 'unknown',
      streaming: false,
    };
  }
  async assess(): Promise<PortPermission> {
    return { available: false, reason: 'consumer UI automation is not an established permitted method' };
  }
  // eslint-disable-next-line require-yield
  async *invoke(): AsyncIterable<PortEvent> {
    throw new Error(`${this.id} is disabled; the Gate must never let a run reach it`);
  }
  async close(): Promise<void> {}
}
