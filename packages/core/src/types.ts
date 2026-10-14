/**
 * Shared AWRM record types. Every exported record here is one of the 12
 * controlled terms (see lexicon.ts) or a component of one. Logic lives in the
 * owning package; types live here so the package graph stays acyclic.
 */

// ---------- awrm.port ----------
export type PortKind = 'local-model' | 'official-api' | 'approved-browser' | 'owned-fixture';

/** What a port's output is evidence *of*. Never upgrade this label without a real run. */
export type Liveness =
  | 'deterministic-test-double' // AWRM-written code imitating a model; proves infrastructure only
  | 'owned-fixture' // an AWRM-owned service (HTTP / browser) under test control
  | 'local-open-weight-model' // real model weights executed locally
  | 'external-live'; // a third-party service actually contacted

export interface PortManifest {
  id: string;
  kind: PortKind;
  label: string;
  liveness: Liveness;
  provider: string; // 'awrm-local' | 'anthropic' | 'google' | 'openai' | ...
  network: 'none' | 'loopback' | 'external';
  /** Whether re-sending an invocation may duplicate an external effect (billing, posts). */
  sideEffects: 'none' | 'unknown';
  streaming: boolean;
  maxConcurrency?: number;
  model?: string;
  license?: string;
  notes?: string;
}

// ---------- awrm.seat ----------
export interface SeatRef {
  seatId: string; // opaque; never contains credential material
  provider: string;
  principal: 'owner-account' | 'local-principal';
  accountAlias?: string; // owner-chosen label, not a login name
  /** Seats sharing a quotaKey share one allowance (e.g. many views of one account). */
  quotaKey: string;
  profileRef?: string; // handle to an isolated profile dir / keychain entry; never its contents
  credentialRef?: string; // vault handle name; never the secret
  allowedPortKinds: PortKind[];
  /** Permission records this seat may rely on; the Gate picks the one matching port provider+kind. */
  permissionRecordIds: string[];
  scopes: string[];
  expiry?: string; // ISO
}

// ---------- awrm.gate ----------
export type Tri<T extends string> = T | 'unknown';

export interface PermissionEvidence {
  source: string; // document title
  url?: string;
  accessed: string; // ISO date
  quote?: string;
  note?: string;
}

/** Permission is attached to (provider, port kind, method, operation) — not to the seat alone. */
export interface PermissionRecord {
  id: string;
  provider: string;
  portKind: PortKind;
  method: string; // e.g. 'consumer-web-ui-automation', 'messages-api', 'local-execution'
  operations: Array<'prompt' | 'observe'>;
  /** Did the owner authorise use of their account/resources for this method? */
  ownerPermission: Tri<'granted' | 'denied'>;
  /** Does the provider permit this method of automated access? */
  providerPermission: Tri<'permitted' | 'prohibited' | 'not-applicable'>;
  evidence: PermissionEvidence[];
  decidedAt: string;
  expiresAt?: string;
}

export interface Actor {
  id: string;
  kind: 'owner' | 'api-client' | 'plan' | 'seed' | 'experiment';
}

export interface QuotaSnapshot {
  quotaKey: string;
  /** Authorised calls in the current window; null = unknown (never infinite). */
  limit: number | null;
  used: number;
  windowMs: number | null;
  blockedUntil: number | null; // epoch ms after a provider rate-limit signal
}

export interface RunBudgetSnapshot {
  maxCalls: number;
  callsUsed: number;
  maxWallMs: number;
  wallMsUsed: number;
}

export interface GateInput {
  actor: Actor;
  seat: SeatRef | null;
  port: PortManifest;
  operation: 'prompt' | 'observe';
  permission: PermissionRecord | null;
  quota: QuotaSnapshot | null;
  budget: RunBudgetSnapshot;
  now: number;
  /** Set when the call is about to open a connection (second, pre-invoke check). */
  phase: 'enqueue' | 'pre-invoke';
}

export type GateCode =
  | 'permit'
  | 'no-seat'
  | 'seat-expired'
  | 'port-kind-not-allowed-for-seat'
  | 'seat-provider-mismatch'
  | 'permission-missing'
  | 'permission-expired'
  | 'permission-mismatch'
  | 'owner-permission-not-granted'
  | 'provider-permission-not-established'
  | 'operation-not-permitted'
  | 'seed-external-forbidden'
  | 'quota-unknown'
  | 'quota-exhausted'
  | 'rate-limited'
  | 'budget-exhausted';

export interface GateDecision {
  verdict: 'permit' | 'deny';
  code: GateCode;
  reasons: string[];
  phase: GateInput['phase'];
}

