# Repository review (refreshed 2026-10-14)

Scope: what was read, at which revision, and what was concluded. **Reading a
repository is not running it**, except where "executed as black box" is stated.
Nothing from these repositories is imported, vendored, copied or depended on by
AWRM; `awrm audit` and `tests/security/dependency-boundaries.test.ts` enforce
that.

## Primary normative references

| Repository | Branch / HEAD inspected | Read | Executed? | Conclusion for AWRM |
|---|---|---|---|---|
| `akadaan310/seurl` | `master` @ `620ff955b87857c3eb7a7700a81b6a4d0217400a` (2026-09-28) | `README.md`, `NAI-CI.md`, `index.html` — the repository contains only these 3 files (≈4.5 KB) | No (static page) | The seven verbs `START SWITCH WRITE COMMIT BUILD TALK PERTURB` exist only as names on a static page plus prose. No grammar, argument syntax, interpreter, registry or conformance suite exists. AWRM ships a **partial translator** (`packages/interop/src/seurl`) with an AWRM-defined argument convention, labelled as such. It never mints `seurl://` URIs. |
| `akadaan310/purl` | default `claude/purl-protocol-research-bxevq5` @ `3df4452a3624b3f5492bf23c2dacc49d8d2b33c7` (2026-09-25). Other branches: `ccr-d0887a23-30wf63` @ `83d6bcaf` (2026-10-01), `claude/acsp-purl-composition-adsbn6` @ `18c85bf2` | `SPEC.md` (all), `docs/operations.md` (all), `schemas/continuity-package.schema.json`, `src/transport/main.js`, `package.json`, `test/helpers.js` | **Yes — as a separate black-box process** (`node src/transport/main.js`, in-memory, port 18080). AWRM talks to it over HTTP only. | Zero-dependency Node reference server. Wire facts verified live: `/.well-known/purl`, `POST /principals` → bearer token, `POST /r`, `GET /r/{id}/manifest`, `POST /r/{id}/ops/{operation}` with `{expected_version, input}`, `Idempotency-Key` replay, `409 version-conflict`, `GET /r/{id}/ops/*` → `405 Allow: POST`, `404` non-disclosure to other principals, `verify` and `continuity` projections. |
| `akadaan310/NetGovComEduGovOrgEduGovComNet` (ACSP) | default `claude/agent-continuity-protocol-doi4bn` @ `9fcf2e1da3ce01a4e66eb5be5e2249b1f211878b` (2026-09-27). Other branches: `ccr-d0887a23-30wf63`, `claude/acsp-program-001-k616hw`, `claude/acsp-purl-composition-adsbn6` | `PROTOCOL.md` (all 603 lines), `package.json`, `src/runtime.ts`, `src/research/tok.ts` (TOK/ref schemas) | **Yes — as a separate black-box process** (`next dev` with embedded PGlite, port 18090, dependencies installed in a scratch directory outside AWRM). | Mutations go to `POST /r/{id}/operations` (≠ PURL's `/ops/{op}`) with an envelope `{protocol, operation, actor, expected_version?, idempotency_key, payload}`. Verified live: create → owner capability; `401 authentication_required` without capability; `403 session_mismatch` on impersonation; `409 stale_version`; idempotent replay; `?action=prepare_append` is a non-storing intent; TOK `source.identity_assurance = capability`. |
| `akadaan310/substrateIO` | default `claude/research-substrate-bootstrap-bfd02a` @ `7ace119a544fc736f0d4ec1d72cded9dad0a83e3` | file listing; `research/` registry structure (hypotheses, failures, epistemic statuses) | No | Adopted only as discipline: separate observed vs hypothesised, keep refuted results. AWRM's own verdict vocabulary (`PROPOSED … NOT_RUN`) and X001 negative control follow from this. |

## Secondary references (not loaded into any runtime)

Golden Surface, Luna Foundry, Pearl Substrate, Pearl Foundry, aanebed(-v6),
Netscape Surface, GIS substrate/sidecar, my-sneaky-ai and MUSA were **not
cloned**. The mission brief's summaries of them were taken as given context;
AWRM depends on none of them, and the self-audit fails the build if any of
their names appears as an import or dependency.

## Discovery check for newer AWRM/DMU work

`search_repositories user:akadaan310` (84 repositories) on 2026-10-14. The only
AWRM repository is this one (`akadaan310/AWRM`, created 2026-10-14, empty
before this work). Repositories updated after the brief's references
(`adequate-platform` @ `f1ec01db`, empty; `LG` @ `1afe763a`, a design
prototype; `rtperformance` @ `299c65d3`, a training-platform web app) were
shallow-cloned and grepped for `AWRM`, `DMU`, `dark matter unit`: **no
matches**. Nothing supersedes the brief's findings.

## Documented vs implemented vs live-verified

| Claim | SEURL | PURL/0.1 | ACSP/0.1 |
|---|---|---|---|
| Specified in prose | yes (names only) | yes (normative) | yes (normative) |
| Machine-readable schema | no | yes (`schemas/*.json`) | yes (`/protocol.json`, zod) |
| Reference implementation present | static HTML | yes (Node, zero deps) | yes (Next.js + Postgres/PGlite) |
| Executed by this work | no | yes (black box) | yes (black box) |
| AWRM adapter verified live | n/a | **yes — 12 scenario checks + 1 wire-path check** (E008) | **yes — 11 scenario checks + 1 wire-path check** (E008) |
| AWRM adapter verified offline | 3 translator checks | 13 checks (replay of the live recording, incl. full consumption) | 12 checks (replay of the live recording, incl. full consumption) |
