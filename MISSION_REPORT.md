# AWRM mission report — 2026-10-14

Branch `ccr-c7b03035-gk3huv` of `akadaan310/AWRM`. Experiment results were
recorded at code commit `4b85a18` (later commits add documentation only).
Environment: 4 × Intel Xeon @ 2.80 GHz, 16 GB RAM, Linux 6.18, Node 22.22,
pnpm 10.28, Chromium 141 (Playwright 1.56.1), ONNX Runtime CPU via
transformers.js 4.3.1.

## 1. Built

A new standalone TypeScript workspace (17 packages; the 10 kernel packages
have no third-party runtime dependencies):

| Path | Content |
|---|---|
| `packages/core` | canonical JSON + SHA-256, JSON-Schema subset validator, Forms, DMU definitions, parser, 5 built-in DMUs, the 12-term lexicon with schemas |
| `packages/policy` | pure Gate (`assess`), QuotaLedger keyed by allowance, sourced provider matrix |
| `packages/identity` | Seats (handles only), PermissionRegistry, Vault + `Secret` |
| `packages/evidence` | Mark seal/verify/graph/content checks, redaction |
| `packages/store` | memory, fsync'd JSONL journal (torn-tail truncation), `node:sqlite` |
| `packages/continuity` | Keep (revisioned, reader lists), Pass (data-only, delimiter neutralisation) |
| `packages/runtime` | Kernel: submit/Gate×2/reserve/Turn/validate/Mark, idempotency, cancel, bounded retry, recovery |
| `packages/scheduler` | Fleet (global cap, DRR + aging, backpressure, breakers, grouped capacity bound), benchmark |
| `packages/plans` | Bonds, type-checked DAG plans |
| `packages/ports` | Port interface; two independent rule-program test doubles; worker-thread CPU fixture; owned-chat HTTP+SSE port; Anthropic & Gemini API ports; disabled consumer-UI ports |
| `packages/port-onnx` (optional) | real local open-weight model port (flan-t5-small, Apache-2.0) |
| `packages/browser-port` (optional) | Chromium port restricted to allowlisted owned origins; no credential entry |
| `packages/interop` | PURL/0.1 client, ACSP/0.1 client, SEURL partial translator, record/replay |
| `packages/fixtures` | owned chat web app (test login, persistent cookie, SSE, 429, hostile mode, exfil honeypot) |
| `packages/api`, `packages/cli` | loopback authenticated API + SDK; `awrm` CLI on the SDK |
| `packages/research` | experiments, Seeds + sandbox tripwire, self-audit, runner |
| `docs/`, `research/` | review, eligibility, architecture, interop, security, runbook, verdicts; theory, axioms, lexicon, paper, claims, preregistration, open questions |

Verified commands (all run in this session):

```
pnpm install --frozen-lockfile        # also from a fresh clone
pnpm typecheck                        # clean
pnpm test                             # 95 tests: 94 pass, 1 opt-in (passes with AWRM_TEST_MODEL=1)
awrm doctor | dmus list | providers assess
awrm run math.check.v1 --port owned-fixture --input '{"question":"17*23"}'   → completed {"answer":391}
awrm marks verify --latest            → digest OK, content OK
awrm fleet benchmark --ports owned-fixture --lanes 1,2,4,8
awrm passes demo --source local-a --target local-b
awrm interop check --protocol purl --offline   / --protocol acsp --offline
awrm experiments run --all            → 12 SUPPORTED, 1 OBSERVED, X001 REFUTED (designed)
awrm report | awrm audit              → self-audit: 0 errors, 0 warnings
node --import tsx scripts/reproduce.ts → 14/14 experiments reproduce verdict + deterministic digest
```

Independent API demo (`awrm serve`, then plain curl):

```
$ curl -s -X POST 'localhost:7357/v1/runs?wait=true' -H "authorization: Bearer $(cat $AWRM_HOME/api-token)" \
       -H 'content-type: application/json' -H 'idempotency-key: demo-0001' \
       -d '{"dmuId":"text.classify.v1","input":{"text":"The invoice is overdue."},"seatId":"local-a","portId":"local-a"}'
{"runId":"run_M4D37C0PYSSWFMQG","state":"completed","output":{"label":"billing"},"markDigest":"sha256:935c4fc3…"}
$ curl -s -o /dev/null -w '%{http_code}' localhost:7357/v1/status        # no token
401
$ curl -s localhost:7357/v1/fleet/capacity -H 'authorization: Bearer …'
{"quotaKey":"awrm-local:local-owner","limit":"unknown","windowMs":"unknown",…}  "Unknown is reported as \"unknown\", never infinite."
```

## 2. Proven (within stated scope)

