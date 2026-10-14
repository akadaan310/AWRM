# AWRM — Account/Web Reasoning Morphogenesis

A standalone engine whose unit of computation is the **Dark Matter Unit (DMU)**:
one typed prompt → one validated response or a typed failure, run through an
explicitly chosen, permission-checked **Port**, with a content-addressed
evidence record (**Mark**) for every outcome.

A browser is one optional Port among several. So is a local open-weight model,
an AWRM-owned test service, or an official provider API. The kernel runs with
none of the optional pieces installed.

```bash
pnpm install --frozen-lockfile
node bin/awrm.mjs run math.check.v1 --port owned-fixture --input '{"question":"What is 17 × 23?"}'
#  state    completed
#  output   {"answer":391}
#  port     owned-fixture [owned-fixture, deterministic-test-double]
#  gate     permit: permit
#  mark     sha256:…
node bin/awrm.mjs marks verify --latest
```

## What is here

| | |
|---|---|
| **Kernel** (`packages/{core,policy,identity,evidence,store,continuity,runtime,scheduler,plans,ports}`) | Forms, DMUs, the pure Gate, quota ledger, Seats-as-handles, vault, Marks, Keep/Pass, Turn state machine, idempotency, cancellation, crash recovery, Fleet scheduler, typed Bond plans. No third-party runtime dependencies. |
| **Ports** | deterministic test doubles (two independent rule programs), worker-thread CPU fixture, owned chat over loopback HTTP+SSE, **real local model** (`packages/port-onnx`, flan-t5-small on CPU), **Chromium** (`packages/browser-port`, owned origins only), Anthropic/Gemini API ports (inert without owner consent + key), disabled consumer-UI ports (always denied). |
| **Interop** (`packages/interop`) | separate black-box clients for **PURL/0.1** and **ACSP/0.1** (verified live against their reference servers) and a **partial** SEURL translator. |
| **API / CLI** | loopback-only authenticated HTTP API, TypeScript SDK, `awrm` CLI built on the SDK. |
| **Research** (`packages/research`, `research/`) | experiments E001–E012, CHAIN, X001; Seeds (bounded self-discovery); self-audit; theory, lexicon, paper, claims. |

## Status in one table

| | |
|---|---|
| Tests | 95 (94 pass + 1 opt-in real-model test, which also passes with `AWRM_TEST_MODEL=1`) |
| Experiments | 12 SUPPORTED, E004 OBSERVED (policy reading), X001 REFUTED by design; 14/14 reproduce across two runs |
| ChatGPT / claude.ai / Gemini web automation | **Blocked** — not permitted / not established ([docs/PROVIDER_ELIGIBILITY.md](docs/PROVIDER_ELIGIBILITY.md)) |
| Official APIs | Implemented, wire-tested offline, **not run** live (no owner consent/key) |
| Capacity | Measured locally (E005); unknown provider allowances are reported as unknown — never unlimited |

## Commands

`awrm doctor · dmus list · providers assess · run · marks verify · fleet benchmark ·
passes demo · interop check · experiments run · report · audit · serve` — see
[docs/RUNBOOK.md](docs/RUNBOOK.md).

## Read next

* [MISSION_REPORT.md](MISSION_REPORT.md) — what was built, proven, blocked, and what is next
* [research/PAPER.md](research/PAPER.md) · [research/THEORY.md](research/THEORY.md) · [research/LEXICON.md](research/LEXICON.md) · [research/AXIOMS.md](research/AXIOMS.md)
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/INTEROPERABILITY.md](docs/INTEROPERABILITY.md) · [docs/ACCOUNT_SECURITY.md](docs/ACCOUNT_SECURITY.md) · [docs/EXPERIMENT_VERDICTS.md](docs/EXPERIMENT_VERDICTS.md) · [docs/REPOSITORY_REVIEW.md](docs/REPOSITORY_REVIEW.md)

AWRM imports nothing from Golden Surface, Luna Foundry, SEURL, PURL, ACSP or other
earlier projects; `awrm audit` fails if it ever does.
