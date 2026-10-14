/**
 * The AWRM kernel: executes DMUs through whichever Port a run names.
 *
 *   submit()  registered → eligible → (Gate@enqueue) → queued | denied
 *   execute() queued → (Gate@pre-invoke + quota reservation) → running
 *             → validating → completed | failed   (one Turn per attempt)
 *
 * Every terminal outcome of every Turn — and every run that ends before a Turn
 * exists — emits exactly one Mark. The kernel imports the Port *interface*
 * only; concrete ports are registered by the host.
 */
import { EventEmitter } from 'node:events';
import {
  AwrmError,
  BUILTIN_DMUS,
  TERMINAL_RUN_STATES,
  defineDmu,
  digest,
  parseResponse,
  randomId,
  renderPrompt,
  systemClock,
  validateInput,
  validateOutput,
  type Actor,
  type BudgetSpec,
  type Clock,
  type DmuDefinition,
  type DmuSpec,
  type ErrorInfo,
  type GateDecision,
  type IdSource,
  type Mark,
  type MarkBody,
  type PortManifest,
  type RunRecord,
  type RunState,
  type SeatRef,
  type TurnRecord,
  type TurnState,
} from '@awrm/core';
import { KeepStore, PassStore, renderKeep, renderPass } from '@awrm/continuity';
import { containsSecret, preview, redactValue, sealMark, verifyMark } from '@awrm/evidence';
import { PermissionRegistry, SeatRegistry, Vault } from '@awrm/identity';
import { QuotaLedger, assess } from '@awrm/policy';
import type { AwrmPort, CredentialAccess, PortEvent } from '@awrm/ports';
import type { Store } from '@awrm/store';
import { checkRunTransition, checkTurnTransition } from './turn';

export interface RunRequest {
  dmuId: string;
  input: unknown;
  seatId: string;
  portId: string;
  actor?: Actor;
  budget?: Partial<BudgetSpec>;
  idempotencyKey?: string;
  parentMarks?: string[];
  context?: { keeps?: string[]; passes?: string[] };
  tags?: string[];
}

export interface KernelOptions {
  store: Store;
  seats: SeatRegistry;
  permissions: PermissionRegistry;
  ledger: QuotaLedger;
  vault: Vault;
  clock?: Clock;
  ids?: IdSource;
  /** Base for exponential backoff between retryable attempts (ms). */
  backoffBaseMs?: number;
}

export interface KernelEvent {
  runId: string;
  seq: number;
  type: 'state' | 'turn' | 'chunk' | 'mark';
  state?: RunState;
  turnState?: TurnState;
  attempt?: number;
  text?: string; // redacted
  markDigest?: string;
  at: string;
}

const DEFAULT_ACTOR: Actor = { id: 'owner', kind: 'owner' };
const MAX_EVENT_HISTORY = 256;

export class Kernel {
  readonly store: Store;
  readonly seats: SeatRegistry;
  readonly permissions: PermissionRegistry;
  readonly ledger: QuotaLedger;
  readonly vault: Vault;
  readonly keeps: KeepStore;
  readonly passes: PassStore;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly events = new EventEmitter();
  private dmus = new Map<string, DmuDefinition>();
  private ports = new Map<string, { port: AwrmPort; manifest: PortManifest }>();
  private controllers = new Map<string, AbortController>();
  private history = new Map<string, KernelEvent[]>();
  private seq = 0;
  private backoffBaseMs: number;

  constructor(o: KernelOptions) {
    this.store = o.store;
    this.seats = o.seats;
    this.permissions = o.permissions;
    this.ledger = o.ledger;
    this.vault = o.vault;
    this.clock = o.clock ?? systemClock;
    this.ids = o.ids ?? ((p) => randomId(p));
    this.keeps = new KeepStore(this.store, this.clock);
    this.passes = new PassStore(this.store, this.clock, this.ids);
    this.backoffBaseMs = o.backoffBaseMs ?? 50;
    this.events.setMaxListeners(1000);
    for (const d of BUILTIN_DMUS) this.dmus.set(d.id, d);
    for (const d of this.store.list<DmuSpec & { digest: string }>('dmus')) this.dmus.set(d.id, defineDmu(stripDigest(d)));
  }

