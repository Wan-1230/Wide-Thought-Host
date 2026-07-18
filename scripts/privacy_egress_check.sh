#!/usr/bin/env bash
# Privacy egress check: run release `wth` through a local CONNECT proxy and
# fail if denylisted destinations appear in the host log.
#
# Does not require MITM / TLS interception — only CONNECT hostnames are recorded.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BIN="${WTH_BIN:-target/release/wth}"
if [[ ! -x "$BIN" ]]; then
  echo "Building release wth..."
  cargo build -p xai-grok-pager-bin --release
  BIN=target/release/wth
fi

BASE_TMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
WORKDIR="${PRIVACY_EGRESS_WORKDIR:-$(mktemp -d "${BASE_TMP}/wth-privacy-egress.XXXXXX")}"
mkdir -p "$WORKDIR"
LOG="$WORKDIR/hosts.txt"
PROXY_PORT="${PRIVACY_EGRESS_PORT:-18080}"
LISTEN="127.0.0.1:${PROXY_PORT}"
echo "$WORKDIR" >"$WORKDIR/workdir.path"

# Destinations that must never appear during a privacy-hard-off smoke session.
DENY_REGEX='(mixpanel\.com|api\.mixpanel\.com|x\.ai|storage\.googleapis\.com|sentry\.io|ingest\.sentry\.io)'

python3 "$ROOT/scripts/privacy_egress_proxy.py" --listen "$LISTEN" --log "$LOG" &
PROXY_PID=$!
cleanup() {
  kill "$PROXY_PID" 2>/dev/null || true
  wait "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT

# --- Readiness: proxy process alive AND accepts TCP ---
READY=0
for _ in $(seq 1 50); do
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "FAIL: privacy egress proxy process exited during startup (pid=$PROXY_PID)"
    exit 1
  fi
  if python3 -c "import socket; s=socket.create_connection(('127.0.0.1',${PROXY_PORT}),0.2); s.close()" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.1
done
if [[ "$READY" -ne 1 ]]; then
  echo "FAIL: privacy egress proxy did not become ready on ${LISTEN}"
  exit 1
fi
echo "proxy ready on ${LISTEN} (pid=$PROXY_PID)"

# --- Positive control: CONNECT a sentinel host so the log must gain a line ---
# (CONNECT is logged before the upstream connect attempt; failure is OK.)
python3 - <<PY
import socket
s = socket.create_connection(("127.0.0.1", ${PROXY_PORT}), 2)
req = (
    b"CONNECT positive-control.test:443 HTTP/1.1\r\n"
    b"Host: positive-control.test:443\r\n"
    b"\r\n"
)
s.sendall(req)
try:
    s.recv(256)
except OSError:
    pass
s.close()
print("positive control CONNECT sent")
PY

if [[ ! -s "$LOG" ]] || ! grep -Fiq 'positive-control.test' "$LOG"; then
  echo "FAIL: positive control did not record positive-control.test (proxy not capturing)"
  echo "log contents:"; cat "$LOG" || true
  exit 1
fi
echo "positive control recorded host; clearing log before wth smoke"
: >"$LOG"

export HTTP_PROXY="http://${LISTEN}"
export HTTPS_PROXY="http://${LISTEN}"
export ALL_PROXY="http://${LISTEN}"
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTPS_PROXY"
export NO_PROXY=""
export no_proxy=""

export GROK_HOME="$WORKDIR/grok-home"
mkdir -p "$GROK_HOME"
export GROK_TELEMETRY_ENABLED=1
export GROK_TELEMETRY_TRACE_UPLOAD=1

echo "==> wth --version"
"$BIN" --version

echo "==> wth --help (smoke)"
"$BIN" --help >/dev/null

echo "==> wth update (must refuse vendor install without dialing x.ai)"
set +e
UPDATE_OUT="$("$BIN" update 2>&1)"
UPDATE_EC=$?
set -e
echo "$UPDATE_OUT" | head -40
if echo "$UPDATE_OUT" | grep -qiE 'never installs from vendor|rebuild from source|Auto-update is not available'; then
  echo "update path reported privacy/manual messaging (ok)"
elif [[ "$UPDATE_EC" -ne 0 ]]; then
  echo "update exited non-zero (ok for privacy build)"
else
  echo "FAIL: wth update exited 0 without privacy refusal message"
  exit 1
fi

if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "FAIL: proxy died during wth smoke"
  exit 1
fi

sleep 1

echo "==> Host log after wth:"
if [[ -s "$LOG" ]]; then
  sort -u "$LOG" | tee "$WORKDIR/hosts.unique.txt"
else
  echo "(empty — no CONNECT/HTTP destinations after positive control clear)"
  : >"$WORKDIR/hosts.unique.txt"
fi

if grep -Ei "$DENY_REGEX" "$WORKDIR/hosts.unique.txt" >/dev/null 2>&1; then
  echo "FAIL: denylisted destination(s) observed:"
  grep -Ei "$DENY_REGEX" "$WORKDIR/hosts.unique.txt" || true
  exit 1
fi

echo "PASS: no denylisted privacy/vendor destinations in egress log"
echo "WORKDIR=$WORKDIR"
