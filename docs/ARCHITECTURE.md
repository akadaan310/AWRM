# Architecture

AWRM is a computation engine whose unit is the **Dark Matter Unit (DMU)**: one
typed, gated, evidenced prompt↔response attempt. Execution methods (local
model, owned fixture, official API, browser) are interchangeable **Ports**. No
browser, OS, UI or legacy project is part of the core.

```
 awrm CLI ── TypeScript SDK ── loopback HTTP API (bearer, Host/Origin checks)
                                   │
 ┌──────────────────────────── KERNEL ────────────────────────────┐
 │ core      Forms, DMU definitions, schemas, canonical JSON,      │
 │           lexicon, shared record types                          │
 │ policy    Gate (pure)  ·  QuotaLedger (per quotaKey)  ·  provider matrix │
 │ identity  Seats (handles only) · PermissionRegistry · Vault     │
 │ evidence  Marks (seal / verify / graph) · redaction             │
 │ store     Memory · JSONL journal (fsync) · node:sqlite          │
 │ continuity Keep (revisioned) · Pass (data-only transfer)        │
 │ runtime   Kernel: submit → Gate → Turn → validate → Mark;       │
 │           idempotency, cancellation, bounded retry, recovery    │
 │ scheduler Fleet: lanes, global cap, DRR fairness + aging,       │
 │           backpressure, breakers, capacity bound                │
 │ plans     Bonds, typed DAG check, execution                     │
 └──────────────────────────── Port interface ────────────────────┘
      │              │                 │                  │
  RulePort /     OwnedChatHttp     OnnxText2Text       BrowserChat        Anthropic / Gemini   DisabledConsumer
  WorkerPool     (loopback SSE)    (optional pkg)      (optional pkg)     API ports            (always denied)
  (in-process)
                                   optional, separate:  interop/ seurl · purl · acsp     research/ experiments · seeds · audit
```

The **kernel packages** (`core store policy identity evidence ports continuity
runtime scheduler plans`) depend only on each other; the dependency test and
`awrm audit` fail on any third-party, browser, model or legacy import there.
`browser-port` and `port-onnx` are optional packages whose third-party
dependencies are `optionalDependencies`; the kernel loads and runs DMUs with
neither installed (test `the kernel loads and runs a DMU with no browser or
model packages resolvable`).

## DMU = (I, O, C, S, G, B, V, E)

| Symbol | Where it lives |
|---|---|
| I, O | `Form.input`, `Form.output` (JSON Schema subset, immutable, content-addressed) |
| C | `Form.context` limits + `renderPrompt` + explicit Keep/Pass refs rendered as delimited **untrusted data** |
| S | Keeps and Passes named in the run request; no vendor hidden state |
| G | `policy/gate.ts` `assess()` — evaluated at enqueue **and** immediately before invocation |
| B | `BudgetSpec` (calls, wall time, output size, retries); requests can only lower it; ceiling enforced at definition |
| V | `portId` per run; DMU lists allowed port kinds |
| E | `Mark` per terminal outcome of every Turn, and for runs that end before a Turn |

## Lifecycles

```
Run:   registered → eligible → queued → running → validating → completed
           │            │         │        │  ↑ retry / crash requeue
           └→ failed    └→ denied └→ cancelled / denied / failed
Turn:  pending → running → success | failure | cancelled     (terminal states absorb)
```

A retry is a **new Turn** whose Mark cites the failed Turn's Mark. Retries
happen only for retryable errors, on ports declaring `sideEffects: 'none'`,
within `maxRetries`. Ports with unknown side effects get `maxRetries = 0`
regardless of the request. A rate-limit signal blocks the seat's `quotaKey`
and is never retried or rerouted.

## Gate rules (first failing rule decides)

1. Seeds never reach external / API / browser ports.
2. A seat must exist, be unexpired, allow the port kind and match the provider.
3. A permission record for exactly (provider, port kind) must be listed on the seat, unexpired, and cover the operation.
4. Owner permission must be `granted`.
5. For non-local ports: provider permission must be `permitted` **and** documentary evidence attached.
6. Run budget not exhausted.
7. Quota snapshot present; not rate-blocked; known limit not reached. Unknown limit ⇒ deny for non-local ports.

After the second Gate, the kernel atomically **reserves** one call on the
quota key; concurrent runs that lose the race are denied (`quota-exhausted`).

## Data at rest

`store` collections: `runs`, `turns`, `marks` (write-once), `mark-content`
(input/output for content re-verification), `keeps` (write-once revisions) +
`keep-heads`, `passes` (write-once), `idempotency`, `dmus`. The JSONL backend
fsyncs every line; a torn final line is truncated on open; corruption anywhere
else is fatal. Secret-shaped input is refused and **not** persisted (only its
digest). Seats, credentials and cookies are never stored.

## Capacity

`Fleet.capacity()` reports `R ≤ Σ_g min(Q_g/T_g, Σ_{i∈g} min(r_i, c_i/L_i))`
with lanes grouped by `quotaKey` (views of one account form one group). Any
unknown provider term makes the bound `unknown`; local groups have no provider
allowance and are bounded by measured `c_i/L_i`. This is a conservative
engineering bound, not a theorem.