  // ------------------------------------------------------------------ registry
  registerDmu(spec: DmuSpec): DmuDefinition {
    const def = defineDmu(spec);
    const existing = this.dmus.get(def.id);
    if (existing && existing.digest !== def.digest) throw new AwrmError('invalid-definition', `${def.id} already registered with a different definition; publish a new version id`);
    if (!existing) {
      this.dmus.set(def.id, def);
      this.store.put('dmus', def.id, { ...spec, digest: def.digest });
    }
    return def;
  }

  getDmu(id: string): DmuDefinition {
    const d = this.dmus.get(id);
    if (!d) throw new AwrmError('unknown-dmu', `no DMU ${id}`);
    return d;
  }

  listDmus(): DmuDefinition[] {
    return [...this.dmus.values()];
  }

  async registerPort(port: AwrmPort): Promise<PortManifest> {
    const manifest = await port.describe();
    if (manifest.id !== port.id || manifest.kind !== port.kind) throw new AwrmError('invalid-definition', 'port manifest disagrees with port');
    this.ports.set(port.id, { port, manifest });
    return manifest;
  }

  portManifest(id: string): PortManifest {
    const p = this.ports.get(id);
    if (!p) throw new AwrmError('unknown-port', `no port ${id}`);
    return p.manifest;
  }

  listPorts(): PortManifest[] {
    return [...this.ports.values()].map((p) => p.manifest);
  }

  async closePorts(): Promise<void> {
    await Promise.all([...this.ports.values()].map((p) => p.port.close()));
  }

  // ------------------------------------------------------------------ queries
  getRun(runId: string): RunRecord {
    const r = this.store.get<RunRecord>('runs', runId);
    if (!r) throw new AwrmError('unknown-run', `no run ${runId}`);
    return r;
  }

  listRuns(): RunRecord[] {
    return this.store.list<RunRecord>('runs');
  }

  getTurn(turnId: string): TurnRecord | undefined {
    return this.store.get<TurnRecord>('turns', turnId);
  }

  getMark(d: string): Mark | undefined {
    return this.store.get<Mark>('marks', d);
  }

  listMarks(): Mark[] {
    return this.store.list<Mark>('marks');
  }

  eventsFor(runId: string): KernelEvent[] {
    return [...(this.history.get(runId) ?? [])];
  }

  // ------------------------------------------------------------------ submit
  submit(req: RunRequest): RunRecord {
    const actor = req.actor ?? DEFAULT_ACTOR;
    const dmu = this.getDmu(req.dmuId);
    const portEntry = this.ports.get(req.portId);
    if (!portEntry) throw new AwrmError('unknown-port', `no port ${req.portId}`);
    const budget = clampBudget(dmu.budget, req.budget, portEntry.manifest);
    const context = { keeps: [...(req.context?.keeps ?? [])], passes: [...(req.context?.passes ?? [])] };
    const parentMarks = [...(req.parentMarks ?? [])];
    for (const p of parentMarks) if (!this.getMark(p)) throw new AwrmError('invalid-input', `parent mark ${p} not found`);
    const requestDigest = digest({ dmuId: dmu.id, dmuDigest: dmu.digest, input: req.input ?? null, seatId: req.seatId, portId: req.portId, budget, parentMarks, context, actor });

    if (req.idempotencyKey !== undefined) {
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(req.idempotencyKey)) throw new AwrmError('invalid-input', 'idempotency key must be 8–128 chars [A-Za-z0-9._:-]');
      const prior = this.store.get<{ runId: string; requestDigest: string }>('idempotency', req.idempotencyKey);
      if (prior) {
        if (prior.requestDigest !== requestDigest) throw new AwrmError('idempotency-conflict', 'idempotency key reused for a different request');
        return this.getRun(prior.runId);
      }
    }

