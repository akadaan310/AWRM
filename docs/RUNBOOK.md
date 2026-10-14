# Runbook

## Install

```bash
pnpm install --frozen-lockfile      # Node ≥ 20 (node:sqlite backend needs ≥ 22.5)
pnpm typecheck && pnpm test         # 95 tests; browser/model tests skip when unavailable
node bin/awrm.mjs doctor
```

`pnpm link --global` (or `npm i -g .`) puts `awrm` on PATH; otherwise use
`node bin/awrm.mjs`. Native install scripts are not run (pnpm default):
`onnxruntime-node` ships its CPU binary in the package.

## Commands

| Command | What it does |
|---|---|
| `awrm doctor` | Environment, backends, optional ports, reference-server URLs, credential *presence* (never values) |
| `awrm dmus list` | Registered DMUs with Form digests |
| `awrm providers assess` | Provider × access-mode matrix with live Gate decisions and the owner-consent counterfactual |
| `awrm run <dmu> --port <id> --input '<json>' [--seat <id>] [--json]` | One DMU through the API; prints state, output, port liveness, Gate, elapsed, Mark |
| `awrm marks verify --latest` / `awrm marks verify <digest>` | Structural + content verification of a Mark |
| `awrm fleet benchmark --ports owned-fixture\|io-latency\|cpu-pool --lanes 1,2,4,8 [--jobs N]` | Local capacity measurement |
| `awrm passes demo --source local-a --target local-b` | classify → Pass → summarize, plus a refused authority-carrying Pass |
| `awrm interop check --protocol purl\|acsp --offline` / `--live <url>` | Adapter scenario against a recording or a live reference server |
| `awrm experiments run --all` / `… run E005 CHAIN` | Runs experiments; writes `research/results/*.json` |
| `awrm report` | Verdict table from the latest full run + self-audit status |
| `awrm audit` | Static self-audit (exit 7 on error findings) |
| `awrm serve [--port 7357]` | Long-running loopback API; token in `$AWRM_HOME/api-token` (0600) |

Ports available to `awrm run`: `owned-fixture`, `local-a`, `local-b` (deterministic
test doubles) and `onnx-local` (real model; first use downloads ~80 MB of public
weights to `$AWRM_MODEL_CACHE` or `~/.cache/awrm/models`).

## Environment variables

| Variable | Meaning |
|---|---|
| `AWRM_HOME` | Data directory (default `./.awrm`): store, API token |
| `AWRM_STORE` | `jsonl` (default) or `sqlite` |
| `AWRM_RESULTS_DIR` | Where experiments write results (default `research/results`) |
| `AWRM_PURL_URL`, `AWRM_ACSP_URL` | Live black-box reference servers for E008 / interop |
| `AWRM_MODEL_CACHE` | Model weight cache |
| `AWRM_SKIP_BROWSER=1`, `AWRM_SKIP_MODEL=1` | Mark those experiment paths NOT_RUN |
| `AWRM_TEST_MODEL=1` | Enable the real-model unit test |
| `AWRM_SECRET_<NAME>` | Value for vault handle `vault:<name>` (owner-provided; never logged) |

## Enabling an official API (owner action)

1. Read and accept the provider's API terms yourself.
2. `export AWRM_SECRET_ANTHROPIC_KEY=…` in your own shell (never in chat or files).
3. Register a seat `{provider: 'anthropic', credentialRef: 'vault:anthropic_key', permissionRecordIds: ['perm.anthropic.api'], quotaKey: 'anthropic:<you>'}`,
   record `ownerPermission: 'granted'` on `perm.anthropic.api`, and configure the
   quota ledger with your known limit. Unknown limit ⇒ the Gate still denies.

No consumer website path can be enabled this way; those records say
`prohibited`/`unknown` and the Gate denies them regardless of owner consent.

## Reproducing the published results

```bash
scripts/start-reference-servers.sh
export AWRM_PURL_URL=http://127.0.0.1:18080 AWRM_ACSP_URL=http://127.0.0.1:18090
node bin/awrm.mjs experiments run --all
node --import tsx scripts/reproduce.ts          # runs everything twice, compares digests
node --import tsx scripts/chart.ts              # regenerates research/results/E005-scaling.svg
node --import tsx scripts/lexicon.ts            # regenerates research/lexicon.json + LEXICON.md
```

## Troubleshooting

* `human-login-required` — the port needs a human sign-in in the seat's profile; AWRM will not do it.
* `gate-denied: quota-unknown` — configure a known allowance for that quotaKey, or use a local port.
* `journal corrupted at line N` — a mid-file corruption of `journal.jsonl`; a torn final line is repaired automatically, anything else needs manual inspection.