| Property | Evidence | Mark (example) |
|---|---|---|
| DMU contract: 391 completes; wrong / timeout / refusal / partial / bad input are typed failures | E001 20/20 | `sha256:7441e7f6…` |
| Port interchangeability: one Form through in-process, HTTP, Chromium and a real ONNX model | E002 (model fails arithmetic → `invalid-output`, correctly) | `sha256:bc571a5b…` |
| Local Fleet capacity: latency-bound 46→357 DMU/s (7.7×) at 1→8 lanes; CPU-bound 52→162 DMU/s at 4 lanes, 166 at 8 (saturated, p50 22→41 ms) | E005, `research/results/E005-scaling.svg` | 32 Marks |
| Quota honesty: 4 views × allowance 3 → 3 admitted; 4 independent × 3 → 12; 429 = hard stop; 4 Chromium tabs → 3 | E006, X001 | `sha256:5984e138…` |
| Keep/Pass: data crosses A→B with citations; credential/authority transfer refused; no hidden memory | E007, CHAIN | `sha256:b55b6cde…` |
| Evidence integrity: all 12 targeted + 300 random tampers detected | E009, property test | `sha256:cde60dff…` |
| Injection resistance: no policy/seat change, no exfiltration, forged delimiters neutralised | E010 | `sha256:55557f2f…` |
| Crash recovery: SIGKILL mid-Turn → local run resumes once; unknown-side-effect run not re-sent (0 invocations) | E011 | `sha256:dd36d1c0…` |
| Bounded self-discovery: 6 Seeds measured (5 candidates, 1 refuted); 4 prohibited rejected incl. a covert `fetch` | E012, `research/results/seeds.json` | — |
| End-to-end chain across two independent adapters with restart and replay; byte-identical Marks in deterministic mode | CHAIN | `sha256:9a1a2a1c…` |

Defects the experiments found in AWRM itself and that were fixed before the
recorded run: forged Pass delimiters (E010), a wall-clock CPU fixture that
faked scaling (E005), torn-journal "sealing" that broke the next open,
an incomplete Pass deny-list, a session-only fixture cookie, and a Fleet
breaker liveness hang (details: `research/PAPER.md` §7.8).

## 3. Interop

| Protocol | Tested | Mode | Supported subset | Not supported |
|---|---|---|---|---|
| PURL/0.1 | discovery, principal, create, manifest check, checkpoint export, `Idempotency-Key` replay, 409 stale version, 405 safe GET, 404 non-disclosure, verify, continuity | **live** vs `akadaan310/purl@3df4452a` + offline replay | `checkpoint`, `annotate` only | grant/delegate/revoke, assign/handoff, transfer, fork/merge, link, lifecycle, SSE, HTML; no PURL facade |
| ACSP/0.1 | discovery, create, TOK append, checkpoint, idempotent replay, 401 without capability, 403 session mismatch, 409 stale version, non-storing prepare | **live** vs `…NetGovComEduGovOrgEduGovComNet@9fcf2e1d` + offline replay | `append`, `checkpoint`, `acknowledge` | annotate, update, supersede, fork, delegate, revoke, issuing handoff, propose/resolve, close; no ACSP facade |
| SEURL | translator: START, TALK, COMMIT → proposals | offline only (no executable reference exists) | 3 of 7 verbs | SWITCH unsupported; WRITE, BUILD, PERTURB underspecified in the source; no `seurl://` minting |

## 4. Accounts (accessed 2026-10-14; not legal advice)

| Provider | Consumer app by a human | Consumer UI automation | Official API |
|---|---|---|---|
| OpenAI | not an AWRM port | **blocked** (terms prohibit programmatic extraction / limit circumvention; current page 403 → wording unconfirmed) | **unknown** (terms unreachable; no port) |
| Anthropic | not an AWRM port | **blocked** (Consumer Terms §3: no automated or non-human access except via API key) | **permitted path, not run** — needs owner consent + key; paid; no free tier shown |
| Google | not an AWRM port | **unknown ⇒ denied** (ToS: no bypassing protective measures / machine-readable instructions) | **permitted path, not run** — free tier exists for developers (professional/business use), unpaid content may train/improve products |

A login to any of these is not API access and does not authorise automation.
Owner chores required by AWRM: none for local work. To enable an API: accept
its terms, put the key in your own environment, record consent, configure a
known quota (`docs/RUNBOOK.md`).

## 5. Unknown / not done

* No third-party model was contacted; official API ports are NOT_RUN.
* The real model is small (flan-t5-small); no quality claims are made.
* E005 is one run per point on one machine; no confidence intervals.
* The Seed sandbox is an in-process tripwire, not OS isolation.
* Nothing was pushed outside this branch, deployed, published, or created externally.

## 6. Next research question

**Does requiring agreement between two independent conforming ports raise the
precision of completed DMUs to ≥ 0.99 while keeping ≥ 70% of single-port
goodput?** The Form already rejects invalid answers (E002), but a schema-valid
wrong answer still completes; cross-port agreement is the cheapest falsifiable
step toward correctness rather than mere validity. Design and falsifier:
`research/OPEN_QUESTIONS.md` Q1.