    const now = this.clock.iso();
    // Secret-shaped input is refused and never persisted; only its digest is kept.
    const withheld = containsSecret(JSON.stringify(req.input ?? null));
    const run: RunRecord = {
      runId: this.ids('run'),
      dmuId: dmu.id,
      dmuVersion: dmu.version,
      formDigest: dmu.form.digest,
      inputDigest: digest(req.input ?? null),
      input: withheld ? { __withheld: 'secret-material' } : (req.input ?? null),
      seatId: req.seatId ?? null,
      portId: req.portId,
      actor,
      state: 'registered',
      idempotencyKey: req.idempotencyKey ?? null,
      requestDigest,
      parentMarks,
      contextRefs: context,
      budget,
      turns: [],
      output: null,
      error: null,
      gate: null,
      markDigest: null,
      createdAt: now,
      updatedAt: now,
      tags: [...(req.tags ?? [])],
    };
    if (req.idempotencyKey !== undefined && !this.store.putIfAbsent('idempotency', req.idempotencyKey, { runId: run.runId, requestDigest })) {
      throw new AwrmError('idempotency-conflict', 'concurrent use of idempotency key');
    }
    this.save(run);

    if (withheld) return this.finishWithoutTurn(run, 'failed', { code: 'secret-material', message: 'input contains credential-shaped material; refused and not stored' }, null);
    const v = validateInput(dmu.form, run.input);
    if (!v.ok) return this.finishWithoutTurn(run, 'failed', { code: 'invalid-input', message: v.errors.map((e) => `${e.path} ${e.message}`).join('; ') }, null);
    const ctxProblem = this.checkContextRefs(dmu, run);
    if (ctxProblem) return this.finishWithoutTurn(run, 'failed', ctxProblem, null);
    this.transition(run, 'eligible');

