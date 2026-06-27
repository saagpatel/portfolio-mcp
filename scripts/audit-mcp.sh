#!/usr/bin/env bash
# Connected MCPAudit scan of THIS server against a local wrangler dev instance.
# Scans only our server (--config-only), runs the deep checks, prints the grade.
#
#   bash scripts/audit-mcp.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
CFG="$(mktemp -t mcpcfg.XXXXXX)"
REPORT="$(dirname "$0")/../.audit-report.json"
LOG="$(mktemp -t wdev.XXXXXX)"

printf '%s' '{ "mcpServers": { "saagarpatel-portfolio": { "type": "http", "url": "http://127.0.0.1:8787/mcp" } } }' >"$CFG"

npx wrangler dev --port 8787 --ip 127.0.0.1 >"$LOG" 2>&1 &
WPID=$!
ready=0
for i in $(seq 1 120); do
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787/" 2>/dev/null)
	[ -z "$code" ] && code=000
	if [ "$code" != "000" ]; then ready=1; break; fi
	if ! kill -0 "$WPID" 2>/dev/null; then echo "!! wrangler exited early"; break; fi
	sleep 1
done
echo "wrangler dev ready=$ready (root HTTP $code)"

if [ "$ready" = "1" ]; then
	echo "=== mcp-audit connected scan ==="
	mcp-audit scan --config "$CFG" --config-only \
		--inject-check --ssrf-check --trifecta-check --shadow-check \
		--json "$REPORT" --verbose 2>&1 || echo "(mcp-audit exit $?)"
	echo
	echo "=== JSON report structure ==="
	python3 - "$REPORT" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("could not read report:", e); sys.exit(0)
print("top-level keys:", list(d) if isinstance(d, dict) else type(d).__name__)
servers = d.get("servers", []) if isinstance(d, dict) else []
for s in servers:
    print(f"\nSERVER: {s.get('name')}")
    for k in ("risk_score", "risk", "grade", "transport", "permissions"):
        if k in s: print(f"  {k}: {s[k]}")
    findings = s.get("findings", [])
    print(f"  findings: {len(findings)}")
    for f in findings:
        print(f"    - [{f.get('severity','?')}] {f.get('rule_id', f.get('id',''))}: {f.get('title', f.get('message',''))}")
PY
fi

kill "$WPID" 2>/dev/null
pkill -f "wrangler dev" 2>/dev/null
rm -f "$CFG" "$LOG"
echo "report kept at: $REPORT"
