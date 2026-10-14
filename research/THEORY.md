# AWRM theory: Dark Matter Units as a unit-level abstraction over model interfaces

Status: **proposed theory with executable semantics.** Definitions below are
implemented in the named modules; propositions are labelled with their current
evidential status. Nothing here is a claim about physics or about the internals
of any provider's model, and nothing here claims free or unlimited access.

## 1. Primitive notions

Let **Val** be the set of JSON values and `⟦·⟧ : Val → {0,1}^*` canonical JSON
(RFC 8785-compatible on Val, `packages/core/src/canonical.ts`). Let
`h(v) = SHA-256(⟦v⟧)`; we write digests as `sha256:<hex>`.

A **schema** σ denotes a predicate `σ ⊆ Val` (`packages/core/src/schema.ts`; an
explicit keyword subset, unknown keywords rejected).

**Definition 1 (Form).** A Form is `F = (σ_in, σ_out, κ, Err)` where κ bounds
context (`maxContextChars`, whether Keeps/Passes are admitted) and Err is the
declared failure-code set. Forms are immutable and identified by `h(F)`.
*Example:* `form.math.check` — `σ_out` requires `{answer: integer}`; the reply
"maybe" ∉ σ_out.

**Definition 2 (Port).** A Port is a partial, possibly nondeterministic,
possibly side-effecting process `V : Prompt × Signal ⇀ Event*` with a manifest
`(kind, liveness, provider, network, sideEffects)`. Liveness ∈ {test-double,
owned-fixture, local-open-weight-model, external-live} states *what an output is
evidence of*. *Example:* `onnx-local` runs `Xenova/flan-t5-small` on CPU.

**Definition 3 (Seat).** A Seat `a = (id, provider, quotaKey, kinds, perms, handles)`
contains no secret material. Seats with equal `quotaKey` share one allowance.
*Example:* four browser tabs on one profile are four views of one seat-quota.

**Definition 4 (Gate).** `G : (actor, a, V, op, π, q, b, t, phase) → {permit, deny}×Code`
is a total, pure function (`packages/policy/src/gate.ts`) of the actor, seat,
port manifest, operation, permission record π, quota snapshot q, run budget b,
time and phase. Its defining property is **closure under ignorance**: every
input term that is `unknown` yields `deny` for non-local ports.

**Definition 5 (DMU).** `U = (I, O, C, S, G, B, V, E)` with `I = σ_in`,
`O = σ_out`, C the context constructor (template + explicitly referenced Keeps
and Passes, rendered as delimited untrusted data), S the explicit state
references, G the Gate, B the budget, V the chosen port and E the evidence
contract. A DMU *definition* fixes (F, template, parser, B_max, admissible port
kinds) and is content-addressed.

**Definition 6 (Run, Turn).** A run of U on input x through seat a and port V is

```
run(U,x,s,a,V) = (y, s', e)      if x ∈ I ∧ G(…enqueue)=permit ∧ G(…pre-invoke)=permit
                                   ∧ reserve(q_a) ∧ V answers within B ∧ parse(answer)=y ∈ O
               = (⊥, s, e_fail)  otherwise
```

Each attempt to obtain an answer from V is a **Turn** with lifecycle
`pending → running → {success, failure, cancelled}`; terminal states are
absorbing (`packages/runtime/src/turn.ts`). A retry is a new Turn whose
evidence cites the previous Turn's.

