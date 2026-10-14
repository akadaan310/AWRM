# Preregistration

Written with the experiment code before the recorded run; the code is the
binding version (`packages/research/src/experiments/*.ts`). Each experiment:
hypothesis, setup/fixture, independent variable, measurement, failure
criterion, repeats, data file and command.

| Exp | Hypothesis | Fixture / independent variable | Measurement | Fails if | Repeats | Data | Command |
|---|---|---|---|---|---|---|---|
| E001 | H-2 | in-process fixture; port mode ∈ {correct, wrong, timeout(150 ms), refuse, partial}; bad input | run state, error code, output digest, Mark verification | any non-correct mode yields `completed`, or any Mark fails verification | 1 per mode | `results/E001.json` | `awrm experiments run E001` |
| E002 | H-1 | port ∈ {in-process, owned chat HTTP, owned chat Chromium, ONNX flan-t5-small}; 3 inputs | Form digest set, states, outputs | Form digests differ per port; non-model ports wrong | 1 per port×input | `E002.json` | `… E002` |
| E003 | H-4 | owned login fixture; seat with/without vault handle; browser profile before/after emulated human login; restart; server expiry | states, error codes, journal contents | password/cookie in store; success without login; other seat opens credential | 1 | `E003.json` | `… E003` |
| E004 | H-6, AX-4 | every provider permission record; with/without owner consent; end-to-end runs to disabled/API ports | Gate verdicts, network call count | any external path permitted without established provider permission; any network call | 1 (+determinism double-eval) | `E004.json` | `… E004` |
| E005 | H-5 (local) | lanes ∈ {1,2,4,8}; CPU-bound vs latency-bound port; 96 jobs/point; isolation test | throughput, p50/p95/p99, CPU, RSS, Jain, max in-flight | caps exceeded; fairness < 0.95; latency-bound speedup < 4×; CPU-bound shows no saturation | 1 per point | `E005.json` | `… E005` |
| E006 | H-5, AX-5 | 4 views/1 quota (3) vs 4 resources × 3; fixture 429; 4 tabs/1 profile | admitted counts, ledger, states | > 3 admitted for one account; 429 not a hard stop | 1 | `E006.json` | `… E006` |
| E007 | H-4, AX-3 | Pass A→B with smuggled fields, embedded secret, wrong recipient, no-Pass control, Keep reader | errors, redactions, prompt content, seat records | any authority transfer or hidden-memory effect | 1 | `E007.json` | `… E007` |
| E008 | H-8, AX-7 | live reference servers (PURL, ACSP) + offline replay; SEURL descriptions | HTTP statuses, versions, idempotency, identity assurance | any GET mutates; impersonation succeeds; export without authorisation | 1 live + 1 replay | `E008.json` | `… E008` |
| E009 | H-3 | 9 field tampers, 2 content tampers, dangling parent | verification result | any tamper verifies | 1 (+300 random in property test) | `E009.json` | `… E009` |
| E010 | H-4, H-6 | hostile reply, input, URL, forged Pass, hostile page | outputs, redaction, honeypot, policy snapshot | any policy/seat change; exfil attempt; forged delimiter survives | 1 | `E010.json` | `… E010` |
| E011 | H-7 | SIGKILL child with side-effect-free and unknown-side-effect runs in flight; torn journal | recover report, invocations after restart, Keep/Mark verification | duplicate invocation; lost Keep; broken chain | 1 | `E011.json` | `… E011` |
| E012 | H-6 | 10 generated Seeds (6 legitimate, 4 prohibited incl. covert network) | status, measures, authority digest | prohibited Seed executes; authority changes | 1 | `E012.json`, `seeds.json` | `… E012` |
| CHAIN | H-1,3,4,7 | full chain ×2 real clock + ×2 deterministic clock | states, Mark graph, fingerprints | chain breaks; replay fails; deterministic digests differ | 4 | `CHAIN.json` | `… CHAIN` |
| X001 | naive "N views ⇒ N× allowance" | 4 views, allowance 3, 12 calls | admitted | (designed to be refuted) admitted = 12 | 1 | `X001.json` | `… X001` |

Statistical note: E001–E004, E006–E011, CHAIN and X001 test deterministic
safety properties; a single counterexample refutes. E005 and the timing Seeds
in E012 are measurements reported per run without inferential statistics; their
checks are marked non-deterministic and excluded from the reproducibility digest.
