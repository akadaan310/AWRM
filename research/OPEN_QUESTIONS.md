# Open questions

## Highest-value next experiment (falsifiable)

**Q1 — Cross-port agreement as a correctness gate.** AWRM's Form catches
*invalid* answers (E002: the real model's arithmetic failure) but not
*schema-valid wrong* ones (`{answer: 392}` completes). Hypothesis: requiring
agreement between two independent conforming ports (e.g. `local-b` rules and
`onnx-local`, or two different local models) before a DMU counts as completed
raises precision of completed answers on a labelled corpus to ≥ 0.99 while
retaining ≥ 70% of single-port goodput. Falsifier: precision gain < 5 points or
goodput < 50%. Design: 500 labelled classify/extract items, ports as factor,
agreement rule as treatment, bootstrap CIs, cost in Turns per completed DMU.
Everything needed exists (Bonds, Marks with parents, Fleet); it adds a
"consensus DMU" whose Mark cites both inputs.

## Further questions

* Q2 — Does the grouped capacity bound predict realised throughput within 20%
  when L_i is measured under load rather than at concurrency 1? (E005 shows L_i
  grows with oversubscription.)
* Q3 — Can a real OS-level sandbox (separate process, seccomp/no-network
  namespace) replace the in-process Seed tripwire without slowing the Seed loop
  by more than 2×?
* Q4 — A PURL-compatible *read-only* facade over Marks (manifest + projections,
  no mutations): which PURL conformance requirements can it meet honestly?
* Q5 — What is the minimal owner-consent record (signed, expiring) that would let
  an official-API seat be enabled without editing data files?
* Q6 — Should the redaction-coverage Seed candidate (GitHub/Slack/AWS formats,
  57% → 100% on the synthetic set) be installed? Needs a false-positive study on
  real logs.
