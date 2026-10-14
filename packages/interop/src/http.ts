/** Shared, protocol-neutral HTTP plumbing for the interop clients (no semantics). */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; redirect?: 'manual' | 'follow' }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface WireRecord {
  method: string;
  path: string;
  status: number;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseBody: unknown;
}

/** Wraps a fetch so every exchange is recorded with credentials redacted. */
export function recordingFetch(inner: FetchLike, log: WireRecord[], base: string): FetchLike {
  return async (url, init) => {
    const res = await inner(url, init);
    const text = await res.text();
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k, /authorization/i.test(k) ? 'Bearer [REDACTED]' : v]));
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(init.body) : null;
    } catch {
      body = init?.body ?? null;
    }
    let resBody: unknown = scrub(text);
    try {
      resBody = JSON.parse(scrub(text), (k, v) => (k === 'token' && typeof v === 'string' ? '[REDACTED:token]' : v));
    } catch {
      /* keep text */
    }
    log.push({ method: init?.method ?? 'GET', path: url.replace(base, ''), status: res.status, requestHeaders: headers, requestBody: body, responseBody: resBody });
    return { status: res.status, headers: res.headers, text: async () => text };
  };
}

/** Remove bearer-capable strings from recorded bodies (tokens are useless after the run, but never committed). */
function scrub(text: string): string {
  return text.replace(/acsp_cap_[A-Za-z0-9]+_[A-Za-z0-9]+/g, '[REDACTED:acsp-capability]').replace(/purl_[A-Za-z0-9_-]{16,}/g, '[REDACTED:purl-token]');
}

export const nodeFetch: FetchLike = async (url, init) => {
  const r = await fetch(url, init as RequestInit);
  return { status: r.status, headers: r.headers, text: () => r.text() };
};

/**
 * Offline replay of a recorded exchange log. Requests must arrive in the same
 * order with the same method, path and body (idempotency keys and auth
 * headers excluded). Any divergence throws — the replay never invents a reply.
 */
export function replayFetch(records: WireRecord[], base: string): FetchLike & { remaining(): number } {
  let i = 0;
  const norm = (b: unknown): string => JSON.stringify(b, (k, v) => (k === 'idempotency_key' ? '<key>' : v));
  const f = (async (url: string, init?: { method?: string; body?: string }) => {
    const rec = records[i++];
    const method = init?.method ?? 'GET';
    const path = url.replace(base, '');
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(init.body) : null;
    } catch {
      body = init?.body ?? null;
    }
    if (!rec) throw new Error(`replay exhausted at ${method} ${path}`);
    if (rec.method !== method || rec.path !== path) throw new Error(`replay divergence at #${i}: expected ${rec.method} ${rec.path}, got ${method} ${path}`);
    if (norm(rec.requestBody) !== norm(body)) throw new Error(`replay body divergence at #${i} (${method} ${path})`);
    const text = typeof rec.responseBody === 'string' ? rec.responseBody : JSON.stringify(rec.responseBody);
    return { status: rec.status, headers: { get: (n: string) => (n.toLowerCase() === 'allow' && rec.status === 405 ? 'POST' : null) }, text: async () => text };
  }) as FetchLike & { remaining(): number };
  f.remaining = () => records.length - i;
  return f;
}
