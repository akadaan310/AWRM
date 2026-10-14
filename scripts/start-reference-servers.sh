#!/usr/bin/env bash
# Starts the PURL/0.1 and ACSP/0.1 reference implementations as SEPARATE black
# boxes in a scratch directory, for live interop verification (E008 /
# `awrm interop check --live`). Nothing from these repositories is imported
# into AWRM; we only talk to them over HTTP.
#
#   scripts/start-reference-servers.sh [workdir]
#   export AWRM_PURL_URL=http://127.0.0.1:18080 AWRM_ACSP_URL=http://127.0.0.1:18090
set -euo pipefail
WORK="${1:-${TMPDIR:-/tmp}/awrm-reference-servers}"
PURL_REV=3df4452a3624b3f5492bf23c2dacc49d8d2b33c7
ACSP_REV=9fcf2e1da3ce01a4e66eb5be5e2249b1f211878b
mkdir -p "$WORK"
cd "$WORK"
[ -d purl ] || git clone -q https://github.com/akadaan310/purl purl
[ -d acsp ] || git clone -q https://github.com/akadaan310/NetGovComEduGovOrgEduGovComNet acsp
git -C purl checkout -q "$PURL_REV"
git -C acsp checkout -q "$ACSP_REV"
(cd acsp && [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null)
(cd purl && PORT=18080 HOST=127.0.0.1 nohup node src/transport/main.js > "$WORK/purl.log" 2>&1 &)
(cd acsp && ACSP_PGLITE_DIR="$WORK/acsp-data" nohup npx next dev -p 18090 -H 127.0.0.1 > "$WORK/acsp.log" 2>&1 &)
for i in $(seq 1 60); do
  if curl -fs http://127.0.0.1:18080/.well-known/purl >/dev/null && curl -fs http://127.0.0.1:18090/.well-known/acsp >/dev/null; then
    echo "PURL  http://127.0.0.1:18080  (akadaan310/purl@$PURL_REV)"
    echo "ACSP  http://127.0.0.1:18090  (akadaan310/NetGovComEduGovOrgEduGovComNet@$ACSP_REV)"
    echo "export AWRM_PURL_URL=http://127.0.0.1:18080 AWRM_ACSP_URL=http://127.0.0.1:18090"
    exit 0
  fi
  sleep 2
done
echo "reference servers did not come up; see $WORK/*.log" >&2
exit 1
