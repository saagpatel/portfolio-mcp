.PHONY: check

check:
	@if [ ! -d node_modules ]; then echo 'run `npm ci`' >&2; exit 1; fi
	bash -n scripts/audit-mcp.sh
	@if command -v shellcheck >/dev/null 2>&1; then shellcheck scripts/audit-mcp.sh; else echo 'shellcheck not installed; skipped'; fi
	npm run lint
	npm run format:check
	npm run typecheck
	npm run build:cli
	npm test
	npm test -- test/stdio.test.ts
	npm run parity
	npm pack --dry-run --json --cache .npm-cache | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const files=JSON.parse(s)[0].files.map(f=>f.path);if(!files.includes("dist/stdio.js")){console.error("npm pack is missing dist/stdio.js");process.exit(1)}console.log("dist/stdio.js listed")})'
	npm run smoke
