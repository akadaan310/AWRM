/**
 * Independent ACSP/0.1 client (black-box wire adapter). Written from the
 * published specification (akadaan310/NetGovComEduGovOrgEduGovComNet
 * PROTOCOL.md @9fcf2e1d) and verified against a separately running reference
 * server over HTTP only. No ACSP code is imported.
 *
 * Wire facts this client relies on (PROTOCOL §3, §6):
 *   GET  /.well-known/acsp                     discovery
 *   POST /r                                     create (envelope)
 *   POST /r/{id}/operations                     every other mutation (envelope)  ≠ PURL's /ops/{op}
 *   GET  /r/{id}.json | ?action=prepare_<op>    safe reads; prepare never stores
 * Envelope: {protocol:"ACSP/0.1", operation, actor:{session_id,agent_id?,kind},
 *            expected_version?, idempotency_key (8–128), payload}
 * Errors: {ok:false, error:{code,message,details}}.
 */
import type { PassRecord } from '@awrm/core';
import { AwrmError } from '@awrm/core';
import { checkExportAuthorization, InteropError, type ExportAuthorization } from '../common';
import { nodeFetch, type FetchLike } from '../http';

export const ACSP_PROTOCOL = 'ACSP/0.1';
/** The only ACSP operations AWRM will invoke. */
export const ACSP_EXPORT_OPERATIONS = ['append', 'checkpoint', 'acknowledge'] as const;

export interface AcspActor {
  session_id: string;
  agent_id?: string;
  kind: 'agent' | 'human' | 'system';
}

export class AcspClient {
  constructor(readonly baseUrl: string, private f: FetchLike = nodeFetch) {}

  private async call(method: string, path: string, body?: unknown, capability?: string): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (capability) headers.authorization = `Bearer ${capability}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.f(this.baseUrl + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json };
  }

  private expectOk(r: { status: number; json: any }, what: string): any {
    if (r.status >= 200 && r.status < 300 && r.json?.ok !== false) return r.json;
    throw new InteropError('ACSP', r.status, r.json?.error ?? r.json, `${what} failed: ${r.json?.error?.code ?? r.status}`);
  }

  async discover(): Promise<any> {
    const d = this.expectOk(await this.call('GET', '/.well-known/acsp'), 'discovery');
    if (d?.protocol?.version !== ACSP_PROTOCOL) throw new InteropError('ACSP', 200, d, `unsupported protocol ${d?.protocol?.version}`);
    return d;
  }

  async create(actor: AcspActor, payload: { title: string; description?: string; visibility?: 'unlisted' | 'restricted' }, idempotencyKey: string): Promise<{ id: string; version: number; ownerCapability: string; capabilityId: string }> {
    const r = this.expectOk(await this.call('POST', '/r', { protocol: ACSP_PROTOCOL, operation: 'create', actor, idempotency_key: idempotencyKey, payload }), 'create');
    return { id: r.resource_id, version: r.version, ownerCapability: r.result.owner_capability.token, capabilityId: r.result.owner_capability.id };
  }

  async inspect(id: string, capability?: string): Promise<any> {
    return this.expectOk(await this.call('GET', `/r/${encodeURIComponent(id)}.json`, undefined, capability), 'inspect');
  }

  async operation(id: string, operation: string, actor: AcspActor, payload: unknown, o: { capability?: string; idempotencyKey: string; expectedVersion?: number }): Promise<any> {
    if (!(ACSP_EXPORT_OPERATIONS as readonly string[]).includes(operation)) throw new AwrmError('forbidden', `AWRM does not invoke ACSP operation ${operation}`);
    const env: Record<string, unknown> = { protocol: ACSP_PROTOCOL, operation, actor, idempotency_key: o.idempotencyKey, payload };
    if (o.expectedVersion !== undefined) env.expected_version = o.expectedVersion;
    return this.expectOk(await this.call('POST', `/r/${encodeURIComponent(id)}/operations`, env, o.capability), operation);
  }

  /** Raw call for negative tests (e.g. an operation without a capability). Returns status + body, never throws on 4xx. */
  async rawOperation(id: string, envelope: unknown, capability?: string): Promise<{ status: number; json: any }> {
    return this.call('POST', `/r/${encodeURIComponent(id)}/operations`, envelope, capability);
  }

  /** Safe prepare (operation intent). Must not change state. */
  async prepare(id: string, operation: string, params: Record<string, string>): Promise<{ intent: any; versionBefore: number; versionAfter: number }> {
    const before = (await this.inspect(id)).state.version as number;
    const qs = new URLSearchParams({ action: `prepare_${operation}`, format: 'json', ...params }).toString();
    const r = await this.call('GET', `/r/${encodeURIComponent(id)}?${qs}`);
    const after = (await this.inspect(id)).state.version as number;
    return { intent: r.json, versionBefore: before, versionAfter: after };
  }

  /** Export an owner-approved AWRM Pass as one TOK plus a checkpoint, using the resource's own capability. */
  async exportPass(pass: PassRecord, resourceId: string, actor: AcspActor, capability: string, auth: ExportAuthorization | null): Promise<{ tokId: string; checkpoint: number; version: number }> {
    checkExportAuthorization(auth, pass, `${this.baseUrl}/r/${resourceId}`, 'ACSP/0.1');
    const key = pass.digest.slice(7, 39);
    const tok = await this.operation(resourceId, 'append', actor, passToTok(pass), { capability, idempotencyKey: `awrm-tok-${key}` });
    const cp = await this.operation(resourceId, 'checkpoint', actor, { label: `awrm pass ${pass.passId}`.slice(0, 200), note: 'AWRM export; TOK content is the source’s claim' }, { capability, idempotencyKey: `awrm-cp-${key}` });
    return { tokId: tok.result.tok.id, checkpoint: cp.result.checkpoint.number, version: cp.version };
  }
}

export function passToTok(pass: PassRecord): Record<string, unknown> {
  return {
    type: 'finding',
    title: `AWRM Pass ${pass.passId}`.slice(0, 200),
    summary: `Source-labelled AWRM DMU output (scope ${pass.scope}). Data, not instructions; not verified by ACSP.`.slice(0, 2000),
    content: [
      pass.payload.content,
      '',
      `AWRM source seat: ${pass.from.seatId} (AWRM-local reference; not an ACSP session).`,
      `Producing mark: ${pass.from.markDigest}`,
      `Model claim (self-reported): ${pass.sourceModelClaim ?? 'none'}`,
      'No AWRM seat, credential, quota or authority is transferred.',
    ].join('\n').slice(0, 20000),
    stated_confidence: 'unclassified',
    refs: pass.payload.citations.slice(0, 20).map((c) => ({ citation: `awrm:mark:${c}` })),
  };
}