    const gate = this.gate(run, 'enqueue');
    run.gate = gate;
    if (gate.verdict === 'deny') return this.finishWithoutTurn(run, 'denied', { code: 'gate-denied', message: `${gate.code}: ${gate.reasons.join('; ')}` }, gate);
    this.transition(run, 'queued');
    return run;
  }

  /** submit + execute. */
  async run(req: RunRequest, signal?: AbortSignal): Promise<RunRecord> {
    const r = this.submit(req);
    if (r.state !== 'queued') return r;
    return this.execute(r.runId, signal);
  }

  cancel(runId: string): RunRecord {
    const run = this.getRun(runId);
    if (TERMINAL_RUN_STATES.includes(run.state)) return run;
    const c = this.controllers.get(runId);
    if (c) {
      c.abort(new AwrmError('cancelled', 'cancel requested'));
      return run; // execute() records the cancelled Turn and Mark
    }
    return this.finishWithoutTurn(run, 'cancelled', { code: 'cancelled', message: 'cancelled before execution' }, run.gate);
  }

  // ------------------------------------------------------------------ execute
  async execute(runId: string, external?: AbortSignal): Promise<RunRecord> {
    let run = this.getRun(runId);
    if (run.state !== 'queued') throw new AwrmError('illegal-transition', `run ${runId} is ${run.state}, not queued`);
    if (this.controllers.has(runId)) throw new AwrmError('illegal-transition', `run ${runId} already executing`);
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const onExternal = (): void => controller.abort(new AwrmError('cancelled', 'cancelled by caller'));
    external?.addEventListener('abort', onExternal, { once: true });
    if (external?.aborted) onExternal();
    try {
      for (;;) {
        run = this.getRun(runId);
        const outcome = await this.attempt(run, controller.signal);
        if (outcome === 'retry') {
          await backoff(this.backoffBaseMs, run.turns.length, controller.signal).catch(() => undefined);
          if (controller.signal.aborted) {
            run = this.getRun(runId);
            return this.finishWithoutTurn(run, 'cancelled', { code: 'cancelled', message: 'cancelled during backoff' }, run.gate);
          }
          continue;
        }
        return this.getRun(runId);
      }
    } finally {
      external?.removeEventListener('abort', onExternal);
      this.controllers.delete(runId);
    }
  }

  private async attempt(run: RunRecord, signal: AbortSignal): Promise<'done' | 'retry'> {
    const dmu = this.getDmu(run.dmuId);
    const { port, manifest } = this.ports.get(run.portId) ?? {};
    if (!port || !manifest) {
      this.finishWithoutTurn(run, 'failed', { code: 'unknown-port', message: `port ${run.portId} not registered` }, run.gate);
      return 'done';
    }
    if (signal.aborted) {
      this.finishWithoutTurn(run, 'cancelled', { code: 'cancelled', message: 'cancelled before invocation' }, run.gate);
      return 'done';
    }
    // Second Gate evaluation, immediately before anything can reach the port.
    const gate = this.gate(run, 'pre-invoke');
    run.gate = gate;
    if (gate.verdict === 'deny') {
      this.finishWithoutTurn(run, 'denied', { code: 'gate-denied', message: `${gate.code}: ${gate.reasons.join('; ')}` }, gate);
      return 'done';
    }
    const seat = this.seats.require(run.seatId!);
    if (!this.ledger.reserve(seat.quotaKey)) {
      const g: GateDecision = { verdict: 'deny', code: 'quota-exhausted', reasons: ['reservation refused (concurrent exhaustion)'], phase: 'pre-invoke' };
      run.gate = g;
      this.finishWithoutTurn(run, 'denied', { code: 'gate-denied', message: 'quota-exhausted: reservation refused' }, g);
      return 'done';
    }

    // ---- Turn starts: from here a call may reach the port and is counted.
    const prevTurnId = run.turns.at(-1) ?? null;
    const turn: TurnRecord = {
      turnId: this.ids('turn'),
      runId: run.runId,
      attempt: run.turns.length + 1,
      parentTurnId: prevTurnId,
      state: 'pending',
      portId: run.portId,
      startedAt: null,
      endedAt: null,
      elapsedMs: null,
      firstChunkMs: null,
      outputChars: 0,
      error: null,
      markDigest: null,
    };
    run.turns.push(turn.turnId);
    this.saveTurn(turn);
    this.transition(run, 'running');
    this.setTurn(turn, 'running');
    turn.startedAt = this.clock.iso();
    this.saveTurn(turn);

    const context = this.buildContext(dmu, run, seat);
    const prompt = renderPrompt(dmu, (run.input ?? {}) as Record<string, unknown>, context);
    const remainingWall = Math.max(1, run.budget.maxWallMs - this.wallUsed(run));
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new AwrmError('timeout', `deadline ${remainingWall} ms`)), remainingWall);
    const combined = AbortSignal.any([signal, deadline.signal]);
    const t0 = this.clock.monotonic();
    let text = '';
    let final: Extract<PortEvent, { type: 'final' }> | null = null;
    let terminal: { kind: 'refusal' | 'error' | 'rate-limited' | 'too-large'; ev?: PortEvent } | null = null;
    let thrown: unknown = null;
    const credentials: CredentialAccess | null = seat.credentialRef
      ? { withCredential: (fn) => this.vault.use(seat, seat.credentialRef!, fn) }
      : null;

    try {
      const stream = port.invoke(
        { runId: run.runId, turnId: turn.turnId, attempt: turn.attempt, dmuId: dmu.id, prompt, maxOutputChars: run.budget.maxOutputChars, deadlineMs: remainingWall, seat, credentials },
        combined,
      );
      for await (const ev of raceAbort(stream, combined)) {
        if (ev.type === 'chunk') {
          if (turn.firstChunkMs === null) turn.firstChunkMs = round(this.clock.monotonic() - t0);
          text += ev.text;
          this.emit(run.runId, { type: 'chunk', text: preview(ev.text, 200) });
          if (text.length > run.budget.maxOutputChars) {
            terminal = { kind: 'too-large' };
            break;
          }
        } else if (ev.type === 'final') {
          final = ev;
          break;
        } else {
          terminal = { kind: ev.type === 'refusal' ? 'refusal' : ev.type === 'rate-limited' ? 'rate-limited' : 'error', ev };
          break;
        }
      }
    } catch (e) {
      thrown = e;
    } finally {
      clearTimeout(timer);
    }
    this.ledger.commit(seat.quotaKey); // an invocation was made; it counts whatever the outcome
    turn.elapsedMs = round(this.clock.monotonic() - t0);
    turn.endedAt = this.clock.iso();
    run = this.getRun(run.runId);

    // ---- classify
    if (signal.aborted && !final) return this.endTurn(run, turn, dmu, manifest, 'cancelled', { code: 'cancelled', message: 'cancelled during invocation' }, null, text, 'done');
    if (deadline.signal.aborted && !final) return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'timeout', message: `no complete response within ${remainingWall} ms` }, null, text, 'done');
    if (thrown) return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'port-error', message: errMessage(thrown) }, null, text, 'done');
    if (terminal) {
      const ev = terminal.ev;
      if (terminal.kind === 'too-large') return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'invalid-output', message: `output exceeded ${run.budget.maxOutputChars} chars` }, null, text, 'done');
      if (terminal.kind === 'refusal' && ev?.type === 'refusal') return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'refused', message: ev.reason }, null, text, 'done');
      if (terminal.kind === 'rate-limited' && ev?.type === 'rate-limited') {
        this.ledger.recordRateLimit(seat.quotaKey, ev.retryAfterMs);
        return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'rate-limited', message: `provider rate limit; retry after ${ev.retryAfterMs ?? 'unknown'} ms (quota ${seat.quotaKey} blocked)` }, null, text, 'done');
      }
      if (ev?.type === 'error') {
        const partial = text.length > 0;
        const canRetry = ev.retryable && !partial && manifest.sideEffects === 'none' && turn.attempt <= run.budget.maxRetries && turn.attempt < run.budget.maxCalls;
        return this.endTurn(run, turn, dmu, manifest, 'failed', { code: partial ? 'partial-response' : 'port-error', message: `${ev.code}: ${ev.message}` }, null, text, canRetry ? 'retry' : 'done');
      }
    }
    if (!final) return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'partial-response', message: 'stream ended without a final response' }, null, text, 'done');

    // ---- validate
    this.transition(run, 'validating');
    const raw = final.text;
    if (raw.length > run.budget.maxOutputChars) return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'invalid-output', message: 'output too large' }, null, raw, 'done', final);
    const candidate = parseResponse(dmu.parse, raw);
    const v = validateOutput(dmu.form, candidate);
    if (!v.ok) return this.endTurn(run, turn, dmu, manifest, 'failed', { code: 'invalid-output', message: v.errors.map((e) => `${e.path} ${e.message}`).join('; ') }, null, raw, 'done', final);
    return this.endTurn(run, turn, dmu, manifest, 'completed', null, candidate, raw, 'done', final);
  }

  private endTurn(
    run: RunRecord,
    turn: TurnRecord,
    dmu: DmuDefinition,
    manifest: PortManifest,
    verdict: 'completed' | 'failed' | 'cancelled',
    error: ErrorInfo | null,
    output: unknown,
    raw: string,
    next: 'done' | 'retry',
    final?: Extract<PortEvent, { type: 'final' }>,
  ): 'done' | 'retry' {
    turn.error = error;
    turn.outputChars = raw.length;
    const turnState: TurnState = verdict === 'completed' ? 'success' : verdict === 'cancelled' ? 'cancelled' : 'failure';
    this.setTurn(turn, turnState);
    const prevMark = turn.parentTurnId ? this.getTurn(turn.parentTurnId)?.markDigest : null;
    const mark = this.writeMark({
      run,
      turn,
      dmu,
      manifest,
      verdict,
      error,
      output: verdict === 'completed' ? output : null,
      raw,
      model: final?.model ?? manifest.model ?? null,
      costUsd: final?.costUsd ?? null,
      extraParents: prevMark ? [prevMark] : [],
    });
    turn.markDigest = mark.digest;
    this.saveTurn(turn);
    run.markDigest = mark.digest;
    run.error = error;
    if (next === 'retry') {
      this.transition(run, 'queued');
      return 'retry';
    }
    if (verdict === 'completed') run.output = output;
    this.transition(run, verdict);
    return 'done';
  }

  private finishWithoutTurn(run: RunRecord, to: 'failed' | 'denied' | 'cancelled', error: ErrorInfo, gate: GateDecision | null): RunRecord {
    const dmu = this.getDmu(run.dmuId);
    const manifest = this.ports.get(run.portId)?.manifest ?? unknownPortManifest(run.portId);
    run.gate = gate;
    const mark = this.writeMark({ run, turn: null, dmu, manifest, verdict: to, error, output: null, raw: '', model: null, costUsd: null, extraParents: [] });
    run.markDigest = mark.digest;
    run.error = error;
    this.transition(run, to);
    return run;
  }

  private writeMark(a: {
    run: RunRecord;
    turn: TurnRecord | null;
    dmu: DmuDefinition;
    manifest: PortManifest;
    verdict: Mark['verdict'];
    error: ErrorInfo | null;
    output: unknown;
    raw: string;
    model: string | null;
    costUsd: number | null;
    extraParents: string[];
  }): Mark {
    const { run, turn } = a;
    const passMarks = run.contextRefs.passes.map((p) => this.passes.get(p)?.from.markDigest).filter((d): d is string => Boolean(d));
    const keepMarks = run.contextRefs.keeps.map((k) => this.keeps.latest(k)?.producerMarkHash).filter((d): d is string => Boolean(d));
    const body: MarkBody = {
      schema: 'awrm.mark/1',
      runId: run.runId,
      turnId: turn?.turnId ?? null,
      attempt: turn?.attempt ?? 0,
      dmu: { id: a.dmu.id, version: a.dmu.version, formDigest: a.dmu.form.digest },
      inputDigest: run.inputDigest,
      outputDigest: a.verdict === 'completed' ? digest(a.output) : null,
      rawResponseDigest: a.raw ? digest(a.raw) : null,
      outputPreview: a.raw ? preview(a.raw) : null,
      port: { id: a.manifest.id, kind: a.manifest.kind, liveness: a.manifest.liveness, provider: a.manifest.provider, model: a.model },
      seatId: run.seatId,
      gate: run.gate ? { verdict: run.gate.verdict, code: run.gate.code, decisionDigest: digest(run.gate) } : null,
      verdict: a.verdict,
      error: a.error ? (redactValue(a.error).value as ErrorInfo) : null,
      timing: {
        createdAt: run.createdAt,
        startedAt: turn?.startedAt ?? null,
        endedAt: turn?.endedAt ?? this.clock.iso(),
        elapsedMs: turn?.elapsedMs ?? null,
        firstChunkMs: turn?.firstChunkMs ?? null,
      },
      usage: { calls: turn ? 1 : 0, outputChars: a.raw.length, costUsd: a.costUsd },
      parents: [...new Set([...run.parentMarks, ...passMarks, ...keepMarks, ...a.extraParents])],
    };
    const mark = sealMark(body);
    const check = verifyMark(mark);
    if (!check.ok) throw new AwrmError('integrity', 'kernel produced an invalid Mark', { problems: check.problems });
    this.store.putIfAbsent('marks', mark.digest, mark);
    if (!(run.input && typeof run.input === 'object' && '__withheld' in run.input)) {
      this.store.put('mark-content', mark.digest, { input: run.input, output: a.verdict === 'completed' ? a.output : null });
    }
    this.emit(run.runId, { type: 'mark', markDigest: mark.digest });
    return mark;
  }

  // ------------------------------------------------------------------ gate & context
  private gate(run: RunRecord, phase: 'enqueue' | 'pre-invoke'): GateDecision {
    const seat = run.seatId ? (this.seats.get(run.seatId) ?? null) : null;
    const manifest = this.portManifest(run.portId);
    const permission = seat ? this.permissions.forSeat(seat, manifest.provider, manifest.kind) : null;
    const dmu = this.getDmu(run.dmuId);
    if (!dmu.allowedPortKinds.includes(manifest.kind)) {
      return { verdict: 'deny', code: 'port-kind-not-allowed-for-seat', reasons: [`DMU ${dmu.id} does not allow port kind ${manifest.kind}`], phase };
    }
    return assess({
      actor: run.actor,
      seat,
      port: manifest,
      operation: 'prompt',
      permission,
      quota: seat ? this.ledger.snapshot(seat.quotaKey) : null,
      budget: { maxCalls: run.budget.maxCalls, callsUsed: run.turns.length, maxWallMs: run.budget.maxWallMs, wallMsUsed: this.wallUsed(run) },
      now: this.clock.now(),
      phase,
    });
  }

  private wallUsed(run: RunRecord): number {
    return run.turns.reduce((s, t) => s + (this.getTurn(t)?.elapsedMs ?? 0), 0);
  }

  private checkContextRefs(dmu: DmuDefinition, run: RunRecord): ErrorInfo | null {
    const { keeps, passes } = run.contextRefs;
    if (keeps.length && !dmu.form.context.acceptsKeeps) return { code: 'invalid-input', message: `${dmu.id} does not accept Keeps` };
    if (passes.length && !dmu.form.context.acceptsPasses) return { code: 'invalid-input', message: `${dmu.id} does not accept Passes` };
    try {
      for (const k of keeps) this.keeps.readFor(run.seatId ?? '', k);
      for (const p of passes) this.passes.receive(p, run.seatId ?? '');
    } catch (e) {
      return { code: e instanceof AwrmError ? e.code : 'invalid-input', message: errMessage(e) };
    }
    return null;
  }

  /** C: the only route by which anything other than the input reaches the prompt. */
  private buildContext(dmu: DmuDefinition, run: RunRecord, seat: SeatRef): string {
    const parts: string[] = [];
    for (const k of run.contextRefs.keeps) parts.push(renderKeep(this.keeps.readFor(seat.seatId, k)));
    for (const p of run.contextRefs.passes) parts.push(renderPass(this.passes.receive(p, seat.seatId)));
    if (!parts.length) return '';
    let ctx = parts.join('\n') + '\n';
    if (ctx.length > dmu.form.context.maxContextChars) ctx = ctx.slice(0, dmu.form.context.maxContextChars) + '\n[context truncated]\n';
    return ctx;
  }

  // ------------------------------------------------------------------ recovery
  /**
   * Reconcile durable state after a restart. Side-effect-free work whose Turn
   * was interrupted is re-queued as a new attempt; work on a port with unknown
   * external side effects is failed as ambiguous and never re-sent (H-7).
   */
  recover(): { requeued: string[]; ambiguous: string[]; pendingQueued: string[] } {
    const report = { requeued: [] as string[], ambiguous: [] as string[], pendingQueued: [] as string[] };
    for (const run of this.listRuns()) {
      if (run.state === 'queued') {
        report.pendingQueued.push(run.runId);
        continue;
      }
      if (run.state !== 'running' && run.state !== 'validating' && run.state !== 'registered' && run.state !== 'eligible') continue;
      const dmu = this.getDmu(run.dmuId);
      const manifest = this.ports.get(run.portId)?.manifest ?? unknownPortManifest(run.portId);
      const lastTurn = run.turns.length ? this.getTurn(run.turns.at(-1)!) : undefined;
      if (lastTurn && (lastTurn.state === 'running' || lastTurn.state === 'pending')) {
        lastTurn.error = { code: 'interrupted', message: 'process stopped during this Turn' };
        lastTurn.endedAt = this.clock.iso();
        this.setTurn(lastTurn, 'failure');
        const mark = this.writeMark({ run, turn: lastTurn, dmu, manifest, verdict: 'failed', error: lastTurn.error, output: null, raw: '', model: null, costUsd: null, extraParents: [] });
        lastTurn.markDigest = mark.digest;
        this.saveTurn(lastTurn);
        run.markDigest = mark.digest;
      }
      if (run.state === 'registered' || run.state === 'eligible') {
        this.finishWithoutTurn(run, 'failed', { code: 'interrupted', message: 'interrupted before admission; resubmit' }, run.gate);
        report.ambiguous.push(run.runId);
      } else if (manifest.sideEffects === 'none' && run.turns.length < run.budget.maxCalls) {
        run.error = { code: 'interrupted', message: 'requeued after restart' };
        this.transition(run, 'queued');
        report.requeued.push(run.runId);
      } else {
        run.error = { code: 'ambiguous-side-effect', message: 'interrupted on a port with unknown side effects; not re-sent' };
        this.transition(run, 'failed');
        report.ambiguous.push(run.runId);
      }
    }
    return report;
  }

  // ------------------------------------------------------------------ persistence helpers
  private transition(run: RunRecord, to: RunState): void {
    checkRunTransition(run.state, to);
    run.state = to;
    run.updatedAt = this.clock.iso();
    this.save(run);
    this.emit(run.runId, { type: 'state', state: to });
  }

  private setTurn(turn: TurnRecord, to: TurnState): void {
    checkTurnTransition(turn.state, to);
    turn.state = to;
    this.saveTurn(turn);
    this.emit(turn.runId, { type: 'turn', turnState: to, attempt: turn.attempt });
  }

  private save(run: RunRecord): void {
    this.store.put('runs', run.runId, run);
  }

  private saveTurn(t: TurnRecord): void {
    this.store.put('turns', t.turnId, t);
  }

  private emit(runId: string, e: Omit<KernelEvent, 'runId' | 'seq' | 'at'>): void {
    const ev: KernelEvent = { runId, seq: ++this.seq, at: this.clock.iso(), ...e };
    const h = this.history.get(runId) ?? [];
    h.push(ev);
    if (h.length > MAX_EVENT_HISTORY) h.shift();
    this.history.set(runId, h);
    this.events.emit('event', ev);
  }
}

