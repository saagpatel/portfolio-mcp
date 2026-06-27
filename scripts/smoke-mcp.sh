#!/usr/bin/env bash
# Local Workers-runtime smoke test: boot `wrangler dev`, drive the MCP protocol
# over HTTP against the real workerd runtime, then tear it down.
#
#   bash scripts/smoke-mcp.sh
#
# Confirms the bundle builds, nodejs_compat is sufficient, and the stateless
# streamable-HTTP transport answers initialize + tools/call under workerd.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
LOG="$(mktemp -t wdev.XXXXXX)"

npx wrangler dev --port 8787 --ip 127.0.0.1 >"$LOG" 2>&1 &
WPID=$!

ready=0
secs=0
for i in $(seq 1 120); do
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787/" 2>/dev/null)
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
echo "ready=$ready after ${secs}s (root returned HTTP ${code})"

if [ "$ready" = "1" ]; then
	echo "--- initialize ---"
	curl -sS -X POST "http://127.0.0.1:8787/mcp" \
		-H 'Content-Type: application/json' \
		-H 'Accept: application/json, text/event-stream' \
		-d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
	echo
	echo "--- tools/call search (query=verification, limit=2) ---"
	curl -sS -X POST "http://127.0.0.1:8787/mcp" \
		-H 'Content-Type: application/json' \
		-H 'Accept: application/json, text/event-stream' \
		-d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"verification","limit":2}}}'
	echo
fi

kill "$WPID" 2>/dev/null
pkill -f "wrangler dev" 2>/dev/null
echo "=== wrangler log ==="
cat "$LOG"
rm -f "$LOG"
