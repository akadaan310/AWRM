/**
 * AWRM local API — an API for *AWRM's own DMU engine*, never a proxy to any
 * provider's web UI.
 *
 * Security posture:
 *  - binds to loopback only; refuses any other host;
 *  - bearer token required on every route, compared in constant time;
 *  - Host header must be a loopback name (DNS-rebinding defence);
 *  - any Origin header other than the API's own is refused (CSRF defence);
 *  - POST bodies must be application/json (no simple-form CSRF);
 *  - responses carry no secrets; Marks are already redacted.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AwrmError, TERMINAL_RUN_STATES, isAwrmError, type DmuSpec, type Mark } from '@awrm/core';
import { verifyMark, verifyMarkContent } from '@awrm/evidence';
import { INTEROP_MATRIX } from '@awrm/interop';
import { ELIGIBILITY } from '@awrm/policy';
import type { Kernel, KernelEvent } from '@awrm/runtime';
import type { Fleet } from '@awrm/scheduler';

export interface ApiOptions {
  kernel: Kernel;
  host?: string;
  port?: number;
  token?: string;
  fleet?: Fleet | null;
  interopStatus?: () => unknown;
  version?: string;
}

export interface ApiHandle {
  url: string;
  token: string;
  server: Server;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_BODY = 256 * 1024;

export function newApiToken(): string {
  return 'awrm_tok_' + randomBytes(24).toString('base64url');
}

export async function startApi(o: ApiOptions): Promise<ApiHandle> {
  const host = o.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) throw new AwrmError('forbidden', `the AWRM API binds to loopback only, not ${host}`);
  const token = o.token ?? newApiToken();
  const k = o.kernel;
  const started = Date.now();
  let selfOrigin = '';

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => problem(res, e));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hostHeader = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!LOOPBACK.has(hostHeader)) throw new AwrmError('forbidden', 'non-loopback Host header');
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== selfOrigin) throw new AwrmError('forbidden', 'cross-origin request refused');
    const auth = req.headers.authorization ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!constantEq(presented, token)) throw new AwrmError('unauthorized', 'bearer token required');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (['token', 'access_token', 'key'].some((p) => url.searchParams.has(p))) throw new AwrmError('invalid-input', 'credentials never go in URLs');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const body = method === 'POST' ? await readJson(req) : undefined;
    const seg = path.split('/').filter(Boolean); // ['v1', ...]
    if (seg[0] !== 'v1') throw new AwrmError('not-found', 'unknown route');

    // GET /v1/status
    if (method === 'GET' && path === '/v1/status') {
      const runs = k.listRuns();
      const byState: Record<string, number> = {};
      for (const r of runs) byState[r.state] = (byState[r.state] ?? 0) + 1;
      return json(res, 200, {
        engine: 'awrm',
        version: o.version ?? '0.1.0',
        uptimeMs: Date.now() - started,
        store: { kind: k.store.kind },
        dmus: k.listDmus().length,
        ports: k.listPorts(),
        seats: k.seats.list().map((s) => ({ seatId: s.seatId, provider: s.provider, principal: s.principal, quotaKey: s.quotaKey, allowedPortKinds: s.allowedPortKinds, hasCredentialHandle: Boolean(s.credentialRef) })),
        runs: { total: runs.length, byState },
        marks: k.listMarks().length,
      });
    }
    if (method === 'GET' && path === '/v1/forms') return json(res, 200, { forms: k.listDmus().map((d) => ({ dmuId: d.id, ...d.form })) });
    if (method === 'GET' && path === '/v1/dmus') return json(res, 200, { dmus: k.listDmus() });
    if (method === 'POST' && path === '/v1/dmus') {
      const b = body as { definition?: DmuSpec; approval?: { approvedBy?: string } };
      if (b?.approval?.approvedBy !== 'owner') throw new AwrmError('forbidden', 'registering a DMU requires approval.approvedBy = "owner"');
      if (!b.definition) throw new AwrmError('invalid-input', 'definition required');
      const def = k.registerDmu(b.definition);
      return json(res, 201, { dmu: def, executed: false });
    }
    if (method === 'GET' && path === '/v1/providers') return json(res, 200, { accessed: '2026-10-14', rows: ELIGIBILITY.map(({ record, ...r }) => ({ ...r, evidence: record?.evidence ?? [] })) });
    if (method === 'POST' && path === '/v1/runs') {
      const b = (body ?? {}) as Record<string, unknown>;
      const key = req.headers['idempotency-key'];
      const run = k.submit({
        dmuId: String(b.dmuId ?? ''),
        input: b.input,
        seatId: String(b.seatId ?? ''),
        portId: String(b.portId ?? ''),
        actor: { id: 'api', kind: 'api-client' },
        ...(b.budget ? { budget: b.budget as Record<string, number> } : {}),
        ...(b.context ? { context: b.context as { keeps?: string[]; passes?: string[] } } : {}),
        ...(Array.isArray(b.parentMarks) ? { parentMarks: b.parentMarks as string[] } : {}),
        ...(typeof key === 'string' ? { idempotencyKey: key } : {}),
      });
      let current = run;
      if (run.state === 'queued') {
        const p = k.execute(run.runId).catch(() => k.getRun(run.runId));
        if (url.searchParams.get('wait') === 'true') current = await p;
      }
      return json(res, current.state === 'queued' || current.state === 'running' ? 202 : 200, { run: current });
    }
    if (seg[1] === 'runs' && seg[2]) {
      const runId = seg[2];
      if (method === 'GET' && seg.length === 3) return json(res, 200, { run: k.getRun(runId) });
      if (method === 'POST' && seg[3] === 'cancel') return json(res, 200, { run: k.cancel(runId) });
      if (method === 'GET' && seg[3] === 'events') return sse(req, res, runId);
    }
    if (method === 'GET' && path === '/v1/marks') {
      const marks = k.listMarks();
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 500);
      return json(res, 200, { total: marks.length, marks: marks.slice(-limit).map((m) => ({ digest: m.digest, runId: m.runId, dmu: m.dmu.id, verdict: m.verdict, port: m.port.id, endedAt: m.timing.endedAt })) });
    }
    if (method === 'GET' && seg[1] === 'marks' && seg[2]) {
      const m = k.getMark(seg[2]);
      if (!m) throw new AwrmError('not-found', 'no such mark');
      const content = k.store.get<{ input: unknown; output: unknown }>('mark-content', m.digest);
      const structural = verifyMark(m);
      const contentCheck = content ? verifyMarkContent(m, content.input, content.output) : { ok: false, problems: ['content not stored'] };
      return json(res, 200, { mark: m, verification: { ok: structural.ok && contentCheck.ok, structural, content: contentCheck } });
    }
    if (method === 'POST' && path === '/v1/passes') {
      const b = (body ?? {}) as Record<string, unknown>;
      const m = k.getMark(String(b.fromMark ?? ''));
      if (!m) throw new AwrmError('not-found', 'fromMark not found');
      const { fromMark: _f, ...rest } = b;
      const pass = k.passes.create({ ...rest, fromMark: m, toSeatId: String(b.toSeatId ?? ''), content: String(b.content ?? ''), scope: String(b.scope ?? 'default'), consentRecord: String(b.consentRecord ?? '') } as never);
      return json(res, 201, { pass });
    }
    if (method === 'GET' && seg[1] === 'passes' && seg[2]) {
      const p = k.passes.get(seg[2]);
      if (!p) throw new AwrmError('not-found', 'no such pass');
      return json(res, 200, { pass: p });
    }
    if (method === 'POST' && path === '/v1/keeps') {
      const b = (body ?? {}) as Record<string, unknown>;
      const m = k.getMark(String(b.mark ?? ''));
      if (!m) throw new AwrmError('not-found', 'mark not found');
      const keep = k.keeps.write({ keepId: String(b.keepId ?? ''), content: b.content, mark: m, scope: String(b.scope ?? 'default'), readers: (b.readers as string[]) ?? [], consentRecord: String(b.consentRecord ?? '') });
      return json(res, 201, { keep });
    }
    if (method === 'GET' && seg[1] === 'keeps' && seg[2]) {
      const keep = k.keeps.latest(seg[2]);
      if (!keep) throw new AwrmError('not-found', 'no such keep');
      return json(res, 200, { keep, history: k.keeps.history(seg[2]).map((h) => ({ revision: h.revision, digest: h.digest })) });
    }
    if (method === 'GET' && path === '/v1/fleet/capacity') {
      return json(res, 200, {
        quotas: k.ledger.report().map((q) => ({ ...q, limit: q.limit ?? 'unknown', windowMs: q.windowMs ?? 'unknown' })),
        fleet: o.fleet ? o.fleet.capacity() : null,
        stats: o.fleet ? o.fleet.stats : null,
        note: 'Known allowances only. Unknown is reported as "unknown", never infinite. Views of one account share one quotaKey.',
      });
    }
    if (method === 'GET' && path === '/v1/interop') return json(res, 200, { matrix: INTEROP_MATRIX, testStatus: o.interopStatus?.() ?? 'not-run-in-this-process' });
    throw new AwrmError('not-found', `no route ${method} ${path}`);
  }

  function sse(req: IncomingMessage, res: ServerResponse, runId: string): void {
    k.getRun(runId);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const write = (e: KernelEvent): void => {
      res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    let sent = 0;
    const finishIfTerminal = (): boolean => {
      const r = k.getRun(runId);
      if (TERMINAL_RUN_STATES.includes(r.state)) {
        res.end(`event: end\ndata: ${JSON.stringify({ runId, state: r.state, markDigest: r.markDigest })}\n\n`);
        return true;
      }
      return false;
    };
    for (const e of k.eventsFor(runId)) {
      write(e);
      sent = Math.max(sent, e.seq);
    }
    if (finishIfTerminal()) return;
    const onEv = (e: KernelEvent): void => {
      if (e.runId !== runId || e.seq <= sent) return;
      write(e);
      if (e.type === 'state' && e.state && TERMINAL_RUN_STATES.includes(e.state)) {
        k.events.off('event', onEv);
        finishIfTerminal();
      }
    };
    k.events.on('event', onEv);
    const timeout = setTimeout(() => {
      k.events.off('event', onEv);
      res.end();
    }, 5 * 60_000);
    req.on('close', () => {
      clearTimeout(timeout);
      k.events.off('event', onEv);
    });
  }

  await new Promise<void>((r) => server.listen(o.port ?? 0, host, r));
  const { port } = server.address() as AddressInfo;
  const url = `http://${host === '::1' ? '[::1]' : host}:${port}`;
  selfOrigin = url;
  return {
    url,
    token,
    server,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function constantEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const ct = req.headers['content-type'] ?? '';
  if (!ct.startsWith('application/json')) throw new AwrmError('invalid-input', 'POST bodies must be application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new AwrmError('invalid-input', 'body too large');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AwrmError('invalid-input', 'malformed JSON');
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

const STATUS: Record<string, number> = {
  'invalid-input': 400, 'invalid-definition': 400, 'idempotency-conflict': 409, 'unknown-dmu': 404, 'unknown-port': 404, 'unknown-seat': 404,
  'unknown-run': 404, 'not-found': 404, unauthorized: 401, forbidden: 403, 'authority-transfer': 403, 'secret-material': 400, 'illegal-transition': 409,
  integrity: 409, backpressure: 429,
};

function problem(res: ServerResponse, e: unknown): void {
  if (res.headersSent) return void res.end();
  const code = isAwrmError(e) ? e.code : 'internal';
  const status = STATUS[code] ?? (isAwrmError(e) ? 400 : 500);
  res.writeHead(status, { 'content-type': 'application/problem+json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ type: `urn:awrm:problem:${code}`, title: code, status, detail: e instanceof Error ? e.message : 'internal error', ...(isAwrmError(e) && e.details ? { details: e.details } : {}) }));
}

export type { Mark };