// ---------- awrm.dmu / awrm.turn ----------
export interface BudgetSpec {
  maxCalls: number; // includes retries
  maxWallMs: number; // per attempt deadline
  maxOutputChars: number;
  maxRetries: number; // bounded; 0 for unknown external side effects
  maxCostUsd?: number;
}

export type RunState =
  | 'registered'
  | 'eligible'
  | 'queued'
  | 'running'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'cancelled';

export const TERMINAL_RUN_STATES: readonly RunState[] = ['completed', 'failed', 'denied', 'cancelled'];

export type TurnState = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';

export interface ErrorInfo {
  code: string;
  message: string;
}

export interface TurnRecord {
  turnId: string;
  runId: string;
  attempt: number; // 1-based; a retry is a new Turn
  parentTurnId: string | null;
  state: TurnState;
  portId: string;
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number | null;
  firstChunkMs: number | null;
  outputChars: number;
  error: ErrorInfo | null;
  markDigest: string | null;
}

export interface RunRecord {
  runId: string;
  dmuId: string;
  dmuVersion: number;
  formDigest: string;
  inputDigest: string;
  input: unknown;
  seatId: string | null;
  portId: string;
  actor: Actor;
  state: RunState;
  idempotencyKey: string | null;
  requestDigest: string;
  parentMarks: string[];
  contextRefs: { keeps: string[]; passes: string[] };
  budget: BudgetSpec;
  turns: string[];
  output: unknown | null;
  error: ErrorInfo | null;
  gate: GateDecision | null;
  markDigest: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

// ---------- awrm.mark ----------
export interface MarkBody {
  schema: 'awrm.mark/1';
  runId: string;
  turnId: string | null; // null when denied before any Turn existed
  attempt: number;
  dmu: { id: string; version: number; formDigest: string };
  inputDigest: string;
  outputDigest: string | null;
  rawResponseDigest: string | null;
  outputPreview: string | null; // redacted, truncated
  port: { id: string; kind: PortKind; liveness: Liveness; provider: string; model: string | null };
  seatId: string | null;
  gate: { verdict: 'permit' | 'deny'; code: GateCode; decisionDigest: string } | null;
  verdict: 'completed' | 'failed' | 'denied' | 'cancelled';
  error: ErrorInfo | null;
  timing: { createdAt: string; startedAt: string | null; endedAt: string; elapsedMs: number | null; firstChunkMs: number | null };
  usage: { calls: number; outputChars: number; costUsd: number | null };
  parents: string[]; // parent Mark digests (Bonds, Pass sources, retries)
}

export interface Mark extends MarkBody {
  digest: string; // sha256 of canonical(MarkBody)
}

// ---------- awrm.keep ----------
export interface KeepRecord {
  schema: 'awrm.keep/1';
  keepId: string; // stable topic id
  revision: number;
  content: unknown;
  contentHash: string;
  producerTurnId: string;
  producerMarkHash: string;
  scope: string;
  sourceSeatRef: string; // opaque seat id, non-secret
  sourceModelClaim: string | null; // self-reported by the port; not verified identity
  identityAssurance: 'local-principal' | 'self-asserted';
  readers: string[]; // seat ids allowed to receive it in context
  expiration: string | null;
  consentRecord: string;
  claims: string[];
  uncertainties: string[];
  lineage: string[]; // digests of earlier revisions
  createdAt: string;
  digest: string;
}

// ---------- awrm.pass ----------
export interface PassRecord {
  schema: 'awrm.pass/1';
  passId: string;
  from: { seatId: string; turnId: string; markDigest: string };
  to: { seatId: string };
  payload: { content: string; citations: string[] };
  scope: string;
  redactions: string[]; // kinds of material removed
  consentRecord: string;
  sourceModelClaim: string | null;
  identityAssurance: 'local-principal' | 'self-asserted';
  createdAt: string;
  expiration: string | null;
  digest: string;
}

// ---------- awrm.bond ----------
export interface BondSpec {
  from: { node: string; field: string | null }; // null = whole output
  to: { node: string; field: string };
}

// ---------- awrm.seed ----------
export type SeedStatus = 'proposed' | 'preregistered' | 'rejected' | 'executed' | 'refuted' | 'candidate' | 'inconclusive';

export type SeedCapability = 'local-compute' | 'owned-fixture' | 'read-own-evidence' | 'network' | 'external-port' | 'policy-write' | 'seat-create' | 'budget-raise';

export interface SeedRecord {
  schema: 'awrm.seed/1';
  seedId: string;
  title: string;
  hypothesis: string;
  metric: string;
  prediction: string;
  procedure: string; // name from the fixed sandbox procedure registry
  requestedCapabilities: SeedCapability[];
  status: SeedStatus;
  preregistrationDigest: string | null;
  rejection: string | null;
  result: Record<string, unknown> | null;
}