**Definition 7 (Mark).** For every terminal Turn — and every run that
terminates before any Turn — the kernel emits `m = (body, h(body))` where body
contains `h(x)`, `h(y)` or ⊥, `h(raw)`, port manifest summary, seat id, Gate
verdict with `h(decision)`, verdict, typed error, timing, usage and parent
digests. Marks form a DAG by `parents` (a Merkle DAG: a parent's digest is
inside the child's hashed body).

**Definition 8 (Keep).** A Keep revision is `k_n = (id, n, content, h(content),
m, readers, consent, lineage = [h(k_1)…h(k_{n-1})])` and must cite a completed,
verifying Mark m. Read access is by explicit reader list only.

**Definition 9 (Pass).** A Pass is `p = (m_src, a_src, a_dst, payload, consent)`
where payload is redacted text plus Mark citations. The Pass schema has no
field able to carry a credential handle, profile, permission, quota key or
scope (unknown fields rejected; named authority fields refused with
`authority-transfer`).

**Definition 10 (Bond).** A Bond `β: (U_i.f) → (U_j.g)` is admissible iff
`σ_out(U_i).f ⊑ σ_in(U_j).g` under the conservative assignability relation ⊑
(type inclusion, enum subset, tighter-or-equal length bounds) and `g` is not an
authority field. A plan is admissible iff all Bonds are admissible and the
Bond graph is acyclic.

**Definition 11 (Fleet).** A Fleet is a set of lanes `ℓ_i = (V_i, a_i, c_i, r_i)`
scheduled under a global cap K, a bounded queue, deficit-round-robin fairness
with aging, per-lane circuit breakers and the Gate.

**Definition 12 (Seed).** A Seed is `(hypothesis, metric, prediction,
procedure ∈ P, caps ⊆ Cap, rule)` where P is a *fixed* registry of local
procedures, and the preregistration digest `h(seed)` is recorded before
execution. Admissible iff `caps ⊆ {local-compute, owned-fixture,
read-own-evidence}`.

## 2. Capacity — and a correction to the brief's bound

The mission brief proposed `R_fleet(T) ≤ Σ_i min{Q_i(T)/T, r_i, c_i/L_i}` with
one term per lane. **This over-counts when lanes share an allowance.** Two
lanes that are views of one account each contribute `Q/T`, so the bound
doubles although the permitted calls do not.

*Counterexample (executed, X001/E006):* four lanes on one account with
allowance Q = 3 per window. The per-lane formula bounds admitted calls by
4·3 = 12; observed admitted calls: **3**.

**Proposition C (grouped bound).** Partition lanes by quotaKey into groups g.
By Little's law a lane with concurrency c_i and mean occupancy L_i completes at
most `c_i / L_i` calls per unit time; a declared rate r_i caps it further; a
group's allowance caps the group. Hence

```
R ≤ Σ_g  min( Q_g / T_g ,  Σ_{i∈g} min(r_i, c_i / L_i) )
```

with any unknown provider term making its group term — and the sum — unknown,
never infinite. For local groups (no provider allowance) the first argument is
absent. *Status:* derived under the stated simplifications (stationary L_i,
independent groups, no admission overhead); implemented in
`Fleet.capacity()`; consistent with E005/E006 measurements; **not** an exact
model of realised throughput (CPU contention changes L_i with c_i — E005 shows
p50 latency rising from 22 ms to 41 ms when lanes exceed cores).

## 3. Propositions (preregistered; status after the 2026-10-14 run)

| Id | Statement | Falsifier | Evidence | Status |
|---|---|---|---|---|
| H-1 | One Form runs through ≥ 2 independent conforming Ports with no change to kernel code | port-specific logic in the kernel | E002 (4 ports incl. Chromium and a real model), CHAIN (2 independent adapters), dependency audit | SUPPORTED |
| H-2 | An invalid output or a timeout is never published as a validated success | one counterexample | E001, kernel tests, Turn state machine, property tests | SUPPORTED (no counterexample in 20 E001 checks + unit/property tests; universal claim not proven) |
| H-3 | Tampering with any persisted Mark field or parent link is detected | an altered Mark verifies | E009 (9 field tampers, 2 content tampers, dangling parent), 300-trial random tamper property test | SUPPORTED |
| H-4 | A Pass never grants the origin Seat's execution power | destination can act with origin credentials | E007, E003, E010 | SUPPORTED |
| H-5 | Virtual views with unchanged quota cannot increase permitted external calls; local parallelism raises throughput until resource limits | Gate counts views as quota | E006, X001, E005 | SUPPORTED |
| H-6 | Seeds can improve local measures while never modifying policy or gaining rights | a Seed triggers unauthorised network access | E012 (4/4 prohibited Seeds rejected, incl. a covert `fetch`), E004 | SUPPORTED |
| H-7 | After restart, explicit Keeps are reconstructed and pending local work resumes without duplicate side effects | lost Keep, broken Mark chain, duplicate invocation | E011 (SIGKILL), CHAIN restart | SUPPORTED |
| H-8 | PURL/ACSP adapters preserve permission checks, expected-version behaviour and safe GET | an unsupported mutation path or impersonation | E008 live against both reference servers | SUPPORTED |

Statistical framing: these are deterministic safety properties; each
experiment is a falsification attempt with a binary outcome per check. Where
measurements are stochastic (E005 throughput/latency, E012 timing Seeds) the
numbers are reported per run and excluded from the reproducibility digest.

## 4. What the theory does *not* claim

* No claim that a DMU's output is correct beyond its Form: a schema-valid wrong
  answer (`{answer: 392}`) is a completed DMU. Closing that gap is the open
  question in `OPEN_QUESTIONS.md`.
* No claim about providers' hidden state, determinism or model identity.
  `sourceModelClaim` is self-reported by the port.
* No claim of free, unlimited or pooled access. Capacity is measured or unknown.
* The abstraction is not new in its parts (RPC, actors, capabilities, event
  sourcing, Merkle DAGs, workflow engines). See `PAPER.md` §2 for what is and
  is not original.
