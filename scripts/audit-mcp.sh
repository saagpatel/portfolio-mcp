#!/usr/bin/env bash
# Connected MCPAudit scan of this server against a local wrangler instance.
set -euo pipefail
cd "$(dirname "$0")/.."

CFG=""
LOG=""
WPID=""
REPORT="$(dirname "$0")/../.audit-report.json"

cleanup() {
	if [[ -n "$WPID" ]] && kill -0 "$WPID" 2>/dev/null; then
		kill "$WPID" 2>/dev/null || true
		wait "$WPID" 2>/dev/null || true
	fi
	[[ -z "$CFG" ]] || rm -f "$CFG"
	[[ -z "$LOG" ]] || rm -f "$LOG"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rm -f "$REPORT"
CFG="$(mktemp -t mcpcfg.XXXXXX)"
LOG="$(mktemp -t wdev.XXXXXX)"
printf '%s' '{ "mcpServers": { "saagarpatel-portfolio": { "type": "http", "url": "http://127.0.0.1:8787/mcp" } } }' >"$CFG"

npx wrangler dev --port 8787 --ip 127.0.0.1 >"$LOG" 2>&1 &
WPID=$!
ready=0
code=000
for _ in $(seq 1 120); do
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787/" 2>/dev/null || true)
	[[ -n "$code" ]] || code=000
	if [[ "$code" != 000 ]]; then ready=1; break; fi
	if ! kill -0 "$WPID" 2>/dev/null; then echo "!! wrangler exited early"; break; fi
	sleep 1
done
echo "wrangler dev ready=$ready (root HTTP $code)"
if [[ "$ready" != 1 ]]; then
	cat "$LOG"
	exit 1
fi

echo "=== mcp-audit connected scan ==="
scanner_status=0
if mcp-audit scan --config "$CFG" --config-only \
	--inject-check --ssrf-check --trifecta-check --shadow-check \
	--json "$REPORT" --verbose; then
	scanner_status=0
else
	scanner_status=$?
fi

echo
echo "=== JSON report structure ==="
report_status=0
if [[ -f "$REPORT" ]]; then
python3 - "$REPORT" <<'PY' || report_status=$?
import json, sys
with open(sys.argv[1], encoding="utf-8") as report_file:
    data = json.load(report_file)
print("top-level keys:", list(data) if isinstance(data, dict) else type(data).__name__)
servers = data.get("servers", []) if isinstance(data, dict) else []
for server in servers:
    print(f"\nSERVER: {server.get('name')}")
    for key in ("risk_score", "risk", "grade", "transport", "permissions"):
        if key in server:
            print(f"  {key}: {server[key]}")
    findings = server.get("findings", [])
    print(f"  findings: {len(findings)}")
    for finding in findings:
        print(
            f"    - [{finding.get('severity', '?')}] "
            f"{finding.get('rule_id', finding.get('id', ''))}: "
            f"{finding.get('title', finding.get('message', ''))}"
        )
PY
else
	echo "scanner did not write a report"
	report_status=1
fi

if [[ "$scanner_status" != 0 ]]; then exit "$scanner_status"; fi
if [[ "$report_status" != 0 ]]; then exit "$report_status"; fi
