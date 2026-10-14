/**
 * Independent PURL/0.1 client (black-box wire adapter). Written from the
 * published specification (akadaan310/purl SPEC.md @3df4452a) and verified
 * against a separately running reference server over HTTP only.
 * No PURL code is imported.
 *
 * Wire facts this client relies on (SPEC §3–§4):
 *   GET  /.well-known/purl                 instance manifest
 *   POST /principals                       → bearer token (never in a URL)
 *   POST /r                                create {type, state?, public?}
 *   GET  /r/{id}, /r/{id}/manifest, /r/{id}/{projection}
 *   POST /r/{id}/ops/{operation}           {expected_version, input} + Idempotency-Key
 *   GET  /r/{id}/ops/{operation}           MUST be 405 (safety)
 * Errors are RFC 9457 problems with type urn:purl:problem:<code>.
 */
import type { PassRecord } from '@awrm/core';
import { AwrmError } from '@awrm/core';
import { checkExportAuthorization, InteropError, type ExportAuthorization } from '../common';
import { nodeFetch, type FetchLike } from '../http';

export const PURL_PROTOCOL = 'PURL/0.1';
/** The only operations AWRM will ever invoke on a PURL resource. */
export const PURL_EXPORT_OPERATIONS = ['checkpoint', 'annotate'] as const;
const OP_NAME = /^[a-z][a-z_]{1,40}$/;

export interface PurlOperationDescriptor {
  name: string;
  available?: boolean;
  safe?: boolean;
  method?: string;
  reason?: string;
}

export class PurlClient {
  #token: string | null = null;
  constructor(readonly baseUrl: string, private f: FetchLike = nodeFetch) {
    if (/[?&](token|access_token|key)=/i.test(baseUrl)) throw new AwrmError('invalid-input', 'credentials never go in PURL URLs');
  }

  private async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: any; headers: { get(n: string): string | null } }> {
    const headers: Record<string, string> = { accept: 'application/purl+json', ...extra };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.f(this.baseUrl + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json, headers: res.headers };
  }

  private expectOk(r: { status: number; json: any }, what: string): any {
    if (r.status >= 200 && r.status < 300) {
      if (r.json && typeof r.json.protocol === 'string' && !r.json.protocol.startsWith('PURL/0.')) throw new InteropError('PURL', r.status, r.json, `unknown PURL major version ${r.json.protocol}`);
      return r.json;
    }
    throw new InteropError('PURL', r.status, r.json, `${what} failed: ${r.json?.type ?? r.status} ${r.json?.detail ?? ''}`.trim());
  }

  async discover(): Promise<any> {
    const m = this.expectOk(await this.call('GET', '/.well-known/purl'), 'discovery');
    if (m.kind !== 'instance-manifest') throw new InteropError('PURL', 200, m, 'not an instance manifest');
    return m;
  }

  async registerPrincipal(kind: 'agent' | 'service' | 'human', label: string): Promise<{ principalId: string }> {
    const r = this.expectOk(await this.call('POST', '/principals', { kind, label }), 'principal registration');
    this.#token = r.token as string; // held in memory only
    return { principalId: r.principal.id };
  }

  /** Use an owner-supplied token (e.g. from the vault). */
  useToken(token: string): void {
    this.#token = token;
  }

  async create(type: string, state: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
    const r = this.expectOk(await this.call('POST', '/r', { type, state }), 'create');
    return { id: r.resource.id, version: r.resource.version };
  }

  async representation(id: string): Promise<any> {
    return this.expectOk(await this.call('GET', `/r/${encodeURIComponent(id)}`), 'inspect');
  }

  async manifest(id: string): Promise<{ operations: PurlOperationDescriptor[]; [k: string]: unknown }> {
    return this.expectOk(await this.call('GET', `/r/${encodeURIComponent(id)}/manifest`), 'manifest');
  }

  async projection(id: string, name: 'status' | 'events' | 'verify' | 'continuity' | 'lineage'): Promise<any> {
    return this.expectOk(await this.call('GET', `/r/${encodeURIComponent(id)}/${name}`), name);
  }

  /** Invoke one operation. Refuses operation names outside AWRM's export allow-list or unavailable per the manifest. */
  async invoke(id: string, operation: string, input: unknown, o: { expectedVersion: number; idempotencyKey?: string }): Promise<any> {
    if (!OP_NAME.test(operation) || !(PURL_EXPORT_OPERATIONS as readonly string[]).includes(operation)) throw new AwrmError('forbidden', `AWRM does not invoke PURL operation ${operation}`);
    const man = await this.manifest(id);
    const desc = man.operations.find((o2) => o2.name === operation);
    if (!desc) throw new AwrmError('unsupported', `operation ${operation} not offered by this resource`);
    if (desc.available === false) throw new AwrmError('forbidden', `PURL says ${operation} is unavailable: ${desc.reason ?? 'no reason'}`);
    const r = await this.call('POST', `/r/${encodeURIComponent(id)}/ops/${operation}`, { expected_version: o.expectedVersion, input }, o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {});
    return this.expectOk(r, operation);
  }

  /** Safety probe: GET on an operation URL must be refused (405) and must not change the version. */
  async probeSafeGet(id: string, operation: string): Promise<{ status: number; allow: string | null; versionBefore: number; versionAfter: number }> {
    const before = (await this.representation(id)).resource.version as number;
    const r = await this.call('GET', `/r/${encodeURIComponent(id)}/ops/${operation}`);
    const after = (await this.representation(id)).resource.version as number;
    return { status: r.status, allow: r.headers.get('allow'), versionBefore: before, versionAfter: after };
  }

  /** Map an owner-approved AWRM Pass to a PURL checkpoint (continuity package = unverified claims). */
  async exportPass(pass: PassRecord, resourceId: string, auth: ExportAuthorization | null): Promise<{ checkpointEntry: string; version: number }> {
    checkExportAuthorization(auth, pass, `${this.baseUrl}/r/${resourceId}`, 'PURL/0.1');
    const rep = await this.representation(resourceId);
    const pkg = passToPurlPackage(pass);
    const r = await this.invoke(resourceId, 'checkpoint', { label: `awrm pass ${pass.passId}`.slice(0, 200), package: pkg }, { expectedVersion: rep.resource.version, idempotencyKey: `awrm-${pass.digest.slice(7, 39)}` });
    return { checkpointEntry: r.result.checkpoint, version: r.resource.version };
  }
}

export function passToPurlPackage(pass: PassRecord): Record<string, unknown> {
  return {
    task: `AWRM Pass ${pass.passId} (scope: ${pass.scope})`.slice(0, 2000),
    objective: 'Carry AWRM DMU output as a source-labelled, unverified claim for a later reader.',
    findings: [pass.payload.content.slice(0, 2000), `AWRM citations: ${pass.payload.citations.join(', ')}`.slice(0, 2000)],
    assumptions: [
      `Content was produced by AWRM seat ${pass.from.seatId} (an AWRM-local reference, not a PURL principal) via mark ${pass.from.markDigest}.`,
      `Model claim (self-reported by the port): ${pass.sourceModelClaim ?? 'none'}.`,
    ],
    constraints: ['No AWRM seat, credential, quota or authority is transferred by this checkpoint.', 'AWRM Gate ≠ PURL authority; this export used the PURL principal’s own rights.'],
    open_questions: [],
  };
}
