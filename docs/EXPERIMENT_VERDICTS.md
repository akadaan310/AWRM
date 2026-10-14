# Experiment verdicts

Generated from `research/results/summary.json` — run at commit `4b85a18e9b528a413a74886de670cc83257a5ff7`,
2026-10-14T07:14:55.877Z, Node v22.22.0, 4 × Intel(R) Xeon(R) Processor @ 2.80GHz,
16093 MB. Live reference servers were used for E008; Chromium and the
ONNX model were available. Each row's full record (checks with expected/observed
values, metrics, blocked paths, Mark digests) is `research/results/<id>.json`.

Verdict vocabulary: `SUPPORTED` (all preregistered checks passed), `REFUTED`
(a check failed — the counterexample is kept), `OBSERVED` (a recorded reading,
e.g. policy), `INCONCLUSIVE`, `BLOCKED`, `NOT_RUN`.

| id | title | hypotheses | verdict | checks | marks (first) | blocked / not run | deterministic digest |
|---|---|---|---|---|---|---|---|
| E001 | DMU atom: one prompt, one validated response or a typed failure | H-2 | **SUPPORTED** | 20/20 | 6 (`sha256:7441e7f693f6…`, `sha256:f7fbb116d257…`) | — | `sha256:1bf24fbe9b944eb8…` |
| E002 | Port substitution: one Form, several conforming ports | H-1 | **SUPPORTED** | 3/3 | 12 (`sha256:bc571a5be193…`, `sha256:cca5e97b7ac5…`) | — | `sha256:1704b90788a0bfa1…` |
| E003 | Signed-in boundary (owned fixture): human-only login, restart, expiry, logout, no cookie extraction | H-4 | **SUPPORTED** | 11/11 | 7 (`sha256:74574d37ce3e…`, `sha256:ccc8979a738f…`) | — | `sha256:3ad482f1944f14dc…` |
| E004 | Provider eligibility: consumer UI vs API vs local, decided by the Gate | H-6, AX-4 | **OBSERVED** | 23/23 | 5 (`sha256:6fcaec687d2f…`, `sha256:b22e5d898937…`) | ChatGPT / claude.ai / Gemini consumer UI automation: BLOCKED; Anthropic Messages API, Gemini API: NOT_RUN; OpenAI API: NOT_RUN | `sha256:fb23dec5a90ce040…` |
| E005 | One DMU → Fleet: measured scaling until machine limits | H-5 | **SUPPORTED** | 12/12 | 32 (`sha256:3cd5ebd5e7e5…`, `sha256:21a425a99094…`) | — | `sha256:5a98e86b5eb125dc…` |
| E006 | Quota confinement: 4 views on 1 account vs 4 independent resources | H-5, AX-5 | **SUPPORTED** | 7/7 | 13 (`sha256:5984e1381a72…`, `sha256:58f24e116d3f…`) | — | `sha256:4060dc1c2602a1ff…` |
| E007 | Cross-model Pass with attempted credential/authority transfer | H-4, AX-3 | **SUPPORTED** | 14/14 | 5 (`sha256:b55b6cdea34f…`, `sha256:493fd04a1d1a…`) | — | `sha256:e8953e44a950e348…` |
| E008 | Protocol boundaries: PURL/0.1 and ACSP/0.1 black-box, SEURL partial | H-8, AX-7 | **SUPPORTED** | 53/53 | 1 (`sha256:a785e1a8060d…`) | — | `sha256:bdf10f9b6f71c14f…` |
| E009 | Evidence corruption detection | H-3, AX-6 | **SUPPORTED** | 17/17 | 2 (`sha256:cde60dff8cce…`, `sha256:26cf23d93c5f…`) | — | `sha256:acd5f50e0c5cde34…` |
| E010 | Malicious prompting and injection | H-4, H-6, AX-4 | **SUPPORTED** | 11/11 | 5 (`sha256:55557f2fc753…`, `sha256:e401c6cb3c78…`) | — | `sha256:86dd94ef7b50b63c…` |
| E011 | Crash mid-Turn, restart, reconcile, replay | H-7 | **SUPPORTED** | 14/14 | 4 (`sha256:dd36d1c07aa3…`, `sha256:cc82d59b0c1a…`) | — | `sha256:3602bb4aee36dab9…` |
| E012 | Self-discovery with fixed authority | H-6, AX-4 | **SUPPORTED** | 9/9 | 0 (— (metrics only)) | — | `sha256:3954c606f1e752f9…` |
| CHAIN | End-to-end chain across two independent adapters with restart and replay | H-1, H-3, H-4, H-7, AX-6 | **SUPPORTED** | 14/14 | 4 (`sha256:9a1a2a1c8483…`, `sha256:c3ea6da5451f…`) | — | `sha256:13970d6fff92926f…` |
| X001 | Negative control: "N views ⇒ N× allowance" (expected REFUTED) | naive-H5-complement | **REFUTED** | 0/1 | 0 (— (metrics only)) | — | `sha256:882fedfa917399c9…` |

**Reproducibility.** `scripts/reproduce.ts` ran all 14 experiments twice in fresh
directories: 14/14 reproduced the same verdict and deterministic digest
(`research/results/REPRODUCIBILITY.json`). Latencies, throughput and Mark
digests that embed wall-clock time legitimately differ between runs and are
excluded from that digest; CHAIN shows that in deterministic-clock mode the
Mark digests themselves are byte-identical.

**Negative results kept.** X001 (naive "N views ⇒ N× allowance") is REFUTED by
design. Inside otherwise-supported experiments: the real model fails
`math.check.v1` (invalid-output) in E002; E012's "strict integer parsing" Seed is
REFUTED (false-accept rate unchanged at 0.5, goodput −50%). Bugs found by the
experiments and fixed before this run are listed in `research/PAPER.md` §7.
