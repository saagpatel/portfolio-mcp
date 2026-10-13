# Purpose

portfolio-mcp provides read-only MCP access to the public portfolio corpus over
HTTP and stdio.

# Layout

- `src/server.ts`: shared tools, resources, and prompts.
- `src/index.ts` and `src/stdio.ts`: HTTP Worker and stdio transports.
- `src/corpus.generated.ts`: checked-in, generated public-safe corpus.
- `scripts/build-corpus.mjs`: builds the corpus from public index artifacts.
- `test/`: unit, protocol, corpus-builder, and stdio tests.

# Setup

Use the versions pinned in `.node-version` and `package.json`.

```sh
npm ci
```

# Checks

Run the complete local gate:

```sh
make check
```

The check includes lint, formatting, typecheck, tests, both transports, smoke,
parity, and package contents.

# Boundaries

- Use only the checked-in public-safe corpus for normal work. Do not import
  private portfolio data or sibling-repository content.
- Do not publish packages, deploy Workers, or sign manifests as part of code
  changes.
- Never copy signing keys, Wrangler credentials, or local environment files.
- Keep runtime access read-only and stateless.

# Delivery

Keep changes focused. Run the relevant checks and report their real results.
Publishing, deployment, signing, and registry release work require separate
operator authorization.

Pinned dependency notes:
- `vite` stays at 6.4.3, the currently tested Vite 6 release used with Vitest
  5.0.3. Major upgrades are outside the current scope.
- The `undici` override holds Wrangler's Miniflare dependency to the v7 API
  line while Miniflare declares 7.29.1; the lockfile resolves the compatible
  v7 release without moving to a new major.