// ------------------------------------------------------------------ helpers
function clampBudget(base: BudgetSpec, req: Partial<BudgetSpec> | undefined, manifest: PortManifest): BudgetSpec {
  const pick = (k: keyof BudgetSpec): number => {
    const b = base[k] as number;
    const r = req?.[k];
    if (r === undefined) return b;
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0) throw new AwrmError('invalid-input', `budget.${k} must be a finite non-negative number`);
    return Math.min(b, r); // a request can only lower the DMU's budget
  };
  const out: BudgetSpec = { maxCalls: Math.max(1, pick('maxCalls')), maxWallMs: Math.max(1, pick('maxWallMs')), maxOutputChars: pick('maxOutputChars'), maxRetries: pick('maxRetries') };
  if (manifest.sideEffects !== 'none') out.maxRetries = 0; // unknown external side effects: never blindly retry
  out.maxRetries = Math.min(out.maxRetries, out.maxCalls - 1);
  if (base.maxCostUsd !== undefined) out.maxCostUsd = base.maxCostUsd;
  return out;
}

function stripDigest<T extends { digest?: string }>(d: T): Omit<T, 'digest'> {
  const { digest: _d, ...rest } = d;
  return rest;
}

function unknownPortManifest(id: string): PortManifest {
  return { id, kind: 'owned-fixture', label: 'unregistered port', liveness: 'deterministic-test-double', provider: 'unknown', network: 'none', sideEffects: 'unknown', streaming: false };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function backoff(base: number, attempt: number, signal: AbortSignal): Promise<void> {
  const ms = Math.min(base * 2 ** Math.max(0, attempt - 1), 5_000);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

/** Iterate a port stream but stop promptly when the signal aborts, even if the port ignores it. */
async function* raceAbort<T>(it: AsyncIterable<T>, signal: AbortSignal): AsyncIterable<T> {
  const iter = it[Symbol.asyncIterator]();
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => undefined);
  try {
    for (;;) {
      const r = await Promise.race([iter.next(), aborted]);
      if (r.done) return;
      yield r.value;
    }
  } finally {
    void iter.return?.().catch(() => undefined);
  }
}
