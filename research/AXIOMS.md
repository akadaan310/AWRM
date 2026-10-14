# AWRM engineering invariants (AX-1 … AX-7)

These are **invariants enforced by code and checked by tests**, not
mathematical axioms. "Holds" below means: enforced at the named location, and
no counterexample was found by the named tests/experiments on 2026-10-14.

| Id | Invariant | Enforced in | Checked by | Status |
|---|---|---|---|---|
| AX-1 Atomic observability | Every terminal Turn — and every run ending before a Turn — has exactly one Mark; failures are not omitted | `Kernel.endTurn`, `Kernel.finishWithoutTurn`, `Kernel.recover` | E001, E011, `tests/integration/kernel.test.ts` | holds |
| AX-2 Substitution | Swapping a conforming Port changes no Form, continuity schema or scheduler code | Port interface (`packages/ports/src/interface.ts`); kernel imports only the interface | E002, CHAIN, `tests/ports/ports.test.ts`, dependency audit | holds |
| AX-3 Non-transfer | A Pass carries data, never identity, credentials or authority | Pass schema (`additionalProperties: false`), `AUTHORITY_FIELDS`, `PassStore.receive`, `Vault.use` binding | E007, `tests/integration/continuity.test.ts` | holds (after adding `permissionRecordIds` to the refused-field list — gap found by the test suite) |
| AX-4 Gate precedence | No scheduler path or Seed can override a deny/unknown/exhausted Gate | `assess()` pure + two evaluations + atomic quota reservation; Seeds' capability whitelist + network guard | E004, E006, E012, property test (2000 random Gate inputs) | holds |
| AX-5 Bounded fleet | Views of one quotaKey never change its allowance | `QuotaLedger` keyed by quotaKey; Fleet never reroutes denied work; `capacity()` groups by quotaKey | E006, X001, `tests/perf/fleet.test.ts` | holds |
| AX-6 Provenance closure | Every output, Keep, Bond and Pass points to a verifying Mark or is labelled unverified | Keep/Pass require a completed verifying Mark; Bond-derived runs cite parent Marks; PURL/ACSP exports label content as claims | E009, CHAIN, E008 | holds |
| AX-7 Safe interop | Read-only PURL/ACSP calls never mutate; exports need owner authorisation and the destination's own authority and wire method | adapters' allow-lists, `checkExportAuthorization`, `probeSafeGet`, `prepare()` | E008 live (405 + unchanged version; prepare unchanged version; 401/403 from servers) | holds |
