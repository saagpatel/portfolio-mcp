#!/usr/bin/env bash
# Local Workers-runtime smoke test: boot `wrangler dev`, drive the MCP protocol
# over HTTP against the real workerd runtime, then tear it down.
#
#   bash scripts/smoke-mcp.sh
#
# Confirms the bundle builds, nodejs_compat is sufficient, and the stateless
# streamable-HTTP transport answers initialize + tools/call under workerd.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
LOG="$(mktemp -t wdev.XXXXXX)"
PORT="${PORT:-$(python3 - <<'PY'
import socket

with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    print(s.getsockname()[1])
PY
)}"

npx wrangler dev --port "$PORT" --ip 127.0.0.1 >"$LOG" 2>&1 &
WPID=$!
cleanup() {
	kill "$WPID" 2>/dev/null || true
	pkill -P "$WPID" 2>/dev/null || true
	echo "=== wrangler log ==="
	cat "$LOG"
	rm -f "$LOG"
}
trap cleanup EXIT

ready=0
secs=0
for i in $(seq 1 120); do
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/mcp" 2>/dev/null || true)
	[ -z "$code" ] && code=000
	if [ "$code" != "000" ]; then
		ready=1
		secs=$i
		break
	fi
	if ! kill -0 "$WPID" 2>/dev/null; then
		echo "!! wrangler exited early"
		break
	fi
	sleep 1
done
echo "ready=$ready after ${secs}s (/mcp returned HTTP ${code} on port ${PORT})"

if [ "$ready" != "1" ]; then
	exit 1
fi

node scripts/probe-mcp.mjs --endpoint "http://127.0.0.1:${PORT}/mcp"
