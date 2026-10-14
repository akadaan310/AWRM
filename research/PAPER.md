# Dark Matter Units: Typed, Gated, Evidenced Prompt–Response Computations Across Interchangeable Execution Ports

**Abed Kadaan** (research owner) · implementation and experiments by Claude Code
Draft of 2026-10-14 · code: this repository · results: `research/results/` (run at commit `4b85a18`)

## Abstract

Language-model work is usually organised around a *surface* — a chat page, a
browser tab, an SDK call — rather than around the unit of computation the user
actually cares about. We define that unit, the **Dark Matter Unit (DMU)**: one
independently invocable, permission-checked, typed prompt→response attempt with
explicit context, budget, chosen execution port and a content-addressed evidence
record (**Mark**). We implement an engine in which the browser, a local
open-weight model, an owned test service and official provider APIs are
interchangeable **Ports** behind one interface, and in which a pure **Gate**
denies anything whose permission, quota or budget is unknown. We report twelve
preregistered experiments plus an end-to-end chain and a deliberately failing
negative control, run on a 4-core machine. One Form ran unchanged through four
ports including real Chromium and a real ONNX model (H-1); every corrupted Mark
was detected (H-3); four views of one account with a 3-call allowance were
admitted exactly 3 calls, refuting the naive "N views ⇒ N× capacity" model and
correcting the capacity bound we were given (H-5); a process killed mid-Turn
resumed side-effect-free work exactly once and refused to re-send work with
unknown side effects (H-7); and independent adapters for two external continuity
protocols passed live black-box checks against their reference servers (H-8).
The experiments also found four defects in our own code, which we report. The
contribution is a disciplined composition of known ideas, not new primitives;
we state precisely which parts are standard.

## 1. Problem

People who use several AI systems end up doing the plumbing by hand: copying
answers between tabs, re-explaining context, and guessing what each account
allows. Automating that plumbing invites three failure modes: (i) treating a
consumer login as if it were an API, (ii) confusing many open views with more
permitted capacity, and (iii) letting text that came back from a model or a web
page act as instructions. We want an engine where the unit of work is
explicit, where results are verifiable, where continuity between models is a
deliberate transfer of data, and where capacity is measured rather than imagined.

## 2. Related work and what is (not) new

* **Remote procedure call** (Birrell & Nelson, 1984) — a DMU is RPC-shaped:
  typed request, typed response or failure. AWRM adds nothing to RPC as such.
* **Actors and message passing** (Hewitt et al., 1973) — Turns and Fleet
  lanes are conventional asynchronous workers.
* **Capability-based security** (Dennis & Van Horn, 1966; Miller, 2006;
  Macaroons, Birgisson et al., 2014) — Seats-as-handles, vault binding and the
  Pass "data, not authority" rule are applications of the principle that
  authority must not travel by mere reference.
* **Event sourcing and Merkle structures** (Merkle, 1987; event-sourcing
  practice) — Marks are a write-once, hash-linked log; the JSONL journal is a
  write-ahead log with torn-tail truncation.
* **Durable workflow engines** (e.g. Temporal/Cadence) — the run state machine,
  idempotency keys and crash reconciliation follow their practice; AWRM's
  difference is refusing to re-execute steps with unknown external side effects
  rather than assuming idempotency.
* **Scheduling** — deficit round robin (Shreedhar & Varghese, 1995), Jain's
  fairness index (Jain, Chiu & Hawe, 1984), circuit breakers (Nygard, 2007),
  Little's law for the per-lane bound.
* **Provenance** — W3C PROV-DM (2013) concepts (entity, activity, agent)
  map onto Mark, Turn and Seat.
* **Structured LLM programming** — systems such as DSPy (Khattab et al., 2023)
  and schema-constrained output tooling type model calls; prompt injection
  through retrieved content is documented by Greshake et al. (2023).
