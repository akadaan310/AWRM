# Interoperability: SEURL, PURL/0.1, ACSP/0.1

Three **separate** adapters in `packages/interop/src/{seurl,purl,acsp}`. They
share only protocol-neutral HTTP plumbing (`http.ts`) and an export-authorisation
check (`common.ts`); there is no generic operation converter. The kernel does
not import them. AWRM is not a PURL server or an ACSP server and offers no
facade for either.

## Feature matrix

| Feature | PURL/0.1 adapter | ACSP/0.1 adapter | SEURL translator |
|---|---|---|---|
| Discovery | `GET /.well-known/purl`, rejects unknown major version | `GET /.well-known/acsp`, requires `ACSP/0.1` | — |
| Principal / session | `POST /principals` → bearer token held in memory only | session id chosen by AWRM adapter; owner capability from `create` held in memory | — |
| Create resource | `POST /r {type,state}` | `POST /r` envelope `create` | — |
| Mutation path | `POST /r/{id}/ops/{operation}` | `POST /r/{id}/operations` | none (never mutates) |
| Operations AWRM will invoke | `checkpoint`, `annotate` (allow-list; others refused locally, nothing sent) | `append`, `checkpoint`, `acknowledge` (allow-list) | — |
| Pre-invoke manifest check | yes: operation must be listed and `available` for the requester | n/a (server enforces scopes) | — |
| Optimistic concurrency | `expected_version` from current representation; 409 surfaced | `expected_version` optional; 409 `stale_version` surfaced | — |
| Idempotency | `Idempotency-Key` derived from the Pass digest | `idempotency_key` derived from the Pass digest | — |
| GET safety | `probeSafeGet` asserts `405 Allow: POST` and unchanged version | `prepare()` asserts intent document and unchanged version | — |
| AWRM → protocol mapping | Pass → continuity `package` (all content as *claims*; provenance in `assumptions`, non-transfer in `constraints`) | Pass → one `finding` TOK (`stated_confidence: unclassified`, refs `{citation: "awrm:mark:sha256:…"}`) + checkpoint | TALK → DMU run *proposal* (needs Gate); COMMIT → Keep/Pass checkpoint *proposal* (needs owner); START → boundary |
| Export authorisation | required: owner, this Pass digest, this destination, this protocol | same | n/a |
| Identity mapping | AWRM Seat ≠ PURL principal; AWRM Gate ≠ PURL authority | AWRM Seat ≠ ACSP session; TOK `source` is the adapter's ACSP session with `identity_assurance: capability` | none |
| Not implemented | grant/delegate/revoke, assign/handoff/forward, transfer, fork/merge, link, lifecycle transitions, SSE subscribe, HTML | annotate, update, supersede, fork, delegate, revoke, handoff (issuing), propose, resolve_proposal, close, HTML forms | SWITCH (unsupported), WRITE/BUILD/PERTURB (underspecified in source) |

## Verification status (E008, 2026-10-14)

| Protocol | Live against reference server | Offline |
|---|---|---|
| PURL/0.1 | **LIVE_REFERENCE_VERIFIED** — `akadaan310/purl@3df4452a`, `node src/transport/main.js`, 17 HTTP exchanges, 12 scenario checks + wire-path check | replay of that recording: 13 checks; replay refuses any divergent request |
| ACSP/0.1 | **LIVE_REFERENCE_VERIFIED** — `akadaan310/NetGovComEduGovOrgEduGovComNet@9fcf2e1d`, `next dev` + PGlite, 12 HTTP exchanges, 11 scenario checks + wire-path check | replay: 12 checks |
| SEURL | no executable reference exists | 3 translator checks; **PARTIAL** (3 of 7 verbs mapped to proposals) |

Recordings live in `fixtures/interop/*.golden.json`; bearer tokens and
capabilities are redacted at record time. Offline replay is labelled
"not a live verification" in CLI output.

## Reproduce

```bash
scripts/start-reference-servers.sh              # clones + starts both as black boxes
export AWRM_PURL_URL=http://127.0.0.1:18080 AWRM_ACSP_URL=http://127.0.0.1:18090
node bin/awrm.mjs interop check --protocol purl --live $AWRM_PURL_URL
node bin/awrm.mjs interop check --protocol acsp --live $AWRM_ACSP_URL
node bin/awrm.mjs experiments run E008         # live + replay, rewrites the recordings
node bin/awrm.mjs interop check --protocol purl --offline
```
