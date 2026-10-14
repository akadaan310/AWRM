/** TypeScript SDK for the AWRM local API. The CLI uses this same client. */
import type { DmuSpec, Mark, PassRecord, RunRecord } from '@awrm/core';

export class AwrmApiError extends Error {
  constructor(public status: number, public problem: { type?: string; title?: string; detail?: string; details?: unknown }) {
    super(`${status} ${problem.title ?? ''}: ${problem.detail ?? ''}`);
  }
}

export class AwrmClient {
  constructor(private baseUrl: string, private token: string) {}

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new AwrmApiError(res.status, data);
    return data as T;
  }

  status(): Promise<any> {
    return this.req('GET', '/v1/status');
  }
  dmus(): Promise<{ dmus: Array<{ id: string; title: string; version: number; digest: string; allowedPortKinds: string[] }> }> {
    return this.req('GET', '/v1/dmus');
  }
  forms(): Promise<any> {
    return this.req('GET', '/v1/forms');
  }
  registerDmu(definition: DmuSpec): Promise<any> {
    return this.req('POST', '/v1/dmus', { definition, approval: { approvedBy: 'owner' } });
  }
  providers(): Promise<any> {
    return this.req('GET', '/v1/providers');
  }
  run(r: { dmuId: string; input: unknown; seatId: string; portId: string; budget?: Record<string, number>; context?: { keeps?: string[]; passes?: string[] }; parentMarks?: string[] }, o: { wait?: boolean; idempotencyKey?: string } = {}): Promise<{ run: RunRecord }> {
    return this.req('POST', `/v1/runs${o.wait ? '?wait=true' : ''}`, r, o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {});
  }
  getRun(id: string): Promise<{ run: RunRecord }> {
    return this.req('GET', `/v1/runs/${id}`);
  }
  cancel(id: string): Promise<{ run: RunRecord }> {
    return this.req('POST', `/v1/runs/${id}/cancel`, {});
  }
  async events(id: string): Promise<Array<{ event: string; data: any }>> {
    const res = await fetch(`${this.baseUrl}/v1/runs/${id}/events`, { headers: { authorization: `Bearer ${this.token}` } });
    const text = await res.text();
    return text
      .split('\n\n')
      .filter(Boolean)
      .map((blk) => ({ event: /^event: (.*)$/m.exec(blk)?.[1] ?? 'message', data: JSON.parse(/^data: (.*)$/m.exec(blk)?.[1] ?? 'null') }));
  }
  marks(limit = 50): Promise<{ total: number; marks: Array<{ digest: string; runId: string; dmu: string; verdict: string; port: string; endedAt: string }> }> {
    return this.req('GET', `/v1/marks?limit=${limit}`);
  }
  mark(digest: string): Promise<{ mark: Mark; verification: { ok: boolean; structural: { ok: boolean; problems: string[] }; content: { ok: boolean; problems: string[] } } }> {
    return this.req('GET', `/v1/marks/${digest}`);
  }
  createPass(p: { fromMark: string; toSeatId: string; content: string; scope: string; consentRecord: string; [k: string]: unknown }): Promise<{ pass: PassRecord }> {
    return this.req('POST', '/v1/passes', p);
  }
  getPass(id: string): Promise<{ pass: PassRecord }> {
    return this.req('GET', `/v1/passes/${id}`);
  }
  createKeep(k: { keepId: string; content: unknown; mark: string; scope: string; readers: string[]; consentRecord: string }): Promise<any> {
    return this.req('POST', '/v1/keeps', k);
  }
  capacity(): Promise<any> {
    return this.req('GET', '/v1/fleet/capacity');
  }
  interop(): Promise<any> {
    return this.req('GET', '/v1/interop');
  }
}