* **External protocols** — PURL/0.1 and ACSP/0.1 (owner's earlier work) define
  continuity resources with explicit authority; SEURL names seven verbs.

**What we claim as original**, modestly: (a) a single controlled vocabulary of
twelve terms with executable schemas and falsifiers; (b) making *port liveness*
(test double / owned fixture / local model / external live) a first-class,
hashed field of every evidence record so a mock can never be reported as a live
result; (c) a Gate that is closed under ignorance and evaluated twice around an
atomic quota reservation keyed by *allowance*, not by view; (d) the grouped
capacity bound of §4.3, which corrects the per-lane bound in our own brief;
(e) a Seed loop whose authority is fixed by a capability whitelist plus a
runtime network tripwire. None of these is a new theory of computation.

## 3. Vocabulary

The twelve terms (`research/LEXICON.md`, generated from
`packages/core/src/lexicon.ts`): `awrm.dmu`, `awrm.form`, `awrm.seat`,
`awrm.port`, `awrm.gate`, `awrm.turn`, `awrm.mark`, `awrm.keep`, `awrm.pass`,
`awrm.fleet`, `awrm.bond`, `awrm.seed`. Each has a JSON Schema validated against
a real record (positive) and a malformed one (negative) in
`tests/core/lexicon.test.ts`, and a test asserts none collides with the SEURL
verbs or PURL/ACSP terms.

## 4. Semantics (summary of `THEORY.md`)

### 4.1 Run
`run(U,x,s,a,V)` returns `(y,s',e)` only if x satisfies the input schema, the
Gate permits at enqueue and again before invocation, a quota reservation
succeeds, the port answers within budget, and the parsed answer satisfies the
output schema; otherwise `(⊥,s,e_fail)`. Both branches emit a Mark.

### 4.2 Evidence
`Mark.digest = h(body)`; body includes input/output/raw digests, port liveness,
seat, Gate decision digest, verdict, timing, usage and parent digests.
Verification recomputes the digest and checks internal consistency (e.g. a
`completed` Mark must have a permit Gate and an output digest); graph
verification resolves parents and their time order; content verification
recomputes input/output digests from stored content.

### 4.3 Capacity
`R ≤ Σ_g min(Q_g/T_g, Σ_{i∈g} min(r_i, c_i/L_i))`, lanes grouped by quotaKey;
unknown provider terms make the bound unknown. The brief's per-lane form
`Σ_i min(Q_i/T, r_i, c_i/L_i)` over-counts shared allowances; X001 is the
executed counterexample (bound 12, observed 3).

## 5. Implementation

TypeScript, Node ≥ 20, pnpm workspace of 17 packages; the ten kernel packages
have no third-party runtime dependencies (JSON Schema subset, canonical JSON,
SHA-256, storage and HTTP are written against Node built-ins). Storage: JSONL
journal with per-line fsync (default) or `node:sqlite`. Optional packages:
`browser-port` (playwright-core 1.56.1, Chromium 141) and `port-onnx`
(`@huggingface/transformers` 4.3.1, ONNX Runtime CPU, `Xenova/flan-t5-small`
8-bit, Apache-2.0). A loopback-only authenticated HTTP API and SDK expose the
engine; the CLI uses the same SDK. 95 unit/integration/property/security tests;
line coverage of package sources by the unit suite is 81.9% (kernel.ts 91.6%,
gate.ts 100%).

## 6. Study design

Each experiment (E001–E012, CHAIN, X001) is a runnable module that builds a
fresh engine, executes real runs, and records checks of the form
(name, expected, observed, pass, deterministic?). Hypotheses, falsifiers and
pass conditions were written into the experiment code before the recorded run
(`research/experiments/PREREGISTRATION.md`). A result file stores environment,
checks, metrics, Mark digests, blocked paths, counterexamples and a
*deterministic digest* over the checks marked deterministic. Paths that could
not legitimately run are recorded as `BLOCKED`/`NOT_RUN`, never simulated as
successes. Environment: 4 × Intel Xeon @ 2.80 GHz, 16 GB, Linux 6.18, Node 22.22.

## 7. Results

### 7.1 Overview

| Exp. | Hypotheses | Verdict | Checks |
|---|---|---|---|
| E001 DMU atom | H-2 | SUPPORTED | 20/20 |
| E002 Port substitution | H-1 | SUPPORTED | 3/3 (12 runs) |
| E003 Signed-in boundary (owned fixture) | H-4 | SUPPORTED | 11/11 |
| E004 Provider eligibility | H-6, AX-4 | OBSERVED (policy reading) | 23/23 |
| E005 Fleet scaling | H-5 | SUPPORTED | 12/12 |
| E006 Quota confinement | H-5, AX-5 | SUPPORTED | 7/7 |
| E007 Cross-model Pass | H-4, AX-3 | SUPPORTED | 14/14 |
| E008 Protocol boundaries | H-8, AX-7 | SUPPORTED (live) | 53/53 |
| E009 Evidence corruption | H-3, AX-6 | SUPPORTED | 17/17 |
| E010 Malicious prompting | H-4, H-6 | SUPPORTED | 11/11 |
| E011 Crash & recovery | H-7 | SUPPORTED | 14/14 |
| E012 Self-discovery | H-6 | SUPPORTED | 9/9 |
| CHAIN end-to-end | H-1,3,4,7 | SUPPORTED | 14/14 |
| X001 negative control | naive complement of H-5 | **REFUTED** (as designed) | 0/1 |

Two independent full runs reproduced all 14 verdicts and deterministic digests
(`REPRODUCIBILITY.json`).

### 7.2 Port substitution (E002)

Same two Forms, same kernel code, four ports:

| Port | Liveness | math.check (17×23) | classify ×2 | Elapsed per DMU (ms) |
|---|---|---|---|---|
| owned-fixture (in-process rules) | test double | 391 ✓ | billing ✓, shipping ✓ | 0.2–0.5 |
| owned-chat-http (loopback SSE, vault login) | owned fixture | 391 ✓ | ✓ ✓ | 5.9–49 |
| owned-chat-browser (Chromium 141) | owned fixture | 391 ✓ | ✓ ✓ | 218–567 |
| onnx-local (flan-t5-small, CPU) | **local open-weight model** | **failed: invalid-output** | ✓ ✓ | 34–109 (load 1.4 s) |

The real model answered the arithmetic prompt with a non-integer (an earlier
probe returned "iv"); the Form rejected it. That is the intended behaviour and
a genuine negative result about the model, not about the engine.

### 7.3 Fleet scaling (E005; chart `results/E005-scaling.svg`)

96 `math.check` DMUs per point; one lane = concurrency 1.

| Lanes | CPU-bound DMU/s | p50 / p95 ms | CPU util. | Latency-bound DMU/s | p50 ms |
|---|---|---|---|---|---|
| 1 | 52.3 | 18.4 / 25.5 | 0.37 | 46.2 | 20.7 |
| 2 | 104.0 | 17.0 / 26.2 | 0.63 | 93.1 | 20.7 |
| 4 | 161.6 | 22.2 / 37.0 | 0.94 | 184.8 | 20.7 |
| 8 | 166.5 | 40.9 / 82.4 | 0.98 | 357.5 | 21.1 |

Latency-bound work scaled 7.7× at 8 lanes; CPU-bound work scaled 3.1× at 4
lanes and only 3.2× at 8 on 4 cores, while median latency doubled — the machine
limit is visible. Partition fairness (Jain) was 1.0 at every point. In the
isolation test (32 DMUs, 4 lanes, global cap 8, one failing lane) the observed
maximum in flight was 8, the bad lane's breaker (threshold 2) opened with 3
failures recorded (one was already in flight), and
29/32 jobs completed; failed jobs were not resubmitted elsewhere.

### 7.4 Quota confinement (E006, X001)

* Four views of one account, allowance 3, 12 jobs: **3 completed**, 5 denied
  by the Gate / atomic quota reservation, 4 never dispatched; ledger `used = 3`.
* Four independent simulated resources × 3: **12 completed**.
* Owned chat fixture enforcing 2/min: `completed, completed, failed(rate-limited),
  denied, denied`; the fixture saw exactly one 429.
* Four Chromium tabs on one profile, allowance 3: **3 completed**.
* X001 preregistered the naive prediction 12; observed 3; counterexample kept.

### 7.5 Continuity, evidence, injection, recovery

* E007: a Pass carrying `credentialRef`/`permissionRecordIds` was refused; a
  secret in Pass content was redacted; the destination received no credential
  access; a third seat could not use a Pass addressed to another; without the
  Pass the destination's output carried no trace of it (no hidden memory).
* E009: 9 single-field tampers (including upgrading a failed verdict and
  relabelling a test double as `external-live`), 2 stored-content tampers and a
  dangling parent were all detected; a 300-trial random-tamper property test
  found no undetected change.
* E010: hostile replies, hostile input text, a secret-bearing URL, forged Pass
  delimiters and a hostile owned web page left seats, permissions and quota
  policy byte-identical; zero exfiltration attempts reached the honeypot.
* E011: the worker process was SIGKILLed mid-Turn with two runs in flight. On
  restart the side-effect-free run was re-queued and completed on attempt 2;
  the run on a port declaring unknown side effects was failed as
  `ambiguous-side-effect` and its port was invoked **0** times; a torn journal
  tail was truncated; Keeps and the Mark graph verified.
* CHAIN: classify (adapter A) → Keep + Pass → Bond plan extract (A) → cite (B)
  → summarise (B) → restart → replay. Output: "Topic billing: (ticket-INV-7)
  The customer asked for a receipt." The structural fingerprint matched across
  two real-clock runs; in deterministic-clock mode the Mark digests were
  byte-identical (set digest `sha256:d20c2862…`).

### 7.6 External protocols (E008)

Live against separately running reference servers (PURL `node` server; ACSP
Next.js + PGlite): discovery, creation, owner-authorised export, `405` on
`GET …/ops/checkpoint` with unchanged version, idempotent replay without a new
event, `409` on stale versions, `404` non-disclosure (PURL), `401` without a
capability and `403 session_mismatch` on impersonation (ACSP), server-side hash
verification, TOK source = the adapter's own ACSP session. AWRM refused to
invoke `grant`/`delegate` locally. The same scenario passed offline against the
recorded exchanges. SEURL: 3 of 7 verbs map to *proposals*; 4 are reported as
unsupported or underspecified.

### 7.7 Seeds (E012)

| Seed | Outcome | Measure |
|---|---|---|
| Strict integer parsing | **refuted** | false-accept rate 0.50 → 0.50; correct-answer goodput −50% |
| Redaction coverage (GitHub/Slack/AWS formats) | candidate | detection 0.57 → 1.00; benign false positives 0 → 0 |
| Canonical-JSON property tests | candidate | 0 → 500 passing generated cases |
| Lane count matching cores | candidate (this run) | 75.7 → 255.7 DMU/s; 4→8 lanes +10% |
| Smaller context budget | candidate | 4/4 summaries unchanged at 400 chars (all changed at 120) |
| Shorter local retry backoff | candidate | p50 52.1 → 6.5 ms, 20/20 successes both |
| Activate consumer ChatGPT port | rejected (network, external-port) | — |
| Treat unknown quota as unlimited | rejected (policy-write) | — |
| Create extra seats | rejected (seat-create, budget-raise) | — |
| Remote benchmark declared local | rejected at runtime (sandbox tripwire) | — |

Candidates are proposals for human review; none was installed.

### 7.8 Defects found by our own experiments and tests (fixed before the recorded run)

1. **Forged context delimiters** (E010): content containing `[END AWRM PASS …]`
   could close the real delimiter. Fixed by neutralising delimiter-like text.
2. **Wall-clock spin in the CPU fixture** (E005): worker threads "worked" for a
   fixed wall time, so 8 threads on 4 cores appeared to finish on time and
   CPU-bound throughput seemed to scale 6×. Fixed to a calibrated fixed amount
   of work; the corrected run shows saturation.
3. **Torn-tail "sealing"** (store tests): appending a newline after a torn
   journal line left corrupt bytes mid-file and made the *next* open fatal.
   Fixed by truncating the torn tail.
4. **Incomplete authority deny-list** (continuity tests): `permissionRecordIds`
   was not on the Pass refused-field list (the schema would still have
   rejected it, but with the wrong error class). Fixed.
5. **Session-only fixture cookie** (E010/E003): the owned fixture issued a
   session cookie that Chromium drops on profile close, which made profile
   persistence look broken. Real "stay signed in" cookies are persistent; the
   fixture now sets `Max-Age`.
6. **Breaker liveness** (fleet tests): with every lane's breaker open and
   nothing in flight, queued jobs would never be re-pumped. Fixed with a
   cooldown timer.

## 8. Negative results

X001 (designed); the real model's arithmetic failure (E002); the strict-parsing
Seed; the time-variance of the lane-count Seed, which was refuted in a run made
before defect 2 was fixed and is a candidate after; the brief's capacity bound
(§4.3).

## 9. Threats to validity

* **Test doubles.** Most runs use AWRM-written rule programs. They prove
  infrastructure properties only; every Mark labels them `deterministic-test-double`.
* **One small model.** flan-t5-small is far weaker than production models;
  E002 shows the contract, not model quality.
* **Owned fixtures are not providers.** Login, expiry and rate-limit behaviour
  were exercised against a fixture we wrote. No third-party service was
  automated or contacted; no official API was called (no keys).
* **Single machine, few repeats.** E005 is one run per point; throughput
  varies run to run (CPU-bound 1-lane throughput ranged 43–65 DMU/s across our
  runs). We report point estimates, not confidence intervals.
* **Universal safety claims** (H-2, H-3, H-4) are supported by absence of
  counterexamples in finite tests, not proven.
* **Policy reading.** E004 records our reading of terms on one date; OpenAI's
  pages were not retrievable by our fetcher.
* **Sandbox.** The Seed network guard is an in-process tripwire, not isolation.

## 10. Limitations and ethics

The engine deliberately cannot be used to automate consumer AI websites, rotate
identities, pool accounts, evade rate limits or disguise automation; those
paths are denied by data the Gate reads, not by convention. It never asks a
human for passwords or for routine browser chores. API use requires the
owner's own acceptance of the provider's terms and their own key. Unpaid API
tiers may use submitted content to improve provider products; the provider
matrix records this so an owner can decide.

## 11. Reproducibility

```bash
pnpm install --frozen-lockfile && pnpm test
scripts/start-reference-servers.sh && export AWRM_PURL_URL=http://127.0.0.1:18080 AWRM_ACSP_URL=http://127.0.0.1:18090
node bin/awrm.mjs experiments run --all && node --import tsx scripts/reproduce.ts
```

## References

Birgisson, A., Politz, J. G., Erlingsson, Ú., Taly, A., Vrable, M., Lentczner, M. (2014). Macaroons: Cookies with contextual caveats for decentralized authorization in the cloud. NDSS.
Birrell, A. D., Nelson, B. J. (1984). Implementing remote procedure calls. ACM TOCS 2(1).
Dennis, J. B., Van Horn, E. C. (1966). Programming semantics for multiprogrammed computations. CACM 9(3).
Greshake, K., Abdelnabi, S., Mishra, S., Endres, C., Holz, T., Fritz, M. (2023). Not what you've signed up for: Compromising real-world LLM-integrated applications with indirect prompt injection. AISec.
Hewitt, C., Bishop, P., Steiger, R. (1973). A universal modular ACTOR formalism for artificial intelligence. IJCAI.
Jain, R., Chiu, D., Hawe, W. (1984). A quantitative measure of fairness and discrimination for resource allocation in shared computer systems. DEC-TR-301.
Khattab, O., et al. (2023). DSPy: Compiling declarative language model calls into self-improving pipelines. arXiv:2310.03714.
Merkle, R. C. (1987). A digital signature based on a conventional encryption function. CRYPTO.
Miller, M. S. (2006). Robust Composition: Towards a unified approach to access control and concurrency control. PhD thesis, Johns Hopkins University.
Nygard, M. T. (2007). Release It! Pragmatic Bookshelf.
Shreedhar, M., Varghese, G. (1995). Efficient fair queueing using deficit round robin. SIGCOMM.
W3C (2013). PROV-DM: The PROV Data Model. W3C Recommendation.
RFC 8785 (JSON Canonicalization Scheme), RFC 9457 (Problem Details), RFC 6570 (URI Template).
